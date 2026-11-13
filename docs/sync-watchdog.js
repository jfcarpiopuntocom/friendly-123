/* sync-watchdog.js — CAPA DE REDUNDANCIA DEL SISTEMA DE SYNC (JFC 2026-08-27).
 *
 * POR QUÉ EXISTE: el sync de friendly-123 es sólido (relay propio E2E, reloj
 * Lamport, catch-up entre pares, checkpoint en la bitácora del relay), pero
 * tiene puntos únicos de fallo que esta capa cubre SIN tocar el código que ya
 * funciona:
 *   - El checkpoint vive SOLO en el relay (si el relay cae, un aparato nuevo o
 *     rezagado no tiene de dónde reconstruir).
 *   - La divergencia entre aparatos se MUESTRA (micelio) pero no se ACTÚA.
 *   - El log de ops tiene tope 500 y el catálogo en vivo no lleva stock.
 *
 * QUÉ HACE (3 capacidades redundantes, todas aditivas):
 *   A) SNAPSHOT LOCAL: guarda periódicamente una foto completa (perchas,
 *      productos+stock, equipo+PIN+rol+rev, clientes, nombre) en IndexedDB,
 *      independiente del relay. Si el relay cae, el dato sigue siendo durable
 *      y puede sembrar otro aparato.
 *   B) VERIFICADOR DE CONSISTENCIA: cada ~60s compara la huella de cada par
 *      (f123_micelio_vistos) con la propia; si un par diverge de forma
 *      persistente, el aparato de mayor rol hace un re-sync seguro
 *      (resincronizar + pedirCatalogo), nunca un merge a ciegas.
 *   C) SNAPSHOT ENTRE PARES: un aparato rezagado puede pedir un snapshot
 *      completo (catálogo + equipo + clientes + STOCK) a un par conectado —
 *      lo que el catálogo en vivo NO lleva. Se aplica add-only y con guarda de
 *      frescura (aplicarCheckpoint), así que NUNCA pisa datos existentes.
 *
 * PRIORIDAD DE DATOS: perchas, PIN, roles, inventario, clientela = prioridad
 * (todo cubierto). FOTOS = secundarias, FUERA de esta capa (fase 2).
 *
 * REGLA DE ORO: esta capa SOLO llama APIs públicas existentes (OCSync,
 * OCSyncControl). No reimplementa cifrado ni merge. Todo es try/catch: si esta
 * capa fallara, la app no se entera. Se puede quitar borrando este archivo,
 * su <script> en index.html y los 5 hooks de sync-realtime.js.
 */
