// soporte-visual.js — Refuerzo del rol SOPORTE (JFC 2026-08-27).
// Cuando JFC entra a una tienda ajena como lord (código maestro), es
// maintenance/support: ve inventario y fotos para verificar integridad, pero
// NO precios/números ni datos de contacto de clientes. El CSS body.rol-soporte
// (en auth-ui.js) oculta los selectores más visibles; este módulo refuerza la
// ocultación en re-renders, porque la app re-renderiza mucho (index.html >1MB).
//
// Principio de aislamiento (igual que micelio): si algo falla aquí, la app
// sigue igual. NUNCA toca datos — solo oculta visualmente. Si el CSS ya ocultó
// un elemento, este módulo no hace nada (no duplica trabajo).
(function () {
  "use strict";
  if (typeof window === "undefined") return;

  // Selectores de precios/números y de contacto de clientes. Se ocultan por
  // display:none cuando el body tiene la clase rol-soporte.
  var PRECIOS = [
    ".ficha-producto .precio", ".etiqueta-card .precio-prod",
    ".etiqueta-imprimible .precio-grande", ".precio", ".total", ".monto",
    "[data-precio]", "[data-monto]", ".precio-prod", ".precio-grande",
  ];
  var CONTACTOS = [
    "#cliTelefono", "#cliEmail", "[data-contacto]", ".cli-tel", ".cli-email",
    ".cliente-tel", ".cliente-email", "[data-telefono]", "[data-email]",
  ];

  function esSoporte() {
    try { return document.body && document.body.classList.contains("rol-soporte"); } catch (_) { return false; }
  }

  function ocultar(sel) {
    try {
      var els = document.querySelectorAll(sel);
      for (var i = 0; i < els.length; i++) {
        var el = els[i];
        if (el && el.style && el.style.display !== "none") el.style.display = "none";
      }
    } catch (_) {}
  }

  function aplicar() {
    if (!esSoporte()) return;
    for (var i = 0; i < PRECIOS.length; i++) ocultar(PRECIOS[i]);
    for (var j = 0; j < CONTACTOS.length; j++) ocultar(CONTACTOS[j]);
  }

  // Re-aplica tras cada render relevante y con un MutationObserver para los
  // re-renders que no disparan evento.
  try {
    window.addEventListener("oc-login", aplicar);
    window.addEventListener("oc-sync-op-remota", aplicar);
    window.addEventListener("oc-catalogo-trozo", aplicar);
    window.addEventListener("oc-micelio-cambio", aplicar);
  } catch (_) {}
  try {
    var obs = new MutationObserver(function () { aplicar(); });
    if (document.body) obs.observe(document.body, { childList: true, subtree: true });
  } catch (_) {}

  // Aplicar al cargar (por si el body ya tiene la clase).
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", aplicar);
  } else {
    aplicar();
  }
})();
