// estado-idb.js — friendly-123 · Espejo del estado del negocio en IndexedDB
// ============================================================================
// BUG QUE ARREGLA (JFC 2026-08-17, en su propia PC, encontrado en amigable-123
// y portado aqui porque la causa es identica: mismo origen, mismo techo):
//   "me dijo 'La memoria de este navegador está llena: los cambios nuevos NO se
//    están guardando' y eso jamas debe decir en mi PC donde soooobra espacio"
//
// Tenia razon y el disco no tenia nada que ver. localStorage NO crece con el
// disco: los navegadores le dan un tope fijo de ~5 MB POR ORIGEN, y las tres
// apps (amigable / friendly-123 / consultorio-123) comparten el mismo origen de
// GitHub Pages. Con fotos de producto y un log de actividad largo, ese techo se
// toca en una PC con 900 GB libres exactamente igual que en un telefono viejo.
//
// IndexedDB, en cambio, SI escala con el disco (tipicamente cientos de MB o mas,
// negociado contra el espacio real disponible). Este modulo guarda ahi una copia
// completa del estado cada vez que se guarda, y mock-backend.js la usa como red:
//
//   1. localStorage funciona  -> se guarda en los dos. Nada cambia para nadie.
//   2. localStorage se lleno  -> IndexedDB recibe el estado COMPLETO igual, y el
//                                cartel rojo de "no se esta guardando" NO sale,
//                                porque seria mentira: si se guardo.
//   3. IndexedDB tampoco pudo -> ahi si, cartel rojo. Eso es un problema de
//                                verdad y el dueno tiene que respaldar ya.
//
// Al arrancar, mock-backend compara la revision (_rev) de los dos y se queda con
// la MAS NUEVA. Si localStorage se quedo atras por falta de espacio, el negocio
// sigue completo igual.
//
// REGLA DE LA CASA: si IndexedDB no existe o falla, todo esto es un no-op y la
// app se comporta exactamente como antes. Cero dependencia obligatoria.
// ============================================================================
(function () {
  "use strict";

  var DB_NAME = "f123_estado";      // aislamiento.js le pone el namespace solo
  var STORE = "estado";
  var CLAVE = "actual";
  var SOPORTADO = ("indexedDB" in window);

  var dbPromise = null;
  function abrirDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = function () {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
      req.onblocked = function () { reject(new Error("IndexedDB bloqueado")); };
    });
    return dbPromise;
  }

  /* Guarda el estado completo. Devuelve true SOLO si de verdad quedo escrito:
     mock-backend decide con esto si el aviso rojo sale o no, asi que aqui no se
     puede ser optimista. */
  async function guardar(estado) {
    if (!SOPORTADO || !estado || typeof estado !== "object") return false;
    try {
      var db = await abrirDB();
      await new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, "readwrite");
        /* Se clona a JSON y de vuelta: el estructurado de IndexedDB revienta
           con funciones o referencias ciclicas, y aqui entra un objeto armado
           por otro modulo. Mejor pagar la copia que perder el guardado. */
        tx.objectStore(STORE).put(JSON.parse(JSON.stringify(estado)), CLAVE);
        tx.oncomplete = resolve;
        tx.onerror = function () { reject(tx.error); };
        tx.onabort = function () { reject(tx.error || new Error("abortada")); };
      });
      return true;
    } catch (err) {
      try { console.error("[estado-idb] guardar:", err); } catch (_) {}
      return false;
    }
  }

  async function leer() {
    if (!SOPORTADO) return null;
    try {
      var db = await abrirDB();
      return await new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, "readonly");
        var req = tx.objectStore(STORE).get(CLAVE);
        req.onsuccess = function () { resolve(req.result || null); };
        req.onerror = function () { reject(req.error); };
      });
    } catch (err) {
      try { console.error("[estado-idb] leer:", err); } catch (_) {}
      return null;
    }
  }

  /* Cuanto espacio hay DE VERDAD. Sirve para no acusar al dispositivo de estar
     lleno cuando el que se lleno fue el cajoncito de localStorage. */
  async function espacio() {
    try {
      if (!navigator.storage || !navigator.storage.estimate) return null;
      var e = await navigator.storage.estimate();
      if (!e || !e.quota) return null;
      return { usado: e.usage || 0, tope: e.quota, libre: e.quota - (e.usage || 0) };
    } catch (_) { return null; }
  }

  window.OCEstadoIDB = { guardar: guardar, leer: leer, espacio: espacio, soportado: SOPORTADO };
})();
