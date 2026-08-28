/* ============================================================================
   micelio-ui.js — la cara visible del micelio, dentro de la app.
   friendly-123-123 · 2026-08-15 · JFC

   Tres cosas, en orden de importancia:

   1. EL PULSAR. Si TU dispositivo lleva rato sin hablar con el equipo, un
      punto de color aparece flotando abajo a la derecha y late despacio. Al
      tocarlo cuenta qué pasa. Va FUERA del flujo del documento: no empuja el
      header, no mueve el layout, no tapa nada. Cuando todo está al día, no
      existe. El que está a ciegas es el único que puede arreglarlo moviéndose
      a donde haya señal, y es justo el que no se entera: por eso se ve. Pero
      se ve como un pulso, no como una alarma de incendio.

   2. EL PANEL DEL EQUIPO, dentro de Avanzado. Quién está al día, quién
      rezagado, quién a ciegas, con el apodo que el negocio le puso.

   3. EL APODO Y LA PERILLA. Un solo campo libre: el negocio decide si escribe
      "Rosa" o "el celular del mostrador". Y los umbrales, movibles.

   Este módulo solo pinta. La lógica está en micelio-vivo.js. Si esto falla,
   el micelio sigue funcionando y la app sigue vendiendo: solo no se ve.
   ============================================================================ */
