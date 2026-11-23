
// Item 4 (revision JFC 2026-07-05): capa PWA minima — cachea el shell
// (HTML/JS/CSS/assets propios) para que la app abra sin conexion. Nunca
// intercepta /api/* ni version.json (datos y updates siempre frescos).
// El chequeo de version (Fase 2) vive en auth-ui.js — no duplicarlo aqui.
// Falla en silencio en navegadores sin soporte — nunca bloquea la carga.
if ("serviceWorker" in navigator) {
  // C168 Safari: register() already runs the browser update algorithm. The
  // extra reg.update() on every launch doubled checks while scripts loaded;
  // version-mismatch and periodic explicit updates below remain intact.
  window.addEventListener("load", () => { navigator.serviceWorker.register("./sw.js", { updateViaCache: "none" }).catch(() => {}); });
  /* MEJORA #3 (JFC 2026-09-08, auditoría de versión): fin de la mezcla
     intra-sesión. Cuando un service worker NUEVO toma control con un shell
     distinto (avisa con {tipo:"shell-actualizado"} desde broadcastActualizacion),
     la página vieja puede quedar corriendo código viejo en memoria mientras el
     SW ya sirve archivos nuevos = MEZCLA (fue el bug del Avanzado roto). Nadie
     escuchaba ese aviso. Ahora la página lo escucha y marca la recarga SEGURA
     diferida (misma que el piso de versión: invisible, al próximo login, nunca
     interrumpe el tecleo del PIN). Así el aparato converge a UNA sola versión
     limpia: o todo viejo o todo nuevo, nunca mezclado. NO se toca la activación
     del SW (skipWaiting) — cambio puramente aditivo y seguro para producción. */
  // First-ever SW install is NOT an upgrade from an older running shell.
  let origenSinShellAnterior = false;
  try { origenSinShellAnterior = !navigator.serviceWorker.controller && !localStorage.getItem("f123_version_vista"); } catch (_) {}
  try {
    navigator.serviceWorker.addEventListener("message", function (ev) {
      try {
        if (ev && ev.data && ev.data.tipo === "shell-actualizado") {
          // Only the initial install of the SAME shell may skip the deferred reload.
          // Later upgrades, old controllers and previously viewed versions must reload safely.
          const primerShell = window.__f123PrimerShellCargado;
          if (origenSinShellAnterior && (!primerShell || ev.data.shell === primerShell)) return;
          if (typeof _recargarSeguroVersion === "function") _recargarSeguroVersion();
          else { try { sessionStorage.setItem("f123_reload_al_entrar", "1"); } catch (_) {} }
        }
      } catch (_) {}
    });
  } catch (_) {}
}
// 4D: compare the PUBLIC shell, never a CacheStorage key with -goldenN/-next/-previo.
// CacheStorage is shared by every app and channel at this origin.
function _cachesDeEsteCanal(nombres) {
  const m = /\/(next|previo)\/$/.exec(location.pathname || "");
  return (nombres || []).filter(n => /^f123-shell-v\d+(?:-golden\d+)?(?:-(?:next|previo))?$/.test(n) && (m ? n.endsWith("-" + m[1]) : !/-(?:next|previo)$/.test(n)));
}
function _shellPublicoDeCache(n) { return n.replace(/-(?:next|previo)$/, "").replace(/-golden\d+$/, ""); }
// CONTROL DE VERSION FORZADO (JFC 2026-07-17, "no podemos andar sirviendo
// versiones viejas"): en CADA carga se pide version.json fresco (el SW nunca
// lo cachea, por diseno). Si la version publicada difiere de la ultima vista
// en este dispositivo, se purgan TODAS las caches, se actualiza el SW y se
// recarga UNA sola vez — automatico, sin banner, sin pedirle nada al usuario.
// Anti-loop: la version nueva se guarda ANTES de recargar, asi la segunda
// carga ya coincide y no vuelve a recargar. Primera visita: solo registra.
(async function () {
  try {
    // Capture BEFORE the async version fetch: a first-install SW may claim mid-request.
    const controladorAlIniciar = !!(navigator.serviceWorker && navigator.serviceWorker.controller);
    const r = await fetch("./version.json?ts=" + Date.now(), { cache: "no-store" });
    if (!r.ok) { try { const eb = JSON.parse(localStorage.getItem("f123_errores") || "[]"); eb.push({ ts: Date.now(), tipo: "version-check", msg: "version.json " + r.status }); if (eb.length > 50) eb.splice(0, eb.length - 50); localStorage.setItem("f123_errores", JSON.stringify(eb)); } catch (_) {} return; }
    const _vj = (await r.json()) || {};
    // BUG RAIZ (JFC 2026-08-26, "3 semanas viendo codigo viejo"): antes esto
    // comparaba SOLO `version` ("1.7.5"), que casi nunca se subia. Cada build
    // sube el `shell` (f123-shell-vNN) pero `version` se quedaba igual, asi que
    // este reload forzado NUNCA se disparaba y el dispositivo seguia con el
    // shell viejo. Ahora la huella incluye AMBOS: si cambia cualquiera, refresca.
    const v = String(_vj.version || "") + "|" + String(_vj.shell || "");
    if (v === "|") return;
    const K = "f123_version_vista";
    const prev = localStorage.getItem(K);
    if (prev === v) return;
    // First entry on this origin has no older controller to replace.
    // Record its shell without forcing another full page load at PIN/demo entry.
    // If a SW already controls the page, preserve the safe upgrade path.
    if (prev === null && !controladorAlIniciar) {
      window.__f123PrimerShellCargado = String(_vj.shell || "");
      localStorage.setItem(K, v);
      return;
    }
    // The PIN-only adoption path uses a per-shell loop guard instead of
    // a count/time-based quota that could strand a device on an old version.
    localStorage.setItem(K, v);
    // C185: C181 revisar() owns the explicit mismatch update. No parallel SW check during cold boot.
    // Solo activate del SW retira caches anteriores; update() no confirma una instalacion completa.
    try {
      const bc = new BroadcastChannel("f123-version");
      bc.postMessage({ tipo: "recargar", v: v });
      setTimeout(function () { try { bc.close(); } catch (_) {} }, 500);
    } catch (_) {}
    /* JFC 2026-09-04: NO refrescar la UI mid-uso — reiniciar la pantalla mientras
       se trabaja se ve mal (y peor si rompe el layout). Se solicito actualizar el SW;
       su activate conserva la limpieza por canal. Se DIFIERE la recarga al próximo login (que es
       invisible, vía auth-ui.entrar()). La info del negocio sigue viva por el
       túnel reactivo; el "vivir actualizado" no requiere reiniciar la página. */
    try { sessionStorage.setItem("f123_reload_al_entrar", "1"); } catch (_) {}
  } catch (_) {}
})();

