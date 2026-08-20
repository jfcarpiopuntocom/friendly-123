/*!
 * audit-store.js — friendly-123
 * FASE 2, punto 2.1
 *
 * Auditoría PERMANENTE (distinta de telemetry.js, que es una cola de sync
 * con buffer acotado). Este store no se poda automáticamente: existe para
 * poder reconstruir "quién hizo qué, cuándo, dónde y con qué resultado" a
 * largo plazo. Responde en el futuro (sin tocar este archivo, solo
 * consultando lo ya guardado): qué encargados ajustan más stock, qué
 * sucursales tienen más errores, qué funciones nunca se usan, cuánto tarda
 * una venta, qué productos requieren correcciones frecuentes, etc.
 *
 * QUÉ SE AUDITA: no todos los eventos del bus (eso sería ruido/telemetría),
 * solo los que representan una ACCIÓN DE NEGOCIO con resultado (":completado"
 * o ":error" que vienen de ui-actions.js) más cualquier evento que el propio
 * código emita explícitamente con payload.audit === true.
 *
 * Orden de carga: event-bus.js -> logger.js -> telemetry.js -> audit-store.js
 * (audit-store.js no depende de telemetry.js, pero se recomienda ese orden
 * para que toda la infraestructura quede lista de una).
 *
 * Feature flags:
 *   window.AMG_FLAGS.auditStoreEnabled   (default true)
 *   window.AMG_FLAGS.auditableSuffixes   (default [":completado", ":error"])
 */
