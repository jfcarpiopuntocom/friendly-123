/* copiar-libre.js — LA APP ES UN CUADERNO: todo lo que se ve se puede copiar (JFC 2026-10-01).
   "la app es un cuaderno de apuntes, asegurate de que las UI no impida facil copy/paste de
   cualquier cosa en pantalla".

   Problema real: filas y tarjetas clicables (141 cursor:pointer en index.html) abren un
   detalle al soltar el mouse. Al arrastrar para SELECCIONAR texto dentro de ellas, el
   navegador dispara igual el click y el detalle tapa lo que se iba a copiar.

   Regla (practica estandar de tablas con filas clicables): si al soltar hay texto
   seleccionado DENTRO de lo clicado, ese click era para seleccionar, no para abrir.
   Se frena SOLO ese click, en fase de captura, antes de que llegue a la app.
   Nunca se frena: botones, enlaces, campos, selects, labels, summary ni el teclado del PIN
   (esos son acciones, no texto). Un click normal sin seleccion pasa intacto.
   No toca datos, no bloquea copy/paste/contextmenu en ningun lado. Fail-open: ante
   cualquier error, deja pasar el click. */
(function () {
  "use strict";
  if (window.__copiarLibre) return; window.__copiarLibre = true;
  var ACCION = "button,a[href],input,textarea,select,label,summary,[contenteditable],.pad-key,[role=button]";
  document.addEventListener("click", function (e) {
    try {
      if (e.button !== 0 || e.detail > 1) return; // doble click: gesto propio de la app, pasa intacto
      var t = e.target; if (!t || !t.closest || t.closest(ACCION)) return;
      var s = window.getSelection && window.getSelection();
      if (!s || s.isCollapsed || !String(s).trim()) return;
      var r = s.rangeCount ? s.getRangeAt(0) : null;
      if (!r || !(t.contains(r.commonAncestorContainer) || r.intersectsNode(t))) return;
      e.stopPropagation(); e.preventDefault();
    } catch (_) {}
  }, true);
})();
