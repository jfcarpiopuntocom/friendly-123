
/* ETIQUETAS ACCESIBLES (JFC 2026-09-26, axe-core en el Sonar: campos sin etiqueta en Customers,
   Expenses y Advanced). Un placeholder no es una etiqueta para un lector de pantalla. A todo
   input/select/textarea sin <label>, aria-label ni aria-labelledby se le da aria-label desde
   su placeholder, title o el texto visible anterior. Tambien a los que el codigo crea despues
   (MutationObserver con respiro). No cambia nada visible. */
(function () {
  function etiquetar(raiz) {
    try {
      (raiz || document).querySelectorAll("input:not([type=hidden]):not([type=checkbox]):not([type=radio]),select,textarea").forEach(function (el) {
        if (el.getAttribute("aria-label") || el.getAttribute("aria-labelledby")) return;
        if (el.id && document.querySelector('label[for="' + el.id + '"]')) return;
        if (el.closest("label")) return;
        var t = el.getAttribute("placeholder") || el.getAttribute("title") || (el.previousElementSibling && el.previousElementSibling.textContent) || el.name || el.id || "";
        t = String(t).replace(/\s+/g, " ").trim().slice(0, 80);
        if (t) el.setAttribute("aria-label", t);
      });
    } catch (_) {}
  }
  var t = null;
  function pronto() { clearTimeout(t); t = setTimeout(function () { etiquetar(document); }, 250); }
  document.addEventListener("DOMContentLoaded", pronto);
  try { new MutationObserver(pronto).observe(document.documentElement, { childList: true, subtree: true }); } catch (_) {}
})();
