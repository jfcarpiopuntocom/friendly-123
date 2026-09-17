// sync-yjs.js — PLAN C del sync redundante (CRDT / Yjs). FASE 0, spike.
//
// POR QUÉ EXISTE (JFC 2026-09-10): el sync casero (sync-realtime.js: relay +
// Lamport + LWW + vector) funciona, pero JFC quiere REDUNDANCIA real en cascada
// de fallbacks (diseño suyo): Plan A = nube propia del usuario, Plan B = 2ª nube
// propia, Plan C = CRDT device-to-device que sirve AUNQUE todas las nubes estén
// caídas. Yjs es ese piso garantizado. Aquí se construye Plan C PRIMERO porque no
// depende de nadie y da alivio inmediato.
//
// SEGURIDAD / PRIME DIRECTIVE: ningún dato del cliente sale sin cifrar. Se usa el
// MISMO esquema del sync actual (PBKDF2 del código de sala -> AES-GCM). El código
// nunca viaja. El relay solo rebota bytes que no puede leer.
//
// ENCENDIDO POR DEFECTO (JFC 2026-09-15): es el único motor que cruza los BYTES
// de las fotos device-to-device (sala "-fotos"). Solo se apaga si el dueño guarda
// localStorage["OC_YJS_FASE0"] === "0". NO cuesta nada al que trabaja solo:
// arrancar() no hace nada sin cuaderno compartido. Corre EN PARALELO al sync casero, en una
// SALA DISTINTA del relay (sufijo "-y"), así los updates binarios de Yjs jamás
// llegan al handler JSON de sync-realtime.js.
// FASE 1 (2026-09-10): sincroniza TODAS las colecciones del catálogo (productos,
// ubicaciones, usuarios, clientes) como Y.Maps de un mismo Y.Doc.
// FASE 2 (2026-09-09, JFC "ya conectalo, world class"): Plan C YA lee/escribe el
// store REAL de la app (mock-backend.js). store->Yjs con OCSync.catalogoPropio();
// Yjs->store con OCSync.aplicarCatalogo() — el merge ADD-ONLY ya probado en
// producción: nunca borra, nunca pierde, los merges son aditivos. Ver conectarStore().
// Flag OC_YJS_FASE0 (toggle en Avanzado) ahora es escotilla de APAGADO ("0");
// corre en paralelo al sync casero y en sala de relay separada ("-y").
(function () {
  "use strict";

  var FLAG = "OC_YJS_FASE0";
  /* SYNC NUEVO ENCENDIDO POR DEFECTO (JFC 2026-09-15). Antes estaba detrás del
     flag apagado y por eso los BYTES de las fotos nunca cruzaban (solo este
     motor los mueve, sala "-fotos"). Ahora corre para todos, EN PARALELO al
     sync viejo (no lo reemplaza: menos riesgo). Escotilla de escape: si el
     toggle de Avanzado guarda "0" explícito, se apaga. Sin clave (null) = ON. */
  function activo() { try { return localStorage.getItem(FLAG) !== "0"; } catch (_) { return true; } }
  if (!activo()) return; // solo se apaga si el dueño lo puso en "0" a mano

  // Mismos parámetros que sync-realtime.js (NO cambiar sin cambiar allá también).
  var ROOM_KEY = "f123_sync_room";
  var SALT_FIJO = "amigable-sync-v1";
  var RELAY_URL = "wss://friendly123-sync-relay.jfcarpio.workers.dev/sala/";
  var BUNDLE = "./vendor/yjs-bundle.min.js";

  function leerSala() { try { return JSON.parse(localStorage.getItem(ROOM_KEY) || "null"); } catch (_) { return null; } }
  function normalizarCodigo(c) { return String(c || "").trim().toUpperCase(); }

  async function derivarClave(codigo) {
    var enc = new TextEncoder();
    var base = await crypto.subtle.importKey("raw", enc.encode(codigo), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey(
      { name: "PBKDF2", salt: enc.encode(SALT_FIJO), iterations: 100000, hash: "SHA-256" },
      base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]
    );
  }
  async function idDeSala(codigo) {
    var enc = new TextEncoder();
    var hash = await crypto.subtle.digest("SHA-256", enc.encode("amigable-sala:" + codigo));
    return [].slice.call(new Uint8Array(hash)).map(function (b) { return b.toString(16).padStart(2, "0"); }).join("").slice(0, 40);
  }
  // Cifrado BINARIO (updates de Yjs son bytes, no JSON): AES-GCM, iv de 12 al frente.
  async function cifrarBin(clave, bytes) {
    var iv = crypto.getRandomValues(new Uint8Array(12));
    var cif = await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv }, clave, bytes);
    var out = new Uint8Array(iv.length + cif.byteLength);
    out.set(iv, 0); out.set(new Uint8Array(cif), iv.length);
    return out.buffer;
  }
  async function descifrarBin(clave, buffer) {
    var bytes = new Uint8Array(buffer);
    var iv = bytes.slice(0, 12), cif = bytes.slice(12);
    var claro = await crypto.subtle.decrypt({ name: "AES-GCM", iv: iv }, clave, cif);
    return new Uint8Array(claro);
  }

  // ===================================================================
  // CANAL DE RELAY con HANDSHAKE de catch-up (JFC 2026-09-10, fix del bug
  // "no sincronizan fotos ni el nombre"). ANTES: cada aparato solo mandaba su
  // estado en onopen; un aparato YA conectado no le compartía nada al que entra
  // DESPUÉS, así que lo puesto antes (nombre, fotos) nunca llegaba (el relay solo
  // rebota, no guarda historia). AHORA: state-vector de Yjs, dos vías y loop-safe.
  //   Marco: 1 byte de tag + payload, todo cifrado.
  //     tag 0 = update binario (aplicar)
  //     tag 1 = "hola": mi state-vector. Quien lo recibe responde con lo que al
  //             otro le falta (tag 0) Y su propio SV (tag 2) para pedir lo suyo.
  //     tag 2 = respuesta de SV: se contesta SOLO con el diff (tag 0), sin re-pedir
  //             (corta el ciclo). Así ambos convergen en un ida y vuelta.
  // Un solo canal por Y.Doc (catálogo, fotos y ops usan cada uno el suyo).
  // ===================================================================
  function _frame(tag, payload) { var out = new Uint8Array(1 + payload.length); out[0] = tag; out.set(payload, 1); return out; }
  function crearCanal(Y, doc, suffix, nombre, permiteCkpt, seedFn) {
    var canal = { ws: null, pend: [] };
    var MAX_OP_BYTES = 250 * 1024; // guard: el relay cierra (1009) frames > 256KB
    var reintentos = 0; // backoff (fix B, JFC 2026-09-10): antes reconectaba fijo
                        // cada 4s; si el relay cerraba (p.ej. frame grande), era una
                        // tormenta de upgrades -> límite diario del worker. Ahora
                        // exponencial con jitter y tope 30s, como el sync viejo.
    function reprogramar() {
      reintentos++;
      var base = Math.min(30000, 1000 * Math.pow(2, Math.min(reintentos, 5))); // 2,4,8,16,32->30s
      var delay = base / 2 + Math.random() * base / 2; // jitter: no todos reconectan a la vez
      setTimeout(conectar, delay);
    }
    function enviar(tag, payload) {
      if (!API.clave) return;
      cifrarBin(API.clave, _frame(tag, payload)).then(function (buf) {
        if (canal.ws && canal.ws.readyState === 1) canal.ws.send(buf); else canal.pend.push(buf);
      }).catch(function () {});
    }
    /* PERSISTENCIA DEL SYNC NUEVO (JFC 2026-09-15, v285). EL BUG DE 3 SEMANAS: el
       relay solo REBOTA los frames binarios de Yjs en vivo, NO los guarda. Así dos
       aparatos solo convergían si estaban abiertos A LA VEZ; abiertos en momentos
       distintos nunca se ponían al día (verificado: al conectar a una sala sin nadie
       en línea llegan 0 mensajes). El relay SÍ sabe persistir, pero solo por el
       protocolo de texto op/ckpt/pull (verificado: envías op, cierras, reconectas,
       pull -> vuelve intacto). Aquí el cliente Yjs USA ese canal: cada update LOCAL
       se guarda como {k:"op"} (el mismo frame binario cifrado, en base64) y al
       conectar se pide {k:"pull"} para recibir todo lo persistido. El relay reenvía
       cada op guardada como frame binario -> cae en manejar() -> tag 0 -> applyUpdate.
       Los updates de Yjs son idempotentes y conmutativos, así que reaplicar todo en
       cada conexión converge sin duplicar. Zero-knowledge intacto: el relay guarda
       bytes cifrados, no entiende nada. */
    var _lamCtr = 0;
    function _b64(buf) { var u = new Uint8Array(buf), s = ""; for (var i = 0; i < u.length; i++) s += String.fromCharCode(u[i]); return btoa(s); }
    canal.enviarUpdate = function (update) {
      if (!API.clave) return;
      cifrarBin(API.clave, _frame(0, update)).then(function (buf) {
        // (a) en vivo, a quien esté conectado ahora
        if (canal.ws && canal.ws.readyState === 1) canal.ws.send(buf); else canal.pend.push(buf);
        // (b) persistente, para quien entre después aunque nadie esté en línea.
        // GUARD DE TAMAÑO (v286, #8): si el frame cifrado supera el tope del relay
        // (256KB -> cierra 1009 -> tormenta de reconexión), NO se persiste como op
        // única. El catálogo/fotos ya viajan troceados; el estado completo se
        // reconstruye vía el checkpoint (encodeStateAsUpdate) que sí cabe o se
        // volverá a intentar. Se avisa en consola para diagnóstico.
        if (buf.byteLength > MAX_OP_BYTES) { try { log("op grande (" + buf.byteLength + "B) no persistida; va en vivo + ckpt"); } catch (_) {} return; }
        try {
          var op = JSON.stringify({ k: "op", id: (Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8)), lam: Date.now() + (++_lamCtr), c: _b64(buf) });
          if (canal.ws && canal.ws.readyState === 1) canal.ws.send(op); else canal.pend.push(op);
        } catch (_) {}
      }).catch(function () {});
    };
    /* CHECKPOINT (v286, #1 + fix real "el catálogo viejo no cruza"). enviarUpdate
       solo persiste CAMBIOS nuevos. Pero el catálogo que ya vivía en el IndexedDB
       de Yjs (de antes de v285) nunca generó una op -> un aparato que hace pull no
       lo recibía. Por eso el item nuevo cruzaba pero el inventario existente no.
       Aquí, al conectar (tras dar tiempo al pull), se manda el ESTADO COMPLETO como
       {k:"ckpt"}: el relay lo guarda como 'latest' y sirve al que entra, y de paso
       poda las ops que resume (compactación). Guardas de seguridad:
         - Solo si el doc tiene contenido real (no pisar el ckpt del relay con un
           doc vacío recién arrancado). El relay además rechaza un ckpt de lam menor
           (C1 guard), así que un aparato que ya hizo pull manda un ckpt superset.
         - Solo en canales con permiteCkpt (catálogo y ops; NO fotos: su estado
           completo supera el frame de 256KB). */
    var _tCkpt = null;
    function hacerCkpt() {
      if (!permiteCkpt || !API.clave || !canal.ws || canal.ws.readyState !== 1) return;
      var full; try { full = Y.encodeStateAsUpdate(doc); } catch (_) { return; }
      if (!full || full.length < 16) return; // doc prácticamente vacío: no pisar el ckpt bueno del relay
      cifrarBin(API.clave, _frame(0, full)).then(function (buf) {
        if (buf.byteLength > MAX_OP_BYTES) { try { log("ckpt grande (" + buf.byteLength + "B) omitido en " + nombre); } catch (_) {} return; }
        try {
          var ck = JSON.stringify({ k: "ckpt", lam: Date.now(), c: _b64(buf) });
          if (canal.ws && canal.ws.readyState === 1) canal.ws.send(ck);
        } catch (_) {}
      }).catch(function () {});
    }
    function conectar() {
      var url = RELAY_URL + API.roomId + suffix;
      var ws; try { ws = new WebSocket(url); } catch (_) { reprogramar(); return; }
      ws.binaryType = "arraybuffer"; canal.ws = ws;
      ws.onopen = function () {
        reintentos = 0; // conexión buena: resetea el backoff
        try { enviar(1, Y.encodeStateVector(doc)); } catch (_) {} // "hola": a quien esté en vivo
        try { ws.send(JSON.stringify({ k: "pull", lam: 0 })); } catch (_) {} // trae lo PERSISTIDO (async)
        while (canal.pend.length && ws.readyState === 1) ws.send(canal.pend.shift());
        // Tras dar tiempo al pull (para que este aparato ya tenga lo de los demás),
        // publicar el estado COMPLETO como checkpoint: así el catálogo que ya tenía
        // (aunque nunca haya cambiado desde v285) queda disponible para el que entre.
        if (permiteCkpt) { clearTimeout(_tCkpt); _tCkpt = setTimeout(hacerCkpt, 2500); }
        // Canal sin ckpt (fotos): sembrado propio al conectar (cada foto va como
        // op individual, que sí cabe en el frame). Tras dar tiempo al pull.
        if (seedFn) setTimeout(function () { try { seedFn(); } catch (_) {} }, 3200);
      };
      function manejar(buf) {
        descifrarBin(API.clave, buf).then(function (bytes) {
          var tag = bytes[0], payload = bytes.subarray(1);
          if (tag === 0) { Y.applyUpdate(doc, payload, "red"); }
          else if (tag === 1) { // me saludan: les mando lo que les falta + mi SV para pedir lo mío
            try { enviar(0, Y.encodeStateAsUpdate(doc, payload)); } catch (_) {}
            try { enviar(2, Y.encodeStateVector(doc)); } catch (_) {}
          } else if (tag === 2) { // respuesta a mi SV: solo el diff, sin re-pedir (corta el loop)
            try { enviar(0, Y.encodeStateAsUpdate(doc, payload)); } catch (_) {}
          }
        }).catch(function () {}); // basura o clave distinta -> se ignora
      }
      ws.onmessage = function (ev) {
        if (!API.clave) return;
        var d = ev.data;
        // ROBUSTEZ (JFC 2026-09-10, world-class): normalmente con binaryType
        // "arraybuffer" llega un ArrayBuffer, pero algunos navegadores/proxies
        // entregan un Blob aunque se pida ArrayBuffer. Se aceptan AMBOS. Los
        // frames de texto (que no son nuestros marcos binarios) se ignoran.
        if (d instanceof ArrayBuffer) manejar(d);
        else if (typeof Blob !== "undefined" && d instanceof Blob) { try { d.arrayBuffer().then(manejar).catch(function () {}); } catch (_) {} }
      };
      ws.onclose = function () { canal.ws = null; reprogramar(); };
      ws.onerror = function () { try { ws.close(); } catch (_) {} };
    }
    canal.conectar = conectar;
    return canal;
  }

  // Carga perezosa del bundle vendorizado (solo si el flag está encendido, para no
  // pagar 94kb de parse a quien no prueba). Sin CDN: es un archivo del shell.
  function cargarBundle() {
    return new Promise(function (resolve, reject) {
      if (window.Y && window.IndexeddbPersistence) return resolve();
      var s = document.createElement("script");
      s.src = BUNDLE; s.async = true;
      s.onload = function () { (window.Y && window.IndexeddbPersistence) ? resolve() : reject(new Error("bundle sin Y")); };
      s.onerror = function () { reject(new Error("no se pudo cargar " + BUNDLE)); };
      document.head.appendChild(s);
    });
  }

  // Fase 1: TODAS las colecciones del catálogo, no solo productos. Cada una es
  // un Y.Map dentro del mismo Y.Doc, así un solo update binario las cubre todas
  // y convergen juntas. La lista es la misma que viaja hoy en el sync casero
  // (ver _acumularCatalogo en sync-realtime.js): ubicaciones, productos,
  // usuarios, clientes. Agregar aquí una colección nueva es una línea.
  // JFC 2026-09-10 ("sync integral, shared notebook"): se suman las entidades
  // definicionales que faltaban — promotoras (comisionistas) y sucursales. Son
  // como el catálogo: se mergean add-only (nunca se pisa una ya existente, así no
  // se adivina sobre comisiones/plata). Las VENTAS y el dinero NO van por aquí: eso
  // lo maneja el sync de ops (sync-realtime) con orden causal; meterlo al add-only
  // ciego duplicaría plata. Ver aplicarCatalogo() en mock-backend.js.
  var COLECCIONES = ["productos", "ubicaciones", "usuarios", "clientes", "promotoras", "sucursales", "ventas", "dispositivos"];
  /* VENTAS (dinero) POR EL SYNC NUEVO (JFC 2026-09-16, aprobado). Antes el dinero
     viajaba solo por el sync viejo (sync-realtime, frágil). Ahora las ventas cruzan
     por Yjs, ADD-ONLY por id (cada venta una sola vez -> no se duplica plata). No
     hay doble descuento de stock porque el stock es LWW ABSOLUTO aparte (v289), no
     se re-deriva de estas ventas. Para NO reventar el frame de 256KB con historiales
     grandes, las ventas NO van en el batch de sembrar(); se siembran como op
     INDIVIDUAL (una mini-actualización por venta, igual que las fotos). */
  /* DISPOSITIVOS (apodos "This device") POR EL SYNC NUEVO (v298, JFC 2026-09-16).
     Antes los apodos viajaban por micelio sobre el sync VIEJO (frágil) y no cruzaban
     bien. Ahora cada aparato publica su entrada {id,apodo,rol} en la colección
     "dispositivos" (add-only por id; el aparato es dueño de SU entrada). Al recibir,
     aplicarCatalogo alimenta la lista de micelio (OCMicelio.recibir) para que el
     dueño vea sus aparatos en Advanced. Va en el batch: es diminuto. */
  var COLECCIONES_BATCH = ["productos", "ubicaciones", "usuarios", "clientes", "promotoras", "sucursales", "dispositivos"];
  var API = {
    estado: "apagado", doc: null, mapas: {}, clave: null, ws: null, bc: null, roomId: null, colecciones: COLECCIONES,
    // API genérica por colección (probar convergencia a mano o desde código).
    set: function (col, id, obj) { var m = this.mapas[col]; if (!m) return false; m.set(String(id), obj); return true; },
    get: function (col) { var o = {}, m = this.mapas[col]; if (m) m.forEach(function (v, k) { o[k] = v; }); return o; },
    del: function (col, id) { var m = this.mapas[col]; if (!m) return false; m.delete(String(id)); return true; },
    // Atajos retro-compatibles con la Fase 0.
    setProducto: function (id, obj) { return this.set("productos", id, obj); },
    getProductos: function () { return this.get("productos"); },
    _diag: function () {
      var n = {}, self = this; this.colecciones.forEach(function (c) { n[c] = self.mapas[c] ? self.mapas[c].size : 0; });
      var rs = function (cn) { return cn && cn.ws ? cn.ws.readyState : null; };
      return { estado: this.estado, roomId: this.roomId, n: n,
        ws: { catalogo: rs(this.canal), fotos: rs(this.fotosCanal), ops: rs(this.opsCanal) },
        meta: { nombre: this.meta ? this.meta.get("nombreNegocio") : null, esDueno: this.meta ? this.meta.get("nombreEsDueno") : null },
        fotos: this.fotosMap ? this.fotosMap.size : 0, ops: this.opsMap ? this.opsMap.size : 0 };
    }
  };
  window.OCYjs = API;

  function log(/*...*/) { try { console.log.apply(console, ["[OCYjs]"].concat([].slice.call(arguments))); } catch (_) {} }

  async function arrancar() {
    /* UNA LICENCIA = UNA SALA (v295, JFC 2026-09-16). "salas"/f123_sync_room es
       VESTIGIAL y ya NO decide nada: la sala es SIEMPRE la LICENCIA
       (f123_owned.licenseCode). Antes f123_sync_room podía quedar desalineado de la
       licencia y mandar el aparato a otra sala -> no convergía. Ya no se lee como
       fuente de sala. Si el aparato no tiene licencia (demo/sin activar), no hay
       sync. La CLAVE y la sala salen de la MISMA licencia, así todos los aparatos
       de una licencia caen en la misma sala, siempre. */
    var _licProp = "";
    try { var _ow = JSON.parse(localStorage.getItem("f123_owned") || "null") || {}; if (_ow.licenseCode) _licProp = String(_ow.licenseCode); } catch (_) {}
    if (!_licProp) { log("sin licencia — sin sync (una licencia = una sala; f123_sync_room ya no decide)"); return; }
    var codigo = normalizarCodigo(_licProp);
    try { await cargarBundle(); } catch (e) { log("bundle:", e && e.message); return; }

    var Y = window.Y;
    API.doc = new Y.Doc();
    COLECCIONES.forEach(function (c) { API.mapas[c] = API.doc.getMap(c); });
    // FASE 2 (JFC 2026-09-09): mapa aparte para el nombre del negocio y los PINs
    // de rol, que viajan CON el catálogo pero no son una colección de ítems. Así
    // Plan C converge un negocio completo por sí solo, sin depender del sync casero.
    API.meta = API.doc.getMap("_meta");
    API.clave = await derivarClave(codigo);
    /* LIMPIEZA (2026-09-16): SOLO la licencia canonica de JFC estrena sala NUEVA
       para abandonar la sala de catalogo contaminada con semilla (la vieja queda
       huerfana e hibernada, sin costo). Gated EXACTO: ninguna otra licencia
       (idiomARTE incluida) cambia de sala. La CLAVE sigue derivada de la licencia,
       asi los aparatos de JFC se entienden en la sala nueva. Ver la purga local
       gated en mock-backend.js. */
    var _salaId = (codigo === "F123-A6YK-6V1J-BF2A-S2J24") ? (codigo + "::limpio-2026-09-16") : codigo;
    API.roomId = await idDeSala(_salaId);

    // Persistencia local: sobrevive recargas y sirve offline (piso del piso).
    // Guardamos la referencia: al terminar de cargar de IndexedDB ("synced")
    // hacemos el primer volcado Yjs->store, para que un aparato que arranca
    // offline ya vea lo que otro dejó, sin esperar al relay (Fase 2).
    try { API.idb = new window.IndexeddbPersistence("f123-yjs-" + API.roomId, API.doc); } catch (e) { log("idb:", e && e.message); }

    // Convergencia entre pestañas del MISMO origen: instantánea, sin red.
    try {
      API.bc = new BroadcastChannel("f123-yjs-" + API.roomId);
      API.bc.onmessage = function (ev) { try { Y.applyUpdate(API.doc, new Uint8Array(ev.data), "bc"); } catch (_) {} };
    } catch (_) {}

    // Cada cambio local -> update binario -> (a) pestañas por BroadcastChannel,
    // (b) otros dispositivos por el relay cifrado. origin !== "bc"/"red" evita eco.
    API.canal = crearCanal(Y, API.doc, "-y", "catalogo", true); // ckpt: catálogo cabe
    API.doc.on("update", function (update, origin) {
      if (origin === "bc" || origin === "red") return;
      try { if (API.bc) API.bc.postMessage(update.buffer.slice ? update.buffer : update); } catch (_) {}
      API.canal.enviarUpdate(update);
    });

    // B3 (JFC 2026-09-10): documento SEPARADO para los BYTES de las fotos. NO van
    // en el doc del catálogo (lo inflarían): aquí cada foto es hash -> dataURL,
    // converge por su propia sala de relay ("-fotos"), persiste en su propio
    // IndexedDB y entre pestañas por su BroadcastChannel. Content-addressed: una
    // foto (un hash) se escribe una sola vez. Así las fotos cruzan device-to-device
    // sin nube; la nube durable del dueño (Google Drive) es una fase posterior.
    API.fotosDoc = new Y.Doc();
    API.fotosMap = API.fotosDoc.getMap("blobs");
    try { API.fotosIdb = new window.IndexeddbPersistence("f123-yjs-fotos-" + API.roomId, API.fotosDoc); } catch (_) {}
    try {
      API.fotosBc = new BroadcastChannel("f123-yjs-fotos-" + API.roomId);
      API.fotosBc.onmessage = function (ev) { try { Y.applyUpdate(API.fotosDoc, new Uint8Array(ev.data), "bc"); } catch (_) {} };
    } catch (_) {}
    API.fotosCanal = crearCanal(Y, API.fotosDoc, "-fotos", "fotos", false, sembrarFotosAlRelay); // sin ckpt (fotos exceden 256KB); siembra c/foto como op individual
    API.fotosDoc.on("update", function (update, origin) {
      if (origin === "bc" || origin === "red") { pedirVolcarFotos(); return; } // llegó un blob: guardarlo local
      try { if (API.fotosBc) API.fotosBc.postMessage(update.buffer.slice ? update.buffer : update); } catch (_) {}
      API.fotosCanal.enviarUpdate(update);
    });

    // SYNC DE VENTAS/OPS (JFC 2026-09-10, "que sincronice TODO"). Doc SEPARADO de
    // eventos append-only: opId -> op. Cada venta/movimiento viaja como un hecho
    // inmutable y se aplica UNA sola vez por OCSync.aplicarOpRemota (idempotente
    // por opId). Sala de relay "-ops" aparte. Los ops PROPIOS (mismo deviceId) no
    // se re-aplican: ya se aplicaron al hacer la acción. Esto es event-sourcing
    // sobre CRDT: transporte confiable (Yjs) + aplicación segura (handler probado).
    // Va detrás del MISMO flag y en paralelo al sync viejo (respaldo), así que un
    // op duplicado por los dos transportes se aplica una vez y no dobla la plata.
    API.opsDoc = new Y.Doc();
    API.opsMap = API.opsDoc.getMap("eventos");
    try { API.opsIdb = new window.IndexeddbPersistence("f123-yjs-ops-" + API.roomId, API.opsDoc); } catch (_) {}
    try {
      API.opsBc = new BroadcastChannel("f123-yjs-ops-" + API.roomId);
      API.opsBc.onmessage = function (ev) { try { Y.applyUpdate(API.opsDoc, new Uint8Array(ev.data), "bc"); } catch (_) {} };
    } catch (_) {}
    API.opsCanal = crearCanal(Y, API.opsDoc, "-ops", "ops", true); // ckpt: ops es pequeño
    API.opsDoc.on("update", function (update, origin) {
      if (origin === "bc" || origin === "red") { pedirProcesarEventos(); return; }
      try { if (API.opsBc) API.opsBc.postMessage(update.buffer.slice ? update.buffer : update); } catch (_) {}
      API.opsCanal.enviarUpdate(update);
    });
    // Publicar al doc de ops cada venta/movimiento local (el op EXACTO de sync-realtime).
    window.addEventListener("oc-op-local", function (ev) { try { publicarOpLocal(ev.detail); } catch (_) {} });

    API.canal.conectar();      // catálogo + _meta (nombre, pinsRol) — sala "-y"
    API.fotosCanal.conectar(); // bytes de las fotos — sala "-fotos"
    API.opsCanal.conectar();   // ventas/ops — sala "-ops"
    conectarStore(Y);   // FASE 2: leer/escribir el store REAL de la app (add-only)
    // Al cargar de IndexedDB los blobs ya guardados, volcarlos al store de fotos.
    if (API.fotosIdb && API.fotosIdb.once) API.fotosIdb.once("synced", pedirVolcarFotos);
    // Al cargar los eventos ya guardados, procesarlos (aplica los que falten).
    if (API.opsIdb && API.opsIdb.once) API.opsIdb.once("synced", pedirProcesarEventos);
    API.estado = "activo";
    log("Plan C activo (Fase 2 + fotos + ops). Sala:", API.roomId);
  }

  // ===================================================================
  // VENTAS/OPS device-to-device (event-sourcing sobre CRDT).
  // ===================================================================
  function miDeviceId() {
    try { return String((window.OCSyncControl && window.OCSyncControl.deviceIdActual && window.OCSyncControl.deviceIdActual()) || ""); } catch (_) { return ""; }
  }
  function publicarOpLocal(op) {
    if (!op || !op.opId || !API.opsMap) return;
    try { if (!API.opsMap.get(op.opId)) API.opsMap.set(op.opId, op); } catch (_) {}
  }
  var _tOps = null, _opsProcesadas = null;
  function pedirProcesarEventos() { clearTimeout(_tOps); _tOps = setTimeout(procesarEventos, 200); }
  function procesarEventos() {
    if (!window.OCSync || typeof window.OCSync.aplicarOpRemota !== "function" || !API.opsMap) return;
    if (!_opsProcesadas) _opsProcesadas = {}; // cache liviano por sesión (aplicarOpRemota ya es idempotente igual)
    var mio = miDeviceId(), aplico = false;
    API.opsMap.forEach(function (op, opId) {
      if (!op || _opsProcesadas[opId]) return;
      // ECO: un op PROPIO ya se aplicó al hacer la acción; re-aplicarlo doblaría
      // la plata (el handler NO lo tiene en su set de "vistos", porque nunca pasó
      // por aplicarOpRemota). Se salta explícitamente por deviceId, y se marca
      // procesado (no hay nada que reintentar).
      if (mio && String(op.deviceId) === mio) { _opsProcesadas[opId] = 1; return; }
      try {
        var r = window.OCSync.aplicarOpRemota(op);
        // #4 (fix 2026-09-10): marcar procesado SOLO si el handler respondió ok
        // (aplicado o repetido). Si lanzó, se deja sin marcar para reintentar en
        // el próximo pase. aplicarOpRemota ya es idempotente por opId, así que
        // reintentar es seguro.
        if (r && r.ok) {
          _opsProcesadas[opId] = 1;
          if (!r.repetida) {
            aplico = true;
            try { window.dispatchEvent(new CustomEvent("oc-sync-op-remota", { detail: op })); } catch (_) {}
          }
        }
      } catch (_) { /* sin marcar: se reintenta */ }
    });
    void aplico;
  }

  // ===================================================================
  // B3 — BYTES DE LAS FOTOS device-to-device (doc y relay separados).
  // ===================================================================
  var _tVolcar = null;
  function pedirVolcarFotos() { clearTimeout(_tVolcar); _tVolcar = setTimeout(volcarFotosAlStore, 250); }

  // Yjs(fotos) -> OCFotos (IndexedDB local). Cada hash que llegó y no esté local
  // se guarda; luego se avisa a la UI para que la percha muestre su foto.
  function volcarFotosAlStore() {
    if (!window.OCFotos || !API.fotosMap) return;
    var pend = [], hubo = false;
    API.fotosMap.forEach(function (dataUrl, hash) { pend.push([hash, dataUrl]); });
    var i = 0;
    (function next() {
      if (i >= pend.length) {
        if (hubo) {
          // v290: hidratar fotos de PRODUCTO (poner p.foto desde el hash recibido)
          // para que la UI, que pinta p.foto, muestre la foto que cruzo.
          try { if (window.OCSync && window.OCSync.hidratarFotosProductos) window.OCSync.hidratarFotosProductos(); } catch (_) {}
          try { window.dispatchEvent(new CustomEvent("oc-fotos-actualizadas")); } catch (_) {}
        }
        return;
      }
      var hash = pend[i][0], dataUrl = pend[i][1]; i++;
      Promise.resolve(window.OCFotos.tieneHash(hash)).then(function (ya) {
        if (ya) return next();
        return Promise.resolve(window.OCFotos.guardarPorHash(hash, dataUrl)).then(function () { hubo = true; next(); });
      }).catch(next);
    })();
  }

  /* SEMBRAR FOTOS AL RELAY (v287, JFC 2026-09-16). El bug: publicarFotosLocales
     salta las fotos que YA están en el fotosMap (línea "ya publicado"); pero una
     foto que ya vivía en el Yjs-IDB de fotos nunca genera un update al reconectar
     -> nunca se persiste como {k:op} -> el relay queda con 0 fotos y el otro
     aparato no la recibe (verificado: sala -fotos vacía). Y el canal fotos no tiene
     ckpt (su estado completo supera 256KB). Aquí, al conectar, se RE-manda cada
     foto EN USO como una op INDIVIDUAL (cada dataURL <180KB por la compresión de
     vista-perchas.js, así que cabe en el frame). Se arma un update mínimo (un
     Y.Doc con solo esa foto) y se pasa por enviarUpdate del canal fotos: persiste
     como op + va en vivo. Guard de sesión para no re-mandar la misma foto en cada
     reconexión. */
  var _fotosSembradas = {};
  function sembrarFotosAlRelay() {
    if (!window.OCFotos || !window.OCSync || !API.fotosCanal || !window.Y || !API.fotosDoc) return;
    // Primero: dar hash a las fotos de PRODUCTO que solo estaban inline (v290 fix:
    // la foto de producto no cruzaba porque no tenia fotoHash ni iba por el canal).
    Promise.resolve(window.OCSync.hashearFotosProductos ? window.OCSync.hashearFotosProductos() : 0).then(function () {
      var cat; try { cat = window.OCSync.catalogoPropio(); } catch (_) { return; }
      var hUbic = (cat && cat.ubicaciones || []).map(function (u) { return u.fotoHash; }).filter(Boolean);
      var hProd = (cat && cat.productos || []).map(function (p) { return p.fotoHash; }).filter(Boolean);
      hUbic.concat(hProd).forEach(function (hash) {
        if (_fotosSembradas[hash]) return;
        Promise.resolve(window.OCFotos.leerPorHash(hash)).then(function (dataUrl) {
          if (!dataUrl) return;
          try {
            var d = new window.Y.Doc();
            d.getMap("blobs").set(hash, dataUrl); // FIX v293: el doc real usa "blobs" (no "fotos"); antes la foto caía en un mapa que nadie leía
            var u = window.Y.encodeStateAsUpdate(d);
            _fotosSembradas[hash] = 1;
            // Aplicar con origin "seed" dispara el observador de -fotos (línea ~331)
            // que YA hace enviarUpdate (op + en vivo). NO enviar explícito aparte:
            // duplicaba la op (FIX v293).
            try { window.Y.applyUpdate(API.fotosDoc, u, "seed"); } catch (_) {}
          } catch (_) {}
        }).catch(function () {});
      });
    }).catch(function () {});
  }

  /* SEMBRAR VENTAS (dinero) AL RELAY (v292, JFC 2026-09-16, aprobado). Cada venta
     se manda como op INDIVIDUAL al canal de CATALOGO (mini Y.Doc con esa venta en
     el map "ventas"), no en el batch de sembrar, para no reventar el frame de
     256KB con historiales grandes. Add-only por id: el receptor la suma una sola
     vez (aplicarCatalogo). No duplica plata ni stock (el stock es LWW aparte).
     Guard de sesion para no re-mandar la misma venta. */
  var _ventasSembradas = {};
  function sembrarVentasAlRelay() {
    if (!window.OCSync || !API.canal || !window.Y || !API.doc) return;
    var cat; try { cat = window.OCSync.catalogoPropio(); } catch (_) { return; }
    var ventas = (cat && cat.ventas) || [];
    ventas.forEach(function (v) {
      if (!v || v.id == null) return;
      var id = String(v.id);
      if (_ventasSembradas[id]) return;
      // Si ya está en el map del doc (de un pull), no re-mandar.
      try { if (API.mapas.ventas && API.mapas.ventas.get(id)) { _ventasSembradas[id] = 1; return; } } catch (_) {}
      try {
        var d = new window.Y.Doc();
        d.getMap("ventas").set(id, JSON.parse(JSON.stringify(v)));
        var u = window.Y.encodeStateAsUpdate(d);
        _ventasSembradas[id] = 1;
        // Aplicar con origin "seed" dispara el observador del catálogo (línea ~311)
        // que YA hace enviarUpdate (op + en vivo). NO enviar explícito: duplicaba
        // la op (FIX v293).
        try { window.Y.applyUpdate(API.doc, u, "seed"); } catch (_) {}
      } catch (_) {}
    });
  }

  // OCFotos local -> Yjs(fotos). Publica los blobs de las fotos EN USO (las que
  // alguna percha referencia por fotoHash) que aún no estén en el doc de fotos.
  function publicarFotosLocales() {
    if (!window.OCFotos || !API.fotosMap || !window.OCSync) return;
    var cat; try { cat = window.OCSync.catalogoPropio(); } catch (_) { return; }
    var hUbic = (cat && cat.ubicaciones || []).map(function (u) { return u.fotoHash; }).filter(Boolean);
    var hProd = (cat && cat.productos || []).map(function (p) { return p.fotoHash; }).filter(Boolean); // v290: fotos de producto tambien
    hUbic.concat(hProd).forEach(function (hash) {
      if (API.fotosMap.get(hash)) return; // ya publicado
      Promise.resolve(window.OCFotos.leerPorHash(hash)).then(function (dataUrl) {
        if (dataUrl && !API.fotosMap.get(hash)) { try { API.fotosMap.set(hash, dataUrl); } catch (_) {} }
      }).catch(function () {});
    });
  }


  // ===================================================================
  // FASE 2 (JFC 2026-09-09) — PUENTE AL STORE REAL, sin perder nada.
  //
  // POR QUÉ ASÍ: el sync casero (sync-realtime.js) ya tenía el contrato bueno
  // y probado en producción. NO se reinventa el merge:
  //   store -> Yjs : window.OCSync.catalogoPropio() da la foto de las 4
  //                  colecciones; se vuelca a los Y.Map por id.
  //   Yjs -> store : window.OCSync.aplicarCatalogo(remoto, null), que es el
  //                  merge ADD-ONLY ya probado (nunca borra, nunca pisa un ítem
  //                  existente salvo edición del dueño; el equipo usa LWW con
  //                  reloj lógico + tombstones). Es exactamente lo que pidió JFC:
  //                  "los datos a salvo, los merges aditivos, nunca se pierda nada".
  //
  // rol = null a propósito: Yjs converge sin saber el rol del emisor, así que la
  // regla "el dueño pisa nombre/precio" no aplica por este canal; add-only sí, que
  // es lo que garantiza no perder datos. Si el sync casero sigue encendido, esa
  // regla la resuelve él. Ver aplicarCatalogo() en mock-backend.js.
  //
  // ANTI-BUCLE: al escribir en el store se disparan oc-catalogo-cambiado /
  // oc-equipo-cambiado, que a su vez re-vuelcan a Yjs. Con _aplicando=true durante
  // el volcado y comparando por JSON antes de cada set(), el re-vuelco no genera
  // updates nuevos (no hay diferencias) y el bucle muere solo.
  // ===================================================================
  function conectarStore(Y) {
    if (!window.OCSync || typeof window.OCSync.catalogoPropio !== "function" ||
        typeof window.OCSync.aplicarCatalogo !== "function") {
      log("store no disponible (OCSync) — Plan C queda solo como capa CRDT");
      return;
    }
    var _aplicando = false;   // guard: no re-volcar mientras aplicamos al store
    var _tSeed = null, _tAplica = null;

    // store -> Yjs. Add/update por id; nunca borra del Y.Map (add-only también
    // aguas arriba). Las bajas de equipo viajan como tombstone (borrado:true),
    // que catalogoPropio() sí incluye, así que la baja converge igual.
    function sembrar() {
      if (_aplicando) return;
      var cat;
      try { cat = window.OCSync.catalogoPropio(); } catch (_) { return; }
      if (!cat) return;
      var miRol = ""; try { if (window.OCAuth && OCAuth.rolActual) miRol = OCAuth.rolActual() || ""; } catch (_) {}
      try {
        API.doc.transact(function () {
          COLECCIONES_BATCH.forEach(function (col) {
            var filas = cat[col] || [];
            filas.forEach(function (r) {
              if (!r || r.id == null) return;
              var k = String(r.id);
              var prev = API.mapas[col].get(k);
              var js = JSON.stringify(r);
              // Solo si cambió: evita tormenta de updates binarios por el relay.
              if (!prev || JSON.stringify(prev) !== js) API.mapas[col].set(k, JSON.parse(js));
            });
          });
          /* NOMBRE DEL NEGOCIO (A1, JFC 2026-09-10). No mergeaba porque el
             puente aplicaba con rol=null y aplicarCatalogo solo adopta el nombre
             si el local está vacío. Ahora el nombre del DUEÑO gana, como la regla
             de jerarquía de siempre: guardamos junto al nombre si quien lo puso es
             el dueño; el otro aparato aplica con rolRemoto="dueno" y lo adopta.
             Un no-dueño no pisa un nombre ya marcado como del dueño. */
          if (cat.nombreNegocio) {
            var soyDueno = miRol === "dueno";
            var yaEsDueno = API.meta.get("nombreEsDueno") === true;
            /* DESEMPATE DETERMINISTA (v283, JFC 2026-09-15). Antes un dueño pisaba
               el nombre compartido cada vez que sembraba -> con DOS aparatos dueño
               era una guerra de nombres que nunca convergía. Ahora gana el rename
               de dueño MÁS RECIENTE por sello de tiempo: un dueño solo escribe el
               nombre si su ts es >= al del doc (o si el doc aún no es de dueño). */
            // v290 (#2): desempate PRIMARIO por rev monotónico (inmune a relojes
            // desfasados), secundario por ts.
            var revMeta = Number(API.meta.get("nombreRev")) || 0;
            var revMio = Number(cat.nombreNegocioRev) || 0;
            var tsMeta = Number(API.meta.get("nombreTs")) || 0;
            var tsMio = Number(cat.nombreNegocioTs) || 0;
            if (soyDueno) {
              var _gano = !yaEsDueno || revMio > revMeta || (revMio === revMeta && tsMio >= tsMeta);
              if (_gano) {
                if (API.meta.get("nombreNegocio") !== cat.nombreNegocio) API.meta.set("nombreNegocio", cat.nombreNegocio);
                if (revMio) API.meta.set("nombreRev", revMio);
                if (tsMio) API.meta.set("nombreTs", tsMio);
                if (!yaEsDueno) API.meta.set("nombreEsDueno", true);
              }
            } else if (!yaEsDueno && !API.meta.get("nombreNegocio")) {
              API.meta.set("nombreNegocio", cat.nombreNegocio);
              API.meta.set("nombreEsDueno", false);
            }
          }
          if (cat.pinsRol && JSON.stringify(API.meta.get("pinsRol")) !== JSON.stringify(cat.pinsRol))
            API.meta.set("pinsRol", cat.pinsRol);
        }, "seed"); // origin "seed": estos updates no deben re-aplicarse al store
      } catch (e) { log("sembrar:", e && e.message); }
      // B3: publicar al doc de fotos los blobs de perchas Y productos que tienen
      // foto. Antes se asegura que las fotos de PRODUCTO tengan hash (v290): una
      // foto recien puesta se hashea y se publica sin esperar a reconectar.
      try {
        if (window.OCSync && window.OCSync.hashearFotosProductos) {
          window.OCSync.hashearFotosProductos().then(function () { try { publicarFotosLocales(); } catch (_) {} }).catch(function () { try { publicarFotosLocales(); } catch (_) {} });
        } else { publicarFotosLocales(); }
      } catch (_) { try { publicarFotosLocales(); } catch (_) {} }
      // v292: sembrar las ventas (dinero) como ops individuales (add-only).
      try { sembrarVentasAlRelay(); } catch (_) {}
    }

    // Yjs -> store. Reconstruye el catálogo desde los Y.Map y llama al merge
    // add-only probado. Síncrono: aplicarCatalogo no es async.
    function aplicar() {
      if (_aplicando) return;
      // Genérico sobre COLECCIONES: agregar una colección nueva (promotoras,
      // sucursales…) es una sola línea allá arriba, aquí ya viaja sola.
      var remoto = { nombreNegocio: API.meta.get("nombreNegocio") || "", nombreNegocioTs: Number(API.meta.get("nombreTs")) || 0, nombreNegocioRev: Number(API.meta.get("nombreRev")) || 0, pinsRol: API.meta.get("pinsRol") || null, deviceNombre: "sync" };
      var hay = false;
      COLECCIONES.forEach(function (c) { remoto[c] = valores(c); if (remoto[c].length) hay = true; });
      // #2 (fix 2026-09-10): un update de SOLO el nombre (o pinsRol) también debe
      // aplicarse aunque no haya entidades — antes se descartaba y el nombre nunca
      // llegaba a un aparato que recibió primero el _meta.
      if (!hay && !remoto.nombreNegocio && !remoto.pinsRol) return;
      // rolRemoto="dueno" si el nombre lo puso un dueño (A1): así aplicarCatalogo
      // adopta el nombre del negocio aunque el local ya tenga otro. Para el resto
      // de reglas (nombre/precio de ítems) esto solo habilita que el nombre del
      // dueño gane; el add-only del catálogo no cambia.
      var rolRemoto = (API.meta.get("nombreEsDueno") === true) ? "dueno" : null;
      _aplicando = true;
      try {
        var r = window.OCSync.aplicarCatalogo(remoto, rolRemoto);
        // A2/A3 (JFC 2026-09-10): si el merge sumó algo, avisar a la UI para que
        // (a) lo muestre como alerta dentro de "Today's alerts", no como banner
        // suelto, y (b) re-pinte la vista Hoy (si no, el hero se queda en
        // "Loading your business..."). La UI escucha oc-sync-merge en index.html.
        // v289: incluir r.actualizados -> una actualizacion SOLO de stock/precio
        // (sin altas) tambien re-pinta la UI: es el refresco "en segundos" del CDC.
        if (r && r.ok && (r.agregadasU || r.agregadosP || r.actualizados || r.ventasAgregadas || r.miembrosAgregados || r.clientesAgregados || r.promotorasAgregadas || r.sucursalesAgregadas)) {
          try {
            window.dispatchEvent(new CustomEvent("oc-sync-merge", { detail: {
              perchas: r.agregadasU || 0, productos: r.agregadosP || 0, actualizados: r.actualizados || 0, ventas: r.ventasAgregadas || 0,
              miembros: r.miembrosAgregados || 0, clientes: r.clientesAgregados || 0,
              promotoras: r.promotorasAgregadas || 0, sucursales: r.sucursalesAgregadas || 0
            } }));
          } catch (_) {}
        }
      }
      catch (e) { log("aplicar:", e && e.message); }
      _aplicando = false;
    }
    function valores(col) { var o = API.get(col), a = []; for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) a.push(o[k]); return a; }

    // Cambios locales del catálogo / equipo -> re-volcar a Yjs (con rebote).
    // Son las MISMAS señales que escucha el sync casero (mock-backend las emite).
    function pedirSeed() { clearTimeout(_tSeed); _tSeed = setTimeout(sembrar, 400); }
    window.addEventListener("oc-catalogo-cambiado", pedirSeed);
    window.addEventListener("oc-equipo-cambiado", pedirSeed);

    // Convergencia remota (relay) o de otra pestaña (BroadcastChannel) -> aplicar.
    // Los updates propios de sembrar() llevan origin "seed" y se ignoran aquí.
    API.doc.on("update", function (update, origin) {
      if (origin !== "red" && origin !== "bc") return;
      clearTimeout(_tAplica); _tAplica = setTimeout(aplicar, 300);
    });

    // Arranque: cuando IndexedDB termina de cargar, primero APLICAMOS lo que ya
    // había guardado localmente (por si este aparato arrancó offline) y luego
    // SEMBRAMOS lo local que aún no esté en Yjs. Ambos son idempotentes.
    function primerCruce() { aplicar(); sembrar(); }
    if (API.idb && typeof API.idb.on === "function") API.idb.once ? API.idb.once("synced", primerCruce) : API.idb.on("synced", primerCruce);
    else setTimeout(primerCruce, 800);
    // Red de seguridad si "synced" no llega (idb deshabilitado en algún navegador).
    setTimeout(function () { if (API.estado === "activo") sembrar(); }, 2500);

    API._store = { sembrar: sembrar, aplicar: aplicar }; // para diagnóstico manual
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", arrancar);
  else arrancar();
})();
