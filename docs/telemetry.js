/*!
 * telemetry.js — friendly-123
 * FASE 1, punto 1.3
 *
 * Enriquece cada evento del EventBus con contexto de diagnóstico (device,
 * sesión, versión, memoria, storage, online/offline) y lo persiste en
 * IndexedDB como cola de sync futura. NO envía nada a ningún servidor
 * todavía — eso es Fase 2+ (sync-queue.js). Por ahora es local-first puro.
 *
 * Orden de carga recomendado: event-bus.js → logger.js → telemetry.js
 * Si event-bus.js no está cargado, telemetry.js se auto-desactiva (no hay
 * nada de qué escuchar) y lo deja registrado en consola — no revienta.
 *
 * Identificadores que espera encontrar en window (todos OPCIONALES, con
 * fallback "desconocido" si no existen — así funciona ya mismo y cuando
 * en Fase 4 la app real setee licenseId/companyId/branchId/employeeId no
 * hay que tocar este archivo):
 *   window.AMG_CONTEXT = { licenseId, companyId, branchId, employeeId, appVersion }
 *
 * Feature flags:
 *   window.AMG_FLAGS.telemetryEnabled       (default true)
 *   window.AMG_FLAGS.telemetryIndexedDB     (default true) — guardar cola en IndexedDB
 *   window.AMG_FLAGS.telemetryLogLevel      (default "INFO") — nivel con el que se loguea cada evento
 *   window.AMG_FLAGS.telemetrySampleRate    (default 1) — 1 = todos los eventos, 0.1 = 10%
 */
