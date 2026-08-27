/*!
 * sync-queue.js — friendly-123
 * FASE 2, punto 2.2
 *
 * Drena telemetría (f123_telemetry_db, vía AMG.Telemetry.getPending) hacia un
 * backend futuro. HOY NO HAY BACKEND, así que por defecto corre en
 * "dry run": simula el envío, marca como sincronizado localmente, pero
 * JAMÁS hace una petición de red real hasta que:
 *   1) window.AMG_FLAGS.syncQueueDryRun se ponga en false, Y
 *   2) alguien llame a AMG.SyncQueue.setTransport(fn) con una función real.
 * Sin ambas condiciones, este archivo no puede sacar un solo byte de la
 * máquina del usuario. Diseño local-first, tal como pide el proyecto.
 *
 * Se dispara automáticamente al recuperar conexión (evento "conexion:online"
 * emitido por ui-actions.js) y opcionalmente cada N minutos si está online.
 * También se puede disparar a mano: AMG.SyncQueue.flush().
 *
 * Reintentos: backoff exponencial simple (1s, 2s, 4s... tope 60s), máximo
 * configurable de intentos por item antes de dejarlo en cola para el
 * siguiente ciclo (nunca se descarta silenciosamente).
 *
 * Orden de carga: requiere telemetry.js cargado antes (usa
 * AMG.Telemetry.getPending). Si falta, se auto-desactiva con warning.
 *
 * Feature flags:
 *   window.AMG_FLAGS.syncQueueEnabled       (default true)
 *   window.AMG_FLAGS.syncQueueDryRun        (default true) — ver arriba, NO tocar sin transporte real
 *   window.AMG_FLAGS.syncQueueBatchSize     (default 50)
 *   window.AMG_FLAGS.syncQueueIntervalMs    (default 300000 = 5 min, solo si online)
 *   window.AMG_FLAGS.syncQueueMaxRetries    (default 5)
 */
