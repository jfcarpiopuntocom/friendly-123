
(function () {
  var lista = ["./edutips.js", "./workshop-brand.js", "./inspector.js", "./inspector-ui.js"]; /* OC-CARGADOR-LISTA */
  if (window.OCCargador && window.OCCargador.cargar) { window.OCCargador.cargar(lista); return; }
  var pendientes = lista.slice(); (function siguiente(){ if (!pendientes.length) return; var s = document.createElement("script"); s.src = pendientes.shift(); s.async = false; s.onload = s.onerror = siguiente; document.head.appendChild(s); })();
})();
