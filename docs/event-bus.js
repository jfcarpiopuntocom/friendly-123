// COMPARTIDO: utilidad generica identica en las 3 apps a proposito.
/*!
 * event-bus.js — Amigable-123
 * FASE 1, punto 1.1
 *
 * Bus de eventos tipado, universal, standalone. NO depende de ningún otro
 * archivo del proyecto. NO modifica nada existente. Es 100% aditivo.
 *
 * Objetivo arquitectónico (ver prompt maestro):
 *   Usuario → UI → UI Actions → Event Bus → Validación → Logger → Telemetry
 *   → Analytics → Audit → Persistencia → Sync Queue → Render
 *
 * Este archivo implementa SOLO el "Event Bus" del diagrama. Cualquier otra
 * capa (logger, telemetry, audit, sync) se suscribe a este bus, nunca al
 * revés — event-bus.js no importa ni requiere ningún otro módulo.
 *
 * Compatibilidad: ES5+, sin dependencias externas, sin build step, sin
 * módulos ES (para poder cargarse con <script> plano en navegadores viejos
 * y en el service worker si hiciera falta en el futuro).
 *
 * Activación: siempre activo (es infraestructura pasiva — no hace nada si
 * nadie emite ni escucha). Se puede desactivar el *logging* de sus propios
 * errores internos con window.AMG_FLAGS.eventBusVerbose = false.
 *
 * Namespace elegido: window.AMG (Amigable-123) — no colisiona con el
 * namespace existente de la app, que es window.OC* (OCAuth, OCRateOpen, etc.)
 */
