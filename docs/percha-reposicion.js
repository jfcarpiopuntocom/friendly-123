/*!
 * percha-reposicion.js — friendly-123 (nuevo, 2026-07-24)
 *
 * "Lista de reposición por percha" (prometida en el manual maestro): al abrir
 * la carpeta de una percha (vista Perchas), debajo de sus productos aparece
 * la orden de compra priorizada: productos en zona de reorden (stock <=
 * umbralAmarillo) cruzados con la matriz BCG — estrella y vaca primero
 * (se venden Y se acaban), luego promesa, luego el resto. Rojo antes que
 * amarillo dentro de cada grupo.
 *
 * VISTA POR ROL (más control según quién mira):
 *   - dueño/admin: cantidad sugerida (hasta umbralAmarillo+1), costo estimado
 *     por línea y total de la orden de compra.
 *   - encargado/encargado: solo qué se está acabando y su prioridad, con el
 *     mensaje "avísale al dueño" — sin costos.
 *
 * CÓMO SE ENGANCHA SIN TOCAR vista-perchas.js: delegación sobre el click de
 * apertura de carpeta ([data-vp-abrir]) + espera corta a que el modal pinte,
 * y se APPENDEA una sección propia (#amg-repo-lista) a #vp-carpeta-body.
 * Si vista-perchas cambia o falta, este módulo no hace nada y no rompe nada.
 *
 * Legibilidad (regla JFC): texto negro puro sobre fondo claro, 17px+ móvil,
 * colores sólidos, cero grises en texto.
 *
 * Feature flag: window.AMG_FLAGS.perchaReposicionEnabled (default true)
 * Rollback: quitar este <script>. Cero dependencia hacia atrás.
 */
