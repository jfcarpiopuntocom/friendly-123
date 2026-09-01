// AMIGABLE — Cliente de sincronizacion en tiempo real (2026-07-23)
// ============================================================================
// QUE HACE: en cuanto el dueño se licencia (automatico) o un encargado escribe
// UNA vez el codigo del negocio ("Unirme a mi equipo"), este dispositivo
// queda sincronizado 24/7 PARA SIEMPRE — no es un modo evento que se prende
// y apaga. Las VENTAS, AJUSTES, ANULACIONES y TRANSFERENCIAS de stock hechas
// en cualquier dispositivo del equipo llegan a los demas en segundos, todos
// los dias, haya o no haya feria — para que nadie sobrevenda ni se atropelle.
//
// COMO SE PROTEGE LA APP (lazy approach, cero dependencia obligatoria):
//   - Si esto nunca se activa, o el relay esta caido, o se borra este
//     archivo entero: la app funciona EXACTAMENTE igual que siempre
//     (solo local, como fue desde el dia 1).
//   - mock-backend.js JAMAS toca la red — este archivo es el UNICO que abre
//     un WebSocket, y solo si el dueño lo pidio explicitamente.
//   - El relay (Cloudflare Worker) es "sordo y desmemoriado a proposito":
//     solo rebota blobs cifrados, nunca los guarda ni los lee en claro.
//   - Cifrado E2E: la clave sale del codigo de sala via PBKDF2+AES-GCM,
//     nunca viaja al relay. Sin el codigo, un mensaje interceptado es ruido.
//   - Alcance v1: SOLO se sincronizan cambios de STOCK (venta, ajuste,
//     anulacion, transferencia) sobre productos que YA EXISTEN en ambos
//     dispositivos (mismo id) — el catalogo (altas, precios, fotos, perchas)
//     se configura antes del evento, en un solo dispositivo, y se reparte
//     por backup/restauracion como siempre. Sincronizar el catalogo completo
//     es una fase futura, documentada aparte.
// ============================================================================
(function () {
  // RELAY PROPIO (JFC 2026-08-25): friendly deja de colgarse del relay de
  // amigable y usa el suyo (cloudflare-sync-relay/, name friendly123-sync-relay).
  // Un relay por app: un deploy de una no puede afectar a la otra. Solo cambia
  // el HOST — la derivacion de sala/clave (SALT_FIJO, "amigable-sala:") queda
  // igual para no re-derivar salas distintas en dispositivos ya emparejados;
  // durante el rollout, dos dispositivos sincronizan cuando ambos ya apuntan
  // aqui (la cola offline + catch-up recuperan lo que se perdio mientras tanto).
  const RELAY_URL = "wss://friendly123-sync-relay.jfcarpio.workers.dev/sala/";
  const ROOM_KEY = "f123_sync_room"; // {codigo} — si no existe, sync apagado
  const DEVICE_ID_KEY = "f123_device_id";
  const LAMPORT_KEY = "f123_sync_lamport";
  const COLA_KEY = "f123_sync_cola"; // ops pendientes de enviar (offline)
  const SALT_FIJO = "amigable-sync-v1"; // salt fijo: codigo de sala = "clave de cuarto", no defensa contra MITM

  // ---------------------------------------------------------------------------
  // CATCH-UP ENTRE PARES (2026-08-04) — sin tocar el manifiesto NO CLOUD
  // ---------------------------------------------------------------------------
  // El relay sigue "sordo y desmemoriado a proposito": no guarda nada, solo
  // rebota blobs cifrados. El problema que esto resuelve es otro: si el
  // equipo B estuvo CERRADO mientras A vendia, B nunca se enteraba de esas
  // ventas al reconectar — el relay solo reenvia en vivo, no tiene memoria
  // que consultar. Antes, la unica salida era un respaldo manual.
  //
  // La solucion NO es que el relay guarde nada. Es que cada dispositivo ya
  // guarda un registro corto de las ULTIMAS operaciones que vio (propias y
  // ajenas) en SU PROPIO localStorage — eso no es "cloud", es el mismo dato
  // que el dispositivo ya genero. Al reconectarse, un dispositivo pregunta
  // "cual es tu ultimo lamport de cada equipo que conoces" y CUALQUIER PAR
  // que este conectado en ese momento y tenga ops mas nuevas se las manda
  // DIRECTO — el relay solo las reenvia, igual que cualquier Op normal.
  //
  // Reutiliza el mismo canal cifrado E2E y el mismo dedup por opId que ya
  // existe en mock-backend.js (_opsAplicadas, tope 500) — reenviar una op
  // vieja nunca duplica una venta, aplicarOpRemota() ya la reconoce y la
  // ignora si ya se aplico.
  //
  // Si nadie estuvo online mientras el otro vendia (caso raro: todo el
  // equipo apagado a la vez), la brecha no se puede cerrar sola — ahi sigue
  // el respaldo manual/WhatsApp como red de ultimo recurso (Fases 2 y 4).
  const LOG_KEY = "f123_sync_log"; // ultimas ops vistas (propias + ajenas), para poder RE-enviarlas a un par que las perdio
  const LOG_TOPE = 1000; // M1 (2026-08-27): >= COLA_TOPE(1000). Antes 500 < 1000: un aparato offline que generaba >500 ops perdía las más viejas del log y no podía reenviarlas por catch-up a un par que también estuvo offline. Con 1000 el log nunca pierde ops que la cola aún tiene.
  const TIPO_CATCHUP_PEDIDO = "__catchup_pedido__";
  /* Tipos que alimentan el TABLERO DE CONTROL (portado de amigable-123,
     2026-08-18). El tablero es un lienzo que no guarda nada: pide una foto del
     negocio, la pinta y la olvida al cerrarse. Estos mensajes viajan cifrados
     por el mismo relay, que solo rebota bytes que no puede leer. */
  const TIPO_LATIDO = "__latido__";
  const TIPO_CHECKPOINT = "__checkpoint__"; // foto cifrada del catalogo (bitacora)
  const TIPO_PIN = "__pin__";
  const TIPO_ORDEN = "__orden__";
  const TIPO_RESPUESTA = "__respuesta__";
  /* PASO 4 (JFC 2026-08-19): pedir/responder el CATALOGO entre dispositivos del
     mismo equipo. Es distinto de la foto: la foto es para el tablero (lectura,
     incluye ventas y clientes, se olvida al cerrar) y esto es solo lo que
     DEFINE el catalogo (perchas y productos), para poder juntarlos. */
  const TIPO_CATALOGO_PEDIDO = "__catalogo_pedido__";
  const TIPO_CATALOGO_TROZO  = "__catalogo_trozo__";
  const TIPO_FOTO_PEDIDA = "__foto_pedida__";
  const TIPO_FOTO_TROZO = "__foto_trozo__";
  const FOTO_FILAS_POR_TROZO = 200;
  /* REDUNDANCIA (JFC 2026-08-27): mensajes efímeros del sync-watchdog para el
     snapshot entre pares. No son ops de negocio: no se loguean ni se deduplican
     (igual que catchup/foto). Se quitan junto con sync-watchdog.js. */
  const TIPO_SNAPSHOT_PEDIDO = "__snapshot_pedido__";
  const TIPO_SNAPSHOT_TROZO  = "__snapshot_trozo__";

  function leerLog() {
    try { const a = JSON.parse(localStorage.getItem(LOG_KEY) || "[]"); return Array.isArray(a) ? a : []; }
    catch (_) { return []; }
  }
  function registrarEnLog(op) {
    if (!op || !op.opId) return;
    try {
      const log = leerLog();
      if (log.some((o) => o.opId === op.opId)) return; // ya esta, no duplicar
      log.push(op);
      localStorage.setItem(LOG_KEY, JSON.stringify(log.slice(-LOG_TOPE)));
      /* C2: solo las ops de negocio reales llegan aquí (los mensajes de control
         retornan antes en onmessage), así que este es el lamport correcto del
         checkpoint. Ver comentario en _lamportAplicadoMax. */
      if (typeof op.lamport === "number" && op.lamport > _lamportAplicadoMax) _lamportAplicadoMax = op.lamport;
    } catch (_) {}
  }
  // Vector "lo mas nuevo que conozco de cada dispositivo" — se manda al
  // reconectar para que los pares sepan que me falta.
  function construirVectorConocido() {
    const v = {};
    leerLog().forEach((op) => {
      if (!op.deviceId || typeof op.lamport !== "number") return;
      if (!(op.deviceId in v) || op.lamport > v[op.deviceId]) v[op.deviceId] = op.lamport;
    });
    return v;
  }
  // Ops que YO tengo y que, segun el vector recibido, el que pregunta no
  // tiene todavia. Nunca le devuelvo sus propias ops (el vector ya las
  // incluye si las tiene; si no las tiene, tampoco soy yo quien deba
  // reenviarselas — vinieron de el).
  function buscarOpsFaltantes(vectorPedido, deviceIdPide) {
    const conocido = vectorPedido || {};
    return leerLog().filter((op) => {
      if (op.deviceId === deviceIdPide) return false;
      const max = typeof conocido[op.deviceId] === "number" ? conocido[op.deviceId] : 0;
      return op.lamport > max;
    }).slice(-200); // tope por respuesta: evitar un envio gigante de una sola vez
  }

  function uuidCorto() {
    const c = globalThis.crypto;
    if (c && c.randomUUID) return c.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (ch) => {
      const r = (Math.random() * 16) | 0, v = ch === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  function deviceId() {
    let id = localStorage.getItem(DEVICE_ID_KEY);
    if (!id) { id = uuidCorto(); try { localStorage.setItem(DEVICE_ID_KEY, id); } catch (_) {} }
    return id;
  }

  /* LORD / SUPER-ADMIN (JFC 2026-08-26). Un aparato se marca lord cuando se
     verifica el código maestro (candado de JFC). El lord, al unirse a la licencia
     de un cliente, entra como INVITADO/observador: NO adopta la licencia ajena y
     deja rastro de auditoría (best-practice de acceso privilegiado: identidad
     distinta + registro de todo acceso). Un usuario normal nunca es lord. */
  const LORD_KEY = "f123_lord";
  const LORD_LIC_KEY = "f123_lord_licencia_canonica";
  const ACCESOS_KEY = "f123_accesos"; // bitácora local de accesos del lord a tiendas ajenas
  function _esLord() { try { return localStorage.getItem(LORD_KEY) === "1"; } catch (_) { return false; } }
  function _licenciaCanonicaLord() {
    try {
      if (!_esLord()) return null;
      var c = localStorage.getItem(LORD_LIC_KEY);
      return c ? String(c).trim().toUpperCase().replace(/\s+/g, "") : null;
    } catch (_) { return null; }
  }
  function _registrarAcceso(licencia) {
    try {
      var log = [];
      try { log = JSON.parse(localStorage.getItem(ACCESOS_KEY) || "[]"); if (!Array.isArray(log)) log = []; } catch (_) { log = []; }
      log.push({
        licencia: String(licencia || ""),
        cuando: (new Date()).toISOString(),
        deviceId: deviceId(),
        toco: false, // observador por defecto; se marca true si ejecuta una orden que muta
      });
      localStorage.setItem(ACCESOS_KEY, JSON.stringify(log.slice(-500)));
    } catch (_) {}
  }

  function lamportActual() { return Number(localStorage.getItem(LAMPORT_KEY) || 0); }
  function mergeLamport(lam) {
    try { var n = Number(lam) || 0; if (n > lamportActual()) localStorage.setItem(LAMPORT_KEY, String(n)); } catch (_) {}
  }
  /* C2 (2026-08-27, auditoría de integridad): lamport de la última op de
     negocio REALMENTE aplicada al estado. mergeLamport() corre para TODA op
     descifrada (latidos, pedidos de catch-up, trozos de foto, órdenes,
     checkpoints, snapshots) ANTES de los type-checks, así que lamportActual()
     se infla más allá de lo que el estado refleja. Si el checkpoint usara ese
     valor, el relay podaría ops que un par aún necesita (pérdida de stock).
     Este contador solo sube con ops que pasan por registrarEnLog (locales y
     remotas de negocio), que SÍ quedan en el estado. Se inicializa desde el
     log persistido para reflejar sesiones anteriores; ser un límite inferior
     es seguro (nunca sobre-poda). */
  let _lamportAplicadoMax = (function () {
    try {
      const log = JSON.parse(localStorage.getItem(LOG_KEY) || "[]");
      if (Array.isArray(log)) {
        let m = 0;
        log.forEach((o) => { if (o && typeof o.lamport === "number" && o.lamport > m) m = o.lamport; });
        return m;
      }
    } catch (_) {}
    return 0;
  })();
  // ArrayBuffer -> base64 (para meter el sobre cifrado en el frame de texto de
  // la bitacora). Solo se usa con paquetes chicos (ops) y el checkpoint.
  function ab2b64(buf) {
    var b = new Uint8Array(buf), s = "";
    for (var i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
    return btoa(s);
  }
  function siguienteLamport() {
    let n = Number(localStorage.getItem(LAMPORT_KEY) || 0) + 1;
    try { localStorage.setItem(LAMPORT_KEY, String(n)); } catch (_) {}
    return n;
  }

  function leerCola() {
    try { const a = JSON.parse(localStorage.getItem(COLA_KEY) || "[]"); return Array.isArray(a) ? a : []; }
    catch (_) { return []; }
  }
  function guardarCola(cola) {
    try {
      /* FASE 2 (2026-08-27): antes se descartaba en silencio lo que pasara de
         200 ops — si un aparato estaba offline mucho tiempo, movimientos de
         stock se perdían sin aviso. Ahora el tope es 1000 y, si se desborda,
         se deja una marca (f123_sync_cola_desbordada) que el sync-watchdog
         puede avisar: nunca se pierde stock en silencio. */
      const arr = Array.isArray(cola) ? cola : [];
      if (arr.length > 1000) {
        try { localStorage.setItem("f123_sync_cola_desbordada", String(arr.length)); } catch (_) {}
      }
      localStorage.setItem(COLA_KEY, JSON.stringify(arr.slice(-1000)));
    } catch (_) {}
  }

  function leerSala() {
    try { return JSON.parse(localStorage.getItem(ROOM_KEY) || "null"); } catch (_) { return null; }
  }

  // --- Cripto: PBKDF2(codigo) -> AES-GCM. El codigo nunca sale de este dispositivo. ---
  async function derivarClave(codigo) {
    const enc = new TextEncoder();
    const base = await crypto.subtle.importKey("raw", enc.encode(codigo), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey(
      { name: "PBKDF2", salt: enc.encode(SALT_FIJO), iterations: 100000, hash: "SHA-256" },
      base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]
    );
  }
  async function idDeSala(codigo) {
    const enc = new TextEncoder();
    const hash = await crypto.subtle.digest("SHA-256", enc.encode("amigable-sala:" + codigo));
    return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 40);
  }
  async function cifrar(clave, objeto) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const datos = new TextEncoder().encode(JSON.stringify(objeto));
    const cif = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, clave, datos);
    const paquete = new Uint8Array(iv.length + cif.byteLength);
    paquete.set(iv, 0); paquete.set(new Uint8Array(cif), iv.length);
    return paquete.buffer;
  }
  async function descifrar(clave, buffer) {
    const bytes = new Uint8Array(buffer);
    const iv = bytes.slice(0, 12), cif = bytes.slice(12);
    const claro = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, clave, cif);
    return JSON.parse(new TextDecoder().decode(claro));
  }

  /* AUTO-CARGA DEL INVENTARIO EN UN DISPOSITIVO NUEVO (JFC 2026-08-25).
     El caso central de todo esto: entro con la licencia del negocio + un PIN
     del equipo y quiero VER su tienda. Los usuarios (PINs) ya se aplican solos
     al unirse; el catalogo (perchas/productos) esperaba un "Merge" manual en
     Avanzado. En un dispositivo que TODAVIA NO tiene inventario propio no hay
     nada que proteger: se junta el catalogo que manda un companero y se aplica
     solo. Es AGREGAR, nunca borra (los productos entran con stock 0). Si el
     dispositivo ya tiene inventario propio, NO se toca: ahi manda el merge
     manual, que muestra el cambio antes de aplicarlo. */
  var _bufCat = null;
  function _resetBufCat() { _bufCat = null; }
  function _acumularCatalogo(pl, forzar) {
    try {
      if (!pl || !pl.tabla) return;
      /* DETECCIÓN DE EMPUJE CONCURRENT (2026-08-26, code-review finding #2):
         Si ya hay un buffer activo para un pushId distinto, el empuje anterior
         nunca va a completarse (sus trozos restantes no llegarán). Lo descartamos
         y empezamos fresco con el pushId nuevo. Sin esto, los trozos de dos empujes
         en paralelo se mezclan y el catálogo resultante es basura (ubicaciones de
         uno + productos del otro). El pushId lo genera el emisor en difundirEquipo/
         difundirCatalogo; si el emisor es viejo (antes del fix) no manda pushId —
         en ese caso pl.pushId === undefined y nos comportamos igual que antes. */
      if (_bufCat && pl.pushId && _bufCat.pushId && _bufCat.pushId !== pl.pushId) {
        _bufCat = null; // empuje viejo incompleto; empezar desde cero con el nuevo
      }
      if (!_bufCat) _bufCat = { ubicaciones: [], productos: [], usuarios: [], clientes: [], esperados: 0, vistos: 0, huella: "", rol: "", forzar: false, pushId: pl.pushId || null, nombreNegocio: "" };
      _bufCat.esperados = pl.deTotal || _bufCat.esperados;
      _bufCat.huella = pl.huella || _bufCat.huella;
      _bufCat.rol = pl.rol || _bufCat.rol;
      if (pl.nombreNegocio) _bufCat.nombreNegocio = pl.nombreNegocio; // B2 (2026-08-28): el nombre de la tienda viaja con el catálogo
      if (forzar) _bufCat.forzar = true; // un EMPUJE (para:null) por un cambio real, no una respuesta a mi pedido
      if (Array.isArray(pl.filas)) {
        if (pl.tabla === "ubicaciones") _bufCat.ubicaciones = _bufCat.ubicaciones.concat(pl.filas);
        else if (pl.tabla === "productos") _bufCat.productos = _bufCat.productos.concat(pl.filas);
        else if (pl.tabla === "usuarios") _bufCat.usuarios = _bufCat.usuarios.concat(pl.filas);
        else if (pl.tabla === "clientes") _bufCat.clientes = (_bufCat.clientes || []).concat(pl.filas); // JFC 2026-08-26: los clientes viajan con el catálogo
      }
      _bufCat.vistos++;
      if (_bufCat.esperados && _bufCat.vistos >= _bufCat.esperados) {
        var cat = { ubicaciones: _bufCat.ubicaciones, productos: _bufCat.productos, usuarios: _bufCat.usuarios, clientes: _bufCat.clientes || [], huella: _bufCat.huella, nombreNegocio: _bufCat.nombreNegocio || "" };
        var rol = _bufCat.rol; var forz = _bufCat.forzar; _bufCat = null;
        if (forz) {
          /* EMPUJE EN VIVO (JFC 2026-08-25): otro dispositivo del equipo cambio
             su catalogo (p.ej. creo una percha nueva) y lo manda. Se aplica
             add-only SIEMPRE, tenga o no inventario propio este aparato: es la
             union de perchas/productos del equipo (nunca borra, los productos
             nuevos entran con stock 0 — cada percha cuenta su stock fisico).
             Asi la percha nueva del PC aparece en el celular sin merge manual.
             Una respuesta a MI pedido (para != null) NO entra aqui: esa sigue
             respetando el candado de "solo si estoy vacio". */
          try {
            if (window.OCSync && window.OCSync.aplicarCatalogo) {
              window.OCSync.aplicarCatalogo(cat, rol);
              try { if (typeof window.cargarInventario === "function") window.cargarInventario(); } catch (_) {}
              try { window.dispatchEvent(new CustomEvent("oc-catalogo-autoaplicado", { detail: { productos: (cat.productos || []).length, empuje: true } })); } catch (_) {}
            }
          } catch (_) {}
        } else {
          _autoAplicarSiVacio(cat, rol);
        }
      }
    } catch (_) { _bufCat = null; }
  }
  function _autoAplicarSiVacio(cat, rol) {
    try {
      if (!window.OCSync || !window.OCSync.aplicarCatalogo || !window.OCSync.huella) return;
      var h = window.OCSync.huella();
      var vacio = h && (Number(h.productos) || 0) === 0; // sin inventario propio
      if (!vacio) return; // ya tiene lo suyo: no se toca, decide el merge manual
      window.OCSync.aplicarCatalogo(cat, rol);
      // Refresca la vista de inventario si esta a la vista (si no, se ve al abrirla).
      try { if (typeof window.cargarInventario === "function") window.cargarInventario(); } catch (_) {}
      try { window.dispatchEvent(new CustomEvent("oc-catalogo-autoaplicado", { detail: { productos: (cat.productos || []).length } })); } catch (_) {}
    } catch (_) {}
  }

  // --- Estado de conexion ---
  let ws = null, claveActual = null, salaIdActual = null, reintentoMs = 1000;
  let _ckptTimer = null; // sube checkpoints periodicos mientras hay conexion
  let estadoActual = "apagado"; // apagado | conectando | conectado | reconectando
  let presenciaN = null; // cuantos dispositivos conectados ahora (null = desconocido)
  let intentosSeguidos = 0; // reintentos consecutivos sin exito (refuerzo 2026-07-23)
  let timeoutConexion = null;
  const listenersEstado = [];
  function notificarEstado(nuevo) {
    estadoActual = nuevo;
    listenersEstado.forEach((fn) => { try { fn(nuevo, presenciaN); } catch (_) {} });
  }

  // Refuerzo (2026-07-23, auditoria delegada + verificacion manual): antes
  // conectar() podia llamarse dos veces seguidas (Activar + reconexion
  // automatica por visibilitychange casi al mismo tiempo, o un doble-click)
  // sin cerrar el socket anterior — quedaba una conexion fantasma abierta
  // consumiendo un cupo de la sala (max 12) y duplicando mensajes. Ahora
  // conectar() SIEMPRE cierra lo que hubiera antes de abrir uno nuevo.
  function cerrarWsExistente() {
    if (timeoutConexion) { clearTimeout(timeoutConexion); timeoutConexion = null; }
    if (_ckptTimer) { clearInterval(_ckptTimer); _ckptTimer = null; }
    if (ws) {
      try { ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null; ws.close(); } catch (_) {}
      ws = null;
    }
  }

  async function conectar() {
    const sala = leerSala();
    if (!sala || !sala.codigo) { notificarEstado("apagado"); return; }
    cerrarWsExistente();
    notificarEstado(estadoActual === "apagado" ? "conectando" : "reconectando");
    // Refuerzo: el codigo se normaliza (mayusculas + sin espacios) SIEMPRE
    // antes de derivar la clave/sala — sin esto, "amg-xxxx" y "AMG-XXXX"
    // caen en salas distintas y el equipo nunca entiende por que no sincroniza.
    const codigoNorm = normalizarCodigo(sala.codigo);
    claveActual = await derivarClave(codigoNorm);
    salaIdActual = await idDeSala(codigoNorm);
    try { ws = new WebSocket(RELAY_URL + salaIdActual); }
    catch (_) { return programarReintento(); }

    ws.binaryType = "arraybuffer";
    // Refuerzo: si el handshake se cuelga (servidor acepta TCP pero nunca
    // responde el upgrade), algunos navegadores nunca disparan onerror ni
    // onclose — sin este timeout, el estado quedaba en "conectando" para
    // siempre. A los 10s, si sigue CONNECTING, se fuerza el cierre y se
    // deja que el backoff normal reintente.
    timeoutConexion = setTimeout(() => {
      if (ws && ws.readyState === WebSocket.CONNECTING) { try { ws.close(); } catch (_) {} }
    }, 10000);
    ws.onopen = () => {
      if (timeoutConexion) { clearTimeout(timeoutConexion); timeoutConexion = null; }
      reintentoMs = 1000;
      intentosSeguidos = 0;
      notificarEstado("conectado");
      _resetBufCat(); // empezar limpio: el catalogo de esta sesion se junta de cero
      vaciarCola();
      pedirCatchup();
      pullDelRelay(); // ponerse al dia contra la bitacora del relay (aunque no haya peers)
      // Subir nuestro checkpoint poco despues de conectar, y luego cada tanto,
      // asi el relay siempre tiene una foto reciente para el que llegue nuevo.
      setTimeout(function () { try { subirCheckpoint(true); } catch (_) {} }, 1500 + Math.random() * 1500);
      try { if (_ckptTimer) clearInterval(_ckptTimer); _ckptTimer = setInterval(function () { try { subirCheckpoint(false); } catch (_) {} }, 180000); } catch (_) {}
      /* Al conectar se pide tambien el catalogo (JFC 2026-08-21). De lo que
         llegue, el EQUIPO se aplica solo y el resto espera a que una persona
         lo confirme en Avanzado. Asi el segundo dispositivo tiene los PINs y
         los roles al dia sin que nadie tenga que acordarse de pulsar nada:
         el cuaderno esta compartido de verdad, no "compartible si alguien
         hace el tramite". Jitter para no pedirlo todos en el mismo instante
         cuando el wifi del local vuelve y reconectan varios a la vez. */
      /* pedirCatalogo() en CADA reconexion (2026-08-26, code-review finding #3):
         El mecanismo catch-up (pedirCatchup/pullDelRelay) solo replaya OPS de stock.
         Los cambios de equipo (alta, baja, cambio de rol, desactivación) NO quedan
         en ese log — solo existen como el estado actual de los usuarios del peer.
         Un dispositivo offline que vuelve a conectarse no sabría que alguien fue dado
         de baja si dependiera solo del catch-up de stock.
         La solución: pedirCatalogo() en TODA reconexión, no solo en dispositivos vacíos.
         La respuesta llega unicast (op.para = mi deviceId), aplicarEquipoRemoto la
         aplica siempre (add-only + último-en-editar-gana por actualizadoEn).
         Para dispositivos con inventario: el catálogo completo va a _autoAplicarSiVacio
         que lo descarta (correcto), pero el equipo ya se aplicó vía aplicarEquipoRemoto.
         Jitter para no saturar cuando muchos dispositivos reconectan a la vez (wifi del local). */
      setTimeout(function () { try { pedirCatalogo(); } catch (_) {} }, 800 + Math.random() * 1200);
    };
    ws.onmessage = async (ev) => {
      // Frame de presencia (2026-07-23): el relay los manda en TEXTO plano,
      // sin cifrar (solo es un numero de conexiones, no dato del negocio).
      // Las Ops reales siempre son binarias (ArrayBuffer, cifradas). Este
      // chequeo de tipo es la unica forma de distinguirlos.
      if (typeof ev.data === "string") {
        try {
          const msg = JSON.parse(ev.data);
          if (msg && msg.__presencia__) { presenciaN = msg.n; notificarEstado(estadoActual); }
        } catch (_) {}
        return;
      }
      try {
        const op = await descifrar(claveActual, ev.data);
        /* Reloj de Lamport: al recibir, mi reloj sube a max(mio, ajeno). Sin
           esto, un checkpoint que yo suba podria llevar un lamport MENOR que
           una op ajena que ya esta reflejada en su stock, y un dispositivo
           nuevo volveria a aplicar esa op (doble conteo). Merge estandar. */
        if (op && typeof op.lamport === "number") mergeLamport(op.lamport);
        // Catch-up (2026-08-04): un par pregunto que ops le faltan. Le
        // contesto directo (el relay solo reenvia, no interviene) con lo que
        // yo tengo en mi log local que el todavia no vio. Nunca se aplica
        // como si fuera una Op real de negocio.
        if (op && op.tipo === TIPO_CATCHUP_PEDIDO) {
          responderCatchup(op);
          return;
        }
        /* Mensajes del tablero. Ninguno es una Op de negocio: no se registran
           en el log ni se aplican al estado. Solo se contestan. */
        if (op && op.tipo === TIPO_CATALOGO_PEDIDO) { responderCatalogo(op); return; }
        if (op && op.tipo === TIPO_CATALOGO_TROZO) {
          /* Solo lo escucha quien lo pidio. Del catalogo no se aplica NADA
             aqui: se junta y se avisa, y una persona decide en pantalla.
             EXCEPCION, JFC 2026-08-21: el trozo de EQUIPO si se aplica solo.
             Son las credenciales de acceso, y el bug de produccion era que la
             gente no podia entrar a su propio cuaderno desde el segundo
             dispositivo. Ver el comentario largo en OCSync.aplicarEquipoRemoto.
             Nunca borra a nadie ni degrada por su cuenta. */
          if (op.para && op.para !== deviceId()) return;
          try {
            const _pl = op.payload;
            /* UNICAST SOLO para aplicarEquipoRemoto (2026-08-26, code-review finding #5):
               El empuje en vivo (para==null, broadcast) llega a _acumularCatalogo con
               forzar=true, que al completarse llama aplicarCatalogo → aplicarEquipoRemoto.
               Si TAMBIÉN llamamos aplicarEquipoRemoto aquí (inmediato), el mismo lote de
               usuarios se aplica DOS veces. El segundo pase es un no-op en términos de
               datos (add-only, timestamp gana), pero dispara un evento oc-equipo-sync
               spurio y un movimiento de auditoría duplicado.
               Solución: aplicarEquipoRemoto inmediato SOLO para respuestas a MI pedido
               (op.para === mi deviceId). Para broadcasts, _acumularCatalogo lo maneja
               cuando acumula todos los trozos y llama aplicarCatalogo. */
            if (_pl && _pl.tabla === "usuarios" && Array.isArray(_pl.filas) &&
                op.para != null &&
                window.OCSync && window.OCSync.aplicarEquipoRemoto) {
              window.OCSync.aplicarEquipoRemoto(_pl.filas);
            }
            /* Se junta el catalogo aqui tambien (pasivamente) para que un
               dispositivo NUEVO vea el inventario sin abrir Avanzado ni tocar
               nada. Solo se aplica solo si esta vacio (ver _autoAplicarSiVacio). */
            _acumularCatalogo(_pl, op.para == null);
          } catch (_) {}
          try { window.dispatchEvent(new CustomEvent("oc-catalogo-trozo", { detail: op })); } catch (_) {}
          return;
        }
        if (op && op.tipo === TIPO_FOTO_PEDIDA) { responderFoto(op); return; }
        if (op && op.tipo === TIPO_PIN) { responderPin(op); return; }
        if (op && op.tipo === TIPO_ORDEN) { responderOrden(op); return; }
        /* CHECKPOINT (bitacora): la foto cifrada con el catalogo+stock. Solo se
           aplica en un dispositivo FRESCO (aplicarCheckpoint se auto-protege:
           si ya hubo ventas aqui, se ignora). Asi un dispositivo nuevo ve la
           tienda con su stock real sin depender de que haya alguien en linea. */
        if (op && op.tipo === TIPO_CHECKPOINT) {
          try {
            if (op.payload && window.OCSync && window.OCSync.aplicarCheckpoint) {
              var _rc = window.OCSync.aplicarCheckpoint(op.payload);
              if (_rc && _rc.ok) {
                try { if (typeof window.cargarInventario === "function") window.cargarInventario(); } catch (_) {}
                try { window.dispatchEvent(new CustomEvent("oc-checkpoint-restaurado", { detail: _rc })); } catch (_) {}
              }
            }
          } catch (_) {}
          return;
        }
        /* Y los que emite el propio tablero: se ignoran aqui para no
           reprocesarlos ni meterlos al log de ops. */
        if (op && (op.tipo === TIPO_FOTO_TROZO || op.tipo === TIPO_RESPUESTA || op.tipo === TIPO_LATIDO)) return;
        /* REDUNDANCIA (JFC 2026-08-27): snapshot entre pares del sync-watchdog.
           Se delega al watchdog; si no está cargado, se ignoran. */
        if (op && op.tipo === TIPO_SNAPSHOT_PEDIDO) { if (window.OCSyncWatchdog) window.OCSyncWatchdog.responderSnapshot(op); return; }
        if (op && op.tipo === TIPO_SNAPSHOT_TROZO)  { if (window.OCSyncWatchdog) window.OCSyncWatchdog.acumularSnapshot(op); return; }
        registrarEnLog(op);
        if (window.OCSync && window.OCSync.aplicarOpRemota) window.OCSync.aplicarOpRemota(op);
        window.dispatchEvent(new CustomEvent("oc-sync-op-remota", { detail: op }));
      } catch (_) { /* mensaje ilegible (codigo distinto, ruido) — se ignora, sordo a proposito */ }
    };
    ws.onclose = () => { if (_ckptTimer) { clearInterval(_ckptTimer); _ckptTimer = null; } notificarEstado("reconectando"); programarReintento(); };
    ws.onerror = () => { try { ws.close(); } catch (_) {} };
  }

/* ==========================================================================
     LA FOTO DEL NEGOCIO (M2, M3, M4 del PLAN-tablero-2026-08-15).

     Quien pide (el tablero) manda TIPO_FOTO_PEDIDA. Quien tiene la app junta
     su estado y lo devuelve EN TROZOS numerados. Si un trozo se pierde, se
     pide solo ese: un negocio con miles de ventas no puede depender de que un
     unico mensaje gigante llegue entero.

     NADA DE ESTO TOCA UN SERVIDOR. Los datos permanecen en los dispositivos
     del equipo; el relay solo rebota bytes cifrados que no puede leer, y el
     tablero los pinta y los olvida al cerrarse.
     ========================================================================== */
  async function armarFoto() {
    /* Se lee del backend local por su propia API, no del storage crudo: si
       manana cambia como se guarda, esto sigue funcionando. */
    async function get(ruta) {
      try {
        const r = await fetch("/api" + ruta);
        const j = await r.json();
        return Array.isArray(j) ? j : (j && typeof j === "object" ? j : null);
      } catch (_) { return null; }
    }
    /* Rutas verificadas contra mock-backend.js: el resumen se llama
       /api/dashboard, y /api/ventas/todas se agrego para el tablero (solo
       lectura, ya enriquecida con nombres). */
    /* liquidaciones y perchas se suman para las pestanias de Comisiones y
       Eventos del tablero (JFC 2026-08-18). Son las dos tablas mas chicas de
       todas y evitan que el tablero tenga que rehacer la cuenta del reparto por
       su cuenta — que es como dos pantallas terminan mostrando dos numeros
       distintos del mismo negocio. */
    const [productos, clientes, ventas, resumen, liquidaciones, perchas, movimientos, promotoras] = await Promise.all([
      get("/productos?ubicacionId=todas"),
      get("/clientes"),
      get("/ventas/todas?ubicacionId=todas"),
      get("/dashboard?ubicacionId=todas"),
      get("/liquidaciones"),
      get("/ubicaciones?todas=1"),
      get("/movimientos?limite=200"),
      /* PROMOTORAS EN LA FOTO (JFC 2026-08-29): liquidaciones ya viajaba (el
         reparto YA CALCULADO), pero la fuente -- la lista de comisionistas en
         si, con %, meta mensual, banco/cuenta -- nunca se pedia. El tablero
         veia los pagos pero no sabia quienes son los comisionistas ni su %
         vigente si alguien los daba de alta o los editaba desde otro aparato.
         Ruta verificada contra el modulo de comisiones: GET /api/promotoras. */
      get("/promotoras"),
    ]);
    return {
      productos: productos || [],
      clientes: Array.isArray(clientes) ? clientes : [],
      ventas: ventas || [],
      resumen: resumen || null,
      liquidaciones: Array.isArray(liquidaciones) ? liquidaciones : [],
      perchas: Array.isArray(perchas) ? perchas : [],
      movimientos: Array.isArray(movimientos) ? movimientos : [],
      promotoras: Array.isArray(promotoras) ? promotoras : [],
      negocio: (function () {
        try { return (JSON.parse(localStorage.getItem("f123_owned") || "null") || {}).nombreNegocio || ""; }
        catch (_) { return ""; }
      })(),
      generadaEn: (new Date()).toISOString(),
    };
  }

  /* Corta una tabla larga en trozos parejos. Devuelve [] si no hay filas, para
     que el tablero pueda distinguir "sin datos" de "no llego nada". */
  function trocear(nombre, filas) {
    const out = [];
    const arr = Array.isArray(filas) ? filas : [];
    if (!arr.length) { out.push({ tabla: nombre, i: 0, total: 1, filas: [] }); return out; }
    const total = Math.ceil(arr.length / FOTO_FILAS_POR_TROZO);
    for (let i = 0; i < total; i++) {
      out.push({ tabla: nombre, i: i, total: total, filas: arr.slice(i * FOTO_FILAS_POR_TROZO, (i + 1) * FOTO_FILAS_POR_TROZO) });
    }
    return out;
  }

  /* Pide el catalogo a los companeros de equipo. Efimero: si no contesta
     nadie, no pasa nada y se puede volver a pedir. */
  async function pedirCatalogo() {
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    const op = {
      opId: uuidCorto(), deviceId: deviceId(), tipo: TIPO_CATALOGO_PEDIDO,
      payload: { rol: rolActual() }, fecha: (new Date()).toISOString(),
    };
    try { await new Promise((r) => setTimeout(r, 0)); ws.send(await cifrar(claveActual, op)); return true; } catch (_) { return false; }
  }

  function rolActual() {
    try { return (window.OCAuth && window.OCAuth.rolActual) ? window.OCAuth.rolActual() : ""; } catch (_) { return ""; }
  }

  /* Contesta con MI catalogo. Va en trozos por lo mismo que la foto: un
     negocio con miles de productos no puede depender de que un unico mensaje
     gigante llegue entero. */
  async function responderCatalogo(pedido) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (!window.OCSync || !window.OCSync.catalogoPropio) return;   // un tablero no contesta
    await new Promise((r) => setTimeout(r, Math.random() * 400));  // jitter, como la foto
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    let cat;
    try { cat = window.OCSync.catalogoPropio(); } catch (_) { return; }
    /* El EQUIPO viaja igual que las perchas y los productos (JFC 2026-08-21).
       Antes solo iban `ubicaciones` y `productos`, y por eso el PIN de un
       admin creado en un dispositivo no existia en el otro: el dato nunca
       cruzaba. Va por el mismo canal cifrado y solo entre dispositivos que
       comparten la misma licencia. */
    const trozos = [].concat(trocear("ubicaciones", cat.ubicaciones))
                     .concat(trocear("productos", cat.productos))
                     .concat(trocear("usuarios", cat.usuarios || []))
                     .concat(trocear("clientes", cat.clientes || [])); // JFC 2026-08-26: los clientes viajan con el catálogo (add-only), como el equipo
    for (let k = 0; k < trozos.length; k++) {
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      const op = {
        opId: uuidCorto(), deviceId: deviceId(), tipo: TIPO_CATALOGO_TROZO,
        para: pedido.deviceId || null,
        payload: Object.assign({ rol: rolActual(), huella: cat.huella ? cat.huella.corta : "", k: k, deTotal: trozos.length, nombreNegocio: cat.nombreNegocio || "" }, trozos[k]),
        fecha: (new Date()).toISOString(),
      };
      try { ws.send(await cifrar(claveActual, op)); } catch (_) { return; }
    }
  }

  /* DIFUNDIR EL EQUIPO EN CUANTO CAMBIA (JFC 2026-08-25).
     Bug real: degradar/promover a alguien, o cambiar un PIN, "no servia" en el
     otro dispositivo. La causa: el equipo solo viajaba cuando un aparato PEDIA
     el catalogo (al reconectar). Si los dos ya estaban conectados, el cambio de
     rol/PIN se quedaba en el aparato donde se hizo. Ahora, apenas se toca el
     equipo (alta, edicion, rol, PIN, baja), se EMPUJA la lista de usuarios a
     todos los compañeros (para:null). Cada uno la aplica por el MISMO camino
     seguro que ya existia (aplicarEquipoRemoto = add-only + ultimo-en-editar
     gana por actualizadoEn); no se inventa merge nuevo. Solo empuja el equipo,
     no toca stock ni ventas. Una baja (DELETE) no se propaga sola porque el
     merge es add-only —eso es a proposito: nadie borra a nadie por la red. */
  async function difundirEquipo() {
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    if (!window.OCSync || !window.OCSync.catalogoPropio) return false; // un tablero no difunde
    let cat;
    try { cat = window.OCSync.catalogoPropio(); } catch (_) { return false; }
    const trozos = trocear("usuarios", cat.usuarios || []);
    /* pushId (2026-08-26, code-review finding #2): identificador único para ESTE empuje.
       _acumularCatalogo usa un solo buffer _bufCat. Si dos dispositivos empujan en
       paralelo, los trozos de ambos se mezclan en el mismo buffer y el resultado es
       basura. Con pushId, _acumularCatalogo puede detectar que llegó un trozo de un
       empuje distinto y limpiar el buffer antes de aceptarlo.
       uuidCorto() produce un ID de 8 chars suficientemente aleatorio para este propósito. */
    const pushId = uuidCorto();
    for (let k = 0; k < trozos.length; k++) {
      if (!ws || ws.readyState !== WebSocket.OPEN) return false;
      const op = {
        opId: uuidCorto(), deviceId: deviceId(), tipo: TIPO_CATALOGO_TROZO,
        para: null, // a todo el equipo, no a un solo pedido
        payload: Object.assign({ rol: rolActual(), huella: cat.huella ? cat.huella.corta : "", k: k, deTotal: trozos.length, pushId: pushId, nombreNegocio: cat.nombreNegocio || "" }, trozos[k]),
        fecha: (new Date()).toISOString(),
      };
      try { ws.send(await cifrar(claveActual, op)); } catch (_) { return false; }
    }
    return true;
  }
  /* La capa de datos (mock-backend) avisa con este evento cada vez que el
     equipo cambia. Se difunde con un pequeño respiro para no mandar diez veces
     si hubo varios cambios seguidos (coalescing simple). */
  var _difEquipoT = null;
  try {
    window.addEventListener("oc-equipo-cambiado", function () {
      try { clearTimeout(_difEquipoT); } catch (_) {}
      _difEquipoT = setTimeout(function () { try { difundirEquipo(); } catch (_) {} }, 400);
    });
  } catch (_) {}

  /* DIFUNDIR EL CATALOGO (perchas/productos) AL CAMBIAR — mismo patron que el
     equipo (JFC 2026-08-25: "no se sincronizaron las racks, en mi cel sale 1 y
     en mi PC salen 2"). Antes una percha nueva solo llegaba con el merge manual
     o a un aparato vacio. Ahora, al crear/editar una percha o producto, se
     empuja el catalogo a todo el equipo (para:null) y cada aparato lo mergea
     add-only por el mismo camino que el boton "Merge inventory with my team".
     Va con el equipo incluido para que un solo empuje deje todo al dia. */
  async function difundirCatalogo() {
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    if (!window.OCSync || !window.OCSync.catalogoPropio) return false;
    let cat;
    try { cat = window.OCSync.catalogoPropio(); } catch (_) { return false; }
    const trozos = [].concat(trocear("ubicaciones", cat.ubicaciones || []))
                     .concat(trocear("productos", cat.productos || []))
                     .concat(trocear("usuarios", cat.usuarios || []));
    /* pushId (2026-08-26, code-review finding #2): mismo patrón que difundirEquipo.
       Todos los trozos de este empuje comparten el mismo pushId para que el receptor
       pueda detectar interleaving con otro empuje concurrente y limpiar el buffer. */
    const pushId = uuidCorto();
    for (let k = 0; k < trozos.length; k++) {
      if (!ws || ws.readyState !== WebSocket.OPEN) return false;
      const op = {
        opId: uuidCorto(), deviceId: deviceId(), tipo: TIPO_CATALOGO_TROZO,
        para: null,
        payload: Object.assign({ rol: rolActual(), huella: cat.huella ? cat.huella.corta : "", k: k, deTotal: trozos.length, pushId: pushId }, trozos[k]),
        fecha: (new Date()).toISOString(),
      };
      try { ws.send(await cifrar(claveActual, op)); } catch (_) { return false; }
    }
    return true;
  }
  var _difCatT = null;
  try {
    window.addEventListener("oc-catalogo-cambiado", function () {
      try { clearTimeout(_difCatT); } catch (_) {}
      _difCatT = setTimeout(function () { try { difundirCatalogo(); } catch (_) {} }, 500);
    });
  } catch (_) {}

  async function responderFoto(pedido) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    /* Un tablero no contesta a otro tablero: solo responde quien tiene backend. */
    if (!window.OCSync && !window.fetch) return;
    /* Jitter: si hay dos telefonos del mismo negocio conectados, no mandan la
       foto entera los dos a la vez. */
    await new Promise((r) => setTimeout(r, Math.random() * 500));
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    let foto;
    try { foto = await armarFoto(); } catch (_) { return; }
    const trozos = []
      .concat(trocear("productos", foto.productos))
      .concat(trocear("clientes", foto.clientes))
      .concat(trocear("ventas", foto.ventas))
      .concat(trocear("liquidaciones", foto.liquidaciones))
      .concat(trocear("perchas", foto.perchas))
      .concat([{ tabla: "resumen", i: 0, total: 1, filas: [foto.resumen || {}] }]);
    for (let k = 0; k < trozos.length; k++) {
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      const op = {
        opId: uuidCorto(), deviceId: deviceId(), tipo: TIPO_FOTO_TROZO,
        para: pedido.deviceId || null,
        payload: Object.assign({ negocio: foto.negocio, generadaEn: foto.generadaEn, k: k, deTotal: trozos.length }, trozos[k]),
        fecha: (new Date()).toISOString(),
      };
      try { ws.send(await cifrar(claveActual, op)); } catch (_) { return; }
    }
  }

  /* ==========================================================================
     EL MANDO A DISTANCIA. Este dispositivo hace de manos del tablero.

     Por que asi y no reimplementando Avanzado dentro de tablero.html: la
     logica de negocio vive en un solo sitio. Si manana cambia como se agrega
     un encargado, cambia en mock-backend.js y el tablero se entera solo. Dos
     implementaciones de la misma regla es como se rompen los negocios.
     ========================================================================== */
  /* Verifica el PIN que llego del tablero y contesta SOLO el rol, nunca nada
     mas. Un PIN de encargado o de contador no abre el tablero: ese es el punto.
     El PIN viaja cifrado con la clave de sala, igual que todo lo demas. */
  async function responderPin(op) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const pin = String((op.payload && op.payload.pin) || "");
    if (!pin) return;

    /* BUG 1: el PIN de un ADMIN nunca abria el tablero. verificarOwnerOEmpleado
       solo devuelve "dueno" o "empleado"; los admins se dan de alta como
       usuarios nombrados y se verifican por /api/usuarios/verificar. Faltaba
       ese segundo camino, asi que el guard "dueno o admin" era en realidad
       "solo dueno". */
    let rol = "";
    try {
      /* El secreto puede estar todavia migrando cuando llega el pedido: sin
         esperar, un PIN valido se rechazaba por pura carrera de arranque. */
      if (window.OCSecure && window.OCSecure.migrarSiHaceFalta) {
        try { await window.OCSecure.migrarSiHaceFalta(); } catch (_) {}
      }
      if (window.OCSecure && window.OCSecure.verificarOwnerOEmpleado) {
        rol = (await window.OCSecure.verificarOwnerOEmpleado(pin)) || "";
      }
      if (rol !== "dueno") {
        const res = await fetch("/api/usuarios/verificar", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pin: pin }),
        });
        if (res.ok) {
          const u = await res.json();
          if (u && u.rol && u.activo !== false) rol = u.rol;
        }
      }
    } catch (_) {}

    const ok = rol === "dueno" || rol === "admin";

    /* BUG 2, y es el que rompia el caso real: en una sala con MAS DE UN
       dispositivo, todos contestaban, y el tablero se quedaba con la PRIMERA
       respuesta. Un telefono que no conoce ese PIN contestaba "no" antes que
       el que si lo conoce, y un PIN valido quedaba rechazado.

       Ahora el "no" NO se manda: quien no puede autorizar se calla, y el
       tablero cae en su propio timeout si de verdad nadie lo reconocio. Un
       silencio de 12 s es mejor que un rechazo falso e inmediato.

       Solo se contesta el "no" cuando este dispositivo es el UNICO en la sala:
       ahi el rechazo es informacion cierta y ahorra la espera. */
    if (!ok && presenciaN > 2) return;

    const r = {
      opId: uuidCorto(), deviceId: deviceId(), tipo: TIPO_RESPUESTA,
      payload: { pedido: (op.payload && op.payload.pedidoId) || op.opId, ok: ok,
                 datos: ok ? { rol: rol } : { error: "Ese PIN no abre el tablero." } },
      fecha: (new Date()).toISOString(),
    };
    try { ws.send(await cifrar(claveActual, r)); } catch (_) {}
  }

  /* LISTA BLANCA DE ÓRDENES REMOTAS (JFC 2026-08-27). Bug latente arreglado:
     ORDENES_PERMITIDAS se referenciaba en ordenPermitida() pero NUNCA se
     definía → cualquier orden del tablero lanzaba ReferenceError que se tragaba
     el try/catch y el tablero esperaba y hacía timeout. Ahora se define aquí,
     estricta: solo estas rutas se pueden pedir desde el dashboard. El tablero
     (tablero-avanzado.js) usa /api/usuarios, /api/actividad, /api/integridad,
     /api/transferencias, /api/reportes/pl y /api/reportes/balance. Se añade
     /micelio/apodo (POST) para que el tablero pueda renombrar un dispositivo. */
  var ORDENES_PERMITIDAS = [
    { m: "GET",  re: /^\/api\/usuarios$/ },
    { m: "GET",  re: /^\/api\/directorio$/ }, // JFC 2026-08-28: directorio de acceso (quién tiene cada PIN)
    { m: "PATCH", re: /^\/api\/usuarios\/[^/]+$/ },
    { m: "POST", re: /^\/api\/usuarios$/ },
    { m: "GET",  re: /^\/api\/actividad$/ },
    { m: "GET",  re: /^\/api\/integridad$/ },
    { m: "GET",  re: /^\/api\/transferencias$/ },
    { m: "GET",  re: /^\/api\/reportes\/pl\?/ },
    { m: "GET",  re: /^\/api\/reportes\/balance\?/ },
    { m: "POST", re: /^\/micelio\/apodo$/ },
    { m: "POST", re: /^\/micelio\/fixlic$/ }, // JFC 2026-08-28: soporte — dar licencia nueva completa
    { m: "POST", re: /^\/micelio\/rotar$/ },  // JFC 2026-08-28: soporte — rotar licencia
  ];

  function ordenPermitida(metodo, ruta) {
    return ORDENES_PERMITIDAS.some(function (p) { return p.m === metodo && p.re.test(ruta); });
  }

  async function responderOrden(op) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const p = op.payload || {};
    const metodo = String(p.metodo || "GET").toUpperCase();
    const ruta = String(p.ruta || "");
    const responder = async (cuerpo, ok) => {
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      const r = {
        opId: uuidCorto(), deviceId: deviceId(), tipo: TIPO_RESPUESTA,
        payload: { pedido: p.pedidoId || op.opId, ok: !!ok, datos: cuerpo },
        fecha: (new Date()).toISOString(),
      };
      try { ws.send(await cifrar(claveActual, r)); } catch (_) {}
    };
    if (!ordenPermitida(metodo, ruta)) {
      /* Se dice que no se permite, no se ignora: un tablero esperando en
         silencio una respuesta que nunca llega es peor que un no claro. */
      return responder({ error: "That action cannot be done from the dashboard." }, false);
    }
    /* Jitter, igual que en el catch-up: si hay dos telefonos del negocio
       conectados, no ejecutan la misma orden a la vez. Solo el primero que
       conteste importa; el tablero descarta las respuestas repetidas. */
    await new Promise((r) => setTimeout(r, Math.random() * 350));
    /* ORDEN DE APODO (JFC 2026-08-27): el tablero puede renombrar un
       dispositivo. Se orienta por `para` (deviceId): solo el dispositivo
       destinatario la aplica, para que no la ejecuten todos los de la sala. */
    if (metodo === "POST" && ruta === "/micelio/apodo") {
      const para = String(p.para || "");
      if (para && para !== deviceId()) return; // no es para este dispositivo
      const apodo = String((p.cuerpo && p.cuerpo.apodo) || "").trim().slice(0, 28);
      try { if (window.OCMicelio && window.OCMicelio.ponerApodo) window.OCMicelio.ponerApodo(apodo); } catch (_) {}
      return responder({ ok: true, apodo: apodo }, true);
    }
    /* SOPORTE (JFC 2026-08-28): el dashboard pide dar una licencia nueva o
       rotar la actual. Se ejecuta en ESTE dispositivo (window.ocDarLicenciaBuena
       / ocRotarCodigoSala, expuestas por avanzado-extra.js). Solo el dueño. */
    if (metodo === "POST" && (ruta === "/micelio/fixlic" || ruta === "/micelio/rotar")) {
      if (rolActual() !== "dueno") return responder({ error: "Only the owner can do that." }, false);
      try {
        if (ruta === "/micelio/fixlic" && window.ocDarLicenciaBuena) window.ocDarLicenciaBuena();
        if (ruta === "/micelio/rotar" && window.ocRotarCodigoSala) window.ocRotarCodigoSala();
        return responder({ ok: true }, true);
      } catch (_) { return responder({ error: "Could not run that action." }, false); }
    }
    try {
      const opts = { method: metodo };
      let cuerpo = p.cuerpo || {};
      /* CASO ESPECIAL, y el unico: dar de alta a alguien. El backend exige el
         PIN, pero el PIN NO puede viajar al tablero ni teclearse alli: el
         tablero puede estar abierto en una pantalla que ve medio local. Asi
         que lo genera ESTE dispositivo, se lo manda al backend, y al tablero
         solo le contesta que ya esta. El PIN se muestra aqui, en la mano del
         duenio, que es donde tiene que verse. */
      let pinGenerado = "";
      if (metodo === "POST" && ruta === "/api/usuarios" && !cuerpo.pin) {
        const b = new Uint8Array(2);
        crypto.getRandomValues(b);
        pinGenerado = String(100 + ((b[0] << 8 | b[1]) % 900));   /* 100..999 */
        cuerpo = Object.assign({}, cuerpo, { pin: pinGenerado });
      }
      if (metodo !== "GET") {
        opts.headers = { "Content-Type": "application/json" };
        opts.body = JSON.stringify(cuerpo);
      }
      const res = await fetch(ruta, opts);
      const datos = await res.json();
      if (pinGenerado && res.ok !== false && !datos.error) {
        /* El aviso con el PIN sale en ESTE dispositivo. Nunca en la respuesta. */
        try {
          window.dispatchEvent(new CustomEvent("oc-alta-remota", {
            detail: { nombre: datos.nombre || cuerpo.nombre, rol: datos.rol || cuerpo.rol, pin: pinGenerado },
          }));
        } catch (_) {}
      }
      /* Por si acaso: nunca devolver un pin, venga de donde venga. */
      if (datos && typeof datos === "object" && "pin" in datos) { try { delete datos.pin; } catch (_) {} }
      await responder(datos, res.ok !== false);
    } catch (e) {
      await responder({ error: "No se pudo completar." }, false);
    }
  }

  /* Lo llama micelio-vivo.js cada minuto. Si el socket no esta abierto no se
     encola ni se reintenta: un latido viejo no informa de nada, y el silencio
     ES la senal que el otro lado necesita leer. */
  async function emitirLatido(quien) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    const op = {
      opId: uuidCorto(), deviceId: deviceId(), tipo: TIPO_LATIDO,
      /* PASO 2 (JFC 2026-08-19): el latido lleva la HUELLA del catalogo. Sin
         esto el panel del equipo solo sabe CUANDO se hablo el otro, no SI
         estan mostrando el mismo inventario, y decia "al dia" sin comparar un
         solo dato. La huella no revela nada: es un hash de 32 bits. */
      payload: { id: quien.id, apodo: quien.apodo || "", rol: quien.rol || "", huella: quien.huella || "" },
      fecha: (new Date()).toISOString(),
    };
    try { ws.send(await cifrar(claveActual, op)); return true; } catch (_) { return false; }
  }

  /* Lo usa el tablero. En la app no se llama nunca, pero se expone desde el
     mismo modulo para que las dos puntas hablen exactamente el mismo dialecto
     y no puedan desincronizarse por copia y pega. */
  async function pedirFoto() {
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    const op = {
      opId: uuidCorto(), deviceId: deviceId(), tipo: TIPO_FOTO_PEDIDA,
      payload: {}, fecha: (new Date()).toISOString(),
    };
    try { ws.send(await cifrar(claveActual, op)); return true; } catch (_) { return false; }
  }

  /* TEAM- Y F123- SON EL MISMO VALOR (JFC 2026-08-19).
     El codigo de equipo y la licencia se mostraban IGUAL, los dos con F123-, y
     la gente los confundia: JFC mismo puso 789 en su celular creyendo que asi
     entraba a su negocio y termino con dos licencias.

     La separacion es de PRESENTACION: de aqui para adentro la sala vale
     exactamente lo mismo que siempre, asi que ningun equipo ya sincronizado se
     cae. Lo unico que cambia es que el codigo de equipo se MUESTRA y se ACEPTA
     con prefijo TEAM-, y aqui se traduce a la forma interna.

     Se siguen aceptando los dos prefijos al teclear: quien tenga el codigo
     viejo anotado en un papel no se queda afuera. */
  function normalizarCodigo(codigo) {
    var v = String(codigo || "").trim().toUpperCase().replace(/\s+/g, "");
    if (v.indexOf("TEAM-") === 0) v = "F123-" + v.slice(5);
    /* Sustituciones Crockford (JFC 2026-08-27, refuerzo P0). I/L→1, O→0, igual
       que _ocNormalizar() en auth-ui.js y que la máscara formatear(). Antes NO
       se hacían aquí: el mismo código tecleado con "I"/"O" (copiado de un papel
       o captura) caía en una sala DISTINTA a la de quien lo tecleó bien, y la
       desincronización era silenciosa. Ahora ambos caminos normalizan igual. */
    v = v.replace(/[IL]/g, "1").replace(/O/g, "0");
    return v;
  }
  /* SE ACABO EL CODIGO "TEAM-" (JFC 2026-08-21).
     Nunca fue otra cosa que la licencia con otra mascara: normalizarCodigo()
     traduce TEAM- a F123- y adentro vale exactamente lo mismo. Tener dos
     nombres para UN valor solo confundia: la gente creia que ademas de la
     licencia habia que conseguir y teclear un "codigo de equipo", y el panel
     lo PEDIA antes de ofrecerlo.
     La licencia es el tronco: todos los dispositivos con la misma licencia son
     el mismo cuaderno, y se sincronizan solos. Esta funcion queda como
     identidad para no tocar las decenas de llamadas que la usan, y
     normalizarCodigo() SIGUE aceptando TEAM- por si alguien lo tiene anotado
     en un papel de las semanas en que se mostro asi. */
  function codigoParaMostrar(codigo) {
    return String(codigo || "").trim().toUpperCase();
  }

  function programarReintento() {
    if (!leerSala()) return; // el dueño apago sync mientras tanto: no insistir
    intentosSeguidos++;
    // Refuerzo: no podemos distinguir "codigo invalido / sala inalcanzable"
    // de "wifi que parpadeo" desde el WebSocket (el navegador no expone el
    // motivo del cierre) — pero tras varios intentos seguidos fallidos SI
    // podemos avisar, en vez de reintentar en silencio para siempre sin que
    // nadie sepa que algo no cuadra.
    if (intentosSeguidos >= 6) notificarEstado("reconectando");
    // Jitter chico (+-20%) para que, si varios dispositivos del equipo se
    // desconectan juntos (ej. wifi del local que parpadea), no reconecten
    // todos en el mismo instante exacto.
    const jitter = 1 + (Math.random() * 0.4 - 0.2);
    setTimeout(conectar, Math.round(reintentoMs * jitter));
    reintentoMs = Math.min(reintentoMs * 2, 30000);
  }

  async function vaciarCola() {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const cola = leerCola();
    if (!cola.length) return;
    for (const op of cola) {
      try { const buf = await cifrar(claveActual, op); ws.send(buf); _persistirOpBuf(op, buf); } catch (_) { return; } // corta si algo falla, reintenta despues
    }
    guardarCola([]);
  }

  // Al reconectar, preguntar que me perdi. Mensaje ephemero (no de negocio):
  // no se guarda en el log ni en la cola de reintento — si falla, la proxima
  // conexion vuelve a preguntar, no hace falta insistir con este en concreto.
  async function pedirCatchup() {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const pedido = {
      opId: uuidCorto(), deviceId: deviceId(), tipo: TIPO_CATCHUP_PEDIDO,
      payload: construirVectorConocido(), fecha: (new Date()).toISOString(),
    };
    try { ws.send(await cifrar(claveActual, pedido)); } catch (_) {}
  }
  // Alguien pregunto que le falta. Le contesto con mis ops mas nuevas que las
  // que dice conocer — cada una viaja como una Op normal (mismo formato,
  // mismo cifrado), asi que aplicarOpRemota() del que pregunta la procesa
  // exactamente igual que si la hubiera recibido en vivo, con el mismo dedup
  // por opId. Jitter chico: si varios pares contestan a la vez, no lo hacen
  // todos en el mismo instante.
  async function responderCatchup(pedido) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const faltantes = buscarOpsFaltantes(pedido.payload, pedido.deviceId);
    if (!faltantes.length) return;
    await new Promise((r) => setTimeout(r, Math.random() * 400));
    for (const op of faltantes) {
      if (!ws || ws.readyState !== WebSocket.OPEN) return; // se desconecto a mitad de camino, no insistir
      try { ws.send(await cifrar(claveActual, op)); } catch (_) { return; }
    }
  }

  /* ==========================================================================
     BITACORA CIFRADA EN EL RELAY (JFC 2026-08-25)
     Para que un dispositivo NUEVO vea la tienda aunque no haya nadie en linea:
     el relay guarda sobres CERRADOS (no puede leerlos). Todo esto es ADITIVO y
     compatible hacia atras — el envio en vivo sigue igual; un relay viejo
     ignora estos frames de texto.
       - cada op de negocio se manda tambien como {k:"op",...} para la bitacora;
       - cada tanto se sube un {k:"ckpt",...} (foto cifrada del catalogo+stock);
       - al conectar se pide {k:"pull",...} para ponerse al dia contra el relay.
     ======================================================================== */
  function _persistirOpBuf(op, buf) {
    try {
      if (ws && ws.readyState === WebSocket.OPEN)
        ws.send(JSON.stringify({ k: "op", id: op.opId, lam: op.lamport || 0, c: ab2b64(buf) }));
    } catch (_) {}
  }
  var _ultimaHuellaCkpt = "";
  async function subirCheckpoint(forzar) {
    try {
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      if (!window.OCSync || !window.OCSync.estadoParaCheckpoint) return; // un tablero no sube nada
      var snap = window.OCSync.estadoParaCheckpoint();
      var hu = (snap && snap.huella && snap.huella.completa) ? snap.huella.completa : "";
      if (!forzar && hu && hu === _ultimaHuellaCkpt) return; // sin cambios: no repetir
      var sobre = { tipo: TIPO_CHECKPOINT, deviceId: deviceId(), lamport: _lamportAplicadoMax || lamportActual(), payload: snap };
      var buf = await cifrar(claveActual, sobre);
      ws.send(JSON.stringify({ k: "ckpt", lam: sobre.lamport, c: ab2b64(buf) }));
      _ultimaHuellaCkpt = hu;
    } catch (_) {}
  }
  function pullDelRelay() {
    try {
      if (ws && ws.readyState === WebSocket.OPEN)
        ws.send(JSON.stringify({ k: "pull", lam: lamportActual() }));
    } catch (_) {}
  }

  // --- Puente con mock-backend.js: emitirOpStock(tipo, payload) llama aqui ---
  window.OCSyncEmit = function (tipo, payload) {
    const sala = leerSala();
    if (!sala) return; // sync apagado: no-op total, cero overhead
    const op = {
      opId: uuidCorto(), deviceId: deviceId(), deviceNombre: (window.OCCurrentUser && window.OCCurrentUser.nombre) || null,
      lamport: siguienteLamport(), tipo, payload, fecha: (new Date()).toISOString(),
    };
    registrarEnLog(op); // guardo mi propia op para poder reenviarsela a un par que la haya perdido
    if (ws && ws.readyState === WebSocket.OPEN) {
      /* BLINDAJE (JFC 2026-08-25, "JAMAS quedemos mal"): si cifrar() rechaza
         (rarisimo, pero posible), sin el .catch la op no se mandaba NI se
         encolaba: se perdia en silencio. Ahora, cualquier fallo de cifrado o
         de envio cae a la cola, que se vacia al reconectar. Una op nunca se
         pierde por un tropiezo del cifrado. */
      cifrar(claveActual, op)
        .then((buf) => { try { ws.send(buf); _persistirOpBuf(op, buf); } catch (_) { encolar(op); } })
        .catch(() => encolar(op));
    } else {
      encolar(op);
    }
  };
  function encolar(op) { const cola = leerCola(); cola.push(op); guardarCola(cola); }

  // --- API publica para la UI (Avanzado) ---
  window.OCSyncControl = {
    // activar(): usado por el dueño al licenciarse (auto, sin pantalla) y por
    // el panel de Avanzado. unirse() es el mismo mecanismo con nombre claro
    // para el flujo de equipo ("Unirme con el codigo de mi negocio").
    // 2026-07-23 (ajuste del plan sincro-equipos): una vez guardado el
    // codigo, sync queda encendido PARA SIEMPRE en este dispositivo — no es
    // un "modo evento" que se prende y apaga, es un estado permanente.
    activar(codigo) {
      // Refuerzo (2026-07-23): normalizar SIEMPRE antes de guardar — "amg-x"
      // y "AMG-X" deben caer en la MISMA sala. Antes se guardaba tal cual lo
      // tecleara el usuario, silencioso y confuso si alguien no usaba mayus.
      const codigoNorm = normalizarCodigo(codigo);
      if (codigoNorm.length < 6) return { ok: false, error: "The code must be at least 6 characters." };
      /* FORMATO DE SALA (2026-08-14). Acepta el formato nuevo de 4 grupos con
         simbolo de verificacion y TAMBIEN el viejo, para no dejar afuera a
         ninguna licencia ya emitida. consultorio-123 acepta ademas el prefijo
         F123 que emitio por error antes del 2026-08-13.
         Si el codigo trae simbolo de verificacion y NO cuadra, se bloquea: eso
         es un codigo mal tecleado, y dejarlo pasar es lo que manda a alguien a
         una sala vacia sin entender por que no se sincroniza. */
      var _pre = ["F123"];
      var _cuerpo = codigoNorm.replace(new RegExp("^(" + _pre.join("|") + ")-"), "").replace(/-/g, "");
      var _prefijoOk = _pre.some(function (p) { return codigoNorm.indexOf(p + "-") === 0; });
      if (!_prefijoOk || (_cuerpo.length !== 8 && _cuerpo.length !== 12 && _cuerpo.length !== 17)) {
        return { ok: false, error: "Invalid license — check that it is complete, in the format F123-XXXX-XXXX-XXXX-XXXXX." };
      }
      /* AVISO, NO BLOQUEO (JFC 2026-08-27, refuerzo P1). Una licencia corta
         (8/12 = formato viejo) o con checksum que no cuadra se ACEPTA igual
         (guard, no puerta: no dejar fuera a quien tiene su licencia legítima),
         pero se informa al dueño para que no entre a una sala vacía sin saber
         por qué. El caller muestra r.warning si viene. */
      var _aviso = "";
      if (_cuerpo.length === 8 || _cuerpo.length === 12) {
        _aviso = "Esta licencia parece corta (formato viejo). Revisa que esté completa: F123-XXXX-XXXX-XXXX-XXXXX.";
      }
      if (_cuerpo.length === 17) {
        var _B32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ", _CHK = _B32 + "*~$=U", _acc = 0, _mal = false;
        for (var _i = 0; _i < 16; _i++) {
          var _v = _B32.indexOf(_cuerpo.charAt(_i));
          if (_v < 0) { _mal = true; break; }
          _acc = (_acc * 32 + _v) % 37;
        }
        if (_mal || _CHK.charAt(_acc) !== _cuerpo.charAt(16)) {
          /* GUARD, NO PUERTA (JFC 2026-08-25). El simbolo de verificacion NO
             debe RECHAZAR una licencia legitima ya emitida — muchas no llevan
             el checksum del cliente (las emitio el Worker, o son mas viejas).
             Bloqueaba a una usuaria real (idiomARTE) con su licencia correcta
             en tablet/celular. Se degrada a AVISO: se acepta y se conecta. Si
             de verdad estaba mal tecleada, cae en una sala vacia y el indicador
             lo muestra (offline) — recuperable, a diferencia de dejar fuera a
             quien SI tiene su licencia. Misma filosofia que
             ocLicenciaVerificada() en auth-ui.js ("guard, no puerta"). */
          try { console.warn("[sync] licencia sin simbolo de verificacion valido; se acepta igual (guard, no puerta)"); } catch (_) {}
          if (!_aviso) _aviso = "El código no pasa la verificación. Revisa que esté bien tecleado (I/L valen 1, O vale 0).";
        }
      }
      try { localStorage.setItem(ROOM_KEY, JSON.stringify({ codigo: codigoNorm })); } catch (_) {}
      /* ADOPTAR LA LICENCIA AL ACTIVAR (JFC 2026-08-27). Bug de entrada real:
         "Sync your team" llamaba a activar(), que guardaba la sala de sync pero
         NO actualizaba f123_owned.licenseCode. Así el aparato sincronizaba a la
         sala correcta pero seguía reportando al panel una licencia vieja/trunca
         (ej. F123-5HSG-JENF) y quedaba "rogue": no se unía a su licencia ni a
         sus hermanos. Ahora la licencia que el dueño entra deliberadamente se
         vuelve la del dispositivo — mismo criterio que ya tenía unirse().
         Es una acción DELIBERADA del dueño, no autocuración: solo se escribe
         cuando él teclea/pega un código. Se preserva la excepción del lord
         (no adopta licencia ajena, registra el acceso). */
      try {
        if (/^F123-/i.test(codigoNorm)) {
          var _ow = JSON.parse(localStorage.getItem("f123_owned") || "null") || {};
          if (_esLord()) {
            _registrarAcceso(codigoNorm);
          } else {
            /* Se actualizan AMBOS (JFC 2026-08-27, refuerzo P1): licenseCode y
               syncCode. Al entrar una licencia, la sala ES esa licencia, así
               que syncCode debe seguirla. Antes solo se tocaba licenseCode y
               quedaban divergentes (syncCode viejo). */
            _ow.licenseCode = codigoNorm;
            _ow.syncCode = codigoNorm;
            localStorage.setItem("f123_owned", JSON.stringify(_ow));
          }
        }
      } catch (_) {}
      reintentoMs = 1000;
      intentosSeguidos = 0;
      conectar();
      return _aviso ? { ok: true, warning: _aviso } : { ok: true };
    },
    /* Fija la sala de sync a un código SIN conectar (JFC 2026-08-26, NB-1).
       La usa OCTienda.cambiar() al cambiar de tienda: cada tienda debe
       sincronizar en SU PROPIA sala (= su licencia). Sin esto, cambiar de
       tienda por un selector directo dejaría ROOM_KEY apuntando a la sala
       anterior → una tienda sincronizaría en la sala equivocada (contaminación
       cruzada). No conecta porque cambiar() recarga la página justo después, y
       al arrancar `if (leerSala()) conectar()` reconecta a la sala correcta.
       Usa la MISMA normalización que activar() para no crear salas gemelas por
       mayúsculas/formato. Devuelve {ok} y nunca lanza. */
    fijarSala(codigo) {
      try {
        const codigoNorm = normalizarCodigo(codigo);
        if (!codigoNorm || codigoNorm.length < 6) return { ok: false };
        localStorage.setItem(ROOM_KEY, JSON.stringify({ codigo: codigoNorm }));
        return { ok: true, codigo: codigoNorm };
      } catch (_) { return { ok: false }; }
    },
    unirse(codigo) {
      /* JFC 2026-08-28 (bug de join): capturar la tienda de la que se sale ANTES
         de tocar licenseCode. unirse() escribe licenseCode abajo; si cambiar()
         comparara contra _licenciaPropia() (que ya devuelve el código nuevo),
         sufDest caería a "" y el switch nunca ocurriría. `desde` se pasa a
         cambiar() para que el destino sea "::<lic>" (namespace aparte). */
      const _desde = (window.OCTienda && window.OCTienda.licenciaActual) ? window.OCTienda.licenciaActual() : "";
      const r = this.activar(codigo);
      /* APROPIAR EL DISPOSITIVO AL UNIRSE (JFC 2026-08-26). Un aparato que se une
         a un equipo con licencia válida deja de ser DEMO: es un dispositivo REAL
         de esa tienda. Sin esto se quedaba en modo demo y por eso Belén veía los
         clientes semilla, NO tenía la pastilla de rol ni el lápiz de dueño, y "no
         podía agregar" — todo eran síntomas de sesión demo. Solo se marca
         instanceId (identidad de aparato); NO se fija PIN de dueño: la persona
         entra con su PIN de equipo (sincronizado). Se hace ANTES del reload de
         cambiar() para que ya arranque apropiado. Idempotente: si ya tenía
         instanceId, no se toca. */
      try {
        if (r && r.ok) {
          var _ow = JSON.parse(localStorage.getItem("f123_owned") || "null") || {};
          if (!_ow.instanceId) {
            _ow.instanceId = (self.crypto && self.crypto.randomUUID) ? self.crypto.randomUUID() : (Date.now().toString(36) + "-" + Math.random().toString(36).slice(2));
            _ow.activatedAt = _ow.activatedAt || Date.now();
          }
          /* IDENTIDAD AL UNIRSE — MODELO 1 vs MODELO 2 (JFC 2026-08-26).
             Decidido por JFC: un usuario NORMAL que pone una licencia SE VUELVE un
             dispositivo de ESE negocio (adopta la licencia como suya) → el panel de
             licencias lo CUENTA como 2do/3er device en vez de forjar una licencia
             nueva/truncada aparte. Era el bug: unirse() nunca fijaba licenseCode, así
             que el teléfono reportaba una licencia distinta al Worker y salía como
             fila separada. Se fija ANTES de cambiar() para que _licenciaPropia() ya
             refleje esta licencia y la tienda destino sea la propia ("").
             EXCEPCIÓN — EL LORD (JFC como super-admin): un aparato marcado lord NO
             adopta la licencia ajena (conserva su identidad) y entra como INVITADO/
             observador; se REGISTRA el acceso (auditoría, best-practice de acceso
             privilegiado). Así el panel del cliente no lo cuenta como su device. */
          var _codNorm = normalizarCodigo(codigo);
          if (_esLord()) {
            _registrarAcceso(_codNorm);
            /* LORD NUNCA ADOPTA (JFC 2026-08-31). Join a una licencia ajena
               solo registra el acceso. La identidad canónica se escribió UNA
               vez al verificar el código maestro (f123_lord_licencia_canonica)
               y aquí se RESTAURA, no se pisa. Si no hay canónica, no se toca
               licenseCode/syncCode. */
            var _can = _licenciaCanonicaLord();
            if (_can && /^F123-/i.test(_can)) {
              _ow.licenseCode = _can;
              _ow.syncCode = _can;
            }
          } else if (_codNorm && /^F123-/.test(_codNorm)) {
            /* SIMETRIA CON EL LORD (JFC 2026-08-28, cierre de hueco de
               auditoria C-SYNC1): la rama lord de arriba fija licenseCode
               Y syncCode juntos; esta rama normal solo fijaba licenseCode.
               syncCode se quedaba con el valor de la activacion original
               (auth-ui.js los fija iguales al activar), asi que Sync
               diagnostics mostraba dos licencias distintas para SIEMPRE
               despues del primer join -- el sintoma exacto reportado: "me
               muestra la licencia de una tienda a la que me uni una vez
               pero no me deja irme de ahi". No es que no se pueda salir:
               syncCode (la identidad real) nunca se movio; solo la
               etiqueta licenseCode quedo pegada al join. */
            _ow.licenseCode = _codNorm; // se vuelve device de ese negocio (cuenta en el panel)
            _ow.syncCode = _codNorm;
          }
          localStorage.setItem("f123_owned", JSON.stringify(_ow));
        }
      } catch (_) {}
      /* CAMBIO DE TIENDA AL UNIRSE (JFC 2026-08-26 — reemplaza el "adoptar la
         licencia" de 2026-08-25, que hacía merge y por eso el aparato SEGUÍA
         mostrando su tienda local con otro nombre y los PINs del equipo no
         entraban).
         Modelo nuevo (multi-tienda): poner una licencia = VOLVERSE esa tienda.
         La tienda propia queda guardada aparte; se vuelve a ella poniendo su
         licencia otra vez. OCTienda.cambiar() flushea la tienda actual, apunta
         el estado a la tienda de esta licencia y RECARGA — por eso esto va al
         final y todo lo de abajo ya no se ejecuta tras el reload.
         La sala (ROOM_KEY) ya quedó guardada por activar() y sobrevive el
         reload, así que al reconectar los datos del equipo (PINs incluidos)
         sincronizan hacia el namespace de ESTA tienda, no hacia la propia. */
      try {
        if (r && r.ok && window.OCTienda && window.OCTienda.cambiar) {
          const sala = leerSala();
          if (!sala || !sala.codigo) {
            return { ok: false, error: "Failed to set sync room. Try again." };
          }
          const cod = sala.codigo;
          const c = window.OCTienda.cambiar(cod, { desde: _desde }); // recarga la página si cambia de tienda
          /* MISMA TIENDA (JFC 2026-08-26): si la licencia tecleada es la de la
             tienda en la que YA estás, cambiar() no recarga (mismo:true). NO es
             callejón sin salida: se FUERZA una re-sincronización (reconecta +
             re-pide catálogo + jala el checkpoint del relay). Así, si estabas en
             el namespace correcto pero el sync no había traído nada, este segundo
             intento vuelve a jalar todo. */
          if (c && c.mismo) {
            try { reintentoMs = 1000; intentosSeguidos = 0; conectar(); } catch (_) {}
            return { ok: true, mismo: true, error: "You're already in this store — re-syncing with the team now. If a teammate's device is on, their shelves and customers will land in a moment." };
          }
        }
      } catch (err) {
        try { console.error("[unirse] error:", err); } catch (_) {}
        return { ok: false, error: "Unexpected error. Try again." };
      }
      return r;
    },
    desactivar() {
      try { localStorage.removeItem(ROOM_KEY); } catch (_) {}
      cerrarWsExistente();
      presenciaN = null;
      intentosSeguidos = 0;
      notificarEstado("apagado");
    },
    // "Resincronizar" (nunca "forzar" — asusta al usuario normal): salvavidas
    // raro para cuando alguien duda si esta sincronizado de verdad en plena
    // feria. Reconecta ya mismo, sin esperar el backoff normal.
    resincronizar() {
      if (!leerSala()) return { ok: false, error: "Sync is not active on this device." };
      reintentoMs = 1000;
      intentosSeguidos = 0;
      conectar();
      return { ok: true };
    },
    estado() { return estadoActual; },
    presencia() { return presenciaN; },
    // Refuerzo: expone si llevamos varios intentos seguidos sin exito, para
    // que la UI pueda avisar ("revisa el código") en vez de reintentar mudo.
    problemaPersistente() { return intentosSeguidos >= 6; },
    salaActiva() { const s = leerSala(); return s ? s.codigo : null; },
    /* Version presentable del codigo de sala (TEAM-...). El valor interno no
       cambia: esto es solo para pintar y para compartir. */
    /* RELOJ LÓGICO PARA EL ROSTER (JFC 2026-08-26). mock-backend sella cada
       edición del equipo con { c: revTick(), d: deviceIdActual() } para que el
       merge decida quién gana por CAUSALIDAD (Lamport), no por reloj de pared
       (dos celulares con la hora mal puesta se pisaban). Es el mismo contador
       que ya sincronizan los version vectors, así que no hace falta nada nuevo. */
    revTick() { return siguienteLamport(); },
    deviceIdActual() { return deviceId(); },
    pedirCatalogo: pedirCatalogo,
    /* REDUNDANCIA (JFC 2026-08-27): envío genérico de un mensaje efímero
       cifrado (para el sync-watchdog). No se loguea ni se deduplica. Se quita
       junto con sync-watchdog.js. */
    enviarMensaje(tipo, payload, para) {
      if (!ws || ws.readyState !== WebSocket.OPEN) return false;
      const op = { opId: uuidCorto(), deviceId: deviceId(), tipo: tipo, para: para || null, payload: payload, fecha: (new Date()).toISOString() };
      try { cifrar(claveActual, op).then(function (buf) { try { ws.send(buf); } catch (_) {} }); return true; } catch (_) { return false; }
    },
    difundirEquipo: difundirEquipo,
    difundirCatalogo: difundirCatalogo,
    salaParaMostrar() { const s = leerSala(); return s ? codigoParaMostrar(s.codigo) : null; },
    paraMostrar: codigoParaMostrar,
    onEstado(fn) { listenersEstado.push(fn); },
    /* Para el TABLERO DE CONTROL. Se exponen desde el mismo modulo que las
       contesta para que las dos puntas hablen exactamente el mismo dialecto y
       no puedan desincronizarse por copia y pega. */
    pedirFoto,
    emitirLatido,
  };

  // Reconexion automatica al volver a tener foco/red (celular que se bloqueo, wifi que parpadeo)
  window.addEventListener("online", () => { if (leerSala() && estadoActual !== "conectado") { reintentoMs = 1000; conectar(); } });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && leerSala() && (!ws || ws.readyState !== WebSocket.OPEN)) { reintentoMs = 1000; conectar(); }
  });

  // Arranque: si ya habia una sala configurada de antes, reconectar solo.
  if (leerSala()) conectar();
})();
