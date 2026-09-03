// borradores.js — friendly-123 · Nada tecleado se pierde, nunca
// ============================================================================
// PEDIDO (JFC 2026-08-17): "queremos persistencia de los ingresos de datos para
// que JAMAS se pierdan por errores o back del navegador o caida de internet o
// dejado a medias por N otras razones".
//
// Antes esto existia en UN solo formulario (editar producto, "Blindaje #15") y
// cada formulario nuevo nacia desprotegido. Aqui se vuelve una regla de la casa:
// se marca el contenedor con data-borrador="una-clave" y ya. Cada tecla se
// guarda; al volver a abrir, se ofrece restaurar.
//
// POR QUE NO COOKIES: se pidio "via cookies", pero una cookie tiene 4 KB para
// TODO el sitio y viaja en cada peticion. Un formulario de producto con foto no
// entra, y llenar la cookie tumbaria las demas. Se usa localStorage, que es el
// mismo almacenamiento del dispositivo, sobrevive igual al back del navegador,
// al cierre de la pestania, a quedarse sin internet y a cerrar el telefono — que
// es lo que de verdad se pidio — con MUCHO mas espacio y sin viajar a ningun
// lado. aislamiento.js le pone el namespace de esta app solo.
//
// QUE NO GUARDA: contrasenias, PINs y archivos. Un PIN no se guarda jamas, y un
// <input type=file> no se puede repoblar por seguridad del navegador.
// ============================================================================
(function () {
  "use strict";

  var PREFIJO = "f123_borrador_";
  var VIDA_MS = 7 * 24 * 3600 * 1000;   // una semana: mas viejo que eso, estorba
  var RETARDO = 300;

  function clave(nombre) { return PREFIJO + nombre; }

  /* Atajo a i18n con reserva. Si i18n.js no cargo, se devuelve el texto en
     ingles en vez de dejar el cartel vacio justo cuando hay que leerlo. */
  function t(k, reserva) {
    try { return (window.OCI18n && window.OCI18n.t) ? (window.OCI18n.t(k) || reserva) : reserva; }
    catch (_) { return reserva; }
  }

  function guardable(el) {
    if (!el || !el.id) return false;
    if (el.disabled) return false;
    var t = (el.type || "").toLowerCase();
    if (t === "password" || t === "file" || t === "hidden" || t === "submit" || t === "button") return false;
    if (el.dataset && el.dataset.noBorrador === "1") return false;
    return true;
  }

  function campos(cont) {
    return Array.prototype.slice.call(cont.querySelectorAll("input,select,textarea")).filter(guardable);
  }

  function capturar(cont) {
    var vals = {};
    campos(cont).forEach(function (el) {
      var t = (el.type || "").toLowerCase();
      vals[el.id] = (t === "checkbox" || t === "radio") ? !!el.checked : el.value;
    });
    return vals;
  }

  /* Restaurar dispara input/change por campo para despertar a quien escuchaba.
     Pero ESTE modulo tambien los escucha, asi que cada restauracion provocaba
     una tormenta de guardados del borrador recien restaurado. La bandera
     `restaurando` corta ese lazo (caza de bugs 2026-08-18). */
  function aplicar(cont, vals) {
    Object.keys(vals || {}).forEach(function (id) {
      var el = cont.querySelector("#" + (window.CSS && CSS.escape ? CSS.escape(id) : id));
      if (!el || !guardable(el)) return;
      var t = (el.type || "").toLowerCase();
      if (t === "checkbox" || t === "radio") el.checked = !!vals[id];
      else el.value = vals[id];
      /* Se avisa a quien escuchaba: hay campos que abren o cierran otros
         (¿expira? -> fecha de caducidad). Restaurar sin esto dejaba el valor
         puesto pero su seccion escondida. */
      try { el.dispatchEvent(new Event("change", { bubbles: true })); } catch (_) {}
      try { el.dispatchEvent(new Event("input", { bubbles: true })); } catch (_) {}
    });
  }

  function guardar(nombre, cont) {
    try {
      var vals = capturar(cont);
      /* Un formulario en blanco no es un borrador. Guardarlo haria salir el
         cartel de "tenias cambios sin guardar" sin que nadie tecleara nada. */
      var algo = Object.keys(vals).some(function (k) {
        var v = vals[k];
        return v === true || (typeof v === "string" && v.trim() !== "" && v !== "0");
      });
      if (!algo) { limpiar(nombre); return; }
      localStorage.setItem(clave(nombre), JSON.stringify({ vals: vals, ts: Date.now() }));
    } catch (_) { /* sin espacio: el formulario sigue funcionando igual */ }
  }

  function leer(nombre) {
    try {
      var o = JSON.parse(localStorage.getItem(clave(nombre)) || "null");
      if (!o || !o.vals) return null;
      if (Date.now() - (o.ts || 0) > VIDA_MS) { limpiar(nombre); return null; }
      return o;
    } catch (_) { return null; }
  }

  function limpiar(nombre) {
    try { localStorage.removeItem(clave(nombre)); } catch (_) {}
  }

  /* Barrido de borradores vencidos. Corre una vez al arrancar: sin esto, un
     formulario abandonado hace meses seguiria ocupando espacio para siempre. */
  function barrer() {
    try {
      var muertos = [];
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (!k || k.indexOf(PREFIJO) !== 0) continue;
        var o = null;
        try { o = JSON.parse(localStorage.getItem(k) || "null"); } catch (_) {}
        if (!o || Date.now() - (o.ts || 0) > VIDA_MS) muertos.push(k);
      }
      muertos.forEach(function (k) { try { localStorage.removeItem(k); } catch (_) {} });
    } catch (_) {}
  }

  /* ------------------------------------------------------------------------
     Engancha un contenedor. Idempotente: llamarlo dos veces sobre el mismo
     formulario no duplica listeners ni carteles.
       opciones.restaurar : false para no ofrecer el borrador previo
       opciones.msgId     : id del elemento donde poner el cartel de restaurar
     ------------------------------------------------------------------------ */
  function enganchar(cont, nombre, opciones) {
    if (!cont || !nombre) return;
    opciones = opciones || {};
    if (cont.dataset.borradorListo === nombre) return;
    cont.dataset.borradorListo = nombre;

    var reloj = null;
    var restaurando = false;   /* ver aplicar(): no re-guardar lo que se acaba de restaurar */
    var alTeclear = function () {
      if (restaurando) return;
      clearTimeout(reloj);
      reloj = setTimeout(function () { guardar(nombre, cont); }, RETARDO);
    };
    cont.addEventListener("input", alTeclear);
    cont.addEventListener("change", alTeclear);
    /* Si el navegador se lleva la pestania por delante (back, cerrar, cambiar
       de app en el telefono), se guarda YA, sin esperar el retardo. Es el caso
       que mas duele y el que mas veces pasa. */
    var alIrse = function () { clearTimeout(reloj); if (cont.isConnected) guardar(nombre, cont); };
    document.addEventListener("visibilitychange", alIrse);
    window.addEventListener("pagehide", alIrse);
    window.addEventListener("beforeunload", alIrse);

    /* FUGA DE OYENTES (caza de bugs 2026-08-18). Los tres de arriba son
       GLOBALES y antes no se soltaban nunca: cada vez que se abria un
       formulario quedaban tres mas escuchando sobre un contenedor ya muerto.
       En una jornada de cien altas eran trescientos oyentes guardando el mismo
       borrador en cada cambio de pestania del telefono.

       No hay un evento de "este nodo se fue", asi que se vigila con
       MutationObserver: en cuanto el contenedor sale del documento, se sueltan
       los tres y el observador se desconecta a si mismo. Si el navegador no
       tiene MutationObserver, se cae a una revision perezosa dentro de los
       propios listeners, que es peor pero no fuga. */
    var soltar = function () {
      try {
        document.removeEventListener("visibilitychange", alIrse);
        window.removeEventListener("pagehide", alIrse);
        window.removeEventListener("beforeunload", alIrse);
        clearTimeout(reloj);
        delete cont.dataset.borradorListo;
      } catch (_) {}
    };
    if (typeof MutationObserver === "function") {
      var vigia = new MutationObserver(function () {
        if (cont.isConnected) return;
        soltar();
        vigia.disconnect();
      });
      /* M1: observar solo el PADRE del contenedor, no el body entero. subtree
         en el body dispara con CADA mutacion del DOM — cientos por segundo en
         una app viva. El contenedor solo puede desaparecer si su padre lo
         quita, asi que ahi es donde hay que mirar. */
      try {
        const objetivo = cont.parentNode || document.body;
        vigia.observe(objetivo, { childList: true });
      } catch (_) {}
    } else {
      var alIrseOriginal = alIrse;
      alIrse = function () { if (!cont.isConnected) { soltar(); return; } alIrseOriginal(); };
    }

    if (opciones.restaurar === false) return;
    var previo = leer(nombre);
    if (!previo) return;
    var msg = opciones.msgId ? cont.querySelector("#" + opciones.msgId) : null;
    if (!msg) {
      msg = document.createElement("div");
      msg.style.cssText = "font-size:14px;margin:10px 0;font-weight:700;";
      cont.insertBefore(msg, cont.firstChild ? cont.firstChild.nextSibling : null);
    }
    var cuando = "";
    try {
      var d = new Date(previo.ts), hoy = new Date();
      var mismoDia = d.toDateString() === hoy.toDateString();
      cuando = mismoDia
        ? t("draft.atTime", "at ") + d.toLocaleTimeString("en", { hour: "2-digit", minute: "2-digit" })
        : t("draft.onDate", "on ") + d.toLocaleDateString("en", { day: "numeric", month: "long" });
    } catch (_) {}
    msg.innerHTML =
      '<span style="color:var(--rust,#E86040);">' + t("draft.unsaved", "You had unsaved data ") + cuando + ".</span> " +
      '<button type="button" data-borrador-si style="font-size:13px;padding:4px 10px;">' + t("draft.restore", "Restore it") + "</button> " +
      '<button type="button" data-borrador-no style="font-size:13px;padding:4px 10px;background:transparent;">' + t("draft.discard", "Start over") + "</button>";
    var si = msg.querySelector("[data-borrador-si]");
    var no = msg.querySelector("[data-borrador-no]");
    if (si) si.addEventListener("click", function () {
      restaurando = true;
      try { aplicar(cont, previo.vals); } finally {
        setTimeout(function () { restaurando = false; }, 0);
      }
      msg.innerHTML = "";
    });
    if (no) no.addEventListener("click", function () { limpiar(nombre); msg.innerHTML = ""; });
  }

  try { barrer(); } catch (_) {}

  window.OCBorradores = {
    enganchar: enganchar,
    guardar: function (n, c) { guardar(n, c); },
    leer: leer,
    limpiar: limpiar,
    aplicar: aplicar,
  };
})();

