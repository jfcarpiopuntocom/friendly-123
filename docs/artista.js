/*
 * artista.js — friendly-123 · Vista del artista / comisionista (benchmark #6)
 * JFC 2026-09-24. Plan: PLAN-ARTISTA-CARGA-SU-PERCHA-2026-09-24.md
 *
 * QUE HACE: cuando alguien entra con un PIN de artista (auth-ui.js pone
 * body.rol-artista y window.OCCurrentArtista), esta vista TAPA la app entera y
 * muestra solo tres cosas: sus piezas con cantidad, "Add a piece" (nombre,
 * foto, precio, cantidad) y la etiqueta de cada pieza suya.
 *
 * DECISIONES DE JFC (no cambiar sin orden): el artista SOLO agrega piezas; no
 * edita ni borra despues (eso lo hace el dueno o un admin). No ve ventas,
 * plata ni clientes: lo vendido le llega por el estado de cuenta (v393).
 * Imprime etiquetas SOLO de sus piezas.
 *
 * SEGURIDAD: esta pantalla NO es la frontera. La frontera es la compuerta
 * deny-by-default de mock-backend.js (rol "artista"): aunque alguien quite este
 * overlay desde DevTools, cualquier ruta fuera de la lista blanca da 403.
 * test/artista-permisos.test.js fija esas reglas.
 *
 * Todo texto visible pasa por window.t (i18n.js, EN + ES) y se pinta con
 * textContent (nunca innerHTML con datos). Sin emojis, sin gris, >= 13 px.
 */