/* COMPATIBILIDAD DE VERSIÓN + RECARGA COORDINADA (JFC 2026-08-28, sistema de
   integridad de versión). La app le pregunta al service worker qué shell está
   sirviendo (la cache activa f123-shell-vNN) y lo compara con el shell que
   version.json declara. Si el SW sirve un shell distinto al publicado (mezcla
   de versiones), se fuerza una recarga coordinada UNA vez. También se escucha
   el canal BroadcastChannel("f123-version") para recargar cuando otra pestaña
   detecta una versión nueva. */
/* Recarga de versión que NO interrumpe el candado del PIN (JFC 2026-09-01):
   si el gate está visible, el usuario está tecleando su PIN — recargar ahí le
   resetea el tecleo (bug en PC y cel). En vez de eso se DIFIERE al paso
   siguiente: se marca f123_reload_al_entrar y auth-ui.entrar() recarga solo,
   invisible, justo al pasar a la app (ya actualizada). Fuera del gate recarga
   normal. Mismo mecanismo que ya usaba la recarga coordinada de arriba. */
function _recargarSeguroVersion() {
  /* JFC 2026-09-04 / C237: never reload inside active work; arm BOTH legacy key and active
     KP ("f123_act_sola_pendiente") so Safari adopts automatically on the PIN gate. */
  try { sessionStorage.setItem("f123_reload_al_entrar", "1"); } catch (_) {}
  try { sessionStorage.setItem("f123_act_sola_pendiente", "1"); } catch (_) {}
  try { if (window._ocActSola && typeof window._ocActSola.intentar === "function") window._ocActSola.intentar(); } catch (_) {}
}
(function verificarCompatibilidadVersion() {
  try {
    const esperado = (function () { try { return (localStorage.getItem("f123_version_vista") || "").split("|")[1] || ""; } catch (_) { return ""; } })();
    if (esperado && ("caches" in window)) {
      caches.keys().then(function (nombres) {
        const delCanal = _cachesDeEsteCanal(nombres);
        const activa = delCanal[0] || "";
        if (delCanal.length && esperado && !delCanal.some(n => _shellPublicoDeCache(n) === esperado)) {
          try { console.warn("[version] el SW sirve " + activa + " pero version.json pide " + esperado + " — recargando (diferido si hay candado)."); } catch (_) {}
          try { localStorage.setItem("f123_version_vista", esperado); } catch (_) {}
          _recargarSeguroVersion();
        }
      }).catch(function () {});
    }
  } catch (_) {}
  try {
    const bc = new BroadcastChannel("f123-version");
    bc.onmessage = function (ev) {
      try {
        if (ev && ev.data && ev.data.tipo === "recargar") {
          try { localStorage.setItem("f123_version_vista", ev.data.v || ""); } catch (_) {}
          _recargarSeguroVersion();
        }
      } catch (_) {}
    };
  } catch (_) {}
})();