// ============================================================================
// CATEGORIAS — sistema mixto: se elige de la lista, o se escribe una nueva
// ============================================================================
// PEDIDO (JFC 2026-08-17): "Categoria deberia ser pulldown con opciones, no
// puede ser que uno teclee cualquier cosa, y si NO se elige una de las
// opciones, se puede teclear otra, pero facilitemos con pulldown o sistema
// mixto".
//
// Eso es exactamente un <input list>: despliega opciones al tocarlo y acepta
// cualquier texto. Un <select> puro obligaria a tocar codigo cada vez que a
// alguien le aparece un rubro nuevo.
//
// La lista se arma con DOS fuentes, en este orden:
//   1. Las categorias que el negocio YA usa (las suyas van primero: son las que
//      va a volver a escribir).
//   2. Un arranque razonable, para el que abre la app el primer dia.
//
// BAR Y LICORES SON UNA SOLA COSA (JFC): no existe "Licores" como rubro suelto,
// los licores viven dentro de "Bar".
(function () {
  "use strict";

  // Categorías propias del negocio (JFC 2026-09-01): además de la semilla y las
  // derivadas de productos, el dueño/admin puede AGREGAR categorías desde Sold.
  // Se persisten local (sin nube; el relay sigue zero-knowledge).
  var CUSTOM_KEY = "f123_categorias_custom";
  function _leerCustom() { try { var a = JSON.parse(localStorage.getItem(CUSTOM_KEY) || "[]"); return Array.isArray(a) ? a : []; } catch (_) { return []; } }
  function _guardarCustom(a) { try { localStorage.setItem(CUSTOM_KEY, JSON.stringify(a)); } catch (_) {} }
  /* Tombstones de categorías ocultas (JFC/Belén 2026-09-03): al renombrar una
     categoría SEMILLA los productos se mueven bien, pero la semilla seguía en la
     lista (vacía) → "se aumenta en vez de reemplazar" para las default. Se marca
     oculta; listar() la esconde SOLO si ya no tiene productos (nunca oculta
     inventario real). */
  var OCULTAS_KEY = "f123_categorias_ocultas";
  function _leerOcultas() { try { var a = JSON.parse(localStorage.getItem(OCULTAS_KEY) || "[]"); return Array.isArray(a) ? a : []; } catch (_) { return []; } }
  function _guardarOcultas(a) { try { localStorage.setItem(OCULTAS_KEY, JSON.stringify(a)); } catch (_) {} }

  var SEMILLA = [
    "Bar", "Kitchen", "Soft drinks", "Snacks",
    "Crafts", "Art & prints", "Jewelry",
    "Clothing", "Footwear", "Accessories",
    "Cosmetics & personal care", "Home & decor",
    "Stationery", "Toys", "Electronics",
    "Tools & hardware", "Pets",
    "Tickets & events", "Services",
  ];

  var ID_LISTA = "oc-lista-categorias";

  function normalizar(s) {
    return String(s == null ? "" : s).trim();
  }

  /* Pinta (o repinta) el <datalist> compartido. Idempotente y barato. */
  function refrescar(productos) {
    try {
      var lista = document.getElementById(ID_LISTA);
      if (!lista) {
        lista = document.createElement("datalist");
        lista.id = ID_LISTA;
        document.body.appendChild(lista);
      }
      var vistas = [], set = Object.create(null);
      (productos || []).forEach(function (p) {
        var c = normalizar(p && p.categoria);
        if (!c) return;
        var k = c.toLowerCase();
        if (set[k]) return;
        set[k] = 1; vistas.push(c);
      });
      vistas.sort(function (a, b) { return a.localeCompare(b, "es"); });
      SEMILLA.forEach(function (c) {
        var k = c.toLowerCase();
        if (set[k]) return;
        set[k] = 1; vistas.push(c);
      });
      _leerCustom().forEach(function (c) {
        var cc = normalizar(c); if (!cc) return;
        var k = cc.toLowerCase(); if (set[k]) return;
        set[k] = 1; vistas.push(cc);
      });
      lista.innerHTML = vistas.map(function (c) {
        return '<option value="' + String(c).replace(/"/g, "&quot;") + '"></option>';
      }).join("");
    } catch (_) {}
  }

  /* Convierte un input de categoria en el combo mixto. */
  function enganchar(inp) {
    if (!inp || inp.dataset.ocCat === "1") return;
    inp.dataset.ocCat = "1";
    if (!document.getElementById(ID_LISTA)) refrescar([]);
    inp.setAttribute("list", ID_LISTA);
    inp.setAttribute("autocomplete", "off");
    if (!inp.placeholder || /licores|liquor/i.test(inp.placeholder)) {
      inp.placeholder = t("form.categoryPick", "Pick one or type your own");
    }
  }

  /* Engancha todo input de categoria que haya en pantalla ahora mismo. */
  function engancharTodos(raiz) {
    try {
      (raiz || document).querySelectorAll('[id$="-categoria"]').forEach(enganchar);
    } catch (_) {}
  }

  /* Lista unificada: derivadas de productos + semilla + propias, sin duplicar. */
  function listar(productos) {
    var set = Object.create(null), out = [];
    // Categorías que SÍ tienen productos: esas nunca se ocultan (es inventario real).
    var conProd = Object.create(null);
    (productos || []).forEach(function (p) { var c = normalizar(p && p.categoria); if (c) conProd[c.toLowerCase()] = 1; });
    var ocultas = Object.create(null);
    _leerOcultas().forEach(function (c) { var k = normalizar(c).toLowerCase(); if (k) ocultas[k] = 1; });
    function add(c) {
      var cc = normalizar(c); if (!cc) return; var k = cc.toLowerCase();
      if (set[k]) return;
      if (ocultas[k] && !conProd[k]) return; // oculta y sin productos → no se lista
      set[k] = 1; out.push(cc);
    }
    (productos || []).forEach(function (p) { add(p && p.categoria); });
    SEMILLA.forEach(add);
    _leerCustom().forEach(add);
    return out.sort(function (a, b) { return a.localeCompare(b); });
  }
  /* Agregar categoría propia. Devuelve false si vacía o ya existe. */
  function agregar(nombre) {
    var c = normalizar(nombre); if (!c) return false;
    var cur = _leerCustom();
    if (cur.some(function (x) { return normalizar(x).toLowerCase() === c.toLowerCase(); })) return false;
    // Si estaba oculta (renombrada antes), reaparece al agregarla de nuevo.
    var oc = _leerOcultas().filter(function (x) { return normalizar(x).toLowerCase() !== c.toLowerCase(); });
    _guardarOcultas(oc);
    if (SEMILLA.some(function (x) { return x.toLowerCase() === c.toLowerCase(); })) return true; // ya sugerida
    cur.push(c); _guardarCustom(cur);
    try { if (window.OCLastProductos) refrescar(window.OCLastProductos); } catch (_) {}
    return true;
  }
  /* Renombrar una categoría en TODO el negocio: propaga a los productos que la
     usan (PATCH por producto) y actualiza la lista propia. Async; devuelve el
     número de productos actualizados. */
  async function renombrar(viejo, nuevo) {
    var vo = normalizar(viejo), nu = normalizar(nuevo);
    if (!vo || !nu || vo.toLowerCase() === nu.toLowerCase()) return 0;
    var prods = [];
    try { prods = await (await fetch("/api/productos?todas=1")).json(); } catch (_) { prods = []; }
    var afectados = (prods || []).filter(function (p) { return normalizar(p.categoria).toLowerCase() === vo.toLowerCase(); });
    for (var i = 0; i < afectados.length; i++) {
      /* BUG FIX (JFC/Belén 2026-09-03): era PUT, pero el endpoint de editar
         producto es PATCH (no existe PUT /api/productos/:id). Con PUT los
         productos NO se movían, así que la categoría vieja seguía viva junto a la
         nueva → "se aumenta en vez de reemplazar". PATCH sí mueve la categoría. */
      try { await fetch("/api/productos/" + encodeURIComponent(afectados[i].id), { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ categoria: nu }) }); } catch (_) {}
    }
    // Actualizar la lista propia: quitar el viejo, asegurar el nuevo.
    var cur = _leerCustom().filter(function (x) { return normalizar(x).toLowerCase() !== vo.toLowerCase(); });
    if (!cur.some(function (x) { return normalizar(x).toLowerCase() === nu.toLowerCase(); }) &&
        !SEMILLA.some(function (x) { return x.toLowerCase() === nu.toLowerCase(); })) cur.push(nu);
    _guardarCustom(cur);
    // Ocultar la vieja (cubre las SEMILLA, que no viven en custom). listar() la
    // esconde solo si ya no tiene productos; el nuevo nombre nunca se oculta.
    var oc = _leerOcultas().filter(function (x) { return normalizar(x).toLowerCase() !== nu.toLowerCase(); });
    if (!oc.some(function (x) { return normalizar(x).toLowerCase() === vo.toLowerCase(); })) oc.push(vo);
    _guardarOcultas(oc);
    return afectados.length;
  }

  window.OCCategorias = {
    refrescar: refrescar,
    enganchar: enganchar,
    engancharTodos: engancharTodos,
    listar: listar,
    agregar: agregar,
    renombrar: renombrar,
    semilla: SEMILLA.slice(),
  };
})();
