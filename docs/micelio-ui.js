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
  var ROL = { dueno: "Dueño", admin: "Admin", empleado: "Encargado", contador: "Contador" };
  function comoSeLlama(m) {
    /* El apodo manda; si no hay, el rol; si tampoco, el id corto. Nunca el
       PIN: el PIN no se enseña, se teclea. */
    return m.apodo || ROL[m.rol] || ("Dispositivo " + String(m.id).slice(1, 5));
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
      "<p><strong>" + (ciego ? "Estás fuera del loop" : "Poniéndose al día") + "</strong>" +
      /* "hace un momento" no se puede meter en "lleva ___ sin hablar": queda
         mal escrito. Se dice de otra forma en vez de forzar la plantilla. */
      (function () {
        var t = e.cuando === "hace un momento" ? "" : esc(e.cuando.replace("hace ", ""));
        if (ciego) {
          return t
            ? "Este dispositivo lleva " + t + " sin hablar con tu equipo. Mientras siga así, puede que vendas algo que otro ya vendió."
            : "Este dispositivo dejó de hablar con tu equipo. Mientras siga así, puede que vendas algo que otro ya vendió.";
        }
        return t
          ? "Lleva " + t + " sin sincronizar. Casi siempre es la señal."
          : "Dejó de sincronizar hace un momento. Casi siempre es la señal.";
      })() +
      "</p>" +
      "<p>Se arregla solo en cuanto haya internet: no hay que hacer nada más que acercarse a donde haya señal.</p>" +
      '<button type="button" id="oc-micelio-globo-x">Entendido</button>';
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

    pulsar.title = ciego ? "Este dispositivo está fuera del loop" : "Este dispositivo va rezagado";
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
      (m.soyYo ? ' <span style="font-size:13px;font-weight:700;color:#B54E0A;">(este dispositivo)</span>' : "") + "</span>" +
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

    cont.innerHTML =
      '<p style="font-size:14px;line-height:1.55;margin:0 0 12px;color:#2C3E50;">' +
      (ciegos
        ? "Hay " + ciegos + (ciegos === 1 ? " dispositivo que lleva" : " dispositivos que llevan") +
          " rato sin sincronizar. Mientras estén así, pueden vender algo que aquí ya se vendió."
        : "Todos los dispositivos del equipo están hablando entre sí.") +
      "</p>" +
      '<div>' + eq.map(filaEquipo).join("") + "</div>" +

      /* --- el apodo --- */
      '<div style="margin-top:16px;">' +
      '<label for="oc-mic-apodo" style="display:block;font-size:14px;font-weight:700;color:#0F1923;margin:0 0 5px;">Cómo llamar a este dispositivo</label>' +
      '<p style="font-size:14px;line-height:1.5;margin:0 0 7px;color:#2C3E50;">Puede ser la persona o el aparato: "Rosa", "el celular del mostrador", "Tablet feria". Lo verá tu equipo.</p>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;">' +
      '<input id="oc-mic-apodo" type="text" maxlength="28" value="' + esc(yo.apodo) + '" placeholder="Rosa, o el celular del mostrador" ' +
      'style="flex:1;min-width:min(100%,200px);min-height:44px;padding:10px 13px;border:2px solid var(--azul-medio,#2E6278);' +
      'border-radius:8px;font-size:16px;color:#0F1923;background:#FFFFFF;">' +
      '<button type="button" id="oc-mic-apodo-ok" style="min-height:44px;padding:11px 18px;border-radius:8px;border:2px solid #0F1923;' +
      'background:#0F1923;color:#FFFFFF;font-size:15px;font-weight:700;cursor:pointer;">Guardar</button>' +
      "</div>" +
      '<p id="oc-mic-apodo-msg" style="font-size:14px;margin:7px 0 0;min-height:19px;color:#00975C;"></p>' +
      "</div>" +

      /* --- la perilla --- */
      '<details style="margin-top:14px;">' +
      '<summary style="font-size:15px;font-weight:700;color:#0F1923;cursor:pointer;padding:8px 0;min-height:44px;display:flex;align-items:center;">Ajustar cuándo avisar</summary>' +
      '<p style="font-size:14px;line-height:1.5;margin:6px 0 10px;color:#2C3E50;">' +
      'Los valores de fábrica sirven para casi todos. Muévelos si tu negocio trabaja donde la señal es mala, o si al revés necesitas enterarte al minuto.</p>' +
      '<div style="display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end;">' +
      '<div><label for="oc-mic-rez" style="display:block;font-size:14px;font-weight:700;color:#0F1923;margin:0 0 4px;">Rezagado tras</label>' +
      '<input id="oc-mic-rez" type="number" min="1" max="600" value="' + u.rezagado + '" style="width:110px;min-height:44px;padding:10px;' +
      'border:2px solid var(--azul-medio,#2E6278);border-radius:8px;font-size:16px;color:#0F1923;background:#FFFFFF;"> ' +
      '<span style="font-size:14px;color:#2C3E50;">minutos</span></div>' +
      '<div><label for="oc-mic-cie" style="display:block;font-size:14px;font-weight:700;color:#0F1923;margin:0 0 4px;">A ciegas tras</label>' +
      '<input id="oc-mic-cie" type="number" min="2" max="2880" value="' + u.ciegas + '" style="width:110px;min-height:44px;padding:10px;' +
      'border:2px solid var(--azul-medio,#2E6278);border-radius:8px;font-size:16px;color:#0F1923;background:#FFFFFF;"> ' +
      '<span style="font-size:14px;color:#2C3E50;">minutos</span></div>' +
      '<button type="button" id="oc-mic-umb-ok" style="min-height:44px;padding:11px 18px;border-radius:8px;border:2px solid #0F1923;' +
      'background:#FFFFFF;color:#0F1923;font-size:15px;font-weight:700;cursor:pointer;">Guardar</button>' +
      "</div>" +
      '<p id="oc-mic-umb-msg" style="font-size:14px;margin:7px 0 0;min-height:19px;color:#00975C;"></p>' +
      "</details>" +

      /* --- avisos del navegador --- */
      '<div style="margin-top:14px;padding-top:12px;border-top:1px solid var(--azul-suave,#dde5ec);">' +
      '<p style="font-size:14px;line-height:1.55;margin:0 0 8px;color:#2C3E50;">' +
      'Puedes recibir un aviso del navegador cuando este dispositivo quede fuera del loop, aunque tengas la app en segundo plano.</p>' +
      '<button type="button" id="oc-mic-avisos" style="min-height:44px;padding:11px 18px;border-radius:8px;border:2px solid #0F1923;' +
      'background:#FFFFFF;color:#0F1923;font-size:15px;font-weight:700;cursor:pointer;">Activar avisos en este dispositivo</button>' +
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
      msg("oc-mic-apodo-msg", v ? 'Guardado. Tu equipo verá "' + v + '".' : "Sin apodo: tu equipo verá tu rol.");
    });

    var bU = document.getElementById("oc-mic-umb-ok");
    if (bU) bU.addEventListener("click", function () {
      var r = Number(document.getElementById("oc-mic-rez").value);
      var c = Number(document.getElementById("oc-mic-cie").value);
      if (!(r > 0) || !(c > 0)) { msg("oc-mic-umb-msg", "Los dos valores tienen que ser minutos mayores que cero.", "#A8123A"); return; }
      if (c <= r) { msg("oc-mic-umb-msg", '"A ciegas" tiene que ser mayor que "rezagado", si no nadie sería nunca rezagado.', "#A8123A"); return; }
      M.ponerUmbrales(r, c);
      msg("oc-mic-umb-msg", "Guardado. Rezagado a los " + r + " min, a ciegas a los " + c + " min.");
    });

    var bN = document.getElementById("oc-mic-avisos");
    if (bN) {
      /* Estado actual, dicho antes de tocar nada: si el navegador ya los tiene
         bloqueados, el botón no los va a desbloquear y hay que decirlo. */
      try {
        if (!("Notification" in window)) msg("oc-mic-avisos-msg", "Este navegador no puede mostrar avisos. El aviso en pantalla sigue funcionando.", "#2C3E50");
        else if (Notification.permission === "granted") msg("oc-mic-avisos-msg", "Los avisos ya están activos en este dispositivo.");
        else if (Notification.permission === "denied") msg("oc-mic-avisos-msg", "Los avisos están bloqueados para este sitio. Se activan desde los ajustes del navegador, no desde aquí.", "#B54E0A");
      } catch (_) {}

      bN.addEventListener("click", function () {
        M.pedirPermisoAviso().then(function (r) {
          if (r === "granted") {
            msg("oc-mic-avisos-msg", "Listo. Te avisaremos si este dispositivo queda fuera del loop.");
            /* Ya que el dueño dijo que sí a esto, se pide también que el
               navegador no borre los datos del negocio por falta de espacio.
               Va junto porque es el mismo gesto: "esto lo quiero en serio". */
            M.pedirPersistencia().then(function (ok) {
              if (ok) msg("oc-mic-avisos-msg", "Listo. Te avisaremos si este dispositivo queda fuera del loop, y el navegador ya no borrará tus datos por falta de espacio.");
            });
          } else if (r === "denied") {
            msg("oc-mic-avisos-msg", "Los dejaste bloqueados. El aviso en pantalla sigue funcionando igual.", "#B54E0A");
          } else {
            msg("oc-mic-avisos-msg", "Este navegador no puede mostrar avisos. El aviso en pantalla sigue funcionando.", "#2C3E50");
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
      '<h3 style="font-size:19px;margin:0 0 8px;color:#0F1923;">' + esc(d.nombre || "Nuevo miembro") + " ya está en tu equipo</h3>" +
      '<p style="font-size:15px;line-height:1.55;margin:0 0 12px;color:#2C3E50;">Lo agregaste desde tu tablero. Este es su PIN, y solo se muestra ahora:</p>' +
      '<div style="text-align:center;font-family:var(--font-mono,monospace);font-size:38px;font-weight:700;' +
      'letter-spacing:.14em;color:#0F1923;background:#F8F9FB;border-radius:11px;padding:15px;margin:0 0 12px;">' +
      esc(d.pin) + "</div>" +
      '<p style="font-size:15px;line-height:1.55;margin:0 0 14px;color:#2C3E50;">Dáselo en persona. No aparece en el tablero ni vuelve a aparecer aquí: si se pierde, se le pone uno nuevo desde Avanzado.</p>' +
      '<button type="button" id="oc-alta-x" style="width:100%;min-height:48px;padding:12px;border-radius:10px;' +
      'border:none;background:#E86040;color:#FFFFFF;-webkit-text-fill-color:#FFFFFF;font-size:16px;font-weight:700;cursor:pointer;">Ya lo anoté</button>' +
      "</div>";
    document.body.appendChild(m);
    var cerrar = function () { try { m.remove(); } catch (_) {} };
    document.getElementById("oc-alta-x").addEventListener("click", cerrar);
    /* A proposito NO se cierra tocando afuera ni con Escape: cerrarlo sin
       querer significa perder el PIN. Solo el boton lo cierra. */
  });

  window.OCMicelioUI = { pintarPanel: pintarPanel, refrescar: refrescar, comoSeLlama: comoSeLlama };
})();
