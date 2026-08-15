/*!
 * logger.js — friendly-123
 * FASE 1, punto 1.2
 *
 * Logging multinivel: TRACE, DEBUG, INFO, NOTICE, WARN, ERROR, FATAL, AUDIT.
 * Standalone: si event-bus.js está cargado ANTES, logger.js se suscribe solo
 * a sus errores internos (onError) para no perder fallos de listeners. Si
 * event-bus.js NO está cargado, logger.js funciona igual como logger directo
 * (window.AMG.Logger.log(...)) sin romperse. Orden de carga recomendado:
 * event-bus.js → logger.js → telemetry.js → (resto de módulos).
 *
 * Persistencia: ring buffer en memoria (rápido) + volcado periódico a
 * localStorage (sobrevive reloads; NO sobrevive borrar datos del sitio,
 * eso lo resuelve audit-store.js en Fase 2 con IndexedDB).
 *
 * Feature flags:
 *   window.AMG_FLAGS.loggerEnabled        (default true)
 *   window.AMG_FLAGS.loggerMinLevel       (default "DEBUG")
 *   window.AMG_FLAGS.loggerConsoleMirror  (default true) — también hace console.log/warn/error
 *   window.AMG_FLAGS.loggerBufferSize     (default 500) — entradas en memoria
 *   window.AMG_FLAGS.loggerPersistEvery   (default 20) — cada N logs, vuelca a localStorage
 */
(function (global) {
  "use strict";

  if (global.AMG && global.AMG.Logger) return; // ya cargado, no pisar

  global.AMG_FLAGS = global.AMG_FLAGS || {};
  var F = global.AMG_FLAGS;
  if (typeof F.loggerEnabled === "undefined") F.loggerEnabled = true;
  if (typeof F.loggerMinLevel === "undefined") F.loggerMinLevel = "DEBUG";
  if (typeof F.loggerConsoleMirror === "undefined") F.loggerConsoleMirror = true;
  if (typeof F.loggerBufferSize === "undefined") F.loggerBufferSize = 500;
  if (typeof F.loggerPersistEvery === "undefined") F.loggerPersistEvery = 20;

  var LEVELS = ["TRACE", "DEBUG", "INFO", "NOTICE", "WARN", "ERROR", "FATAL", "AUDIT"];
  var LEVEL_RANK = {};
  LEVELS.forEach(function (l, i) { LEVEL_RANK[l] = i; });

  var STORAGE_KEY = "amg_log_buffer_v1";

  function Logger() {
    this._buffer = [];
    this._sinceLastPersist = 0;
    this._loadFromStorage();
  }

  Logger.prototype._loadFromStorage = function () {
    try {
      var raw = global.localStorage && global.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) this._buffer = parsed;
      }
    } catch (_) { /* localStorage puede no existir (modo privado agresivo) — seguir sin persistencia */ }
  };

  Logger.prototype._persist = function () {
    try {
      if (!global.localStorage) return;
      var max = F.loggerBufferSize || 500;
      var toSave = this._buffer.slice(-max);
      global.localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
    } catch (err) {
      // Cuota llena (localStorage full) u otro fallo: no debe tumbar la app.
      // Best-effort: reducir a la mitad e intentar de nuevo una vez.
      try {
        var half = this._buffer.slice(-Math.floor((F.loggerBufferSize || 500) / 2));
        global.localStorage.setItem(STORAGE_KEY, JSON.stringify(half));
      } catch (_) { /* si sigue fallando, se sigue solo con el buffer en memoria */ }
    }
  };

  /**
   * @param {string} level - uno de LEVELS
   * @param {string} tag - módulo/origen, ej: "ventas", "sync", "ui"
   * @param {string} message
   * @param {object} [data] - datos estructurados adicionales
   */
  Logger.prototype.log = function (level, tag, message, data) {
    if (!F.loggerEnabled) return null;
    if (LEVEL_RANK[level] === undefined) level = "INFO";
    if (LEVEL_RANK[level] < LEVEL_RANK[F.loggerMinLevel || "DEBUG"]) return null;

    var entry = {
      ts: Date.now(),
      isoTs: new Date().toISOString(),
      level: level,
      tag: tag || "general",
      message: message || "",
      data: data === undefined ? null : data
    };

    this._buffer.push(entry);
    var max = F.loggerBufferSize || 500;
    if (this._buffer.length > max) this._buffer.splice(0, this._buffer.length - max);

    this._sinceLastPersist++;
    if (this._sinceLastPersist >= (F.loggerPersistEvery || 20) || level === "FATAL" || level === "AUDIT") {
      this._sinceLastPersist = 0;
      this._persist();
    }

    if (F.loggerConsoleMirror && global.console) {
      var line = "[AMG][" + level + "][" + entry.tag + "] " + entry.message;
      if (level === "ERROR" || level === "FATAL") {
        global.console.error(line, data || "");
      } else if (level === "WARN") {
        global.console.warn(line, data || "");
      } else if (level === "TRACE" || level === "DEBUG") {
        if (global.console.debug) global.console.debug(line, data || "");
      } else {
        global.console.log(line, data || "");
      }
    }

    if (global.AMG && global.AMG.EventBus) {
      // No re-emitimos "log:*" por defecto para evitar loops (telemetry.js
      // podría loguear su propio log). telemetry.js escucha eventos de
      // negocio directamente del EventBus, no de acá.
    }

    return entry;
  };

  // Atajos por nivel
  LEVELS.forEach(function (level) {
    Logger.prototype[level.toLowerCase()] = function (tag, message, data) {
      return this.log(level, tag, message, data);
    };
  });

  Logger.prototype.getLogs = function (filter) {
    var out = this._buffer;
    if (filter && filter.level) out = out.filter(function (e) { return e.level === filter.level; });
    if (filter && filter.tag) out = out.filter(function (e) { return e.tag === filter.tag; });
    if (filter && filter.since) out = out.filter(function (e) { return e.ts >= filter.since; });
    return out.slice();
  };

  Logger.prototype.clear = function () {
    this._buffer = [];
    this._persist();
  };

  /** Exporta todo el buffer como Blob JSON descargable — útil para soporte remoto. */
  Logger.prototype.exportAsDownload = function (filename) {
    try {
      var blob = new Blob([JSON.stringify(this._buffer, null, 2)], { type: "application/json" });
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url;
      a.download = filename || ("amigable123-logs-" + Date.now() + ".json");
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      return true;
    } catch (err) {
      if (global.console) global.console.error("[AMG.Logger] exportAsDownload falló:", err);
      return false;
    }
  };

  global.AMG = global.AMG || {};
  global.AMG.Logger = new Logger();
  global.AMG.Logger.LEVELS = LEVELS;
  global.AMG.Logger.VERSION = "1.0.0";

  // Enganche opcional con el EventBus: si un listener de un evento de negocio
  // falla, queda registrado en AUDIT automáticamente (trazabilidad de bugs
  // reales sin que nadie tenga que acordarse de loguearlo a mano).
  if (global.AMG.EventBus && typeof global.AMG.EventBus.onError === "function") {
    global.AMG.EventBus.onError(function (err, evt) {
      global.AMG.Logger.log("ERROR", "event-bus", "Listener falló procesando '" + evt.type + "'", {
        eventId: evt.id,
        eventType: evt.type,
        errorMessage: err && err.message,
        errorStack: err && err.stack
      });
    });
  }

  if (F.loggerConsoleMirror && global.console && global.console.info) {
    global.console.info("[AMG.Logger] listo (v1.0.0). Niveles: " + LEVELS.join(", "));
  }
})(typeof window !== "undefined" ? window : this);
