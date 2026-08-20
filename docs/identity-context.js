/*!
 * identity-context.js — friendly-123 (nuevo, 2026-07-23)
 *
 * QUÉ HACE: puebla window.AMG_CONTEXT (licenseId, companyId, branchId,
 * employeeId, employeeNombre, rol, appVersion) leyendo las fuentes REALES
 * de identidad que la app ya expone — verificadas en el código, no adivinadas:
 *
 *   - localStorage["f123_owned"]  → { instanceId, licenseCode, licenseEstado }
 *     (fuente: mock-backend.js y avanzado-extra.js la leen así)
 *   - window.OCCurrentUser            → { id, nombre } del encargado logueado
 *     con su PIN (fuente: mock-backend.js mov() la usa como usuarioId)
 *   - window.OCAuth.rolActual()       → rol activo (fuente: avanzado-extra.js)
 *   - localStorage["oc_device_id"]    → id de dispositivo (avanzado-extra.js)
 *
 * Con esto, TODO lo que guardan telemetry.js y audit-store.js queda atado a
 * identidad + PIN + licencia + dispositivo, sin tocar ni un byte de la app.
 *
 * SOLO LEE. Jamás escribe en las fuentes, jamás toca la red, jamás modifica
 * OCCurrentUser ni OCAuth. Si una fuente no existe (ej. antes del login),
 * deja "desconocido" y se actualiza solo cuando aparece.
 *
 * ACTUALIZACIÓN: refresca el contexto (a) al cargar, (b) en cada evento del
 * bus ANTES de que telemetry/audit lo lean (se registra primero por orden de
 * carga: este archivo va DESPUÉS de logger.js y ANTES de audit-store.js),
 * (c) cada 15s como red de seguridad (cambio de PIN/rol sin evento).
 *
 * Orden de carga: event-bus.js → logger.js → telemetry.js →
 * identity-context.js → audit-store.js → sync-queue.js → ... → ui-actions.js
 *
 * Feature flag: window.AMG_FLAGS.identityContextEnabled (default true)
 * Rollback: quitar este <script> — telemetry/audit vuelven a "desconocido".
 */
(function (global) {
  "use strict";

  if (global.AMG && global.AMG.IdentityContext) return; // no pisar

  global.AMG_FLAGS = global.AMG_FLAGS || {};
  var F = global.AMG_FLAGS;
  if (typeof F.identityContextEnabled === "undefined") F.identityContextEnabled = true;

  if (!F.identityContextEnabled) {
    if (global.console) global.console.info("[AMG.IdentityContext] deshabilitado por feature flag");
    return;
  }

  function leerOwned() {
    try {
      var raw = global.localStorage && global.localStorage.getItem("f123_owned");
      var o = raw ? JSON.parse(raw) : null;
      return (o && typeof o === "object") ? o : {};
    } catch (_) { return {}; }
  }

  function leerDeviceId() {
    try { return (global.localStorage && global.localStorage.getItem("oc_device_id")) || null; } catch (_) { return null; }
  }

  function leerRol() {
    try {
      if (global.OCAuth && typeof global.OCAuth.rolActual === "function") return global.OCAuth.rolActual() || null;
    } catch (_) {}
    return null;
  }

  function construir() {
    var owned = leerOwned();
    var usr = global.OCCurrentUser || null;
    var prev = global.AMG_CONTEXT || {};
    return {
      // instanceId = identidad única de la licencia instalada; licenseCode =
      // código comercial de la licencia. companyId reutiliza licenseCode
      // porque en friendly-123 una licencia = un negocio.
      licenseId: owned.instanceId || prev.licenseId || "desconocido",
      companyId: owned.licenseCode || prev.companyId || "desconocido",
      licenseEstado: owned.licenseEstado || "desconocido",
      branchId: prev.branchId || "desconocido", // la app no expone sucursal activa globalmente aún; se setea a mano si se necesita: AMG_CONTEXT.branchId = ...
      employeeId: (usr && usr.id) || "desconocido",
      employeeNombre: (usr && usr.nombre) || "desconocido",
      rol: leerRol() || "desconocido",
      deviceId: leerDeviceId() || "desconocido",
      appVersion: prev.appVersion || "shell-v31"
    };
  }

  function refrescar() {
    try { global.AMG_CONTEXT = construir(); } catch (_) { /* jamás romper nada */ }
  }

  // 1) Al cargar.
  refrescar();

  // 2) Antes de cada evento de negocio: al registrarse AHORA (antes de que
  // audit-store.js se suscriba, por orden de carga), este listener corre
  // primero y deja AMG_CONTEXT fresco para telemetry/audit del mismo evento.
  if (global.AMG && global.AMG.EventBus) {
    global.AMG.EventBus.on("*", refrescar);
  }

  // 3) Red de seguridad cada 15s (login/logout/cambio de rol sin evento).
  var timer = setInterval(refrescar, 15000);

  global.AMG = global.AMG || {};
  global.AMG.IdentityContext = {
    VERSION: "1.0.0",
    refrescar: refrescar,
    actual: function () { return global.AMG_CONTEXT || {}; },
    stop: function () { clearInterval(timer); }
  };

  if (global.console && global.console.info) {
    global.console.info("[AMG.IdentityContext] activo — logs y auditoría atados a licencia/encargado/dispositivo.");
  }
})(typeof window !== "undefined" ? window : this);