/* PISO DE VERSIÓN AUTORITATIVO (JFC 2026-09-08, mejora #5 de la auditoría de
   versión). El chequeo de arriba compara el shell activo contra
   f123_version_vista (un valor LOCAL): solo actualiza si algo local ya supo de
   la versión nueva. Este además consulta version.json —la fuente de verdad del
   servidor, que el SW nunca cachea— y, si el shell activo del aparato es
   distinto al que el servidor publica, fuerza la recarga SEGURA (diferida al
   próximo login, invisible; NUNCA bloquea, nunca muestra un límite). Así un
   aparato por debajo del piso converge solo a la versión nueva sin depender de
   que un valor local ya la conociera. Es la versión fail-open de un update
   forzado: empuja a todos a la buena, no deja a nadie afuera. */
(function verificarPisoVersion() {
  try {
    if (!("caches" in window)) return;
    fetch("./version.json?ts=" + Date.now(), { cache: "no-store" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (vj) {
        if (!vj || !vj.shell) return;
        const servidor = String(vj.shell);
        caches.keys().then(function (nombres) {
          const delCanal = _cachesDeEsteCanal(nombres);
        const activa = delCanal[0] || "";
          if (delCanal.length && servidor && !delCanal.some(n => _shellPublicoDeCache(n) === servidor)) {
            try { console.warn("[version] piso: el SW sirve " + activa + " y el servidor publica " + servidor + " — recarga diferida al próximo login."); } catch (_) {}
            try { localStorage.setItem("f123_version_vista", (vj.version || "") + "|" + servidor); } catch (_) {}
            _recargarSeguroVersion();
          }
        }).catch(function () {});
      }).catch(function () {});
  } catch (_) {}
})();

/* C181: al detectar una version nueva, el SW puede actualizarse mientras
   se trabaja, pero el documento SOLO navega desde la pantalla visible del PIN.
   No hay limite artificial de esperas ni recargas por intervalo; cada shell
   puede adoptarse una vez para evitar bucles de cache. */
const _ocActSolaOn = true;
(function actualizacionSola() {
  if (!_ocActSolaOn || !("serviceWorker" in navigator)) return;
  const KA = "f123_autorecarga";
  // Bandera PROPIA: solo la pone revisar() tras confirmar con el service worker que sirve otra
  // version. No se usa f123_reload_al_entrar porque el piso de version la marca en cada carga
  // (compara "f123-shell-vN" contra el nombre de cache con -goldenN y nunca coincide).
  const KP = "f123_act_sola_pendiente";
  const manualPurgeReentry = window.__f123ManualPurgeReentry === true;
  let manualPurgeShell = "";
  if (manualPurgeReentry) {
    try { sessionStorage.removeItem(KP); sessionStorage.removeItem(KA); } catch (_) {}
  }
  function pendiente() { try { return sessionStorage.getItem(KP) === "1"; } catch (_) { return false; } }
  // offsetParent es null en elementos position:fixed (los overlays): se mide con getClientRects.
  function visible(el) { try { return !!(el && getComputedStyle(el).display !== "none" && el.getClientRects().length > 0); } catch (_) { return false; } }
  function enPantallaPIN() {
    try {
      const gate = document.getElementById("oc-gate");
      return !!(gate && gate.style.display !== "none" && visible(gate));
    } catch (_) { return false; }
  }
  // C181: the PIN screen is the ONLY automatic navigation boundary.
  // Once authenticated inside the working app, never reload automatically.
  function seguro() { return enPantallaPIN() && seguroCon(false); }
  function seguroCon(sinRecuperacion) {
    if (window.__f123PurgeEnCurso === true) return false;
    try {
      // Never auto-reload while a notebook still needs local IDB recovery or
      // peer history replay. A SW update is not permission to interrupt money.
      if (!sinRecuperacion && recuperacionPendiente()) return false;
      if (visible(document.getElementById("oc-modal-overlay"))) return false;
      if (visible(document.getElementById("oc-comision-overlay"))) return false;
      if (visible(document.getElementById("vi-cliente"))) return false; // venta abierta
      // P0 #614: pressing Add removes input focus, but neither an unfinished
      // customer form nor a pending strict ACK may be destroyed by a SW reload.
      if (window.__f123AltaClientePendiente ||
          (document.getElementById("cliNombre") || {}).value ||
          (document.getElementById("cliTelefono") || {}).value ||
          (document.getElementById("cliEmail") || {}).value) return false;
      if ([...document.querySelectorAll(".oc-vs-editor")].some(function (e) { return e.style.display === "block"; })) return false;
      if ([...document.querySelectorAll('[role="dialog"]')].some(visible)) return false;
      if (typeof _ventasEnCurso !== "undefined" && _ventasEnCurso.size) return false;
      if (typeof _carritoVenta !== "undefined" && _carritoVenta.length) return false;
      if (typeof _sellando !== "undefined" && _sellando) return false;
      return true;
    } catch (_) { return false; }
  }
  /* (JFC 2026-10-27) Parte Yjs/IDB de seguro(), compartida con auth-ui.js: true si
     recargar ahora interrumpiria la recuperacion local (IDB) o el replay de pares.
     Nunca lanza; sin OCYjs devuelve false. Si algo falla con Yjs presente, true
     (conservador: no recargar). */
  function recuperacionPendiente() {
    try {
      const y = window.OCYjs;
      if (!y || y.estado !== "activo") return false;
      if ([y.canal, y.opsCanal, y.fotosCanal].some(function (c) {
        return c && (c.recuperando || (c.recuperacionLocal && c.recuperacionLocal !== "listo"));
      })) return true;
      if (y._diag && y._diag().recuperacionLocalPendiente) return true;
      return false;
    } catch (_) { return true; }
  }
  try { window.__f123RecuperacionPendiente = recuperacionPendiente; } catch (_) {}
  /* (JFC 2026-10-27) Bitacora de recargas para diagnostico en campo: ultimas 15 en
     localStorage "f123_recargas_log" = [{m: motivo, t: ms, v: shell}]. Sin UI, sin red,
     sin datos de clientes. Nunca lanza. */
  function marcarRecarga(motivo) {
    try {
      let v = "";
      try { v = (localStorage.getItem("f123_version_vista") || "").split("|")[1] || ""; } catch (_) {}
      let a = [];
      try { a = JSON.parse(localStorage.getItem("f123_recargas_log") || "[]"); } catch (_) {}
      if (!Array.isArray(a)) a = [];
      a.push({ m: String(motivo || ""), t: Date.now(), v: v });
      localStorage.setItem("f123_recargas_log", JSON.stringify(a.slice(-15)));
    } catch (_) {}
  }
  try { window.__f123MarcarRecarga = marcarRecarga; } catch (_) {}
  // Cached login code can still consult this guard during a shell transition.
  function puedeRecargarVersion() {
    try {
      const objetivo = (localStorage.getItem("f123_version_vista") || "").split("|")[1] || "";
      const previa = JSON.parse(sessionStorage.getItem(KA) || "null");
      return !!objetivo && !(previa && previa.shell === objetivo);
    } catch (_) { return false; }
  }
  try { window.__f123PuedeRecargarVersion = puedeRecargarVersion; } catch (_) {}
  /* (JFC 2026-11-11, v732) Anillo de errores para diagnostico en campo: ultimos 20 en localStorage
     "f123_errores_log" = [{k: tipo, m: mensaje(160), s: fuente(60), t: ms}]. Sin UI, sin red, nunca lanza.
     Antes una caida no dejaba ningun rastro (Sentry vacio). PARA REVERTIR: borrar este bloque. */
  (function () {
    function reg(tipo, msg, fuente) {
      try {
        var a = JSON.parse(localStorage.getItem("f123_errores_log") || "[]");
        if (!Array.isArray(a)) a = [];
        a.push({ k: tipo, m: String(msg || "").slice(0, 160), s: String(fuente || "").slice(-60), t: Date.now() });
        localStorage.setItem("f123_errores_log", JSON.stringify(a.slice(-20)));
      } catch (_) {}
    }
    try {
      window.addEventListener("error", function (e) { reg("error", e && e.message, e && e.filename); });
      window.addEventListener("unhandledrejection", function (e) { var r = e && e.reason; reg("rechazo", r && (r.message || r), ""); });
    } catch (_) {}
  })();
  /* (JFC 2026-10-28) Recarga frenada por recuperacion Yjs/IDB: se anota desde cuando (sessionStorage
     "f123_update_frenada_desde", no se sobrescribe) y se registra UNA vez "frenada-recuperacion" en la
     bitacora. No recarga mientras la recuperacion siga pendiente. */
  const KF = "f123_update_frenada_desde";
  function frenadaDesde() { try { return Number(sessionStorage.getItem(KF)) || 0; } catch (_) { return 0; } }
  function marcarFrenada() {
    try {
      if (frenadaDesde()) return;
      sessionStorage.setItem(KF, String(Date.now()));
      marcarRecarga("frenada-recuperacion");
    } catch (_) {}
  }
  function limpiarFrenada() { try { sessionStorage.removeItem(KF); } catch (_) {} }
  // C181: actual adoption is allowed at PIN only, never inside the operating app.
  // KA prevents same-shell navigation loops; later new shells remain eligible.
  let recargando = false;
  function mostrarSplashActualizando() {
    try {
      if (!enPantallaPIN()) return null;
      const root = document.body || document.documentElement;
      if (!root) return null;
      const layer = document.createElement("div");
      layer.id = "f123-update-splash";
      layer.setAttribute("role", "status");
      layer.setAttribute("aria-live", "polite");
      layer.style.cssText = "position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;background:#0A0A0F;color:#FFFFFF;-webkit-text-fill-color:#FFFFFF;color-scheme:only light;padding:24px;text-align:center;font-family:'Space Grotesk',Inter,system-ui,-apple-system,sans-serif";
      layer.innerHTML = '<style>@keyframes f123UpdatingSpin{to{transform:rotate(360deg)}}@media(prefers-reduced-motion:reduce){#f123-update-ring{animation:none!important}}</style>' +
        '<div style="width:100%;max-width:360px;background:#12131C;border:2px solid #262938;border-radius:18px;padding:30px 24px 28px;box-sizing:border-box;display:flex;align-items:center;flex-direction:column;gap:16px">' +
        '<div aria-hidden="true" style="display:flex;gap:5px;width:96px;height:5px">' +
        '<span style="flex:1;background:#00C87A;border-radius:99px"></span>' +
        '<span style="flex:1;background:#FFC700;border-radius:99px"></span>' +
        '<span style="flex:1;background:#FF7A2F;border-radius:99px"></span>' +
        '<span style="flex:1;background:#FF3B5C;border-radius:99px"></span>' +
        '<span style="flex:1;background:#38BDF8;border-radius:99px"></span>' +
        '</div>' +
        '<div style="font-size:13px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#00C87A;-webkit-text-fill-color:#00C87A">friendly-123</div>' +
        '<div id="f123-update-ring" aria-hidden="true" style="width:48px;height:48px;border:4px solid #232634;border-top-color:#00C87A;border-right-color:#FFC700;border-radius:50%;animation:f123UpdatingSpin .85s linear infinite"></div>' +
        '<div style="font-size:28px;line-height:1.12;font-weight:700;letter-spacing:-.02em;color:#FFFFFF;-webkit-text-fill-color:#FFFFFF">Updating</div>' +
        '<div style="font-size:15px;line-height:1.45;font-weight:500;color:#CBD5E1;-webkit-text-fill-color:#CBD5E1">Actualizando la aplicación…</div>' +
        '</div>';
      root.appendChild(layer);
      return layer;
    } catch (_) { return null; }
  }
  async function intentar() {
    vigilar();
    if (!pendiente() || recargando || !seguro() || !puedeRecargarVersion()) return false;
    recargando = true;
    let splash = null, navegando = false;
    try {
      const objetivo = (localStorage.getItem("f123_version_vista") || "").split("|")[1] || "";
      if (manualPurgeReentry && (!manualPurgeShell || objetivo === manualPurgeShell)) return false;
      if (!objetivo || await shellDelSW() !== objetivo ||
          !pendiente() || !seguro() || !puedeRecargarVersion()) return false;
      splash = mostrarSplashActualizando();
      // Paint the splash before navigation (no arbitrary idle delay).
      if (splash && document.visibilityState !== "hidden" && typeof window.requestAnimationFrame === "function") {
        await new Promise(function (resolve) {
          window.requestAnimationFrame(function () { window.requestAnimationFrame(resolve); });
        });
      }
      if (!seguro() || !pendiente()) return false;
      sessionStorage.setItem(KA, JSON.stringify({ shell: objetivo }));
      sessionStorage.removeItem(KP);
      try { sessionStorage.setItem("f123_sw_reload_ts", String(Date.now())); } catch (_) {}
      limpiarFrenada();
      marcarRecarga("version-pin");
      location.reload();
      navegando = true;
      return true;
    } catch (_) { return false; }
    finally {
      if (!navegando && splash && splash.remove) splash.remove();
      recargando = false;
    }
  }
  function shellDelSW() {
    return new Promise(function (resolve) {
      const c = navigator.serviceWorker.controller;
      if (!c) return resolve("");
      const t = setTimeout(function () { resolve(""); }, 3000);
      navigator.serviceWorker.addEventListener("message", function onMsg(ev) {
        if (ev && ev.data && ev.data.tipo === "shell-actual") {
          clearTimeout(t); navigator.serviceWorker.removeEventListener("message", onMsg); resolve(String(ev.data.shell || ""));
        }
      });
      try { c.postMessage({ tipo: "que-shell" }); } catch (_) { clearTimeout(t); resolve(""); }
    });
  }
  async function revisar() {
    if (window.__f123PurgeEnCurso === true) return;
    try {
      const r = await fetch("./version.json?ts=" + Date.now(), { cache: "no-store" });
      if (!r.ok) return;
      const vj = await r.json();
      if (!vj || !vj.shell) return;
      if (manualPurgeReentry && !manualPurgeShell) manualPurgeShell = String(vj.shell);
      if (manualPurgeReentry && String(vj.shell) === manualPurgeShell) {
        // Keep the freshly loaded document; upgrade an older controller in place.
        try {
          if (await shellDelSW() !== manualPurgeShell) {
            const reg = await navigator.serviceWorker.getRegistration();
            if (reg) {
              await reg.update();
              if (reg.waiting) reg.waiting.postMessage({ tipo: "skip-waiting" });
            }
          }
        } catch (_) {}
        try { sessionStorage.removeItem(KP); } catch (_) {}
        return;
      }
      const sirve = await shellDelSW();
      if (!sirve) return;
      if (sirve === String(vj.shell)) {
        // The worker can finish takeover before this check. Keep the target
        // fingerprint complete even if the older compatibility path wrote only a shell.
        if (pendiente()) {
          try { localStorage.setItem("f123_version_vista", String(vj.version || "") + "|" + String(vj.shell)); } catch (_) {}
          intentar();
        }
        return;
      }
      try { localStorage.setItem("f123_version_vista", String(vj.version || "") + "|" + String(vj.shell)); } catch (_) {}
      try {
        const regs = typeof navigator.serviceWorker.getRegistrations === "function"
          ? await navigator.serviceWorker.getRegistrations()
          : (await navigator.serviceWorker.getRegistration() ? [await navigator.serviceWorker.getRegistration()] : []);
        for (const g of regs) {
          if (!g) continue;
          if (typeof g.addEventListener === "function" && !g._ocUpdateWired) {
            g._ocUpdateWired = true;
            g.addEventListener("updatefound", () => {
              const sw = g.installing;
              if (!sw) return;
              sw.addEventListener("statechange", () => {
                if (sw.state === "installed" && g.waiting) { try { g.waiting.postMessage({ tipo: "skip-waiting" }); } catch (_) {} }
                if (sw.state === "activated") onShellTomado();
              });
            });
          }
          await g.update();
          if (g.waiting) g.waiting.postMessage({ tipo: "skip-waiting" });
          if (g.installing && !g.installing._ocStateWired) {
            g.installing._ocStateWired = true;
            g.installing.addEventListener("statechange", function () {
              if (this.state === "installed" && g.waiting) { try { g.waiting.postMessage({ tipo: "skip-waiting" }); } catch (_) {} }
              if (this.state === "activated") onShellTomado();
            });
          }
        }
      } catch (_) {}
      _recargarSeguroVersion();
      try { sessionStorage.setItem(KP, "1"); } catch (_) {}
      intentar();
    } catch (_) {}
  }

  function vigilar() {
    try {
      if (!pendiente()) { limpiarFrenada(); return; }
      if (recuperacionPendiente()) marcarFrenada();
      else limpiarFrenada();
    } catch (_) {}
  }
  // E2: a takeover can already match version.json while this document is stale.
  var ultimoControladorSW = navigator.serviceWorker.controller;
  function onShellTomado() {
    if (window.__f123PurgeEnCurso === true) return;
    if (manualPurgeReentry) {
      try { sessionStorage.setItem(KP, "1"); } catch (_) {}
      revisar();
      return;
    }
    var actual = navigator.serviceWorker.controller;
    if (!ultimoControladorSW) { ultimoControladorSW = actual; return; }
    if (!actual || actual === ultimoControladorSW) return;
    ultimoControladorSW = actual;
    try { sessionStorage.setItem(KP, "1"); } catch (_) {}
    _recargarSeguroVersion();
    vigilar();
    if (enPantallaPIN()) intentar();
  }
  navigator.serviceWorker.addEventListener("controllerchange", onShellTomado);
  navigator.serviceWorker.addEventListener("message", function (ev) {
    if (ev && ev.data && ev.data.tipo === "shell-actualizado") onShellTomado();
  });
  window._ocActSola = { revisar: revisar, intentar: intentar, seguro: seguro, vigilar: vigilar }; // para pruebas
  // Installed iPhone PWAs can stay open: install SW while running, adopt at PIN.
  // One network check per 15 minutes on user activity; no background polling.
  let ultimoUpdateAlVolver = 0;
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden") { intentar(); return; }
    const ahora = Date.now();
    if (ahora - ultimoUpdateAlVolver >= 900000) {
      ultimoUpdateAlVolver = ahora;
      navigator.serviceWorker.getRegistration().then(function (reg) {
        if (reg && typeof reg.update === "function") return reg.update();
      }).catch(function () {});
    }
    revisar();
  });
  // The login gate is switched by auth-ui on logout; adopt immediately on its
  // reappearance instead of waiting for a polling interval or another login.
  try {
    const gate = document.getElementById("oc-gate");
    if (gate && typeof window.MutationObserver === "function") {
      new window.MutationObserver(function () {
        if (enPantallaPIN() && pendiente()) intentar();
      }).observe(gate, { attributes: true, attributeFilter: ["style"] });
    }
  } catch (_) {}
  setInterval(function () { if (pendiente() && enPantallaPIN()) intentar(); }, 15000);
  setInterval(revisar, 600000);
  setTimeout(revisar, 0);
})();

