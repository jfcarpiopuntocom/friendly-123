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
// NO ROMPE NADA: apagado por defecto. Solo hace algo si
// localStorage["OC_YJS_FASE0"] === "1". Corre EN PARALELO al sync casero, en una
// SALA DISTINTA del relay (sufijo "-y"), así los updates binarios de Yjs jamás
// llegan al handler JSON de sync-realtime.js.
// FASE 1 (2026-09-10): sincroniza TODAS las colecciones del catálogo (productos,
// ubicaciones, usuarios, clientes) como Y.Maps de un mismo Y.Doc.
// FASE 2 (2026-09-09, JFC "ya conectalo, world class"): Plan C YA lee/escribe el
// store REAL de la app (mock-backend.js). store->Yjs con OCSync.catalogoPropio();
// Yjs->store con OCSync.aplicarCatalogo() — el merge ADD-ONLY ya probado en
// producción: nunca borra, nunca pierde, los merges son aditivos. Ver conectarStore().
// Sigue detrás del flag OC_YJS_FASE0 (toggle en Avanzado), en paralelo al sync
// casero y en sala de relay separada ("-y").
(function () {
  "use strict";

  var FLAG = "OC_YJS_FASE0";
  function activo() { try { return localStorage.getItem(FLAG) === "1"; } catch (_) { return false; } }
  if (!activo()) return; // costo cero para todos los que no probamos el spike

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
  var COLECCIONES = ["productos", "ubicaciones", "usuarios", "clientes"];
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
      return { estado: this.estado, roomId: this.roomId, n: n, ws: this.ws ? this.ws.readyState : null };
    }
  };
  window.OCYjs = API;

  function log(/*...*/) { try { console.log.apply(console, ["[OCYjs]"].concat([].slice.call(arguments))); } catch (_) {} }

  async function arrancar() {
    var sala = leerSala();
    if (!sala || !sala.codigo) { log("sin sala — Plan C en espera (esto es normal si el sync no está configurado)"); return; }
    var codigo = normalizarCodigo(sala.codigo);
    try { await cargarBundle(); } catch (e) { log("bundle:", e && e.message); return; }

    var Y = window.Y;
    API.doc = new Y.Doc();
    COLECCIONES.forEach(function (c) { API.mapas[c] = API.doc.getMap(c); });
    // FASE 2 (JFC 2026-09-09): mapa aparte para el nombre del negocio y los PINs
    // de rol, que viajan CON el catálogo pero no son una colección de ítems. Así
    // Plan C converge un negocio completo por sí solo, sin depender del sync casero.
    API.meta = API.doc.getMap("_meta");
    API.clave = await derivarClave(codigo);
    API.roomId = await idDeSala(codigo);

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
    API.doc.on("update", function (update, origin) {
      if (origin === "bc" || origin === "red") return;
      try { if (API.bc) API.bc.postMessage(update.buffer.slice ? update.buffer : update); } catch (_) {}
      enviarRelay(update);
    });

    conectarRelay(Y);
    conectarStore(Y);   // FASE 2: leer/escribir el store REAL de la app (add-only)
    API.estado = "activo";
    log("Plan C activo (Fase 2: store real, " + COLECCIONES.join(", ") + "). Sala:", API.roomId);
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
      try {
        API.doc.transact(function () {
          COLECCIONES.forEach(function (col) {
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
          if (cat.nombreNegocio && API.meta.get("nombreNegocio") !== cat.nombreNegocio)
            API.meta.set("nombreNegocio", cat.nombreNegocio);
          if (cat.pinsRol && JSON.stringify(API.meta.get("pinsRol")) !== JSON.stringify(cat.pinsRol))
            API.meta.set("pinsRol", cat.pinsRol);
        }, "seed"); // origin "seed": estos updates no deben re-aplicarse al store
      } catch (e) { log("sembrar:", e && e.message); }
    }

    // Yjs -> store. Reconstruye el catálogo desde los Y.Map y llama al merge
    // add-only probado. Síncrono: aplicarCatalogo no es async.
    function aplicar() {
      if (_aplicando) return;
      var remoto = {
        ubicaciones: valores("ubicaciones"),
        productos: valores("productos"),
        usuarios: valores("usuarios"),
        clientes: valores("clientes"),
        nombreNegocio: API.meta.get("nombreNegocio") || "",
        pinsRol: API.meta.get("pinsRol") || null,
        deviceNombre: "sync"
      };
      // Nada que aplicar: no molestar al store (evita guardados en vano).
      if (!remoto.ubicaciones.length && !remoto.productos.length &&
          !remoto.usuarios.length && !remoto.clientes.length) return;
      _aplicando = true;
      try { window.OCSync.aplicarCatalogo(remoto, null); }
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

  // --- Relay device-to-device (sala separada "-y" para no chocar con el sync casero) ---
  var pendientes = [];
  function enviarRelay(update) {
    if (!API.clave) return;
    cifrarBin(API.clave, update).then(function (buf) {
      if (API.ws && API.ws.readyState === 1) API.ws.send(buf);
      else pendientes.push(buf); // se drenan al reconectar
    }).catch(function () {});
  }
  function conectarRelay(Y) {
    var url = RELAY_URL + API.roomId + "-y"; // sufijo -y: aislado del sync casero
    var ws;
    try { ws = new WebSocket(url); } catch (_) { setTimeout(function () { conectarRelay(Y); }, 5000); return; }
    ws.binaryType = "arraybuffer";
    API.ws = ws;
    ws.onopen = function () {
      // Al entrar: manda mi estado completo para que un par nuevo converja rápido.
      try { enviarRelay(Y.encodeStateAsUpdate(API.doc)); } catch (_) {}
      while (pendientes.length && ws.readyState === 1) ws.send(pendientes.shift());
    };
    ws.onmessage = function (ev) {
      if (!(ev.data instanceof ArrayBuffer) || !API.clave) return;
      descifrarBin(API.clave, ev.data).then(function (bytes) {
        Y.applyUpdate(API.doc, bytes, "red"); // origin "red": no re-difundir (evita eco)
      }).catch(function () {}); // basura o clave distinta -> se ignora (relay sordo)
    };
    ws.onclose = function () { API.ws = null; setTimeout(function () { conectarRelay(Y); }, 4000); };
    ws.onerror = function () { try { ws.close(); } catch (_) {} };
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", arrancar);
  else arrancar();
})();
