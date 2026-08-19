/*!
 * simon-config.js — friendly-123 (nuevo, 2026-07-24)
 *
 * EL SISTEMA DE COLORES COMO HERRAMIENTA, NO COMO IMPOSICIÓN.
 * Un cuadro de galería rota cada 6 meses; una funda de café, cada semana.
 * El "negro/dormido" a 30 días globales castiga injustamente a la galería.
 * Este módulo permite al DUEÑO fijar, POR PRODUCTO y POR PERCHA (default
 * para sus productos), los tiempos del semáforo:
 *   - diasDormido: días sin venta antes de marcar NEGRO (dormido)
 *   - vencRojo / vencNaranja: días antes de caducar para ROJO / NARANJA
 * Precedencia: producto > percha > global de la app (sin override = todo
 * sigue EXACTAMENTE igual que hoy).
 *
 * MOTOR (aditivo, sin tocar mock-backend.js): mock-backend parchea
 * window.fetch para servir /api/*. Este módulo, cargado DESPUÉS (bloque AMG
 * al final del body), envuelve ESE fetch: intercepta solo las respuestas GET
 * de /api/productos y, para productos con override aplicable, recalcula el
 * estado con las MISMAS reglas de estadoDe() de mock-backend (verificadas
 * línea a línea, no inventadas):
 *   - dormido: el mensaje original "Sin ventas hace N días" trae la N real;
 *     si N < diasDormido efectivo, el producto deja de ser negro y cae a la
 *     regla de margen (amarillo si margen>=50%, azul si <25%, verde normal).
 *   - vencimiento: se recalcula con fechaCaducidad y los umbrales override.
 * Todo dentro de try/catch: cualquier fallo devuelve la respuesta original
 * intacta. Quitar este archivo = comportamiento de fábrica.
 *
 * UI (solo dueño):
 *   - En el modal de EDICIÓN de producto: bajo los umbrales de stock ya
 *     existentes (#ed-umbral-amarillo), aparecen los 3 campos de tiempo con
 *     AUTOGUARDADO al cambiar (no depende del botón Guardar del modal).
 *   - En el modal de gestión de percha (#vp-g-nombre): campo "días para
 *     dormido" default de la percha, también con autoguardado.
 * Inyección por MutationObserver: si esos modales cambian de estructura en
 * el futuro, este módulo simplemente no inyecta nada y no rompe nada.
 *
 * Storage: localStorage "oc_simon_overrides_v1"
 *   { productos: { [id]: {diasDormido?, vencRojo?, vencNaranja?} },
 *     perchas:   { [id]: {diasDormido?} } }
 * (Entra en el respaldo completo automáticamente NO — es config local del
 * dispositivo; si quieres que viaje en el respaldo, pedirlo como fase.)
 *
 * Feature flag: window.AMG_FLAGS.simonConfigEnabled (default true)
 */