(function () {
  "use strict";
  var API = "/api";
  var raiz = null;

  function t(k, fb) { try { var v = window.t ? window.t(k) : ""; return (v && v !== k) ? v : fb; } catch (_) { return fb; } }
  function dinero(n) { try { return window.fmtMoney ? window.fmtMoney(n) : "$" + (Number(n) || 0).toFixed(2); } catch (_) { return "$" + (Number(n) || 0).toFixed(2); } }
  function el(tag, css, texto) { var e = document.createElement(tag); if (css) e.style.cssText = css; if (texto != null) e.textContent = texto; return e; }

  // Codigo interno de la pieza: el artista no inventa codigos de barra. Base36
  // del reloj + azar: unico en la practica y corto para la etiqueta.
  function codigoNuevo() {
    return "ART-" + Date.now().toString(36).toUpperCase().slice(-5) + Math.floor(Math.random() * 1296).toString(36).toUpperCase().padStart(2, "0");
  }

  async function api(ruta, opts) {
    var r = await fetch(API + ruta, opts);
    var d = null; try { d = await r.json(); } catch (_) {}
    // El dueno quito el acceso (o la sesion quedo sin artista): fuera, sin pantallas a medias.
    if (r.status === 403 && d && d.codigo === "ARTISTA_SIN_ACCESO") {
      try { window.OCAuth.salir(t("artist.accessRemoved", "Your artist access was turned off. Ask the owner.")); } catch (_) {}
      throw new Error("sin acceso");
    }
    return { ok: r.ok, status: r.status, data: d };
  }

  var CSS_BTN = "min-height:48px;padding:12px 18px;border-radius:10px;border:0;font-size:16px;font-weight:700;cursor:pointer;font-family:var(--font-body,sans-serif);";
  var CSS_INPUT = "width:100%;box-sizing:border-box;min-height:48px;padding:10px 12px;font-size:16px;border:2px solid #2C3E50;border-radius:10px;background:#FFFFFF;color:#0F1923;";
  var CSS_LABEL = "display:block;font-size:14px;font-weight:700;color:#0F1923;margin:12px 0 6px;";

  function montar() {
    if (raiz) raiz.remove();
    var a = window.OCCurrentArtista || {};
    // z-index 9980: encima de toda la app, DEBAJO del candado (9999) y de los
    // dialogos (9995+), para que el timeout de inactividad y las alertas se vean.
    // El modal de etiqueta sube a 9990 con body.rol-artista (ver estilo abajo).
    raiz = el("div", "position:fixed;inset:0;z-index:9980;background:#F8F9FB;overflow:auto;-webkit-overflow-scrolling:touch;color:#0F1923;font-family:var(--font-body,sans-serif);");
    raiz.id = "oc-artista";
    var est = document.getElementById("oc-artista-estilo");
    if (!est) {
      est = el("style");
      est.id = "oc-artista-estilo";
      est.textContent = "body.rol-artista #modalEtiqueta{z-index:9990;}" +
        "body:not(.rol-artista) #oc-artista{display:none !important;}" +
        "@media print{#oc-artista{display:none !important;}}";
      document.head.appendChild(est);
    }

    var caja = el("div", "max-width:720px;margin:0 auto;padding:16px 16px 48px;");
    raiz.appendChild(caja);

    // Cabecera: quien es, y salir. Nada mas (no hay navegacion a otras vistas).
    var cab = el("div", "display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;padding:12px 0;border-bottom:2px solid #2C3E50;");
    var quien = el("div");
    quien.appendChild(el("div", "font-size:14px;font-weight:700;color:#2C3E50;", t("artist.heading", "Artist")));
    quien.appendChild(el("div", "font-size:22px;font-weight:700;color:#0F1923;font-family:var(--font-display,sans-serif);", a.nombre || ""));
    cab.appendChild(quien);
    var acciones = el("div", "display:flex;gap:8px;");
    var idioma = el("button", CSS_BTN + "background:#FFFFFF;color:#0F1923;border:2px solid #0F1923;", (window.OCI18n && window.OCI18n.getLang && window.OCI18n.getLang() === "es") ? "EN" : "ES");
    idioma.type = "button";
    idioma.addEventListener("click", function () {
      try { var L = window.OCI18n.getLang() === "es" ? "en" : "es"; window.OCI18n.setLang(L); } catch (_) {}
      montar();
    });
    var salir = el("button", CSS_BTN + "background:#0F1923;color:#FFFFFF;", t("artist.logout", "Log out"));
    salir.type = "button";
    salir.addEventListener("click", function () { try { window.OCAuth.salir(); } catch (_) {} });
    acciones.appendChild(idioma); acciones.appendChild(salir);
    cab.appendChild(acciones);
    caja.appendChild(cab);

    var zonaRack = el("div", "font-size:16px;margin:12px 0;color:#0F1923;");
    caja.appendChild(zonaRack);
    var zonaForm = el("div");
    caja.appendChild(zonaForm);
    caja.appendChild(el("h3", "font-size:20px;margin:24px 0 8px;color:#0F1923;font-family:var(--font-display,sans-serif);", t("artist.myPieces", "My pieces")));
    var zonaLista = el("div");
    caja.appendChild(zonaLista);

    document.body.appendChild(raiz);
    cargar(zonaRack, zonaForm, zonaLista);
  }

  async function cargar(zonaRack, zonaForm, zonaLista) {
    var racks = [], piezas = [];
    try {
      racks = (await api("/ubicaciones")).data || [];
      piezas = (await api("/productos")).data || [];
    } catch (_) { return; }
    zonaRack.textContent = "";
    zonaForm.textContent = "";
    if (!racks.length) {
      zonaRack.appendChild(el("div", "padding:14px;border:2px solid #B8123C;border-radius:10px;background:#FFFFFF;color:#B8123C;font-weight:700;font-size:16px;",
        t("artist.noRack", "You do not have a rack yet. Ask the owner to assign you one.")));
    } else {
      zonaRack.appendChild(el("span", "font-weight:700;", t("artist.yourRack", "Your rack") + ": "));
      zonaRack.appendChild(el("span", "", racks.map(function (r) { return r.nombre; }).join(", ")));
      pintarFormulario(zonaForm, racks, zonaRack, zonaLista);
    }
    pintarLista(zonaLista, piezas);
  }

  function pintarFormulario(zona, racks, zonaRack, zonaLista) {
    var f = el("form", "background:#FFFFFF;border:2px solid #2C3E50;border-radius:12px;padding:16px;margin-top:8px;");
    f.appendChild(el("h3", "font-size:20px;margin:0 0 4px;color:#0F1923;font-family:var(--font-display,sans-serif);", t("artist.addPiece", "Add a piece")));
    f.appendChild(el("p", "font-size:15px;margin:0 0 4px;color:#2C3E50;", t("artist.addHint", "Once saved, only the owner or an admin can change it.")));

    function campo(id, etiqueta, tipo, extra) {
      var l = el("label", CSS_LABEL, etiqueta); l.htmlFor = id;
      var i = el("input", CSS_INPUT); i.id = id; i.type = tipo;
      if (extra) Object.keys(extra).forEach(function (k) { i.setAttribute(k, extra[k]); });
      f.appendChild(l); f.appendChild(i); return i;
    }
    var nombre = campo("art-nombre", t("artist.name", "Name of the piece"), "text", { maxlength: "80", autocomplete: "off" });
    var precio = campo("art-precio", t("artist.price", "Price"), "number", { min: "0.01", step: "0.01", inputmode: "decimal" });
    var cantidad = campo("art-cantidad", t("artist.qty", "How many"), "number", { min: "1", step: "1", inputmode: "numeric", value: "1" });
    var foto = campo("art-foto", t("artist.photo", "Photo (optional)"), "file", { accept: "image/*" });
    foto.style.cssText += "padding:8px;";
    var select = null;
    if (racks.length > 1) {
      var l = el("label", CSS_LABEL, t("artist.rack", "Rack")); l.htmlFor = "art-rack";
      select = el("select", CSS_INPUT); select.id = "art-rack";
      racks.forEach(function (r) { var o = el("option", "", r.nombre); o.value = r.id; select.appendChild(o); });
      f.appendChild(l); f.appendChild(select);
    }
    var msg = el("div", "min-height:24px;font-size:16px;font-weight:700;margin-top:12px;");
    var btn = el("button", CSS_BTN + "width:100%;margin-top:12px;background:#0B7A4B;color:#FFFFFF;", t("artist.save", "Add piece"));
    btn.type = "submit";
    f.appendChild(msg); f.appendChild(btn);

    f.addEventListener("submit", async function (e) {
      e.preventDefault();
      msg.style.color = "#B8123C";
      var n = nombre.value.trim(), pr = Number(precio.value), c = Math.floor(Number(cantidad.value));
      if (!n) { msg.textContent = t("artist.errName", "Write the name of the piece."); return; }
      if (!(pr > 0)) { msg.textContent = t("artist.errPrice", "Write a price greater than zero."); return; }
      if (!(c >= 1)) { msg.textContent = t("artist.errQty", "Write how many pieces (1 or more)."); return; }
      btn.disabled = true;
      var body = { nombre: n, precio: pr, stockInicial: c, barcode: codigoNuevo() };
      if (select) body.ubicacionId = select.value;
      try {
        if (typeof window.leerFotoRedimensionada === "function") {
          var fd = await window.leerFotoRedimensionada(foto);
          if (fd) body.foto = fd;
        }
        var r = await api("/productos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        if (!r.ok) { msg.textContent = (r.data && r.data.error) || t("artist.errSave", "Could not save. Try again."); return; }
        msg.style.color = "#0B7A4B";
        msg.textContent = t("artist.saved", "Saved. It is on your rack.");
        f.reset(); cantidad.value = "1";
        var lista = (await api("/productos")).data || [];
        pintarLista(zonaLista, lista);
      } catch (_) {
        msg.textContent = t("artist.errSave", "Could not save. Try again.");
      } finally { btn.disabled = false; }
    });
    zona.appendChild(f);
  }

  function pintarLista(zona, piezas) {
    zona.textContent = "";
    if (!piezas.length) {
      zona.appendChild(el("p", "font-size:16px;color:#2C3E50;", t("artist.empty", "You have no pieces on your rack yet.")));
      return;
    }
    piezas.forEach(function (p) {
      var fila = el("div", "display:flex;align-items:center;gap:12px;background:#FFFFFF;border:2px solid #2C3E50;border-radius:12px;padding:10px;margin-bottom:8px;");
      if (p.foto) {
        var img = el("img", "width:56px;height:56px;object-fit:cover;border-radius:8px;flex:none;");
        img.src = p.foto; img.alt = "";
        fila.appendChild(img);
      }
      var info = el("div", "flex:1;min-width:0;");
      info.appendChild(el("div", "font-size:17px;font-weight:700;color:#0F1923;overflow-wrap:anywhere;", p.nombre));
      info.appendChild(el("div", "font-size:15px;color:#2C3E50;", dinero(p.precio) + " · " + t("artist.inStock", "on the rack") + ": " + (Number(p.stockActual) || 0)));
      fila.appendChild(info);
      var b = el("button", CSS_BTN + "flex:none;background:#0F1923;color:#FFFFFF;", t("artist.label", "Label"));
      b.type = "button";
      // Reusa la etiqueta de siempre (abrirEtiqueta en index.html): mismo papel,
      // mismo gesto de impresion de Safari. El backend solo la da si es suya.
      b.addEventListener("click", function () { try { window.abrirEtiqueta(p.id); } catch (_) {} });
      fila.appendChild(b);
      zona.appendChild(fila);
    });
  }

  /* CONTROL DEL DUENO (editor de comisionista en index.html, solo dueno/admin).
     Bloque propio con su propio guardado: PUT /api/promotoras/:id/acceso. No
     se mezcla con el "Save" del trato para que un error de PIN no deje a
     medias el porcentaje ni al reves. El PIN nunca se muestra: la lista solo
     dice si hay acceso activo (tieneAccesoArtista). */
  function pintarAccesoEnEditor(caja, pr) {
    var ancla = caja.querySelector("#oc-com-msg");
    if (!ancla || caja.querySelector("#oc-art-acceso")) return;
    var b = el("div", "margin-top:16px;padding:12px;border:2px solid #2C3E50;border-radius:10px;background:#FFFFFF;");
    b.id = "oc-art-acceso";
    b.appendChild(el("div", "font-size:16px;font-weight:700;color:#0F1923;", t("artist.access.title", "Artist access")));
    b.appendChild(el("p", "font-size:14px;color:#2C3E50;margin:4px 0 8px;", t("artist.access.hint", "")));
    var estado = el("div", "font-size:15px;font-weight:700;margin-bottom:8px;");
    function pintarEstado(activo) {
      estado.style.color = activo ? "#0B7A4B" : "#2C3E50";
      estado.textContent = activo ? t("artist.access.on", "Access on") : t("artist.access.off", "Access off");
    }
    pintarEstado(!!pr.tieneAccesoArtista);
    b.appendChild(estado);
    if (pr.tienePercha === false) b.appendChild(el("p", "font-size:14px;font-weight:700;color:#B8123C;margin:0 0 8px;", t("artist.access.noRack", "")));
    var l = el("label", CSS_LABEL, t("artist.access.pin", "Artist PIN (3 digits)")); l.htmlFor = "oc-art-pin";
    var pin = el("input", CSS_INPUT); pin.id = "oc-art-pin"; pin.type = "password"; pin.inputMode = "numeric"; pin.maxLength = 3; pin.autocomplete = "off";
    b.appendChild(l); b.appendChild(pin);
    var msg = el("div", "min-height:22px;font-size:14px;font-weight:700;margin-top:8px;");
    var fila = el("div", "display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;");
    var guardar = el("button", CSS_BTN + "background:#0B7A4B;color:#FFFFFF;", t("artist.access.save", "Save artist access")); guardar.type = "button";
    var apagar = el("button", CSS_BTN + "background:#FFFFFF;color:#B8123C;border:2px solid #B8123C;", t("artist.access.turnOff", "Turn off access")); apagar.type = "button";
    fila.appendChild(guardar); fila.appendChild(apagar);
    b.appendChild(fila); b.appendChild(msg);
    async function enviar(cuerpo) {
      msg.style.color = "#B8123C"; msg.textContent = "";
      guardar.disabled = apagar.disabled = true;
      try {
        var r = await fetch(API + "/promotoras/" + encodeURIComponent(pr.id) + "/acceso", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo) });
        var d = await r.json();
        if (!r.ok) { msg.textContent = (d && d.error) || t("artist.errSave", "Could not save. Try again."); return; }
        pr.tieneAccesoArtista = !!d.tieneAccesoArtista;
        pintarEstado(pr.tieneAccesoArtista);
        pin.value = "";
        msg.style.color = "#0B7A4B"; msg.textContent = t("artist.access.saved", "Artist access saved.");
      } catch (_) { msg.textContent = t("artist.errSave", "Could not save. Try again."); }
      finally { guardar.disabled = apagar.disabled = false; }
    }
    guardar.addEventListener("click", function () {
      var v = pin.value.trim();
      enviar(v ? { pin: v, activo: true } : { activo: true });
    });
    apagar.addEventListener("click", function () { enviar({ activo: false }); });
    ancla.parentNode.insertBefore(b, ancla);
  }

  /* La vista sigue a la clase body.rol-artista (la pone y la quita auth-ui).
     BUG hallado en Chromium (2026-09-24): escuchar solo "oc-login" fallaba al
     recargar, porque la sesion restaurada entra ANTES de que este archivo
     cargue y el evento se perdia: quedaba la app de fondo a la vista (con
     todas sus rutas en 403, pero a la vista). Observar la clase cubre el
     login normal, la sesion restaurada y el cierre de sesion. */
  function sincronizar() {
    var es = !!(document.body && document.body.classList.contains("rol-artista"));
    if (es && !raiz) montar();
    else if (!es && raiz) { raiz.remove(); raiz = null; }
  }
  try { new MutationObserver(sincronizar).observe(document.body, { attributes: true, attributeFilter: ["class"] }); } catch (_) {}
  sincronizar();
  window.OCArtista = { montar: montar, pintarAccesoEnEditor: pintarAccesoEnEditor };
})();
