/* ganchos-demo.js — friendly-123 (JFC 2026-09-24, shell 375)
   ============================================================================
   QUE HACE: en el DEMO (PIN 456) muestra una tarjeta en linea, dentro de la
   pagina, en tres momentos de valor (Today, Inventory, Commissions), con el
   paso siguiente del embudo:
     1) "Start my 30-day full trial"  -> explica que se teclea 7-8-9 en el
        candado y ofrece ir al candado (boton de salir existente).
     2) "See the one-time price"      -> save.html (precio y PayPal).
   REGLAS DURAS que esto respeta (DECISIONES-JFC.md, "Embudo" y "Modales"):
   - NUNCA modal, nunca bloquea, nunca aparece fuera del demo ni en una tienda
     real. "Not now" la oculta 24 h por momento.
   - Nada de la palabra "gratis/free": la prueba con 789 se llama "prueba
     completa de 30 dias" (decision de JFC, shell 343).
   - El texto solo afirma lo que el demo realmente muestra. Variantes elegidas
     con Jev (criterios: especifico, verdadero, calmo, lleva a probarlo).
   - Una tarjeta por vista, maximo. Sin emojis, sin gris, 4 esquinas completas.
   PARA APAGARLO: quitar el <script src="./ganchos-demo.js"> de index.html (y
   del SHELL en sw.js). No toca datos ni el backend.
   ============================================================================ */
(function () {
  "use strict";
  var MOMENTOS = {
    hoy:         { vista: "vista-hoy",        ancla: "heroSemaforo",     donde: "despues" },
    inventario:  { vista: "vista-inventario", ancla: null,               donde: "inicio" },
    comisiones:  { vista: "vista-comisiones", ancla: "listaComisiones",  donde: "final" }
  };
  var PRECIO_URL = "./save.html";
  var OCULTO_MS = 24 * 60 * 60 * 1000;

  function t(k, fb) { try { var v = window.t ? window.t(k) : null; return (v && v !== k) ? v : fb; } catch (_) { return fb; } }
  function esDemo() { try { return !!(window.OCAuth && window.OCAuth.esDemo && window.OCAuth.esDemo()); } catch (_) { return false; } }
  function oculto(m) { try { return Date.now() - Number(localStorage.getItem("f123_gancho_" + m) || 0) < OCULTO_MS; } catch (_) { return false; } }
  function ocultar(m) { try { localStorage.setItem("f123_gancho_" + m, String(Date.now())); } catch (_) {} }

  function tarjeta(m) {
    var el = document.createElement("div");
    el.className = "oc-gancho-demo tag-card";
    el.setAttribute("data-gancho", m);
    el.style.cssText = "text-align:left;margin:14px 0;padding:16px;border:2px solid #2C3E50;border-radius:12px;background:#FFFFFF;";
    var ink = "color:#0F1923 !important;-webkit-text-fill-color:#0F1923 !important;";
    var btn = "display:block;box-sizing:border-box;width:100%;min-height:48px;padding:12px 14px;margin:10px 0 0;border-radius:10px;font-size:16px;font-weight:800;text-align:center;text-decoration:none;cursor:pointer;";
    el.innerHTML =
      '<p style="font-size:16px;font-weight:800;margin:0 0 6px;' + ink + '">' + t("gancho." + m + ".titulo", "") + '</p>' +
      '<p style="font-size:16px;line-height:1.5;margin:0;' + ink + '">' + t("gancho." + m + ".texto", "") + '</p>' +
      '<button type="button" data-gancho-prueba style="' + btn + 'background:#E86040;border:2px solid #C05000;color:#FFFFFF !important;-webkit-text-fill-color:#FFFFFF !important;">' + t("gancho.cta.prueba", "Start my 30-day full trial") + '</button>' +
      '<div data-gancho-pasos hidden style="margin-top:10px;padding:12px;border:2px solid #E86040;border-radius:10px;">' +
        '<p style="font-size:16px;line-height:1.5;margin:0;' + ink + '">' + t("gancho.pasos", "At the lock screen, enter 7-8-9 to activate this device for your own business. The demo stays available with 4-5-6.") + '</p>' +
        '<button type="button" data-gancho-candado style="' + btn + 'background:#0F1923;border:2px solid #0F1923;color:#FFFFFF !important;-webkit-text-fill-color:#FFFFFF !important;">' + t("gancho.cta.candado", "Go to the lock screen") + '</button>' +
      '</div>' +
      '<a href="' + PRECIO_URL + '" data-gancho-precio style="' + btn + 'background:#FFFFFF;border:2px solid #2C3E50;' + ink + '">' + t("gancho.cta.precio", "See the one-time price") + '</a>' +
      '<button type="button" data-gancho-no style="display:block;min-height:44px;margin:8px auto 0;padding:8px 14px;border:none;background:transparent;font-size:14px;font-weight:700;text-decoration:underline;cursor:pointer;' + ink + '">' + t("gancho.cta.no", "Not now") + '</button>';
    el.querySelector("[data-gancho-prueba]").addEventListener("click", function () {
      var p = el.querySelector("[data-gancho-pasos]"); if (p) p.hidden = false;
    });
    el.querySelector("[data-gancho-candado]").addEventListener("click", function () {
      try { var b = document.getElementById("oc-logout"); if (b) b.click(); } catch (_) {}
    });
    el.querySelector("[data-gancho-no]").addEventListener("click", function () { ocultar(m); el.remove(); });
    return el;
  }

  function pintar() {
    try {
      if (!esDemo()) { document.querySelectorAll(".oc-gancho-demo").forEach(function (x) { x.remove(); }); return; }
      Object.keys(MOMENTOS).forEach(function (m) {
        var cfg = MOMENTOS[m];
        var vista = document.getElementById(cfg.vista);
        if (!vista || oculto(m) || vista.querySelector('[data-gancho="' + m + '"]')) return;
        var ancla = cfg.ancla ? document.getElementById(cfg.ancla) : null;
        // Commissions: esperar a que la vista tenga su dinero pintado (el gancho va DESPUES del valor).
        if (m === "comisiones" && (!ancla || !ancla.children.length)) return;
        var card = tarjeta(m);
        if (cfg.donde === "despues" && ancla) ancla.insertAdjacentElement("afterend", card);
        else if (cfg.donde === "final" && ancla) ancla.appendChild(card);
        else vista.insertBefore(card, vista.firstChild);
      });
    } catch (_) {}
  }

  // cargarComisiones() reescribe #listaComisiones entero: se vuelve a pintar al cambiar.
  function observar() {
    try {
      var lista = document.getElementById("listaComisiones");
      if (lista && window.MutationObserver) new MutationObserver(function () { if (!lista.querySelector('[data-gancho="comisiones"]')) pintar(); }).observe(lista, { childList: true });
    } catch (_) {}
  }

  window.addEventListener("oc-login", function () { setTimeout(pintar, 600); });
  window.addEventListener("oc-logout", function () { document.querySelectorAll(".oc-gancho-demo").forEach(function (x) { x.remove(); }); });
  document.addEventListener("click", function (e) {
    try { if (e.target && e.target.closest && e.target.closest("nav button[data-vista]")) setTimeout(pintar, 300); } catch (_) {}
  });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { observar(); setTimeout(pintar, 1500); });
  else { observar(); setTimeout(pintar, 1500); }
  window.OCGanchosDemo = { pintar: pintar };
})();