(function (global) {
  "use strict";
  global.AMG_FLAGS = global.AMG_FLAGS || {};
  if (typeof global.AMG_FLAGS.simonConfigEnabled === "undefined") global.AMG_FLAGS.simonConfigEnabled = true;
  if (!global.AMG_FLAGS.simonConfigEnabled) return;

  var LS_KEY = "oc_simon_overrides_v1";
  function leer() {
    try { var o = JSON.parse(global.localStorage.getItem(LS_KEY) || "null"); return (o && typeof o === "object") ? o : { productos: {}, perchas: {} }; }
    catch (_) { return { productos: {}, perchas: {} }; }
  }
  function guardar(o) { try { global.localStorage.setItem(LS_KEY, JSON.stringify(o)); return true; } catch (_) { return false; } }
  function esDueno() {
    try { var r = global.OCAuth && global.OCAuth.rolActual ? global.OCAuth.rolActual() : null; return r === "dueno" || r === "dueño" || r === "owner"; } catch (_) { return false; }
  }
  function logAmg(nivel, msg, data) { try { if (global.AMG && global.AMG.Logger) global.AMG.Logger.log(nivel, "simon-config", msg, data); } catch (_) {} }

  // ---------- MOTOR: recalcular estado con overrides ----------
  function diasParaVencer(fecha) {
    if (!fecha) return null;
    var d = Math.floor((new Date(fecha + "T23:59:59").getTime() - Date.now()) / 864e5);
    return isNaN(d) ? null : d;
  }
  var ORDEN = { rojo: 0, naranja: 1, negro: 2, amarillo: 3, azul: 4, verde: 5 }; // misma severidad relativa que mock-backend

  function overrideDe(p, ov) {
    var porProd = (ov.productos || {})[p.id] || {};
    var porPercha = (ov.perchas || {})[p.ubicacionId] || {};
    var out = {
      diasDormido: porProd.diasDormido != null ? porProd.diasDormido : porPercha.diasDormido,
      vencRojo: porProd.vencRojo,
      vencNaranja: porProd.vencNaranja
    };
    return (out.diasDormido != null || out.vencRojo != null || out.vencNaranja != null) ? out : null;
  }

  function recalc(p, ov) {
    var o = overrideDe(p, ov);
    if (!o) return p;
    try {
      var margen = p.precio > 0 ? (p.precio - (p.costo || 0)) / p.precio : 0;
      var cambiado = false;

      // 1) DORMIDO/NEGRO: solo si hoy está negro y el mensaje trae los días reales.
      if (o.diasDormido != null && p.estado === "negro") {
        /* BUG (JFC 2026-08-19): esto leia los dias sin venta parseando el
           TEXTO del mensaje con /hace\s+(\d+)\s+d/i. En friendly-123 el
           mensaje sale en ingles ("No sales in 47 days — ..."), asi que la
           regex no hacia match NUNCA, sinVenta quedaba null y el override de
           "dias dormido" por producto no hacia absolutamente nada. El dueno
           configuraba 180 dias para su galeria y no pasaba nada.

           Ahora se calcula del campo estructurado dormidoDesde, que ficha()
           expone. La regex queda de respaldo y acepta los dos idiomas, para
           un payload viejo cacheado que todavia no traiga el campo. */
        var sinVenta = null;
        if (p.dormidoDesde) {
          var t0 = new Date(p.dormidoDesde + "T00:00:00").getTime();
          if (isFinite(t0)) sinVenta = Math.floor((Date.now() - t0) / 86400000);
        }
        if (sinVenta == null) {
          var m = /(?:hace|in)\s+(\d+)\s+(?:d|day)/i.exec(p.mensaje || "");
          sinVenta = m ? Number(m[1]) : null;
        }
        if (sinVenta != null && sinVenta < Number(o.diasDormido)) {
          // Mismas reglas de estadoDe() para el caso no-dormido con stock sano:
          if (margen >= 0.5) { p.estado = "amarillo"; p.nivelBloom = margen >= 0.7 ? 3 : margen >= 0.55 ? 2 : 1; p.mensaje = "Good margin — there is money waiting for you"; }
          else if (margen > 0 && margen < 0.25) { p.estado = "azul"; p.nivelBloom = margen <= 0.1 ? 3 : margen <= 0.18 ? 2 : 1; p.mensaje = "Margin " + (margen * 100).toFixed(0) + "% — check the price or the cost"; }
          else { p.estado = "verde"; p.nivelBloom = p.stockActual >= 15 ? 3 : p.stockActual >= 7 ? 2 : 1; p.mensaje = "Healthy stock"; }
          p.__simonOverride = "dormido:" + o.diasDormido;
          cambiado = true;
        } else if (sinVenta != null) {
          p.nivelBloom = sinVenta >= Number(o.diasDormido) * 4 ? 3 : sinVenta >= Number(o.diasDormido) * 2 ? 2 : 1;
          p.__simonOverride = "dormido:" + o.diasDormido;
          cambiado = true;
        }
      }

      // 2) VENCIMIENTO con umbrales propios (solo perecibles con fecha).
      if ((o.vencRojo != null || o.vencNaranja != null) && p.perecible && p.fechaCaducidad) {
        var dias = p.diasParaVencer != null ? p.diasParaVencer : diasParaVencer(p.fechaCaducidad);
        var vR = o.vencRojo != null ? Number(o.vencRojo) : 3;
        var vN = o.vencNaranja != null ? Number(o.vencNaranja) : 7;
        var porVenc = null;
        if (dias != null) {
          if (dias < 0) porVenc = { estado: "rojo", nivel: 3, mensaje: "Expired " + Math.abs(dias) + " day" + (Math.abs(dias) === 1 ? "" : "s") + " ago — pull it" };
          else if (dias <= vR) porVenc = { estado: "rojo", nivel: dias <= 1 ? 3 : 2, mensaje: "Expires in " + dias + " day" + (dias === 1 ? "" : "s") + " — sell it now" };
          else if (dias <= vN) porVenc = { estado: "naranja", nivel: dias <= Math.ceil(vN * 0.7) ? 2 : 1, mensaje: "Expires in " + dias + " days — sell it first" };
        }
        if (porVenc && ORDEN[porVenc.estado] <= ORDEN[p.estado]) {
          p.estado = porVenc.estado; p.nivelBloom = porVenc.nivel; p.mensaje = porVenc.mensaje;
          p.__simonOverride = (p.__simonOverride ? p.__simonOverride + " " : "") + "venc:" + vR + "/" + vN;
          cambiado = true;
        /* Mismo bug que arriba: se detectaba "lo marco el global por
           vencimiento" buscando las palabras "vence|vencio" en el mensaje, que
           en ingles no aparecen. Ahora se usa el dato: el producto es
           perecible y trae dias para vencer. */
        } else if (porVenc === null && (p.estado === "rojo" || p.estado === "naranja") && p.perecible && p.diasParaVencer != null) {
          // El global lo marcó por vencimiento pero con TUS umbrales aún falta:
          if (margen >= 0.5) { p.estado = "amarillo"; p.nivelBloom = 1; p.mensaje = "Good margin — there is money waiting for you"; }
          else { p.estado = "verde"; p.nivelBloom = p.stockActual >= 15 ? 3 : p.stockActual >= 7 ? 2 : 1; p.mensaje = "Healthy stock"; }
          p.__simonOverride = (p.__simonOverride ? p.__simonOverride + " " : "") + "venc:" + vR + "/" + vN;
          cambiado = true;
        }
      }
      if (cambiado) logAmg("DEBUG", "Estado recalculado", { id: p.id, nombre: p.nombre, estado: p.estado });
    } catch (_) { /* ante cualquier duda, dejar el producto tal cual */ }
    return p;
  }

  // Envolver el fetch YA parcheado por mock-backend (este script carga después).
  var fetchBase = global.fetch;
  global.fetch = function (input, opts) {
    var url = typeof input === "string" ? input : (input && input.url) || "";
    var esProductos = url.indexOf("/api/productos") !== -1 && (!opts || !opts.method || opts.method === "GET");
    var res = fetchBase.apply(this, arguments);
    if (!esProductos) return res;
    return res.then(function (r) {
      try {
        var ov = leer();
        var hayOv = Object.keys(ov.productos || {}).length || Object.keys(ov.perchas || {}).length;
        if (!hayOv || !r || !r.ok) return r;
        return r.clone().json().then(function (data) {
          if (!Array.isArray(data)) return r;
          var out = data.map(function (p) { return recalc(p, ov); });
          return new Response(JSON.stringify(out), { status: 200, headers: { "Content-Type": "application/json" } });
        }).catch(function () { return r; });
      } catch (_) { return r; }
    });
  };

  // ---------- UI: inyección en modales existentes (solo dueño) ----------
  function campo(id, etiqueta, valor, placeholder) {
    return '<label style="display:block;font-size:15px;font-weight:700;color:#0F1923;margin:10px 0 0;">' + etiqueta +
      '<input id="' + id + '" type="number" min="0" step="1" value="' + (valor != null ? valor : "") + '" placeholder="' + placeholder + '" ' +
      'style="display:block;width:100%;margin-top:4px;padding:9px 10px;border:2px solid #2E6278;border-radius:7px;font-size:16px;box-sizing:border-box;background:#FFFFFF;color:#0F1923;"></label>';
  }

  function inyectarEnEdicionProducto() {
    var ancla = document.getElementById("ed-umbral-amarillo");
    if (!ancla || document.getElementById("amg-simon-prod") || !esDueno()) return;
    // id del producto: el modal de edición se abre con el producto activo;
    // lo tomamos del input oculto/dataset si existe, o del último abierto.
    var prodId = (global.__amgUltimaFicha || null);
    var cont = document.createElement("div");
    cont.id = "amg-simon-prod";
    var ov = leer();
    var cur = prodId ? (ov.productos[prodId] || {}) : {};
    cont.innerHTML =
      '<p style="font-size:16px;font-weight:700;color:#0F1923;margin:16px 0 0;border-top:2px solid #C4CDD8;padding-top:12px;">Colors your way (this product)</p>' +
      '<p style="font-size:14px;color:#0F1923;margin:2px 0 0;">Blank = use the app default. Saves as soon as you change it.</p>' +
      campo("amg-sc-dormido", "Days with no sale before marking it BLACK (dormant)", cur.diasDormido, "e.g. 180 for a gallery") +
      campo("amg-sc-vrojo", "Days before expiry to turn RED", cur.vencRojo, "default: 3") +
      campo("amg-sc-vnaranja", "Days before expiry to turn ORANGE", cur.vencNaranja, "default: 7");
    var celda = ancla.closest("label") || ancla.parentElement;
    (celda.parentElement || celda).appendChild(cont);
    ["amg-sc-dormido", "amg-sc-vrojo", "amg-sc-vnaranja"].forEach(function (id, i) {
      var el = document.getElementById(id);
      el.addEventListener("change", function () {
        if (!prodId) { logAmg("WARN", "Sin id de producto para guardar override"); return; }
        var o = leer(); o.productos[prodId] = o.productos[prodId] || {};
        var keys = ["diasDormido", "vencRojo", "vencNaranja"];
        var v = el.value === "" ? null : Math.max(0, parseInt(el.value, 10) || 0);
        if (v === null) delete o.productos[prodId][keys[i]]; else o.productos[prodId][keys[i]] = v;
        if (!Object.keys(o.productos[prodId]).length) delete o.productos[prodId];
        guardar(o);
        logAmg("AUDIT", "Override de color guardado", { productoId: prodId, campo: keys[i], valor: v, audit: true });
      });
    });
  }

  function inyectarEnGestionPercha() {
    var ancla = document.getElementById("vp-g-nombre");
    if (!ancla || document.getElementById("amg-simon-percha") || !esDueno()) return;
    var perchaId = global.__amgPerchaGestion || null;
    var ov = leer();
    var cur = perchaId ? (ov.perchas[perchaId] || {}) : {};
    var cont = document.createElement("div");
    cont.id = "amg-simon-percha";
    cont.innerHTML =
      '<p style="font-size:15px;font-weight:700;color:#0F1923;margin:14px 0 0;">Días para "dormido" en esta percha (default de sus productos)</p>' +
      '<p style="font-size:14px;color:#0F1923;margin:2px 0 8px;">Déjalo vacío para usar el número de días estándar de la app.</p>' +
      campo("amg-sc-percha-dormido", "", cur.diasDormido, "e.g. 180 for a gallery");
    ancla.closest("label").insertAdjacentElement("afterend", cont);
    document.getElementById("amg-sc-percha-dormido").addEventListener("change", function (e) {
      if (!perchaId) return;
      var o = leer(); o.perchas[perchaId] = o.perchas[perchaId] || {};
      var v = e.target.value === "" ? null : Math.max(0, parseInt(e.target.value, 10) || 0);
      if (v === null) delete o.perchas[perchaId].diasDormido; else o.perchas[perchaId].diasDormido = v;
      if (!Object.keys(o.perchas[perchaId]).length) delete o.perchas[perchaId];
      guardar(o);
      logAmg("AUDIT", "Override de percha guardado", { perchaId: perchaId, diasDormido: v, audit: true });
    });
  }

  // Capturar qué producto/percha está abierto (delegación, sin tocar nada):
  document.addEventListener("click", function (e) {
    var ed = e.target && e.target.closest && e.target.closest("[data-vp-edit],[data-vp-prod]");
    if (ed) global.__amgUltimaFicha = ed.getAttribute("data-vp-edit") || ed.getAttribute("data-vp-prod");
    var ren = e.target && e.target.closest && e.target.closest("[data-vp-rename]");
    if (ren) global.__amgPerchaGestion = ren.getAttribute("data-vp-rename");
    // Edición desde inventario: los botones llaman funciones globales con el id;
    // ui-actions ya emite producto_edicion — escuchamos el bus también:
  }, true);
  try {
    if (global.AMG && global.AMG.EventBus) {
      global.AMG.EventBus.on("producto_edicion:iniciado", function (evt) {
        if (evt.payload && evt.payload.productoId) global.__amgUltimaFicha = evt.payload.productoId;
      });
    }
  } catch (_) {}

  // Observador de DOM: inyecta cuando los modales pintan sus campos.
  try {
    new MutationObserver(function () { inyectarEnEdicionProducto(); inyectarEnGestionPercha(); })
      .observe(document.documentElement, { childList: true, subtree: true });
  } catch (_) {}

  global.AMG = global.AMG || {};
  global.AMG.SimonConfig = {
    VERSION: "1.0.0",
    leer: leer,
    fijarProducto: function (id, campos) { var o = leer(); o.productos[id] = Object.assign(o.productos[id] || {}, campos); guardar(o); },
    fijarPercha: function (id, campos) { var o = leer(); o.perchas[id] = Object.assign(o.perchas[id] || {}, campos); guardar(o); },
    limpiar: function () { guardar({ productos: {}, perchas: {} }); }
  };
  if (global.console && global.console.info) global.console.info("[AMG.SimonConfig] activo — colores configurables por producto y percha.");
})(typeof window !== "undefined" ? window : this);