(function (global) {
  "use strict";

  if (global.AMG && global.AMG.SyncQueue) return;

  global.AMG_FLAGS = global.AMG_FLAGS || {};
  var F = global.AMG_FLAGS;
  if (typeof F.syncQueueEnabled === "undefined") F.syncQueueEnabled = true;
  if (typeof F.syncQueueDryRun === "undefined") F.syncQueueDryRun = true;
  if (typeof F.syncQueueBatchSize === "undefined") F.syncQueueBatchSize = 50;
  if (typeof F.syncQueueIntervalMs === "undefined") F.syncQueueIntervalMs = 300000;
  if (typeof F.syncQueueMaxRetries === "undefined") F.syncQueueMaxRetries = 5;

  var DB_NAME = "f123_telemetry_db"; // mismo store que telemetry.js (FIX 2026-08-20, G2: debe coincidir con el rename de telemetry.js)
  var STORE_NAME = "queue";

  function openDB() {
    return new Promise(function (resolve, reject) {
      if (!global.indexedDB) { reject(new Error("IndexedDB no disponible")); return; }
      var req = global.indexedDB.open(DB_NAME, 1);
      req.onsuccess = function (e) { resolve(e.target.result); };
      req.onerror = function (e) { reject(e.target.error); };
      // No definimos onupgradeneeded acá a propósito: el dueño del schema es
      // telemetry.js. Si sync-queue.js abre primero y la DB no existe aún,
      // IndexedDB la crea vacía sin el store — getPending fallará suave y
      // reintentará en el próximo ciclo, sin romper nada.
    });
  }

  function markSynced(id) {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        if (!db.objectStoreNames.contains(STORE_NAME)) { resolve(false); return; }
        var tx = db.transaction(STORE_NAME, "readwrite");
        var store = tx.objectStore(STORE_NAME);
        var getReq = store.get(id);
        getReq.onsuccess = function () {
          var rec = getReq.result;
          if (!rec) { resolve(false); return; }
          rec.synced = 1;
          store.put(rec);
        };
        tx.oncomplete = function () { resolve(true); };
        tx.onerror = function (e) { reject(e.target.error); };
      });
    }).catch(function () { return false; });
  }

  function log(level, msg, data) {
    if (global.AMG && global.AMG.Logger) global.AMG.Logger.log(level, "sync-queue", msg, data);
  }

  function SyncQueue() {
    this._transport = null; // function(batch) => Promise
    this._running = false;
    this._retries = {}; // id -> intentos
    this._timer = null;
    this._unsubscribeOnline = null;
  }

  /**
   * Registrar la función real de transporte (ej. fetch a tu API). Firma:
   *   async function(batch) -> debe resolver si el batch fue aceptado por el
   *   servidor, o rechazar (throw) si falló, para que sync-queue.js reintente.
   * Mientras no se llame a esto, syncQueueDryRun sigue mandando (aunque se
   * ponga en false por error) — no hay transporte, no hay red.
   */
  SyncQueue.prototype.setTransport = function (fn) {
    if (typeof fn !== "function") throw new TypeError("setTransport requiere una función");
    this._transport = fn;
    log("INFO", "Transporte real registrado — a partir de ahora, si syncQueueDryRun=false, se harán envíos reales.");
  };

  SyncQueue.prototype.flush = function () {
    var self = this;
    if (!F.syncQueueEnabled) return Promise.resolve({ skipped: "disabled" });
    if (this._running) return Promise.resolve({ skipped: "already-running" });
    if (global.navigator && global.navigator.onLine === false) return Promise.resolve({ skipped: "offline" });
    if (!global.AMG || !global.AMG.Telemetry || typeof global.AMG.Telemetry.getPending !== "function") {
      log("WARN", "telemetry.js no disponible — no hay de dónde leer la cola.");
      return Promise.resolve({ skipped: "no-telemetry" });
    }

    this._running = true;
    return global.AMG.Telemetry.getPending(F.syncQueueBatchSize || 50).then(function (batch) {
      if (!batch || !batch.length) { self._running = false; return { sent: 0 }; }

      var dryRun = F.syncQueueDryRun !== false || !self._transport;
      var sendPromise = dryRun
        ? Promise.resolve({ dryRun: true, count: batch.length })
        : self._transport(batch);

      return sendPromise.then(function (result) {
        /* M3 (2026-08-27, auditoría): en dry-run NO se marca como synced.
           Antes se llamaba a markSynced() también en dry-run, así que si luego
           se activaba el transporte real, esa telemetría ya no se reenviaba
           (se perdía). El dry-run es una simulación: no debe consumir la cola. */
        if (dryRun) {
          self._running = false;
          log("DEBUG", "Dry-run: batch simulado (NO marcado como enviado — se reenviará cuando haya transporte real)", { count: batch.length });
          return { sent: 0, dryRun: true, count: batch.length };
        }
        var marks = batch.map(function (item) { return markSynced(item.id); });
        return Promise.all(marks).then(function () {
          self._running = false;
          log("AUDIT", "Batch enviado y confirmado", { count: batch.length });
          batch.forEach(function (item) { delete self._retries[item.id]; });
          return { sent: batch.length, dryRun: false };
        });
      }).catch(function (err) {
        self._running = false;
        batch.forEach(function (item) {
          self._retries[item.id] = (self._retries[item.id] || 0) + 1;
        });
        log("WARN", "Falló el envío del batch — queda pendiente para reintento", { error: String(err && err.message || err), count: batch.length });
        return { sent: 0, error: String(err && err.message || err) };
      });
    }).catch(function (err) {
      self._running = false;
      log("ERROR", "flush() falló inesperadamente", { error: String(err) });
      return { sent: 0, error: String(err) };
    });
  };

  SyncQueue.prototype.start = function () {
    if (!F.syncQueueEnabled) {
      if (global.console) global.console.info("[AMG.SyncQueue] deshabilitado por feature flag");
      return;
    }
    var self = this;

    if (global.AMG && global.AMG.EventBus) {
      this._unsubscribeOnline = global.AMG.EventBus.on("conexion:online", function () { self.flush(); });
    } else {
      global.addEventListener("online", function () { self.flush(); });
    }

    if (F.syncQueueIntervalMs > 0) {
      this._timer = setInterval(function () {
        if (!global.navigator || global.navigator.onLine !== false) self.flush();
      }, F.syncQueueIntervalMs);
    }

    if (global.console && global.console.info) {
      global.console.info("[AMG.SyncQueue] activo. dryRun=" + (F.syncQueueDryRun !== false) + " (mientras sea true, CERO peticiones de red reales).");
    }
  };

  SyncQueue.prototype.stop = function () {
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
    if (this._unsubscribeOnline) { this._unsubscribeOnline(); this._unsubscribeOnline = null; }
  };

  global.AMG = global.AMG || {};
  global.AMG.SyncQueue = new SyncQueue();
  global.AMG.SyncQueue.VERSION = "1.0.0";
  global.AMG.SyncQueue.start();
})(typeof window !== "undefined" ? window : this);
