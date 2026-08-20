/*!
 * sync-outbox.js — R2: outbox persistente en IndexedDB (JFC 2026-08-20)
 *
 * QUE RESUELVE: la cola de operaciones pendientes de sincronizar (cambios
 * hechos offline, esperando a que el otro dispositivo las reciba) vivia
 * SOLO en localStorage ("f123_sync_pending"), con el cupo chico (~5-10MB)
 * compartido con TODO lo demas de la app. En un telefono viejo con el
 * storage casi lleno, guardar la cola podia fallar en silencio y una venta
 * offline se perdia sin que nadie lo notara.
 *
 * COMO SE USA: mismo par de funciones que ya existian
 * (guardarColaCifrada/restaurarCola en avanzado-extra.js), pero ahora
 * escriben primero en IndexedDB (cupo ordenes de magnitud mayor, mismo
 * motor que ya usa idb-archivo.js/idb-fotos.js) y SOLO si eso falla caen a
 * localStorage -- exactamente el comportamiento de hoy, sin regresion.
 * Nunca al reves: preferir localStorage cuando IndexedDB si esta
 * disponible perderia el beneficio del cupo grande.
 *
 * FALLA ABIERTO: si IndexedDB no esta soportado (Safari privado viejo,
 * algunos navegadores embebidos), se usa localStorage tal cual se hacia
 * antes de este archivo existir. Ningun camino nuevo puede dejar la app
 * peor que como estaba.
 */
(function () {
  "use strict";

  var DB_NAME = "f123_outbox";
  var STORE = "cola";
  var LS_KEY = "f123_sync_pending";
  var SOPORTADO = typeof indexedDB !== "undefined";
  var dbPromise = null;

  function abrirDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = function () {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: "id" });
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
      req.onblocked = function () { reject(new Error("IndexedDB bloqueado (otra pestaña con una version vieja abierta)")); };
    });
    return dbPromise;
  }

  async function guardar(blobCifrado) {
    if (SOPORTADO) {
      try {
        var db = await abrirDB();
        await new Promise(function (resolve, reject) {
          var tx = db.transaction(STORE, "readwrite");
          tx.objectStore(STORE).put({ id: LS_KEY, blob: blobCifrado, guardado: Date.now() });
          tx.oncomplete = resolve;
          tx.onerror = function () { reject(tx.error); };
        });
        // Limpieza best-effort del rastro viejo en localStorage: si IndexedDB
        // ya tiene el dato fresco, no hace falta duplicarlo ahi tambien.
        try { localStorage.removeItem(LS_KEY); } catch (_) {}
        return true;
      } catch (e) {
        try { console.warn("[sync-outbox] IndexedDB fallo, cae a localStorage:", e && e.message); } catch (_) {}
      }
    }
    try { localStorage.setItem(LS_KEY, blobCifrado); return true; } catch (_) { return false; }
  }

  async function leer() {
    if (SOPORTADO) {
      try {
        var db = await abrirDB();
        var fila = await new Promise(function (resolve, reject) {
          var tx = db.transaction(STORE, "readonly");
          var req = tx.objectStore(STORE).get(LS_KEY);
          req.onsuccess = function () { resolve(req.result); };
          req.onerror = function () { reject(req.error); };
        });
        if (fila && fila.blob) return fila.blob;
      } catch (e) {
        try { console.warn("[sync-outbox] IndexedDB no disponible para leer, prueba localStorage:", e && e.message); } catch (_) {}
      }
    }
    // Migracion silenciosa: si el dato viejo esta solo en localStorage
    // (dispositivo que aun no habia corrido este archivo), se lee de ahi
    // una vez -- la proxima escritura ya cae en IndexedDB.
    try { return localStorage.getItem(LS_KEY); } catch (_) { return null; }
  }

  window.OCOutbox = { guardar: guardar, leer: leer };
})();