(function (global) {
  "use strict";

  if (global.AMG && global.AMG.AuditStore) return;

  global.AMG_FLAGS = global.AMG_FLAGS || {};
  var F = global.AMG_FLAGS;
  if (typeof F.auditStoreEnabled === "undefined") F.auditStoreEnabled = true;
  if (!F.auditableSuffixes) F.auditableSuffixes = [":completado", ":error"];

  var DB_NAME = "f123_audit_db"; // FIX (JFC 2026-08-20, G2): compartido literal con AMIGABLE/Consultorio-123
  var DB_VERSION = 1;
  var STORE_NAME = "eventos";

  function uuid() {
    if (global.crypto && typeof global.crypto.randomUUID === "function") {
      try { return global.crypto.randomUUID(); } catch (_) {}
    }
    return "audit_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 10);
  }

  function openDB() {
    return new Promise(function (resolve, reject) {
      if (!global.indexedDB) { reject(new Error("IndexedDB no disponible")); return; }
      var req = global.indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function (e) {
        var db = e.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          var store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
          store.createIndex("ts", "ts", { unique: false });
          store.createIndex("type", "type", { unique: false });
          store.createIndex("employeeId", "employeeId", { unique: false });
          store.createIndex("branchId", "branchId", { unique: false });
        }
      };
      req.onsuccess = function (e) { resolve(e.target.result); };
      req.onerror = function (e) { reject(e.target.error); };
    });
  }

  function put(record) {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE_NAME, "readwrite");
        tx.objectStore(STORE_NAME).put(record);
        tx.oncomplete = function () { resolve(true); };
        tx.onerror = function (e) { reject(e.target.error); };
      });
    }).catch(function (err) {
      if (global.AMG && global.AMG.Logger) {
        global.AMG.Logger.log("WARN", "audit-store", "No se pudo escribir auditoría", { error: String(err) });
      }
      return false;
    });
  }

  function queryByIndex(indexName, value) {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var out = [];
        var tx = db.transaction(STORE_NAME, "readonly");
        var idx = tx.objectStore(STORE_NAME).index(indexName);
        var req = idx.openCursor(IDBKeyRange.only(value));
        req.onsuccess = function (e) {
          var cursor = e.target.result;
          if (cursor) { out.push(cursor.value); cursor.continue(); }
          else resolve(out);
        };
        req.onerror = function (e) { reject(e.target.error); };
      });
    }).catch(function () { return []; });
  }

  function getAll(limit) {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var out = [];
        var tx = db.transaction(STORE_NAME, "readonly");
        var req = tx.objectStore(STORE_NAME).index("ts").openCursor(null, "prev"); // más reciente primero
        req.onsuccess = function (e) {
          var cursor = e.target.result;
          if (cursor && out.length < (limit || 1000)) { out.push(cursor.value); cursor.continue(); }
          else resolve(out);
        };
        req.onerror = function (e) { reject(e.target.error); };
      });
    }).catch(function () { return []; });
  }

  function getByDateRange(fromTs, toTs) {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var out = [];
        var tx = db.transaction(STORE_NAME, "readonly");
        var req = tx.objectStore(STORE_NAME).index("ts").openCursor(IDBKeyRange.bound(fromTs, toTs));
        req.onsuccess = function (e) {
          var cursor = e.target.result;
          if (cursor) { out.push(cursor.value); cursor.continue(); }
          else resolve(out);
        };
        req.onerror = function (e) { reject(e.target.error); };
      });
    }).catch(function () { return []; });
  }

  /** Agregados simples listos para un futuro dashboard, sin tener que rehacer este archivo. */
  function getStats() {
    return getAll(100000).then(function (rows) {
      var porTipo = {}, porEmpleado = {}, porSucursal = {}, errores = 0;
      rows.forEach(function (r) {
        porTipo[r.type] = (porTipo[r.type] || 0) + 1;
        if (r.employeeId) porEmpleado[r.employeeId] = (porEmpleado[r.employeeId] || 0) + 1;
        if (r.branchId) porSucursal[r.branchId] = (porSucursal[r.branchId] || 0) + 1;
        if (/:error$/.test(r.type)) errores++;
      });
      return { totalEventos: rows.length, errores: errores, porTipo: porTipo, porEmpleado: porEmpleado, porSucursal: porSucursal };
    });
  }

  function esAuditable(evt) {
    if (evt.payload && evt.payload.audit === true) return true;
    return F.auditableSuffixes.some(function (suf) { return evt.type.indexOf(suf) !== -1 && evt.type.lastIndexOf(suf) === evt.type.length - suf.length; });
  }

  function AuditStore() {
    this._unsubscribe = null;
  }

  AuditStore.prototype.start = function () {
    if (!F.auditStoreEnabled) {
      if (global.console) global.console.info("[AMG.AuditStore] deshabilitado por feature flag");
      return;
    }
    if (!global.AMG || !global.AMG.EventBus) {
      if (global.console) global.console.warn("[AMG.AuditStore] event-bus.js no cargado — auditoría inactiva.");
      return;
    }
    var self = this;
    var ctx = function () { return global.AMG_CONTEXT || {}; };

    var handle = function (evt) {
      if (!esAuditable(evt)) return;
      var c = ctx();
      var record = {
        id: uuid(),
        ts: evt.ts,
        isoTs: evt.isoTs,
        type: evt.type,
        payload: evt.payload,
        licenseId: c.licenseId || "desconocido",
        companyId: c.companyId || "desconocido",
        branchId: c.branchId || "desconocido",
        employeeId: c.employeeId || "desconocido",
        appVersion: c.appVersion || "desconocido"
      };
      put(record);
    };

    // Ponerse al día con eventos recientes ya emitidos (ej. si audit-store.js
    // carga después de que ui-actions.js ya disparó algo en el arranque).
    global.AMG.EventBus.getRecentEvents().forEach(handle);
    this._unsubscribe = global.AMG.EventBus.on("*", handle);

    if (global.console && global.console.info) global.console.info("[AMG.AuditStore] activo.");
  };

  AuditStore.prototype.stop = function () {
    if (this._unsubscribe) { this._unsubscribe(); this._unsubscribe = null; }
  };

  AuditStore.prototype.getAll = getAll;
  AuditStore.prototype.getByType = function (type) { return queryByIndex("type", type); };
  AuditStore.prototype.getByEmployee = function (employeeId) { return queryByIndex("employeeId", employeeId); };
  AuditStore.prototype.getByBranch = function (branchId) { return queryByIndex("branchId", branchId); };
  AuditStore.prototype.getByDateRange = getByDateRange;
  AuditStore.prototype.getStats = getStats;

  global.AMG = global.AMG || {};
  global.AMG.AuditStore = new AuditStore();
  global.AMG.AuditStore.VERSION = "1.0.0";
  global.AMG.AuditStore.start();
})(typeof window !== "undefined" ? window : this);
