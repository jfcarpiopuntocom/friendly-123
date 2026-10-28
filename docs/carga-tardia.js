/* carga-tardia.js (v599, perf, JFC 2026-10-27)
 * Carga DESPUES de la primera pantalla los modulos que solo se usan por accion del usuario:
 *   - barcode128.js  (window.OCBarcode: lo lee mock-backend.js al imprimir etiquetas, con guarda)
 *   - qrcode-local.js (window.qrcode: lo lee mock-backend.js al imprimir etiquetas, con guarda)
 *   - tutorial-ui.js (window.OCTutorial: help-ui/welcome-ui lo comprueban antes de usarlo)
 * Antes eran <script defer> en index.html y bloqueaban el arranque en moviles lentos (~74 KB).
 * Se piden en orden (async=false) cuando la pagina termino de cargar y el navegador esta ocioso
 * (>= 2 s tras 'load'). Siguen en el SHELL de sw.js, asi que funcionan sin internet.
 * Para devolver alguno al arranque: ponerle de nuevo su <script defer> en index.html y quitarlo
 * de LISTA. NO agregar aqui nada que escuche 'oc-login' ni DOMContentLoaded al cargar.
 */
(function () {
  "use strict";
  var LISTA = ["./tutorial-ui.js"]; /* v599 revision: barcode128/qrcode volvieron al arranque (etiqueta sin codigo = riesgo). */
  function cargar() {
    for (var i = 0; i < LISTA.length; i++) {
      var s = document.createElement("script");
      s.src = LISTA[i];
      s.async = false; /* respeta el orden de LISTA */
      document.head.appendChild(s);
    }
  }
  function cuandoOcioso() {
    setTimeout(function () {
      try {
        if (window.requestIdleCallback) window.requestIdleCallback(cargar, { timeout: 8000 });
        else cargar();
      } catch (_) { try { cargar(); } catch (__) {} }
    }, 2000);
  }
  if (document.readyState === "complete") cuandoOcioso();
  else window.addEventListener("load", cuandoOcioso, { once: true });
})();
