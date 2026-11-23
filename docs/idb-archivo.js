// idb-archivo.js — friendly-123 (Fase 2 del plan de blindaje de datos, 2026-08-04)
// ============================================================================
// POR QUE: cuando localStorage se llena, guardarEstadoLocal() (mock-backend.js)
// tenia que elegir entre no guardar la venta de HOY o recortar el log de
// actividad VIEJO. El log de actividad es a la vez la evidencia forense de un
// robo y el insumo de la reconciliacion (hechos.js/reconciliacion.js) — hasta
// ahora, recortarlo significaba BORRARLO para siempre.
//
// Este archivo mueve los movimientos viejos a IndexedDB (sin techo practico de
// espacio, mismo criterio que idb-fotos.js) en vez de descartarlos. Nada se
// pierde: solo se muda de un almacen lleno a uno con espacio.
//
// CONTRATO: put() usa el id del propio movimiento como clave — reintentar con
// el mismo lote no duplica nada (sobrescribe con el mismo valor).
//
// Si IndexedDB no existe en este navegador: todas las funciones son no-op
// seguro (mismo criterio que idb-fotos.js) — guardarEstadoLocal() sigue
// funcionando como hoy, sin este resguardo extra pero sin romperse.
(function () {
  const DB_NAME = "f123_archivo";
  const STORE = "movimientos";
  const SOPORTADO = "indexedDB" in window;
  let dbPromise = null;
  let openedDb = null;

  function dropDb() {
    if (openedDb && typeof openedDb.close === "function") {
      try { openedDb.close(); } catch (_) {}
    }
    openedDb = null;
    dbPromise = null;
  }

  function esSafariMovil() {
    try {
      const ua = (typeof navigator !== "undefined" && navigator.userAgent) || "";
      return /iPhone|iPad|iPod|Android|Mobile/i.test(ua);
    } catch (_) { return false; }
  }

  function abrirDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      let settled = false;
      const timeoutMs = esSafariMovil() ? 8000 : 15000;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        dropDb();
        reject(new Error("IndexedDB open timeout"));
      }, timeoutMs);
      let req;
      try {
        req = indexedDB.open(DB_NAME, 1);
      } catch (err) {
        clearTimeout(timer);
        dropDb();
        reject(err);
        return;
      }
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: "id" });
      };
      req.onsuccess = () => {
        if (settled) {
          try { req.result && req.result.close && req.result.close(); } catch (_) {}
          return;
        }
        settled = true;
        clearTimeout(timer);
        openedDb = req.result;
        if (openedDb) {
          openedDb.onclose = () => dropDb();
          openedDb.onversionchange = () => dropDb();
        }
        resolve(req.result);
      };
      req.onerror = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        dropDb();
        reject(req.error);
      };
      req.onblocked = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        dropDb();
        reject(new Error("IndexedDB bloqueado (otra pestaña con una version vieja abierta)"));
      };
    });
    return dbPromise;
  }

  if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
    window.addEventListener("pageshow", function (ev) {
      if (ev && ev.persisted) dropDb();
    });
  }

  // Archiva un lote. Idempotente: reintentar con el mismo lote no duplica.
  // Los movimientos sin id propio reciben uno sintetico estable (fecha+indice)
  // para que igual queden archivados sin romper el keyPath.
  async function archivarLote(movimientos) {
    if (!SOPORTADO || !Array.isArray(movimientos) || !movimientos.length) return false;
    try {
      const db = await abrirDB();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        const store = tx.objectStore(STORE);
        movimientos.forEach((m, i) => {
          const conId = m && m.id ? m : { ...m, id: (m && m.fecha ? m.fecha : "sinfecha") + "_" + i + "_" + Math.random().toString(36).slice(2, 8) };
          store.put(conId);
        });
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
      return true;
    } catch (err) {
      console.error("[idb-archivo] archivarLote:", err);
      return false;
    }
  }

  async function leerTodos() {
    if (!SOPORTADO) return [];
    try {
      const db = await abrirDB();
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, "readonly");
        const req = tx.objectStore(STORE).getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      });
    } catch (err) {
      console.error("[idb-archivo] leerTodos:", err);
      return [];
    }
  }

  async function contar() {
    if (!SOPORTADO) return 0;
    try {
      const db = await abrirDB();
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, "readonly");
        const req = tx.objectStore(STORE).count();
        req.onsuccess = () => resolve(req.result || 0);
        req.onerror = () => reject(req.error);
      });
    } catch (_) { return 0; }
  }

  window.OCArchivo = { archivarLote, leerTodos, contar, soportado: () => SOPORTADO };
})();