(function () {
  "use strict";

  if (!window.OCMicelio) return;   /* sin motor no hay cara */

  var M = window.OCMicelio;

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  // 2026-08-19, aprobado JFC: ROL respeta el idioma activo. Las claves
  // "auth.roleChip.*" ya existen en i18n.js/DICT.en/DICT.es — reutilizadas.
  function _t(k, fb) { try { return (window.OCI18n && window.OCI18n.t(k)) || fb; } catch (_) { return fb; } }
  function rolNombre(rol) {
    if (rol === "dueno")    return _t("auth.roleChip.owner", "Owner");
    if (rol === "admin")    return _t("auth.roleChip.admin", "Admin");
    if (rol === "empleado") return _t("auth.roleChip.employee", "Staff member");
    if (rol === "contador") return _t("auth.roleChip.accountant", "Accountant");
    if (rol === "soporte") return _t("auth.roleChip.support", "Maintenance / Support");
    return rol || "";
  }
  function comoSeLlama(m) {
    /* El apodo manda; si no hay, el número estable (001, 002...); si tampoco,
       el rol; si no, el id corto. Nunca el PIN: el PIN no se enseña, se teclea.
       (JFC 2026-08-27: auto-numeración para identificar dispositivos sin
       nickname.) */
    if (m.apodo) return m.apodo;
    var n = (window.OCMicelio && window.OCMicelio.numeroEstable) ? window.OCMicelio.numeroEstable(m.id) : "";
    if (n) return n;
    return rolNombre(m.rol) || ("Device " + String(m.id).slice(1, 5));
  }

  /* ====================================================== 1. EL PULSAR ===
     UN PULSAR, NO UN BANNER (JFC, 2026-08-15, y con razon: un banner arriba de
     todo empuja el header y arruina el layout que costo meses).

     Es un punto flotante, fijo abajo a la derecha, fuera del flujo del
     documento: NO mueve ni un pixel de la app. Cuando todo esta al dia no
     existe. Cuando hay algo que decir aparece del color que corresponde y
     late despacio. Al tocarlo, cuenta lo que pasa y como arreglarlo.

     Visible pero no grotesco: eso era el encargo.
     ======================================================================== */
  var pulsar = null, globo = null;

  function estiloPulsar() {
    if (document.getElementById("oc-micelio-css")) return;
    var css = document.createElement("style");
    css.id = "oc-micelio-css";
    css.textContent =
      "#oc-micelio-pulsar{position:fixed;right:14px;bottom:14px;z-index:880;width:44px;height:44px;" +
      "border:none;background:transparent;padding:0;cursor:pointer;display:flex;align-items:center;" +
      "justify-content:center;}" +
      "#oc-micelio-pulsar .pt{width:15px;height:15px;border-radius:50%;display:block;" +
      "box-shadow:0 1px 4px #00000040;}" +
      "#oc-micelio-pulsar .halo{position:absolute;width:15px;height:15px;border-radius:50%;" +
      "animation:ocLatir 2.6s ease-out infinite;}" +
      "@keyframes ocLatir{0%{transform:scale(1);opacity:.55;}70%{transform:scale(2.5);opacity:0;}100%{opacity:0;}}" +
      "@media (prefers-reduced-motion: reduce){#oc-micelio-pulsar .halo{animation:none;display:none;}}" +
      "#oc-micelio-globo{position:fixed;right:14px;bottom:64px;z-index:881;max-width:min(92vw,330px);" +
      "background:#FFFFFF;border-radius:13px;padding:14px 16px;box-shadow:0 6px 24px #00000033;" +
      "border:1px solid #dde5ec;}" +
      "#oc-micelio-globo p{font-size:15px;line-height:1.55;margin:0 0 9px;color:#2C3E50;}" +
      "#oc-micelio-globo strong{display:block;font-size:16px;margin:0 0 5px;color:#0F1923;}" +
      "#oc-micelio-globo button{min-height:44px;width:100%;padding:11px;border-radius:9px;" +
      "border:2px solid #0F1923;background:#FFFFFF;color:#0F1923;font-size:15px;font-weight:700;cursor:pointer;}";
    document.head.appendChild(css);
  }

  function cerrarGlobo() {
    if (globo) { globo.remove(); globo = null; }
  }

  function abrirGlobo(e) {
    if (globo) { cerrarGlobo(); return; }
    estiloPulsar();
    var ciego = e.estado === "ciegas";
    globo = document.createElement("div");
    globo.id = "oc-micelio-globo";
    globo.setAttribute("role", "status");
    globo.innerHTML =
      "<p><strong>" + (ciego ? "You are out of the loop" : "Catching up") + "</strong>" +
      /* "just now" no encaja en la plantilla "has gone ___ without talking":
         queda mal escrito. Se dice de otra forma en vez de forzarla. */
      (function () {
        var t = e.cuando === "just now" ? "" : esc(e.cuando.replace(" ago", ""));
        if (ciego) {
          return t
            ? "This device has gone " + t + " without talking to your team. While that lasts, you could sell something someone else already sold."
            : "This device stopped talking to your team. While that lasts, you could sell something someone else already sold.";
        }
        return t
          ? "It has gone " + t + " without syncing. It is almost always the signal."
          : "It stopped syncing a moment ago. It is almost always the signal.";
      })() +
      "</p>" +
      "<p>It fixes itself as soon as there is internet: nothing to do but move somewhere with signal.</p>" +
      '<button type="button" id="oc-micelio-globo-x">Got it</button>';
    document.body.appendChild(globo);
    /* El globo sale justo encima del pulsar, este donde este. */
    if (pulsar) globo.style.bottom = (parseInt(pulsar.style.bottom || 14, 10) + 50) + "px";
    document.getElementById("oc-micelio-globo-x").addEventListener("click", cerrarGlobo);
  }

  /* PULSAR DESACTIVADO — JFC, 2026-08-19: en la app end-user el pulsar
     distrae, daña el layout percibido y no da nada accionable que ya no
     este dentro del panel del equipo. Se apaga la UI (early return) pero
     NO se borra el subsistema: sigue midiendo estado, se puede volver a
     encender solo cambiando la primera linea a `if (false) { ... }`. Uso
     previsto (apuntado en NOTAS-OPERATIVAS-2026-08-19.md): tableros de
     JFC para vigilar el estado de sus clientes desde su panel maestro. */
  var PULSAR_VISIBLE = false;
  function pintarPulsar() {
    if (!PULSAR_VISIBLE) {
      if (pulsar) { pulsar.remove(); pulsar = null; }
      cerrarGlobo();
      return;
    }
    var e = M.miEstado();
    if (e.estado === "al_dia") {
      /* Todo bien: no hay nada que decir, y un indicador que siempre esta
         encendido deja de significar algo. */
      if (pulsar) { pulsar.remove(); pulsar = null; }
      cerrarGlobo();
      return;
    }
    estiloPulsar();
    var ciego = e.estado === "ciegas";
    var color = ciego ? "#E8365D" : "#FFC700";
    if (!pulsar) {
      pulsar = document.createElement("button");
      pulsar.type = "button";
      pulsar.id = "oc-micelio-pulsar";
      pulsar.innerHTML = '<span class="halo"></span><span class="pt"></span>';
      pulsar.addEventListener("click", function () { abrirGlobo(M.miEstado()); });
      document.body.appendChild(pulsar);
    }
    /* Se sube por encima de cualquier barra fija de abajo (la de demo, por
       ejemplo): un pulsar tapado no avisa de nada. Se mide en vez de suponer,
       porque esas barras cambian de alto segun el texto y el ancho. */
    var estorbo = 0;
    try {
      document.querySelectorAll("body > *").forEach(function (el) {
        if (el === pulsar || el === globo) return;
        var st = getComputedStyle(el);
        if ((st.position !== "fixed" && st.position !== "sticky") || st.display === "none") return;
        var r = el.getBoundingClientRect();
        if (!r.height || r.bottom < window.innerHeight - 6) return;   /* no esta pegado abajo */
        if (r.height > window.innerHeight * 0.5) return;              /* es un modal, no una barra */
        estorbo = Math.max(estorbo, Math.round(r.height));
      });
    } catch (_) {}
    pulsar.style.bottom = (14 + estorbo) + "px";
    if (globo) globo.style.bottom = (64 + estorbo) + "px";

    pulsar.title = ciego ? "This device is out of the loop" : "This device is behind";
    pulsar.setAttribute("aria-label", pulsar.title);
    pulsar.querySelector(".pt").style.background = color;
    pulsar.querySelector(".halo").style.background = color;
  }

  /* ================================================ 2. PANEL DEL EQUIPO === */
  function filaEquipo(m) {
    var et = M.etiquetas[m.estado];
    return '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:10px 0;' +
      'border-bottom:1px solid var(--azul-suave,#dde5ec);">' +
      '<span style="display:inline-block;min-width:96px;padding:4px 11px;border-radius:20px;font-size:13px;' +
      'font-weight:700;text-align:center;background:' + et.color + ';color:' + et.tinta + ';">' + et.texto + "</span>" +
      '<span style="font-size:16px;font-weight:700;color:#0F1923;">' + esc(comoSeLlama(m)) +
      (m.soyYo ? ' <span style="font-size:13px;font-weight:700;color:#B54E0A;">(this device)</span>' : "") + "</span>" +
      /* "Up to date" mide el RELOJ: cuando hablo por ultima vez. Un
         dispositivo puede estar hablando hace un segundo y aun asi mostrar
         OTRO inventario, que es justo el caso que confundio a JFC. Cuando eso
         pasa, se marca en la propia fila: leer "Up to date" al lado de un
         aviso de inventario distinto es peor que no marcar nada. */
      (function () {
        try {
          var mia = M.miHuella ? M.miHuella() : "";
          if (!m.soyYo && mia && m.huella && m.huella !== mia) {
            return '<span style="font-size:13px;font-weight:700;color:#B54E0A;background:#FFF6F2;'
              + 'border:1px solid #E86040;border-radius:10px;padding:3px 9px;">different inventory ('
              + esc(m.huella) + ")</span>";
          }
        } catch (_) {}
        return "";
      })() +
      '<span style="font-size:14px;color:#2C3E50;margin-left:auto;">' + esc(m.cuando) + "</span>" +
      "</div>";
  }

  function pintarPanel() {
    var cont = document.getElementById("oc-micelio-panel");
    if (!cont) return;
    var eq = M.equipo();
    var u = M.umbrales();
    var ciegos = eq.filter(function (m) { return m.estado === "ciegas"; }).length;
    var yo = M.yo();

    /* PASO 2 (JFC 2026-08-19): DECIR LA VERDAD SOBRE EL INVENTARIO.
       Antes este panel solo miraba el RELOJ: si un dispositivo habia latido
       hace poco decia "Up to date", aunque estuviera mostrando otro
       inventario. Fue exactamente lo que le paso a JFC: su PC y su celular
       decian "sincronizado" con perchas distintas ("Rack1" y "001").
       Ahora se compara la HUELLA del catalogo. Un dispositivo que no manda
       huella (version vieja) no cuenta como discrepancia: no se sabe, y
       afirmar sin saber es el error que este paso corrige. */
    var _desal = [];
    try { _desal = M.desalineados ? M.desalineados() : []; } catch (_) {}
    var avisoHuella = _desal.length
      ? '<div style="margin:0 0 12px;padding:11px 13px;background:#FFF6F2;border-left:4px solid #E86040;border-radius:0 8px 8px 0;">' +
        '<p style="font-size:15px;font-weight:700;line-height:1.5;margin:0 0 4px;color:#0F1923;">' +
        (_desal.length === 1 ? "1 device is showing a different inventory" : _desal.length + " devices are showing a different inventory") +
        "</p>" +
        '<p style="font-size:14px;line-height:1.5;margin:0;color:#2C3E50;">' +
        "They are connected, but they do not have the same products and shelves as this device: " +
        _desal.map(function (x) { return esc(comoSeLlama(x)) + " (" + esc(x.huella) + ")"; }).join(", ") +
        ". This device is " + esc(M.miHuella ? M.miHuella() : "?") + "." +
        "</p></div>"
      : "";

    cont.innerHTML =
      avisoHuella +
      '<p style="font-size:14px;line-height:1.55;margin:0 0 12px;color:#2C3E50;">' +
      (ciegos
        ? (ciegos === 1 ? "1 device has not" : ciegos + " devices have not") +
          " synced in a while. Until they do, they can sell something that was already sold here."
        : "Every device on your team is talking to the others.") +
      "</p>" +
      '<div>' + eq.map(filaEquipo).join("") + "</div>" +
      /* La huella propia, siempre a la vista: es lo que dos duenos comparan
         por telefono para saber si estan viendo lo mismo, sin entender nada
         de hashes. */
      '<p style="font-size:14px;line-height:1.5;margin:10px 0 0;color:#2C3E50;">' +
      "This device's inventory fingerprint: <strong style=\"font-family:var(--font-mono,monospace);color:#0F1923;\">" +
      esc(M.miHuella ? (M.miHuella() || "?") : "?") + "</strong>. Two devices showing the same products and shelves have the same fingerprint.</p>" +

      /* --- el apodo --- */
      '<div style="margin-top:16px;">' +
      '<label for="oc-mic-apodo" style="display:block;font-size:14px;font-weight:700;color:#0F1923;margin:0 0 5px;">What to call this device</label>' +
      '<p style="font-size:14px;line-height:1.5;margin:0 0 7px;color:#2C3E50;">It can be the person or the device: "Rosa", "front counter phone", "fair tablet". Your team sees it.</p>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;">' +
      '<input id="oc-mic-apodo" type="text" maxlength="28" value="' + esc(yo.apodo) + '" placeholder="Rosa, or the front counter phone" ' +
      'style="flex:1;min-width:min(100%,200px);min-height:44px;padding:10px 13px;border:2px solid var(--azul-medio,#2E6278);' +
      'border-radius:8px;font-size:16px;color:#0F1923;background:#FFFFFF;">' +
      '<button type="button" id="oc-mic-apodo-ok" style="min-height:44px;padding:11px 18px;border-radius:8px;border:2px solid #0F1923;' +
      'background:#0F1923;color:#FFFFFF;font-size:15px;font-weight:700;cursor:pointer;">Save</button>' +
      "</div>" +
      '<p id="oc-mic-apodo-msg" style="font-size:14px;margin:7px 0 0;min-height:19px;color:#00975C;"></p>' +
      "</div>" +

      /* --- la perilla --- */
      '<details style="margin-top:14px;">' +
      '<summary style="font-size:15px;font-weight:700;color:#0F1923;cursor:pointer;padding:8px 0;min-height:44px;display:flex;align-items:center;">Adjust when to warn</summary>' +
      '<p style="font-size:14px;line-height:1.5;margin:6px 0 10px;color:#2C3E50;">' +
      'The factory values work for almost everyone. Move them if your business runs where the signal is bad, or if you need to know within the minute.</p>' +
      '<div style="display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end;">' +
      '<div><label for="oc-mic-rez" style="display:block;font-size:14px;font-weight:700;color:#0F1923;margin:0 0 4px;">Behind after</label>' +
      '<input id="oc-mic-rez" type="number" min="1" max="600" value="' + u.rezagado + '" style="width:110px;min-height:44px;padding:10px;' +
      'border:2px solid var(--azul-medio,#2E6278);border-radius:8px;font-size:16px;color:#0F1923;background:#FFFFFF;"> ' +
      '<span style="font-size:14px;color:#2C3E50;">minutes</span></div>' +
      '<div><label for="oc-mic-cie" style="display:block;font-size:14px;font-weight:700;color:#0F1923;margin:0 0 4px;">Flying blind after</label>' +
      '<input id="oc-mic-cie" type="number" min="2" max="2880" value="' + u.ciegas + '" style="width:110px;min-height:44px;padding:10px;' +
      'border:2px solid var(--azul-medio,#2E6278);border-radius:8px;font-size:16px;color:#0F1923;background:#FFFFFF;"> ' +
      '<span style="font-size:14px;color:#2C3E50;">minutes</span></div>' +
      '<button type="button" id="oc-mic-umb-ok" style="min-height:44px;padding:11px 18px;border-radius:8px;border:2px solid #0F1923;' +
      'background:#FFFFFF;color:#0F1923;font-size:15px;font-weight:700;cursor:pointer;">Save</button>' +
      "</div>" +
      '<p id="oc-mic-umb-msg" style="font-size:14px;margin:7px 0 0;min-height:19px;color:#00975C;"></p>' +
      "</details>" +

      /* --- avisos del navegador --- */
      '<div style="margin-top:14px;padding-top:12px;border-top:1px solid var(--azul-suave,#dde5ec);">' +
      '<p style="font-size:14px;line-height:1.55;margin:0 0 8px;color:#2C3E50;">' +
      'Your browser can warn you when this device drops out of the loop, even with the app in the background.</p>' +
      '<button type="button" id="oc-mic-avisos" style="min-height:44px;padding:11px 18px;border-radius:8px;border:2px solid #0F1923;' +
      'background:#FFFFFF;color:#0F1923;font-size:15px;font-weight:700;cursor:pointer;">Turn on alerts on this device</button>' +
      '<p id="oc-mic-avisos-msg" style="font-size:14px;line-height:1.5;margin:8px 0 0;min-height:19px;color:#2C3E50;"></p>' +
      "</div>";

    cablearPanel();
  }

  function cablearPanel() {
    var msg = function (id, txt, color) {
      var e = document.getElementById(id);
      if (!e) return;
      e.style.color = color || "#00975C";
      e.style.webkitTextFillColor = color || "#00975C";
      e.textContent = txt;
    };

    var bA = document.getElementById("oc-mic-apodo-ok");
    if (bA) bA.addEventListener("click", function () {
      var v = M.ponerApodo(document.getElementById("oc-mic-apodo").value);
      msg("oc-mic-apodo-msg", v ? 'Saved. Your team will see "' + v + '".' : "No nickname: your team sees your role.");
    });

    var bU = document.getElementById("oc-mic-umb-ok");
    if (bU) bU.addEventListener("click", function () {
      var r = Number(document.getElementById("oc-mic-rez").value);
      var c = Number(document.getElementById("oc-mic-cie").value);
      if (!(r > 0) || !(c > 0)) { msg("oc-mic-umb-msg", "Both values have to be minutes greater than zero.", "#A8123A"); return; }
      if (c <= r) { msg("oc-mic-umb-msg", '"Flying blind" has to be greater than "behind", otherwise nobody is ever just behind.', "#A8123A"); return; }
      M.ponerUmbrales(r, c);
      msg("oc-mic-umb-msg", "Saved. Behind at " + r + " min, flying blind at " + c + " min.");
    });

    var bN = document.getElementById("oc-mic-avisos");
    if (bN) {
      /* Estado actual, dicho antes de tocar nada: si el navegador ya los tiene
         bloqueados, el botón no los va a desbloquear y hay que decirlo. */
      try {
        if (!("Notification" in window)) msg("oc-mic-avisos-msg", "This browser cannot show alerts. The on-screen warning still works.", "#2C3E50");
        else if (Notification.permission === "granted") msg("oc-mic-avisos-msg", "Alerts are already on for this device.");
        else if (Notification.permission === "denied") msg("oc-mic-avisos-msg", "Alerts are blocked for this site. You turn them on in your browser settings, not here.", "#B54E0A");
      } catch (_) {}

      bN.addEventListener("click", function () {
        M.pedirPermisoAviso().then(function (r) {
          if (r === "granted") {
            msg("oc-mic-avisos-msg", "Done. We will warn you if this device drops out of the loop.");
            /* Ya que el dueño dijo que sí a esto, se pide también que el
               navegador no borre los datos del negocio por falta de espacio.
               Va junto porque es el mismo gesto: "esto lo quiero en serio". */
            M.pedirPersistencia().then(function (ok) {
              if (ok) msg("oc-mic-avisos-msg", "Done. We will warn you if this device drops out of the loop, and the browser will no longer delete your data to free space.");
            });
          } else if (r === "denied") {
            msg("oc-mic-avisos-msg", "You left them blocked. The on-screen warning still works.", "#B54E0A");
          } else {
            msg("oc-mic-avisos-msg", "This browser cannot show alerts. The on-screen warning still works.", "#2C3E50");
          }
        });
      });
    }
  }

  /* =============================================================== ciclo === */
  function refrescar() {
    try { pintarPulsar(); } catch (_) {}
    try {
      /* El panel solo se repinta si está a la vista: repintarlo mientras el
         usuario escribe su apodo le borraría lo tecleado. */
      var c = document.getElementById("oc-micelio-panel");
      if (c && c.offsetParent && document.activeElement !== document.getElementById("oc-mic-apodo")) pintarPanel();
    } catch (_) {}
  }

  window.addEventListener("oc-micelio-cambio", refrescar);
  window.addEventListener("oc-login", function () { setTimeout(refrescar, 400); });
  setInterval(refrescar, 30000);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", refrescar);
  else refrescar();

  /* ============================================ EL PIN DE QUIEN SE DIO DE ALTA
     Cuando el duenio agrega a alguien desde el tablero, el PIN se genera AQUI
     y se muestra AQUI: el tablero puede estar en una pantalla que ve medio
     local. Este si es un modal y no un pulsar, porque es un dato que hay que
     leer y pasar a una persona, una sola vez, ahora.
     ========================================================================= */
  window.addEventListener("oc-alta-remota", function (ev) {
    var d = (ev && ev.detail) || {};
    if (!d.pin) return;
    var viejo = document.getElementById("oc-alta-modal");
    if (viejo) viejo.remove();
    var m = document.createElement("div");
    m.id = "oc-alta-modal";
    m.style.cssText = "position:fixed;inset:0;z-index:960;background:#0F192399;display:flex;" +
      "align-items:center;justify-content:center;padding:20px;";
    m.innerHTML =
      '<div style="background:#FFFFFF;border-radius:15px;padding:22px;max-width:400px;width:100%;">' +
      '<h3 style="font-size:19px;margin:0 0 8px;color:#0F1923;">' + esc(d.nombre || "New member") + " is on your team</h3>" +
      '<p style="font-size:15px;line-height:1.55;margin:0 0 12px;color:#2C3E50;">You added them from your dashboard. This is their PIN, and it is only shown now:</p>' +
      '<div style="text-align:center;font-family:var(--font-mono,monospace);font-size:38px;font-weight:700;' +
      'letter-spacing:.14em;color:#0F1923;background:#F8F9FB;border-radius:11px;padding:15px;margin:0 0 12px;">' +
      esc(d.pin) + "</div>" +
      '<p style="font-size:15px;line-height:1.55;margin:0 0 14px;color:#2C3E50;">Give it to them in person. It does not appear on the dashboard and will not appear here again: if it is lost, set a new one from Advanced.</p>' +
      '<button type="button" id="oc-alta-x" style="width:100%;min-height:48px;padding:12px;border-radius:10px;' +
      'border:none;background:#E86040;color:#FFFFFF;-webkit-text-fill-color:#FFFFFF;font-size:16px;font-weight:700;cursor:pointer;">Got it written down</button>' +
      "</div>";
    document.body.appendChild(m);
    var cerrar = function () { try { m.remove(); } catch (_) {} };
    document.getElementById("oc-alta-x").addEventListener("click", cerrar);
    /* A proposito NO se cierra tocando afuera ni con Escape: cerrarlo sin
       querer significa perder el PIN. Solo el boton lo cierra. */
  });

  window.OCMicelioUI = { pintarPanel: pintarPanel, refrescar: refrescar, comoSeLlama: comoSeLlama };
})();
