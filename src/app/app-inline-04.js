
let _ocModalResolve = null; // rastrea la promise pendiente; permite que un segundo modal cancele el primero
function _ocModalMostrar(mensaje, botonesConfig, opts = {}) {
  return new Promise((resolve) => {
    // Si ya hay un modal abierto, resolver la promise vieja de forma defensiva (false = cancelar)
    if (_ocModalResolve) { _ocModalResolve(false); _ocModalResolve = null; }
    _ocModalResolve = resolve;
    const overlay = document.getElementById("oc-modal-overlay");
    const msgEl = document.getElementById("oc-modal-msg");
    const botonesEl = document.getElementById("oc-modal-botones");
    // Payment choices may span several rows on a phone. Reset on every call
    // so ordinary two-button confirmations keep their existing arrangement.
    botonesEl.style.flexWrap = opts.wrap ? "wrap" : "nowrap";
    msgEl.textContent = mensaje;
    botonesEl.innerHTML = "";
    botonesConfig.forEach(cfg => {
      const b = document.createElement("button");
      b.textContent = cfg.label;
      if (cfg.danger) b.style.cssText = "border-color:var(--rojo,#a3392a);color:var(--rojo-ink,#a3392a);";
      b.addEventListener("click", () => {
        overlay.style.display = "none";
        _ocModalResolve = null;
        resolve(cfg.value);
      });
      botonesEl.appendChild(b);
    });
    overlay.style.display = "flex";
  });
}
// Reemplazo de confirm(): resuelve true (aceptar) / false (cancelar).
/* El rescate desde IndexedDB (mock-backend.js) puede llegar despues de que la
   app ya pinto la primera vista con un estado viejo. Se repinta lo que hay en
   pantalla para que el dueno no vea datos que ya no son. */
window.addEventListener("oc-estado-rescatado", function () {
  /* SE REPINTA LA VISTA QUE SE ESTA MIRANDO (caza de bugs 2026-08-18).
     Antes solo repintaba Inventario, Perchas y Ubicaciones — pero la vista
     donde el encargado esta TODO EL DIA es Hoy, y esa se quedaba con las
     cifras viejas sin decirlo. Un rescate silencioso que deja numeros
     equivocados en pantalla es peor que no rescatar. */
  ["cargarHoy", "cargarInventario", "cargarPerchas", "cargarUbicaciones",
   "cargarClientes", "cargarComisiones"].forEach(function (fn) {
    try { if (typeof window[fn] === "function") window[fn](); } catch (_) {}
  });
  try { if (window.VPerchas && window.VPerchas.cargar) window.VPerchas.cargar(); } catch (_) {}
});
/* Los dos campos del reparto son el mismo numero visto al reves. Se espejan
   mientras se escribe y se recuerda en cual escribio el duenio: ese es el
   idioma de su negocio. Ver el comentario del formulario de perchas. */
let _f123Lectura = 'asociado';
(function () {
  function enganchar() {
    const inAso = document.getElementById('perchaComision');
    const inCasa = document.getElementById('perchaCasa');
    if (!inAso || !inCasa || inAso.dataset.espejo === '1') return;
    inAso.dataset.espejo = '1';
    let espejando = false;
    const limpio = (n) => Math.round(Math.max(0, Math.min(100, n)) * 100) / 100;
    function espejo(origen, destino, lectura) {
      origen.addEventListener('input', () => {
        if (espejando) return;
        const n = Number(origen.value);
        if (origen.value === '') { destino.value = ''; return; }
        if (!Number.isFinite(n)) return;
        espejando = true;
        destino.value = String(limpio(100 - limpio(n)));
        espejando = false;
        _f123Lectura = lectura;
      });
    }
    espejo(inAso, inCasa, 'asociado');
    espejo(inCasa, inAso, 'casa');
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', enganchar);
  else enganchar();
})();
function ocConfirm(mensaje, opts) {
  opts = opts || {};
  return _ocModalMostrar(mensaje, [
    { label: opts.cancelLabel || t("common.cancel"), value: false },
    { label: opts.confirmLabel || t("common.accept"), value: true, danger: !!opts.danger },
  ]);
}
// Reemplazo de alert(): resuelve al cerrar (equivalente a "OK").
function ocAlert(mensaje) {
  return _ocModalMostrar(mensaje, [{ label: t("common.ok"), value: true }]);
}
// Reemplazo de prompt(): muestra un modal con campo de texto. Resuelve con el string
// ingresado (puede ser "") o null si el usuario cancela.
function ocPrompt(mensaje, valorInicial) {
  return new Promise((resolve) => {
    if (_ocModalResolve) { _ocModalResolve(null); _ocModalResolve = null; }
    _ocModalResolve = (v) => resolve(v);
    const overlay = document.getElementById("oc-modal-overlay");
    const msgEl = document.getElementById("oc-modal-msg");
    const botonesEl = document.getElementById("oc-modal-botones");
    msgEl.innerHTML = `<span style="font-weight:700;">${escHtml(mensaje)}</span><br><input id="oc-prompt-input" type="text" maxlength="120" value="${escHtml(valorInicial||'')}" style="margin-top:10px;width:100%;padding:8px 10px;border:2px solid var(--azul-medio,#2c4a68);border-radius:7px;font-size:15px;box-sizing:border-box;">`;
    botonesEl.innerHTML = "";
    const cancel = document.createElement("button");
    cancel.textContent = t("common.cancel");
    cancel.addEventListener("click", () => { overlay.style.display="none"; _ocModalResolve=null; resolve(null); });
    const ok = document.createElement("button");
    ok.textContent = t("common.accept");
    ok.addEventListener("click", () => {
      const v = (document.getElementById("oc-prompt-input").value||"").trim();
      overlay.style.display="none"; _ocModalResolve=null; resolve(v);
    });
    botonesEl.appendChild(cancel);
    botonesEl.appendChild(ok);
    overlay.style.display = "flex";
    setTimeout(() => { const inp = document.getElementById("oc-prompt-input"); if(inp) { inp.focus(); inp.select(); } }, 50);
    const inp = document.getElementById("oc-prompt-input");
    if (inp) inp.addEventListener("keydown", (e) => {
      if (e.key === "Enter") ok.click();
      if (e.key === "Escape") cancel.click();
    });
  });
}