(function (global) {
  "use strict";

  if (global.AMG && global.AMG.EventBus) {
    // Ya cargado (doble <script> por error, hot-reload, etc.) — no pisar.
    return;
  }

  global.AMG_FLAGS = global.AMG_FLAGS || {};
  if (typeof global.AMG_FLAGS.eventBusVerbose === "undefined") {
    global.AMG_FLAGS.eventBusVerbose = true;
  }
  if (typeof global.AMG_FLAGS.eventBusReplayBufferSize === "undefined") {
    global.AMG_FLAGS.eventBusReplayBufferSize = 200;
  }

  // --- Utilidades internas ------------------------------------------------

  function uuid() {
    // crypto.randomUUID no existe en navegadores viejos / contextos no
    // seguros (http). Fallback RFC4122-ish sin dependencias.
    if (global.crypto && typeof global.crypto.randomUUID === "function") {
      try { return global.crypto.randomUUID(); } catch (_) {}
    }
    var d = Date.now();
    var d2 = (typeof performance !== "undefined" && performance.now) ? performance.now() * 1000 : 0;
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      var r = (d + Math.random() * 16) % 16 | 0;
      d = Math.floor(d / 16);
      if (d2 > 0) { r = (r + d2) % 16 | 0; d2 = Math.floor(d2 / 16); }
      return (c === "x" ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }

  function safeClone(payload) {
    // Evita que un payload circular o gigante rompa el bus. Best-effort.
    if (payload === undefined || payload === null) return payload;
    try {
      return JSON.parse(JSON.stringify(payload));
    } catch (_) {
      return { __unclonable__: true, type: typeof payload };
    }
  }

  // --- EventBus -------------------------------------------------------

  function EventBus() {
    this._listeners = Object.create(null); // { eventType: [ {fn, once} ] }
    this._wildcard = []; // listeners de '*'
    this._replayBuffer = []; // últimos N eventos emitidos, para suscriptores tardíos
    this._errorHooks = []; // callbacks(err, context) — logger.js se engancha acá
  }

  /**
   * Suscribirse a un tipo de evento. Devuelve función de unsubscribe.
   * @param {string} type - nombre del evento, ej: "venta:completada". '*' = todos.
   * @param {function(event)} handler
   */
  EventBus.prototype.on = function (type, handler) {
    if (typeof handler !== "function") {
      throw new TypeError("AMG.EventBus.on: handler debe ser una función");
    }
    if (type === "*") {
      this._wildcard.push(handler);
      var self = this;
      return function unsubscribe() {
        var i = self._wildcard.indexOf(handler);
        if (i !== -1) self._wildcard.splice(i, 1);
      };
    }
    if (!this._listeners[type]) this._listeners[type] = [];
    this._listeners[type].push({ fn: handler, once: false });
    var selfT = this;
    return function unsubscribe() {
      var arr = selfT._listeners[type];
      if (!arr) return;
      var idx = arr.findIndex(function (l) { return l.fn === handler; });
      if (idx !== -1) arr.splice(idx, 1);
    };
  };

  /** Igual que on(), pero se auto-desuscribe tras la primera ejecución. */
  EventBus.prototype.once = function (type, handler) {
    var self = this;
    var wrapped = function (evt) {
      unsub();
      handler(evt);
    };
    var unsub = this.on(type, wrapped);
    return unsub;
  };

  /** Desuscribir explícitamente (alternativa a usar el retorno de on()). */
  EventBus.prototype.off = function (type, handler) {
    if (type === "*") {
      var i = this._wildcard.indexOf(handler);
      if (i !== -1) this._wildcard.splice(i, 1);
      return;
    }
    var arr = this._listeners[type];
    if (!arr) return;
    var idx = arr.findIndex(function (l) { return l.fn === handler; });
    if (idx !== -1) arr.splice(idx, 1);
  };

  /**
   * Emitir un evento tipado. Nunca lanza excepción hacia el llamador: si un
   * listener falla, se aísla el error (no debe poder tumbar una venta por un
   * bug en, digamos, el logger).
   * @param {string} type
   * @param {object} [payload]
   * @returns {object} el evento completo emitido (útil para debug/tests)
   */
  EventBus.prototype.emit = function (type, payload) {
    if (typeof type !== "string" || !type) {
      throw new TypeError("AMG.EventBus.emit: 'type' debe ser un string no vacío");
    }
    var evt = {
      id: uuid(),
      type: type,
      payload: payload === undefined ? null : payload,
      ts: Date.now(),
      isoTs: new Date().toISOString()
    };

    this._pushReplay(evt);

    var handlers = (this._listeners[type] || []).slice(); // copia: on/off durante emit no debe romper el loop
    for (var i = 0; i < handlers.length; i++) {
      this._invoke(handlers[i].fn, evt);
    }
    var wc = this._wildcard.slice();
    for (var j = 0; j < wc.length; j++) {
      this._invoke(wc[j], evt);
    }
    return evt;
  };

  EventBus.prototype._invoke = function (fn, evt) {
    try {
      fn(evt);
    } catch (err) {
      if (global.AMG_FLAGS.eventBusVerbose && global.console && global.console.error) {
        global.console.error("[AMG.EventBus] listener falló para '" + evt.type + "':", err);
      }
      for (var i = 0; i < this._errorHooks.length; i++) {
        try { this._errorHooks[i](err, evt); } catch (_) { /* un hook roto no puede romper el bus */ }
      }
    }
  };

  /** Registrar un hook de error (usado por logger.js para loguear fallos de listeners). */
  EventBus.prototype.onError = function (hook) {
    if (typeof hook === "function") this._errorHooks.push(hook);
  };

  EventBus.prototype._pushReplay = function (evt) {
    this._replayBuffer.push(evt);
    var max = global.AMG_FLAGS.eventBusReplayBufferSize || 200;
    if (this._replayBuffer.length > max) {
      this._replayBuffer.splice(0, this._replayBuffer.length - max);
    }
  };

  /**
   * Devuelve los últimos N eventos emitidos (para que un módulo que se monta
   * tarde — ej. telemetry.js cargado después — pueda "ponerse al día" sin
   * haber estado escuchando desde el principio).
   */
  EventBus.prototype.getRecentEvents = function (type) {
    if (!type) return this._replayBuffer.slice();
    return this._replayBuffer.filter(function (e) { return e.type === type; });
  };

  EventBus.prototype.clearReplayBuffer = function () {
    this._replayBuffer = [];
  };

  // --- Instancia singleton compartida por toda la app -------------------
  global.AMG = global.AMG || {};
  global.AMG.EventBus = new EventBus();
  global.AMG.EventBus.VERSION = "1.0.0";

  if (global.AMG_FLAGS.eventBusVerbose && global.console && global.console.info) {
    global.console.info("[AMG.EventBus] listo (v1.0.0). Namespace: window.AMG.EventBus");
  }
})(typeof window !== "undefined" ? window : this);
