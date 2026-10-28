
// Item 4 (revision JFC 2026-07-05): capa PWA minima — cachea el shell
// (HTML/JS/CSS/assets propios) para que la app abra sin conexion. Nunca
// intercepta /api/* ni version.json (datos y updates siempre frescos).
// El chequeo de version (Fase 2) vive en auth-ui.js — no duplicarlo aqui.
// Falla en silencio en navegadores sin soporte — nunca bloquea la carga.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => { navigator.serviceWorker.register("./sw.js", { updateViaCache: "none" }).then((reg) => reg && reg.update && reg.update()).catch(() => {}); });
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
  try {
    navigator.serviceWorker.addEventListener("message", function (ev) {
      try {
        if (ev && ev.data && ev.data.tipo === "shell-actualizado") {
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
    /* ANTI-LOOP ROBUSTO (JFC 2026-08-28, sistema de integridad de versión):
       si el deploy está a medias o la red devuelve algo raro, no queremos un
       bucle infinito de recargas. Se guarda la versión ANTES de recargar (ya
       existía) y además un contador con timestamp: si se recarga más de 3
       veces en 30s, se para y se deja la app como está (mejor servir algo que
       recargar sin fin). */
    const KI = "f123_version_intento";
    try {
      const ahora = Date.now();
      const it = JSON.parse(localStorage.getItem(KI) || "null");
      if (it && (ahora - it.ts) < 30000) {
        if (it.n >= 3) { localStorage.setItem(K, v); return; } // tope: no más recargas
        it.n += 1; it.ts = ahora; localStorage.setItem(KI, JSON.stringify(it));
      } else {
        localStorage.setItem(KI, JSON.stringify({ n: 1, ts: ahora }));
      }
    } catch (_) {}
    localStorage.setItem(K, v);
    try { const regs = await navigator.serviceWorker.getRegistrations(); for (const g of regs) { try { await g.update(); } catch (_) {} } } catch (_) {}
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
  /* JFC 2026-09-04: nunca recargar mid-uso. Se difiere SIEMPRE al próximo login
     (invisible). Antes recargaba de golpe fuera del candado y reiniciaba la UI
     del usuario mientras trabajaba. */
  try { sessionStorage.setItem("f123_reload_al_entrar", "1"); } catch (_) {}
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

/* ACTUALIZACION SOLA (v492, DECISION MAYOR DE JFC 2026-10-13: "es detestable hacerles a los
   de friendly-123 tener que reenganchar"). Antes la version nueva se cargaba SOLO al proximo
   login; un cliente con la sesion abierta nunca volvia a escribir su PIN y se quedaba en la
   version vieja hasta reenganchar. Ahora:
   - cada 10 min, al volver a la app y 20 s despues de abrirla se pregunta al servidor que
     version esta publicada y al service worker cual sirve (mensaje "que-shell");
   - si difieren, se baja la nueva y queda pendiente la recarga;
   - la recarga ocurre sola en un MOMENTO SEGURO: app en segundo plano o 90 s sin tocarla,
     sin ventanas abiertas, sin campo con el cursor, sin venta en curso y con la sesion
     abierta (la sesion se conserva: entra solo, sin PIN).
   - anti-bucle: como maximo una recarga automatica por version cada 10 minutos.
   NO BORRAR. Para desactivar: poner _ocActSolaOn = false. */
const _ocActSolaOn = true;
(function actualizacionSola() {
  if (!_ocActSolaOn || !("serviceWorker" in navigator)) return;
  const KA = "f123_autorecarga";
  let ultimoToque = Date.now();
  ["pointerdown", "keydown", "touchstart", "input"].forEach(function (ev) {
    window.addEventListener(ev, function () { ultimoToque = Date.now(); }, { passive: true, capture: true });
  });
  // Bandera PROPIA: solo la pone revisar() tras confirmar con el service worker que sirve otra
  // version. No se usa f123_reload_al_entrar porque el piso de version la marca en cada carga
  // (compara "f123-shell-vN" contra el nombre de cache con -goldenN y nunca coincide).
  const KP = "f123_act_sola_pendiente";
  function pendiente() { try { return sessionStorage.getItem(KP) === "1"; } catch (_) { return false; } }
  // offsetParent es null en elementos position:fixed (los overlays): se mide con getClientRects.
  function visible(el) { try { return !!(el && getComputedStyle(el).display !== "none" && el.getClientRects().length > 0); } catch (_) { return false; } }
  function seguro() { return seguroCon(false); }
  function seguroCon(sinRecuperacion) {
    try {
      if (!sessionStorage.getItem("f123_sesion")) return false;            // sin sesion: lo resuelve el login
      // Never auto-reload while a notebook still needs local IDB recovery or
      // peer history replay. A SW update is not permission to interrupt money.
      // (JFC 2026-10-28) sinRecuperacion solo lo usa el aviso tocado por el usuario (guarda antes de recargar).
      if (!sinRecuperacion && recuperacionPendiente()) return false;
      const gate = document.getElementById("oc-gate");
      if (gate && gate.style.display !== "none") return false;            // tecleando el PIN
      if (visible(document.getElementById("oc-modal-overlay"))) return false;
      if (visible(document.getElementById("oc-comision-overlay"))) return false;
      if (document.getElementById("vi-cliente")) return false;            // panel de venta abierto
      if ([...document.querySelectorAll(".oc-vs-editor")].some(function (e) { return e.style.display === "block"; })) return false;
      if ([...document.querySelectorAll('[role="dialog"]')].some(visible)) return false;
      const a = document.activeElement;
      if (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) return false;
      if (typeof _ventasEnCurso !== "undefined" && _ventasEnCurso.size) return false;
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
  /* (JFC 2026-10-28) Recarga frenada por recuperacion Yjs/IDB: se anota desde cuando (sessionStorage
     "f123_update_frenada_desde", no se sobrescribe) y se registra UNA vez "frenada-recuperacion" en la
     bitacora. Nunca recarga. (JFC 2026-10-28) sin plazo: aviso inmediato; ver Workbox
     handling-service-worker-updates. Solo recarga si el usuario toca el aviso. */
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
  // Only a user click can upgrade an open notebook. Idle/hidden is NOT consent.
  function intentar() {
    try { vigilar(); } catch (_) {}
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
    try {
      const r = await fetch("./version.json?ts=" + Date.now(), { cache: "no-store" });
      if (!r.ok) return;
      const vj = await r.json();
      if (!vj || !vj.shell) return;
      const sirve = await shellDelSW();
      if (!sirve || sirve === String(vj.shell)) return;
      try { localStorage.setItem("f123_version_vista", String(vj.version || "") + "|" + String(vj.shell)); } catch (_) {}
      try {
        const reg = await navigator.serviceWorker.getRegistration();
        if (reg) { await reg.update(); if (reg.waiting) reg.waiting.postMessage({ tipo: "skip-waiting" }); }
      } catch (_) {}
      _recargarSeguroVersion();
      try { sessionStorage.setItem(KP, "1"); } catch (_) {}
      intentar();
    } catch (_) {}
  }
  /* (JFC 2026-10-28) AVISO apenas la recarga se frena por recuperacion (sin plazo). Una tira fija abajo (boton), sin
     fondo oscuro ni opacidad ni rgba; estilos inline con !important (sin tocar CSS). z-index 9990:
     por debajo del PIN gate (#oc-gate = 9999). Tocarlo GUARDA y luego recarga; nunca recarga a la fuerza. */
  const ID_AVISO = "f123-aviso-version";
  function textoAviso(clave) {
    let es = true;
    try { if (window.OCI18n && window.OCI18n.getLang) es = window.OCI18n.getLang() === "es"; } catch (_) {}
    const T = {
      listo: ["Hay una versión nueva de la app. Toca para guardar y actualizar.", "A new version is ready. Tap to save and update."],
      ocupado: ["Termina lo que estás haciendo y vuelve a tocar.", "Finish what you're doing and tap again."],
      guardando: ["Aún guardando. Intenta en un momento.", "Still saving. Try again in a moment."]
    };
    return T[clave][es ? 0 : 1];
  }
  function quitarAviso() { try { const a = document.getElementById(ID_AVISO); if (a && a.remove) a.remove(); } catch (_) {} }
  // Guardado duradero REAL: OCSync.confirmarCatalogoDurable (mock-backend.js) espera ventas/pagos en
  // curso y hace guardarEstadoLocal(true,true) (snapshot completo exigido en localStorage/IDB);
  // devuelve true SOLO si quedo escrito. Aqui: tope de 5 s y solo === true cuenta como exito.
  function guardarDuradero() {
    return new Promise(function (resolve) {
      let fin = false;
      const t = setTimeout(function () { if (!fin) { fin = true; resolve(false); } }, 5000);
      function listo(ok) { if (fin) return; fin = true; clearTimeout(t); resolve(ok === true); }
      try {
        const s = window.OCSync;
        if (!s || typeof s.confirmarCatalogoDurable !== "function") return listo(false);
        Promise.resolve(s.confirmarCatalogoDurable()).then(listo, function () { listo(false); });
      } catch (_) { listo(false); }
    });
  }
  let _avisoOcupado = false;
  async function alTocarAviso() {
    const el = document.getElementById(ID_AVISO);
    if (!el || _avisoOcupado) return;
    _avisoOcupado = true;
    try {
      if (!seguroCon(false)) { el.textContent = textoAviso("ocupado"); return; }
      const ok = await guardarDuradero();
      // Se revisa de nuevo: durante el guardado pudo abrirse una venta o editor.
      if (!ok || !seguroCon(false)) { el.textContent = textoAviso(ok ? "ocupado" : "guardando"); return; }
      try {
        sessionStorage.removeItem(KP);
        sessionStorage.removeItem("f123_reload_al_entrar");
        sessionStorage.removeItem(KF);
      } catch (_) {}
      try { marcarRecarga("aviso-usuario"); } catch (_) {}
      location.reload();
    } finally { _avisoOcupado = false; }
  }
  function mostrarAviso() {
    try {
      if (document.getElementById(ID_AVISO)) return;
      const b = document.createElement("button");
      b.id = ID_AVISO;
      b.type = "button";
      b.setAttribute("role", "status");
      b.setAttribute("aria-live", "polite");
      b.textContent = textoAviso("listo");
      const est = {
        position: "fixed", left: "0", right: "0", bottom: "0", width: "100%", "box-sizing": "border-box",
        "z-index": "9990", "min-height": "48px", padding: "12px 16px", border: "0", margin: "0",
        "background-color": "#E86040", color: "#FFFFFF", "-webkit-text-fill-color": "#FFFFFF",
        "font-size": "16px", "font-weight": "700", "line-height": "1.3", "text-align": "center",
        cursor: "pointer", "border-radius": "0", animation: "none", transition: "none"
      };
      Object.keys(est).forEach(function (k) { b.style.setProperty(k, est[k], "important"); });
      b.addEventListener("click", alTocarAviso);
      document.body.appendChild(b);
    } catch (_) {}
  }
  // (JFC 2026-10-28) sin plazo: aviso inmediato; ver Workbox handling-service-worker-updates.
  // Se llama donde se frena la recarga (intentar) y donde se marca el pendiente (revisar, onShellTomado);
  // el setInterval de 60 s solo sirve para QUITAR el aviso al terminar la recuperacion, no retrasa mostrarlo.
  function vigilar() {
    try {
      if (!pendiente()) { limpiarFrenada(); quitarAviso(); return; }
      if (recuperacionPendiente()) marcarFrenada();
      else limpiarFrenada();
      mostrarAviso();
    } catch (_) {}
  }
  // E2: a takeover can already match version.json while this document is stale.
  var ultimoControladorSW = navigator.serviceWorker.controller;
  function onShellTomado() {
    var actual = navigator.serviceWorker.controller;
    if (!ultimoControladorSW) { ultimoControladorSW = actual; return; }
    if (!actual || actual === ultimoControladorSW) return;
    ultimoControladorSW = actual;
    try { sessionStorage.setItem(KP, "1"); } catch (_) {}
    _recargarSeguroVersion();
    vigilar();
    if (document.visibilityState === "hidden" || Date.now() - ultimoToque > 90000) intentar();
  }
  navigator.serviceWorker.addEventListener("controllerchange", onShellTomado);
  navigator.serviceWorker.addEventListener("message", function (ev) {
    if (ev && ev.data && ev.data.tipo === "shell-actualizado") onShellTomado();
  });
  window._ocActSola = { revisar: revisar, intentar: intentar, seguro: seguro, vigilar: vigilar }; // para pruebas
  // Installed iPhone PWAs can stay open: check the SW on return, not just load.
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
  setInterval(function () { if (Date.now() - ultimoToque > 90000) intentar(); }, 15000);
  setInterval(revisar, 600000);
  setInterval(vigilar, 60000); // (JFC 2026-10-28) unico re-chequeo: solo quita el aviso tras la recuperacion
  setTimeout(revisar, 20000);
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