(function (global) {
  "use strict";
  global.AMG_FLAGS = global.AMG_FLAGS || {};
  if (typeof global.AMG_FLAGS.perchaReposicionEnabled === "undefined") global.AMG_FLAGS.perchaReposicionEnabled = true;
  if (!global.AMG_FLAGS.perchaReposicionEnabled) return;

  var API = "/api";
  function money(n) {
    const v = Number(n || 0);
    try {
      const loc = (window.OCI18n && window.OCI18n.locale && window.OCI18n.locale()) || "en-US";
      return new Intl.NumberFormat(loc, { style: "currency", currency: "USD" }).format(v);
    } catch (_) { return "$" + v.toFixed(2); }
  }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function esDueno() {
    try { var r = global.OCAuth && global.OCAuth.rolActual ? global.OCAuth.rolActual() : null; return r === "dueno" || r === "dueño" || r === "owner" || r === "admin"; } catch (_) { return false; }
  }
  function logAmg(nivel, msg, data) { try { if (global.AMG && global.AMG.Logger) global.AMG.Logger.log(nivel, "percha-repo", msg, data); } catch (_) {} }

  // Peso BCG por NOMBRE (el endpoint /api/inventario/bcg agrupa por nombre).
  function pesosBcg(bcg) {
    var w = {};
    try {
      (bcg.estrellas || []).forEach(function (i) { w[i.nombre] = 3; });
      (bcg.vacas || []).forEach(function (i) { if (w[i.nombre] === undefined) w[i.nombre] = 2; });
      (bcg.promesas || []).forEach(function (i) { if (w[i.nombre] === undefined) w[i.nombre] = 1; });
      (bcg.pesosMuertos || []).forEach(function (i) { if (w[i.nombre] === undefined) w[i.nombre] = 0; });
    } catch (_) {}
    return w;
  }
  var ETIQUETA_BCG = { 3: "⭐ estrella", 2: "vaca", 1: "promesa", 0: "" };

  function construirLista(prods, bcgPesos) {
    var enReorden = (prods || []).filter(function (p) {
      var uA = Number(p.umbralAmarillo || 0), uR = Number(p.umbralRojo || 0);
      var tope = Math.max(uA, uR);
      return tope > 0 ? p.stockActual <= tope : p.stockActual <= 0;
    });
    enReorden.forEach(function (p) {
      p.__peso = bcgPesos[p.nombre] !== undefined ? bcgPesos[p.nombre] : 0;
      p.__urgente = p.stockActual <= Number(p.umbralRojo || 0);
      var objetivo = Math.max(Number(p.umbralAmarillo || 0), Number(p.umbralRojo || 0)) + 1;
      p.__sugerido = Math.max(1, objetivo - Number(p.stockActual || 0));
    });
    enReorden.sort(function (a, b) {
      if (b.__peso !== a.__peso) return b.__peso - a.__peso;           // estrella/vaca primero
      if (a.__urgente !== b.__urgente) return a.__urgente ? -1 : 1;    // rojo antes que amarillo
      return a.stockActual - b.stockActual;                            // el más agotado primero
    });
    return enReorden;
  }

  function render(perchaId) {
    var body = document.getElementById("vp-carpeta-body");
    if (!body) return;
    var prev = document.getElementById("amg-repo-lista");
    if (prev) prev.remove();
    var cont = document.createElement("div");
    cont.id = "amg-repo-lista";
    // BUG FIJADO (JFC 2026-08-19, caza produccion): textos hardcoded en
    // espanol en app cuyo default es ingles.
    var _es = function(){try{return window.OCI18n&&window.OCI18n.getLang()==="es";}catch(_){return false;}};
    var TL = {
      title:    _es() ? "Lista de reposición" : "Restock list",
      loading:  _es() ? "(cargando…)"          : "(loading…)",
      nothing:  _es() ? "✓ Nothing to restock on this shelf — all stock is above its thresholds."
                     : "✓ Nothing to restock on this shelf — all stock is above its thresholds.",
      urgent:   _es() ? "URGENTE"               : "URGENT",
      soon:     _es() ? "pronto"                : "soon",
      restockV: _es() ? "reponer"               : "restock",
      leftV:    _es() ? "quedan"                : "left",
      cost:     _es() ? "Costo estimado de la orden:"
                     : "Estimated order cost:",
      notify:   _es() ? "Tell the owner to restock what is listed above."
                     : "Let the owner know to restock the items above.",
      priority: _es() ? "Priority: sells fast and runs out (star/cash cow) first; red before yellow."
                     : "Priority: what sells and runs out (star/cash cow) first; red before yellow.",
      failed:   _es() ? "Could not work out the restock: "
                     : "Could not calculate restock: "
    };
    cont.innerHTML = '<p style="font-size:17px;font-weight:700;color:#0F1923;margin:18px 0 8px;">' + TL.title + ' <span style="font-weight:400;font-size:15px;">' + TL.loading + '</span></p>';
    body.appendChild(cont);

    Promise.all([
      // 2026-08-19, aprobado JFC: red-segura envuelve fetch y devuelve una
      // Response 503 en vez de rechazar cuando la red esta caida. Sin este
      // check r.json() sobre una 503 producia {error:...} y el .catch de
      // abajo mostraba "Could not calculate restock: undefined". Ahora se
      // convierte en un throw claro.
      fetch(API + "/productos?ubicacionId=" + encodeURIComponent(perchaId)).then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      }),
      fetch(API + "/inventario/bcg?ubicacionId=" + encodeURIComponent(perchaId)).then(function (r) {
        if (!r.ok) return {};
        return r.json();
      }).catch(function () { return {}; })
    ]).then(function (res) {
      var lista = construirLista(res[0], pesosBcg(res[1] || {}));
      var dueno = esDueno();
      if (!lista.length) {
        cont.innerHTML = '<p style="font-size:17px;font-weight:700;color:#0F1923;margin:18px 0 4px;">' + TL.title + '</p>' +
          '<p style="font-size:16px;color:#0F1923;background:#E7F7EE;border:2px solid #1a6e3c;border-radius:8px;padding:10px 12px;margin:0;">' + TL.nothing + '</p>';
        return;
      }
      var totalCosto = 0;
      var filas = lista.map(function (p) {
        var costoLinea = p.__sugerido * Number(p.costo || 0);
        totalCosto += costoLinea;
        var chip = p.__urgente
          ? '<span style="font-size:13px;font-weight:700;background:#E53935;color:#FFFFFF;padding:3px 9px;border-radius:12px;">' + TL.urgent + '</span>'
          : '<span style="font-size:13px;font-weight:700;background:#FFB300;color:#1e1a12;padding:3px 9px;border-radius:12px;">' + TL.soon + '</span>';
        var bcgTxt = ETIQUETA_BCG[p.__peso] ? '<span style="font-size:13px;font-weight:700;color:#0F1923;">' + ETIQUETA_BCG[p.__peso] + "</span>" : "";
        var derecha = dueno
          ? '<span style="font-size:15px;color:#0F1923;">' + TL.restockV + ' <strong>' + p.__sugerido + "</strong> · " + money(costoLinea) + "</span>"
          : '<span style="font-size:15px;color:#0F1923;">' + TL.leftV + ' <strong>' + p.stockActual + "</strong></span>";
        return '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:8px 0;border-bottom:1px solid #C4CDD8;">' +
          chip + '<strong style="font-size:16px;color:#0F1923;flex:1;min-width:120px;">' + esc(p.nombre) + "</strong>" + bcgTxt + derecha + "</div>";
      }).join("");
      var pie = dueno
        ? '<p style="font-size:16px;font-weight:700;color:#0F1923;margin:10px 0 0;">' + TL.cost + ' ' + money(totalCosto) + "</p>"
        : '<p style="font-size:15px;color:#0F1923;margin:10px 0 0;">' + TL.notify + '</p>';
      cont.innerHTML =
        '<p style="font-size:17px;font-weight:700;color:#0F1923;margin:18px 0 4px;">' + TL.title + '</p>' +
        '<p style="font-size:14px;color:#0F1923;margin:0 0 6px;">' + TL.priority + '</p>' +
        '<div style="background:#F8F9FB;border:2px solid #2E6278;border-radius:10px;padding:6px 12px;">' + filas + pie + "</div>";
      logAmg("INFO", "Lista de reposición pintada", { perchaId: perchaId, items: lista.length });
    }).catch(function (err) {
      cont.innerHTML = '<p style="font-size:15px;color:#a3392a;font-weight:700;">' + TL.failed + esc(err && err.message) + "</p>";
    });
  }

  // Enganche por delegación: mismo click que abre la carpeta en vista-perchas.js.
  document.addEventListener("click", function (e) {
    var abrir = e.target && e.target.closest && e.target.closest("[data-vp-abrir]");
    if (!abrir) return;
    var perchaId = abrir.getAttribute("data-vp-abrir");
    // vista-perchas pinta async: reintentos cortos hasta que el body tenga contenido.
    var intentos = 0;
    (function esperar() {
      var body = document.getElementById("vp-carpeta-body");
      if (body && body.textContent && body.textContent.indexOf("Cargando") === -1) { render(perchaId); return; }
      if (++intentos < 25) setTimeout(esperar, 200);
    })();
  }, false);

  global.AMG = global.AMG || {};
  global.AMG.PerchaReposicion = { VERSION: "1.0.0", render: render };
  if (global.console && global.console.info) global.console.info("[AMG.PerchaReposicion] activo.");
})(typeof window !== "undefined" ? window : this);
