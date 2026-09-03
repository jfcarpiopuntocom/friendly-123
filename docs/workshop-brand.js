/* workshop-brand.js — marca y límites del CAMPO DE PRUEBAS (JFC 2026-09-03).

   MISMO archivo en friendly-123 y en friendly123workshop (cero drift). Es
   NO-OP salvo cuando corre en el origen del workshop, detectado por la URL. Ahí:
     1) El nombre de la tienda queda fijo en "VERSIÓN DE PRUEBAS", NARANJA
        brillante e intocable — para que nadie (ni nosotros) confunda pruebas con
        una tienda real.
     2) Límite racional anti-desastre: se desactiva "unirse a un cuaderno" para
        que un beta helper NO pueda unirse por error a una tienda real por el
        relay compartido. El campo de pruebas se usa con 456 (demo) o 789
        (instancia propia gratis, aislada).
   Aditivo, ligero, sin tocar datos ni el sync. Falla abierto: cualquier error se
   traga en consola y la app sigue igual. */
(function () {
  "use strict";
  try {
    if (!/friendly123workshop/i.test(location.href)) return; // solo en el workshop
  } catch (_) { return; }

  var NARANJA = "#F97316";            // naranja del semáforo (paleta oficial)
  var ETIQUETA = "VERSIÓN DE PRUEBAS";

  function pintarNombre(el) {
    if (!el) return;
    if (el.textContent !== ETIQUETA) el.textContent = ETIQUETA;
    el.style.setProperty("color", NARANJA, "important");
    el.style.setProperty("-webkit-text-fill-color", NARANJA, "important");
    el.style.setProperty("font-weight", "800", "important");
    el.style.setProperty("letter-spacing", ".04em", "important");
  }

  function aplicar() {
    // Header: nombre de tienda fijo + sin lápiz de edición (intocable).
    var h = document.getElementById("oc-negocio-nombre");
    if (h) {
      pintarNombre(h);
      if (!h._wsObs && window.MutationObserver) {
        // Si algo intenta re-pintar el nombre real, lo volvemos a fijar.
        h._wsObs = new MutationObserver(function () { pintarNombre(h); });
        try { h._wsObs.observe(h, { childList: true, characterData: true, subtree: true }); } catch (_) {}
      }
    }
    var edit = document.getElementById("oc-negocio-editar");
    if (edit) edit.style.display = "none";

    // Gate (candado): mismo sello en naranja.
    var g = document.getElementById("oc-gate-negocio");
    if (g) { g.style.display = "block"; g.innerHTML = ""; var s = document.createElement("strong"); s.textContent = ETIQUETA; pintarNombre(s); g.appendChild(s); }

    // Límite racional: nada de unirse a una tienda real desde pruebas.
    var join = document.getElementById("oc-unirse-equipo");
    if (join) join.style.display = "none";
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", aplicar);
  else aplicar();
  // Re-aplica tras render diferidos (el candado y el header se pintan async).
  var n = 0, iv = setInterval(function () { aplicar(); if (++n >= 20) clearInterval(iv); }, 500);
})();