(function (global) {
  "use strict";

  if (global.AMG && global.AMG.Telemetry) return; // ya cargado

  global.AMG_FLAGS = global.AMG_FLAGS || {};
  var F = global.AMG_FLAGS;
  if (typeof F.telemetryEnabled === "undefined") F.telemetryEnabled = true;
  if (typeof F.telemetryIndexedDB === "undefined") F.telemetryIndexedDB = true;
  if (typeof F.telemetryLogLevel === "undefined") F.telemetryLogLevel = "INFO";
  if (typeof F.telemetrySampleRate === "undefined") F.telemetrySampleRate = 1;

  var DB_NAME = "f123_telemetry_db"; // FIX (JFC 2026-08-20, G2): compartido literal con AMIGABLE/Consultorio-123
  var DB_VERSION = 1;
  var STORE_NAME = "queue";
  var SESSION_KEY = "f123_session_id_v1"; // FIX (JFC 2026-08-20, G2): sessionStorage se comparte por origen entre las 3 apps

  // --- sessionId: uno por pestaña/sesión de navegador --------------------
  function getSessionId() {
    try {
      var existing = global.sessionStorage && global.sessionStorage.getItem(SESSION_KEY);
      if (existing) return existing;
      var id = "sess_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 10);
      if (global.sessionStorage) global.sessionStorage.setItem(SESSION_KEY, id);
      return id;
    } catch (_) {
      return "sess_no_storage_" + Date.now();
    }
  }

  // --- Detección liviana de device/browser/OS (sin librerías externas) ---
  function detectEnv() {
    var ua = (global.navigator && global.navigator.userAgent) || "";
    var platform = (global.navigator && global.navigator.platform) || "desconocido";
    var isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
    var browser = "desconocido";
    if (/Firefox\//.test(ua)) browser = "Firefox";
    else if (/Edg\//.test(ua)) browser = "Edge";
    else if (/OPR\//.test(ua)) browser = "Opera";
    else if (/Chrome\//.test(ua)) browser = "Chrome";
    else if (/Safari\//.test(ua)) browser = "Safari";
    var os = "desconocido";
    if (/Windows/.test(ua)) os = "Windows";
    else if (/Android/.test(ua)) os = "Android";
    else if (/iPhone|iPad|iPod/.test(ua)) os = "iOS";
    else if (/Mac OS X/.test(ua)) os = "macOS";
    else if (/Linux/.test(ua)) os = "Linux";
    return { ua: ua, platform: platform, isMobile: isMobile, browser: browser, os: os };
  }

  function safeMemory() {
    try {
      var out = {};
      if (global.navigator && global.navigator.deviceMemory) out.deviceMemoryGB = global.navigator.deviceMemory;
      if (global.performance && global.performance.memory) {
        out.jsHeapUsedMB = Math.round(global.performance.memory.usedJSHeapSize / 1048576);
        out.jsHeapLimitMB = Math.round(global.performance.memory.jsHeapSizeLimit / 1048576);
      }
      return out;
    } catch (_) { return {}; }
  }

  function safeStorageEstimate(callback) {
    try {
      if (global.navigator && global.navigator.storage && global.navigator.storage.estimate) {
        global.navigator.storage.estimate().then(function (est) {
          callback({
            usageMB: est.usage ? Math.round(est.usage / 1048576) : null,
            quotaMB: est.quota ? Math.round(est.quota / 1048576) : null
          });
        }).catch(function () { callback({}); });
        return;
      }
    } catch (_) {}
    callback({});
  }

  // --- IndexedDB mínima, sin librerías -----------------------------------
  function openDB() {
    return new Promise(function (resolve, reject) {
      if (!global.indexedDB) { reject(new Error("IndexedDB no disponible")); return; }
      var req = global.indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function (e) {
        var db = e.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          var store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
          store.createIndex("ts", "ts", { unique: false });
          store.createIndex("synced", "synced", { unique: false });
        }
      };
      req.onsuccess = function (e) { resolve(e.target.result); };
      req.onerror = function (e) { reject(e.target.error); };
    });
  }

  function idbPut(record) {
    if (!F.telemetryIndexedDB) return Promise.resolve(false);
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE_NAME, "readwrite");
        tx.objectStore(STORE_NAME).put(record);
        tx.oncomplete = function () { resolve(true); };
        tx.onerror = function (e) { reject(e.target.error); };
      });
    }).catch(function (err) {
      // Cuota llena, navegador viejo sin IDB, modo privado agresivo, etc.
      // Nunca debe romper el flujo de negocio: solo se pierde telemetría.
      if (global.AMG && global.AMG.Logger) {
        global.AMG.Logger.log("WARN", "telemetry", "No se pudo guardar en IndexedDB", { error: String(err) });
      }
      return false;
    });
  }

  /** Devuelve hasta `limit` registros pendientes de sync (para sync-queue.js en Fase 2). */
  function getPending(limit) {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var out = [];
        var tx = db.transaction(STORE_NAME, "readonly");
        var idx = tx.objectStore(STORE_NAME).index("synced");
        var req = idx.openCursor(IDBKeyRange.only(0));
        req.onsuccess = function (e) {
          var cursor = e.target.result;
          if (cursor && out.length < (limit || 500)) {
            out.push(cursor.value);
            cursor.continue();
          } else {
            resolve(out);
          }
        };
        req.onerror = function (e) { reject(e.target.error); };
      });
    }).catch(function () { return []; });
  }

  // --- Telemetry -----------------------------------------------------

  function Telemetry() {
    this._env = detectEnv();
    this._sessionId = getSessionId();
    this._storageInfo = {};
    var self = this;
    safeStorageEstimate(function (info) { self._storageInfo = info; });
    this._unsubscribe = null;
  }

  Telemetry.prototype.buildEnvelope = function (evt) {
    var ctx = global.AMG_CONTEXT || {};
    return {
      id: evt.id,
      ts: evt.ts,
      isoTs: evt.isoTs,
      type: evt.type,
      payload: evt.payload,
      sessionId: this._sessionId,
      licenseId: ctx.licenseId || "desconocido",
      companyId: ctx.companyId || "desconocido",
      branchId: ctx.branchId || "desconocido",
      employeeId: ctx.employeeId || "desconocido",
      appVersion: ctx.appVersion || "desconocido",
      browser: this._env.browser,
      os: this._env.os,
      isMobile: this._env.isMobile,
      viewport: { w: global.innerWidth || null, h: global.innerHeight || null },
      online: typeof global.navigator !== "undefined" ? global.navigator.onLine : null,
      memory: safeMemory(),
      storage: this._storageInfo,
      synced: 0 // 0 = pendiente de sync, 1 = ya enviado (lo usa sync-queue.js en Fase 2)
    };
  };

  Telemetry.prototype.start = function () {
    if (!F.telemetryEnabled) {
      if (global.console) global.console.info("[AMG.Telemetry] deshabilitado por feature flag");
      return;
    }
    if (!global.AMG || !global.AMG.EventBus) {
      if (global.console) global.console.warn("[AMG.Telemetry] event-bus.js no está cargado — telemetría inactiva. Cargar event-bus.js ANTES de telemetry.js.");
      return;
    }
    var self = this;

    // Ponerse al día con eventos ya emitidos antes de que telemetry.js cargara.
    var recent = global.AMG.EventBus.getRecentEvents();
    recent.forEach(function (evt) { self._handle(evt); });

    this._unsubscribe = global.AMG.EventBus.on("*", function (evt) { self._handle(evt); });

    if (global.console && global.console.info) {
      global.console.info("[AMG.Telemetry] activo. sessionId=" + this._sessionId);
    }
  };

  Telemetry.prototype._handle = function (evt) {
    if (Math.random() > (F.telemetrySampleRate || 1)) return; // muestreo opcional
    var envelope = this.buildEnvelope(evt);

    if (global.AMG.Logger) {
      global.AMG.Logger.log(F.telemetryLogLevel || "INFO", "telemetry", evt.type, envelope);
    }
    idbPut(envelope);
  };

  Telemetry.prototype.stop = function () {
    if (this._unsubscribe) { this._unsubscribe(); this._unsubscribe = null; }
  };

  Telemetry.prototype.getPending = getPending;

  global.AMG = global.AMG || {};
  global.AMG.Telemetry = new Telemetry();
  global.AMG.Telemetry.VERSION = "1.0.0";
  global.AMG.Telemetry.start();
})(typeof window !== "undefined" ? window : this);
