(function () {
  var lista = ["./edutips.js", "./workshop-brand.js", "./inspector.js", "./inspector-ui.js"]; /* OC-CARGADOR-LISTA */
  var iniciado = false, listo = false, ultimoDetalle = null;
  function cargarExtras() {
    if (window.OCCargador && window.OCCargador.cargar) { window.OCCargador.cargar(lista); return; }
    var pendientes = lista.slice();
    (function siguiente() {
      if (!pendientes.length) return;
      var s = document.createElement("script");
      s.src = pendientes.shift(); s.async = false;
      s.onload = s.onerror = siguiente;
      document.head.appendChild(s);
    })();
  }
  function sesionActiva() {
    var rol = window.OCAuth && window.OCAuth.rolActual ? window.OCAuth.rolActual() : null;
    var g = document.getElementById("oc-gate");
    return !!(rol && g && g.style && g.style.display === "none");
  }
  function esDemoActivo() {
    if (window.OCAuth && typeof window.OCAuth.esDemo === "function") return !!window.OCAuth.esDemo();
    return !!(document.body && document.body.classList && document.body.classList.contains("rol-demo"));
  }
  function cargarPostPin(detalle) {
    if (detalle) ultimoDetalle = detalle;
    if (listo || iniciado) return;
    iniciado = true;
    var nodos = document.querySelectorAll('script[type="text/plain"][data-post-pin-src]');
    var rutas = [];
    for (var i = 0; i < nodos.length; i++) {
      var r = nodos[i].getAttribute("data-post-pin-src");
      if (r) rutas.push(r);
    }
    function finalizar() {
      listo = true;
      window.__ocPostPinListo = true;
      if (sesionActiva()) {
        var rol = window.OCAuth && window.OCAuth.rolActual ? window.OCAuth.rolActual() : null;
        var det = ultimoDetalle || { rol: rol, demo: esDemoActivo() };
        window.dispatchEvent(new CustomEvent("oc-login", { detail: Object.assign({}, det, { postPinReplay: true }) }));
        if (det.rol === "empleado" || det.rol === "admin") {
          setTimeout(function () {
            var nh = document.querySelector('nav button[data-vista="hoy"]');
            if (nh && !nh.classList.contains("activo")) nh.click();
          }, 0);
        } else if (det.rol === "contador") {
          setTimeout(function () {
            var n = document.querySelector('nav button[data-vista="contable"]');
            if (n) n.click();
          }, 0);
        }
      }
      cargarExtras();
    }
    if (!rutas.length) { finalizar(); return; }
    var restantes = rutas.length;
    for (var j = 0; j < rutas.length; j++) {
      var s = document.createElement("script");
      s.src = rutas[j];
      s.async = false;
      s.onload = s.onerror = function () {
        if (--restantes === 0) finalizar();
      };
      (document.head || document.documentElement || document.body).appendChild(s);
    }
  }
  if (typeof window.addEventListener !== "function") { cargarExtras(); return; }
  window.addEventListener("oc-login", function (ev) {
    if (ev && ev.detail && ev.detail.postPinReplay) return;
    if (!sesionActiva()) return;
    cargarPostPin(ev && ev.detail ? ev.detail : null);
  });
  function revisarInicio() {
    if (sesionActiva() || (window.location && window.location.protocol === "file:")) cargarPostPin(null);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", revisarInicio, { once: true });
  else revisarInicio();
})();