(function () {
  "use strict";
  var DB_NAME = "f123_sync_watchdog";
  var DB_VER = 1;
  var STORE_SNAP = "snapshots";
  var STORE_ESTADO = "estado";
  var SNAP_INTERVALO_MS = 5 * 60 * 1000;   // snapshot local cada 5 min
  var CHECK_INTERVALO_MS = 60 * 1000;      // verificación de consistencia cada 60s
  var DIVERGENCIA_MIN = 2;                 // divergencias consecutivas antes de actuar
  var TROZO_BYTES = 200 * 1024;            // tope por trozo (relay ~256KB)
  var MAX_SNAPSHOTS = 3;                   // conservar los últimos N snapshots

  var _db = null;
  var _divergencias = {};                  // deviceId -> contador consecutivo
  var _ultimoCheck = 0;
  var _snapTimer = null;
  var _checkTimer = null;
  var _snapPendiente = null;               // acumulador de trozos (Capability C)
  var _snapPendienteId = null;

  // -------------------------------------------------------------------------
  // IndexedDB helpers (Capability A)
  // -------------------------------------------------------------------------
  function abrirDB() {
    return new Promise(function (resolve) {
      if (_db) return resolve(_db);
      try {
        var req = indexedDB.open(DB_NAME, DB_VER);
        req.onupgradeneeded = function (e) {
          var db = e.target.result;
          if (!db.objectStoreNames.contains(STORE_SNAP)) db.createObjectStore(STORE_SNAP, { keyPath: "id" });
          if (!db.objectStoreNames.contains(STORE_ESTADO)) db.createObjectStore(STORE_ESTADO, { keyPath: "k" });
        };
        req.onsuccess = function () { _db = req.result; resolve(_db); };
        req.onerror = function () { resolve(null); };
      } catch (_) { resolve(null); }
    });
  }
  function tx(store, modo, fn) {
    return abrirDB().then(function (db) {
      if (!db) return null;
      return new Promise(function (resolve) {
        try {
          var t = db.transaction(store, modo);
          var s = t.objectStore(store);
          var resultado = null;
          var pendientes = 0;
          var resuelto = false;
          function terminar() {
            if (resuelto) return;
            resuelto = true;
            resolve(resultado);
          }
          // fn recibe el store y puede devolver un IDBRequest o un valor.
          var ret = fn(s, function (val) { resultado = val; });
          if (ret && typeof ret.onsuccess === "function") {
            pendientes++;
            ret.onsuccess = function () { resultado = ret.result; pendientes--; if (pendientes === 0) terminar(); };
            ret.onerror = function () { pendientes--; if (pendientes === 0) terminar(); };
          } else if (ret !== undefined) {
            resultado = ret;
          }
          t.oncomplete = function () { terminar(); };
          t.onerror = function () { terminar(); };
          t.onabort = function () { terminar(); };
        } catch (_) { resolve(null); }
      });
    });
  }

  // -------------------------------------------------------------------------
  // Capability A — snapshot local
  // -------------------------------------------------------------------------
  function armarSnapshot() {
    try {
      if (!window.OCSync || !window.OCSync.estadoParaCheckpoint) return null;
      var snap = window.OCSync.estadoParaCheckpoint();
      if (!snap) return null;
      var lamport = 0;
      try { if (window.OCSyncControl && window.OCSyncControl.revTick) lamport = window.OCSyncControl.revTick(); } catch (_) {}
      return {
        id: "snap-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8),
        ts: new Date().toISOString(),
        lamport: lamport,
        huella: snap.huella || "",
        data: snap,
      };
    } catch (_) { return null; }
  }

  function guardarSnapshot() {
    var snap = armarSnapshot();
    if (!snap) return Promise.resolve(null);
    return tx(STORE_SNAP, "readwrite", function (s, cb) {
      s.put(snap);
      var all = s.getAll();
      all.onsuccess = function () {
        var arr = (all.result || []).sort(function (a, b) { return (a.ts < b.ts) ? 1 : -1; });
        for (var i = MAX_SNAPSHOTS; i < arr.length; i++) s.delete(arr[i].id);
        cb(snap);
      };
    });
  }

  function ultimoSnapshot() {
    return tx(STORE_SNAP, "readonly", function (s, cb) {
      var all = s.getAll();
      all.onsuccess = function () {
        var arr = (all.result || []).sort(function (a, b) { return (a.ts < b.ts) ? 1 : -1; });
        cb(arr[0] || null);
      };
    });
  }

  function listarSnapshots() {
    return tx(STORE_SNAP, "readonly", function (s, cb) {
      var all = s.getAll();
      all.onsuccess = function () {
        cb((all.result || []).sort(function (a, b) { return (a.ts < b.ts) ? 1 : -1; }));
      };
    });
  }

  // -------------------------------------------------------------------------
  // Capability B — verificador de consistencia + re-sync seguro
  // -------------------------------------------------------------------------
  function huellasDePares() {
    try {
      var raw = localStorage.getItem("f123_micelio_vistos") || "{}";
      var obj = JSON.parse(raw);
      var out = {};
      for (var k in obj) {
        if (!Object.prototype.hasOwnProperty.call(obj, k)) continue;
        var v = obj[k];
        if (v && v.huella) out[k] = v.huella;
      }
      return out;
    } catch (_) { return {}; }
  }

  function rolLocal() {
    try { if (window.OCAuth && window.OCAuth.rolActual) return window.OCAuth.rolActual(); } catch (_) {}
    return "";
  }
  function rangoRol(r) { return r === "dueno" ? 3 : r === "admin" ? 2 : r === "empleado" ? 1 : 0; }

  function verificarConsistencia() {
    var res = { divergentes: [], accion: null };
    try {
      if (!window.OCSync || !window.OCSync.huella) return res;
      var miHuella = window.OCSync.huella();
      var pares = huellasDePares();
      var miRango = rangoRol(rolLocal());
      for (var id in pares) {
        if (!Object.prototype.hasOwnProperty.call(pares, id)) continue;
        if (id === (window.OCSyncControl && window.OCSyncControl.deviceIdActual ? window.OCSyncControl.deviceIdActual() : "")) continue;
        if (pares[id] === miHuella) { _divergencias[id] = 0; continue; }
        _divergencias[id] = (_divergencias[id] || 0) + 1;
        if (_divergencias[id] >= DIVERGENCIA_MIN) {
          res.divergentes.push(id);
          // Solo actúa el aparato de mayor rol, y con backoff (no en cada check).
          if (miRango >= 2 && _ultimoCheck + 5 * 60 * 1000 < Date.now()) {
            res.accion = "resincronizar";
            _ultimoCheck = Date.now();
          }
        }
      }
    } catch (_) {}
    return res;
  }

  function ejecutarReSync() {
    try {
      if (window.OCSyncControl && window.OCSyncControl.resincronizar) window.OCSyncControl.resincronizar();
      if (window.OCSyncControl && window.OCSyncControl.pedirCatalogo) window.OCSyncControl.pedirCatalogo();
      return true;
    } catch (_) { return false; }
  }

  // -------------------------------------------------------------------------
  // Capability C — snapshot entre pares (mensajes efímeros, no se loguean)
  // -------------------------------------------------------------------------
  function trocear(snap) {
    var json;
    try { json = JSON.stringify(snap); } catch (_) { return []; }
    var bytes = new TextEncoder().encode(json);
    var trozos = [];
    for (var i = 0; i < bytes.length; i += TROZO_BYTES) {
      var chunk = bytes.slice(i, i + TROZO_BYTES);
      var dec = new TextDecoder().decode(chunk);
      trozos.push(dec);
    }
    return trozos;
  }

  function responderSnapshot(pedido) {
    try {
      var snap = armarSnapshot();
      if (!snap) return;
      var trozos = trocear(snap);
      var total = trozos.length;
      var para = pedido && pedido.deviceId ? pedido.deviceId : null;
      for (var i = 0; i < total; i++) {
        if (window.OCSyncControl && window.OCSyncControl.enviarMensaje) {
          window.OCSyncControl.enviarMensaje("__snapshot_trozo__", {
            snapId: snap.id, idx: i, total: total, huella: snap.huella, trozo: trozos[i],
          }, para);
        }
      }
    } catch (_) {}
  }

  function acumularSnapshot(op) {
    try {
      var pl = op && op.payload;
      if (!pl || !pl.snapId) return;
      if (_snapPendienteId !== pl.snapId) {
        _snapPendienteId = pl.snapId;
        _snapPendiente = { snapId: pl.snapId, total: pl.total, huella: pl.huella, trozos: [] };
      }
      _snapPendiente.trozos[pl.idx] = pl.trozo;
      if (_snapPendiente.trozos.filter(Boolean).length >= _snapPendiente.total) {
        var json = _snapPendiente.trozos.join("");
        var snap;
        try { snap = JSON.parse(json); } catch (_) { snap = null; }
        _snapPendiente = null; _snapPendienteId = null;
        if (snap && snap.data && window.OCSync && window.OCSync.aplicarCheckpoint) {
          var r = window.OCSync.aplicarCheckpoint(snap.data);
          try { window.dispatchEvent(new CustomEvent("oc-snapshot-restaurado", { detail: r })); } catch (_) {}
        }
      }
    } catch (_) {}
  }

  function pedirSnapshot() {
    try {
      if (window.OCSyncControl && window.OCSyncControl.enviarMensaje) {
        window.OCSyncControl.enviarMensaje("__snapshot_pedido__", { ts: Date.now() }, null);
        return true;
      }
    } catch (_) {}
    return false;
  }

  // -------------------------------------------------------------------------
  // Timers + arranque
  // -------------------------------------------------------------------------
  function arrancar() {
    try {
      if (_snapTimer) return;
      // snapshot inicial (si hay datos) y luego periódico
      guardarSnapshot();
      _snapTimer = setInterval(function () { guardarSnapshot(); }, SNAP_INTERVALO_MS);
      _checkTimer = setInterval(function () {
        var res = verificarConsistencia();
        if (res.accion === "resincronizar") ejecutarReSync();
      }, CHECK_INTERVALO_MS);
      // guardar snapshot cuando cambia el catálogo/equipo
      try {
        window.addEventListener("oc-catalogo-cambiado", function () { guardarSnapshot(); });
        window.addEventListener("oc-equipo-cambiado", function () { guardarSnapshot(); });
        window.addEventListener("oc-checkpoint-restaurado", function () { guardarSnapshot(); });
      } catch (_) {}
    } catch (_) {}
  }

  function estado() {
    return {
      activo: !!_snapTimer,
      divergencias: _divergencias,
      ultimoCheck: _ultimoCheck,
      colaDesbordada: colaDesbordada(),
    };
  }

  /* FASE 2 (2026-08-27): la cola offline (f123_sync_cola) marcó un desborde
     (guardarCola en sync-realtime.js). Se expone para que una sesión o el
     tablero puedan avisar que hubo más cambios offline de los que caben en la
     cola — nunca se pierde stock en silencio. */
  function colaDesbordada() {
    try {
      var n = Number(localStorage.getItem("f123_sync_cola_desbordada") || 0);
      return n > 0 ? n : 0;
    } catch (_) { return 0; }
  }

  // Exponer API pública
  window.OCSyncWatchdog = {
    guardarSnapshot: guardarSnapshot,
    ultimoSnapshot: ultimoSnapshot,
    listarSnapshots: listarSnapshots,
    armarSnapshot: armarSnapshot,
    verificarConsistencia: verificarConsistencia,
    ejecutarReSync: ejecutarReSync,
    pedirSnapshot: pedirSnapshot,
    responderSnapshot: responderSnapshot,
    acumularSnapshot: acumularSnapshot,
    estado: estado,
    arrancar: arrancar,
  };

  // Arranque automático (no bloquea nada; todo es try/catch)
  try {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", arrancar, { once: true });
    } else {
      arrancar();
    }
  } catch (_) {}
})();
