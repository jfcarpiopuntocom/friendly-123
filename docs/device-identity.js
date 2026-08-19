// COMPARTIDO: utilidad generica identica en las 3 apps a proposito.
// device-identity.js — unified device ID (JFC 2026-07-28)
//
// Today there are 2 separate device-identity spaces that never talk to each
// other: amigable_device_id (sync-realtime.js) and oc_device_id
// (avanzado-extra.js / OCSync). Each generates its own random ID, so the
// same phone shows up as "2 different devices" depending on who asks — that
// makes any future correlation (e.g. "which device made this change" for
// location tracking) useless.
//
// This file does NOT touch sync-realtime.js or avanzado-extra.js — both
// keep reading their own localStorage key exactly as before, zero risk to
// sync that already works. All this does: on load, if an ID already exists
// under EITHER key, copy it into whichever key is missing, so both converge
// on the same value going forward. If NEITHER exists yet (brand-new device),
// generate one ID and seed both. Devices that already have two DIFFERENT
// values (diverged before this file existed) are left untouched — silently
// overwriting an already-established device ID could disrupt an in-flight
// sync session keyed on the old value.
(function () {
  var CLAVES = ["amigable_device_id", "oc_device_id"];
  function leer(clave) {
    try { return localStorage.getItem(clave) || null; } catch (_) { return null; }
  }
  function escribir(clave, valor) {
    try { localStorage.setItem(clave, valor); } catch (_) {}
  }
  function generar() {
    var c = globalThis.crypto;
    if (c && c.randomUUID) return c.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (ch) {
      var r = (Math.random() * 16) | 0, v = ch === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }
  var existente = null;
  for (var i = 0; i < CLAVES.length; i++) {
    var v = leer(CLAVES[i]);
    if (v) { existente = v; break; }
  }
  var canonico = existente || generar();
  for (var j = 0; j < CLAVES.length; j++) {
    if (!leer(CLAVES[j])) escribir(CLAVES[j], canonico);
  }
  window.OCDeviceId = canonico;
})();