// Microcirugia 5 (2026-07-07): tras importar un respaldo o restaurar un punto
// de la caja fuerte (avanzado-extra dispara "oc-datos-importados"), la UI se
// re-sincroniza sola: ubicaciones, vista activa y select de clientes. Antes
// dependia de que el dueno recargara la pagina a mano.
window.addEventListener("oc-datos-importados", async () => {
  try { await cargarUbicaciones(); } catch (_) {}
  try { refrescarVistaActiva(); } catch (_) {}
  try { poblarSelectClientes(); } catch (_) {}
});

// FIX preventivo 2026-07-07: dos pestañas del mismo negocio abiertas a la vez
// se pisan el estado guardado (la ultima en escribir gana y la otra pierde
// ventas). Se detecta a la segunda pestaña con BroadcastChannel y se le pone
// un candado claro. "Usar aqui" queda para el caso legitimo (pestaña zombie).
// Microcirugia 3 (2026-07-07): CAJA NEGRA. En la tienda no hay DevTools —
// los ultimos 20 errores quedan en localStorage["oc_errores"] para poder
// diagnosticar por WhatsApp ("mandame lo que dice AVANZADO > soporte").
// Aviso discreto una sola vez por sesion; jamas bloquea nada.
(function cajaNegraErrores() {
  let avisado = false;
  let aviso = null;
  function cerrarAviso() { if (aviso) { aviso.remove(); aviso = null; } }
  // Un PIN valido descarta errores visuales de la pantalla anterior.
  window.addEventListener("oc-login", cerrarAviso);
  window.addEventListener("unhandledrejection", (e) => { try { const lista = JSON.parse(localStorage.getItem("f123_errores") || "[]"); lista.push({ fecha: new Date().toISOString(), msg: String((e.reason && e.reason.message) || e.reason).slice(0, 300), src: "promise", linea: 0 }); localStorage.setItem("f123_errores", JSON.stringify(lista.slice(-10))); } catch (_) {} }); // (2026-07-17) promesas rechazadas tambien van a la caja negra
  window.addEventListener("error", (e) => {
    try {
      const lista = JSON.parse(localStorage.getItem("f123_errores") || "[]");
      lista.push({ fecha: new Date().toISOString(), msg: String(e.message || ""), src: String(e.filename || "").split("/").pop() + ":" + (e.lineno || 0) });
      localStorage.setItem("f123_errores", JSON.stringify(lista.slice(-20)));
    } catch (_) {}
    /* CAUSA RAIZ del aviso negro intermitente (Sentry FRIENDLY-123-1, 10 eventos): el navegador emite este
       evento como NOTIFICACION benigna cuando un ResizeObserver cambia el diseno dentro de su propio callback
       (aqui, el ajuste de --riel-top del encabezado). No es una excepcion ni pierde datos; ya se evita
       difiriendo el ajuste a requestAnimationFrame. Se sigue registrando arriba, solo no se muestra el aviso. */
    if (/ResizeObserver loop/i.test(String(e.message || ""))) return;
    if (avisado) return;
    avisado = true;
    try {
      const d = document.createElement("div");
      const es = !!(window.OCI18n && window.OCI18n.getLang && window.OCI18n.getLang() === "es");
      d.setAttribute("role", "status");
      d.setAttribute("id", "f123-error-toast");
      d.style.cssText = "position:fixed;bottom:0;left:0;right:0;z-index:10004;background:#0F1923;border-top:3px solid #E86040;padding:10px 14px;text-align:center;";
      d.innerHTML = '<span style="color:#FFFFFF !important;-webkit-text-fill-color:#FFFFFF !important;font-size:15px;font-weight:700;">' +
        (es ? 'Algo falló en esta pantalla. Si vuelve a ocurrir, avísanos por WhatsApp.' : 'Something failed on this screen. If it happens again, let us know via WhatsApp.') + '</span>' +
        ' <button type="button" data-f123-error-close aria-label="' + (es ? 'Cerrar aviso' : 'Dismiss notice') + '" style="margin-left:10px;min-height:40px;padding:8px 14px;border-radius:6px;border:2px solid #5294AC;background:transparent;color:#FFFFFF !important;-webkit-text-fill-color:#FFFFFF !important;font-size:14px;font-weight:700;cursor:pointer;">' + (es ? 'Cerrar' : 'Close') + '</button>' +
        ' <button type="button" data-f123-error-reload style="margin-left:6px;min-height:40px;padding:8px 14px;border-radius:6px;border:2px solid #5294AC;background:transparent;color:#FFFFFF !important;-webkit-text-fill-color:#FFFFFF !important;font-size:14px;font-weight:700;cursor:pointer;">' + (es ? 'Recargar' : 'Reload') + '</button>';
      (document.body || document.documentElement).appendChild(d);
      aviso = d;
      d.querySelector("[data-f123-error-close]").addEventListener("click", cerrarAviso);
      d.querySelector("[data-f123-error-reload]").addEventListener("click", function () { location.reload(); });
      setTimeout(cerrarAviso, 8000);
    } catch (_) {}
  });
})();

