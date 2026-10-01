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

  /* REPINTADO QUE BORRA LA SELECCION (JFC 2026-10-01, con captura: "no me deja copiar el
     aviso de reloj"). Varias pantallas se repintan solas cada 1-60 s (aviso de reloj y
     linea de Sync cada 3 s, reloj, FAB, cuentas regresivas) asignando textContent aunque
     el texto NO cambio. Asignar textContent reemplaza el nodo de texto y el navegador
     suelta la seleccion: imposible copiar. Arreglo: si el texto nuevo es IDENTICO y el
     elemento solo tiene texto (sin hijos-elemento), no se reasigna. Visualmente es lo
     mismo; solo se conserva la seleccion. Con hijos-elemento o texto distinto, se
     comporta como siempre. innerHTML NO se toca a proposito: reasignarlo recrea nodos
     y el codigo suele volver a colgarles eventos (saltarlo duplicaria handlers). */
  try {
    var d = Object.getOwnPropertyDescriptor(Node.prototype, "textContent");
    if (d && d.set && d.get && d.configurable) {
      Object.defineProperty(Node.prototype, "textContent", {
        configurable: true, enumerable: d.enumerable, get: d.get,
        set: function (v) {
          try {
            if (this.nodeType === 1 && !this.firstElementChild && this.firstChild && this.firstChild === this.lastChild &&
                d.get.call(this) === String(v == null ? "" : v)) return;
          } catch (_) {}
          d.set.call(this, v);
        },
      });
    }
  } catch (_) {}
})();