// Microcirugia 7 (2026-07-07): el navegador interno de WhatsApp/Instagram a
// veces bloquea prompt()/confirm() (devuelven null/false al instante, sin
// dialogo). dialogosBloqueados() lo detecta para avisar claro en vez de
// fallar mudo. Heuristica: confirm respondiendo en <15ms = no hubo dialogo
// humano.
// DORMANT parcial (2026-07-15): su único call site (cierre del día) ahora
// usa ocConfirm() propio, que no depende de window.confirm y por tanto no
// puede ser bloqueado por el webview. Se deja la función viva porque
// prompt() (renombrar sucursal/percha) sigue siendo nativo y podría
// usarla si se detecta el mismo problema ahí. NO BORRAR sin revisar esos
// call sites primero.
window.dialogosBloqueados = function () {
  try {
    const t0 = performance.now();
    const r = window.confirm("friendly-123: toca Aceptar para continuar");
    return (performance.now() - t0) < 15 && r === false;
  } catch (_) { return true; }
};

/* GUARDIA DE DOBLE PESTANA — BORRADA DE AQUI (JFC 2026-08-19).
   Habia DOS guardias haciendo lo mismo, cada una con su propio soyPrincipal:
   desbloquear una NO desbloqueaba la otra, y las dos creaban el mismo id
   #oc-doble-tab, asi que el boton "Use here anyway" podia quedar enganchado a
   la copia equivocada. Encima esta escuchaba el canal "amigable-caja-unica",
   el de la app HERMANA: abrir amigable-123 en otra pestana disparaba el
   bloqueo de friendly-123.
   Queda UNA sola, mas arriba en este archivo (guardiaDoblePestana), ahora
   sobre Web Locks. NO volver a agregar una segunda. */
