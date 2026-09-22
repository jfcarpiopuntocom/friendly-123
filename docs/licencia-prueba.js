/* licencia-prueba.js — prueba completa por tiempo en friendly-123.
   ─────────────────────────────────────────────────────────────────────
   DECISIÓN DE JFC (2026-09-22). No cambiar sin orden expresa suya.
     - PIN 456 = demo con datos de ejemplo. Nunca vence ni se bloquea.
     - PIN 789 (activación) = uso COMPLETO, sin topes, durante PRUEBA_DIAS.
     - Al vencer sin licencia pagada: SOLO LECTURA (ve y exporta todo, no
       registra nada nuevo) + invitación a comprar por WhatsApp y correo, en un
       modal y en Ayuda. Los datos del cliente NUNCA se borran.
     - Pagado = licenseEstado "full", que JFC marca en su panel. El Worker lo
       extiende a TODOS los aparatos de esa licencia (ver worker.js, "LICENCIA
       PAGADA = TODA LA LICENCIA").
     - Aparatos ya activados antes de este cambio: el reloj corre desde el día
       en que este código los ve por primera vez, no desde su activación vieja
       (JFC: "desde HOY").
     - amigable-123 y consultorio-123 NO usan este módulo: cada app tiene su
       propio modelo (amigable: tier gratis por uso; consultorio: sin tier).

   Duración: 30 días. JFC dejó la regla "45 solo si no convierte MUCHO menos
   que 30; si convierte menos, 30". Los datos públicos no miden 45 días
   directamente; la tendencia (7d 24%, 14d 19%, 30d 14%; Basecamp: 30 días
   convirtió 30% más que 60) sugiere que 45 convierte algo menos, así que 30.
   Cambiar SOLO la constante PRUEBA_DIAS: los textos de la UI la leen de aquí.
   EXCEPCIÓN: dos páginas estáticas no pueden leerla y dicen "30" a mano:
   docs/save.html (2 frases) y docs/checklist.html (el botón). Actualizarlas
   junto con la constante.

   SEGURIDAD PARA EL CLIENTE QUE PAGA — la regla más importante del archivo:
   todo falla ABIERTO. Si este módulo no carga, si localStorage no se puede
   leer o si algo lanza, la app NO se bloquea. Un error aquí jamás puede
   dejar en solo lectura a un cliente que pagó.

   LÍMITE HONESTO: el reloj vive en el aparato. Quien cambie la fecha del
   sistema o borre la clave puede alargar la prueba; borrar el almacenamiento
   también le borra su negocio, así que el incentivo es bajo. Es una
   invitación comercial, no un DRM. */
(function () {
  "use strict";

  var PRUEBA_DIAS = 30;
  var DIA_MS = 24 * 60 * 60 * 1000;
  var CLAVE_INICIO = "f123_prueba_inicio";
  // Contacto de venta: el WhatsApp que ya usan las 3 apps y el correo de staff
  // que ya aparece en el código (elegidos por JFC el 2026-09-22).
  var WHATSAPP = "593999905080";
  var CORREO = "staff@jfcarpio.com";

  /* Rutas que siguen funcionando aunque la prueba haya vencido. Todo lo demás
     que escribe queda bloqueado por defecto: así una ruta nueva de ventas
     queda cubierta sin que nadie se acuerde de sumarla aquí.
     /api/escanear es POST pero SOLO BUSCA un producto (no vende): escanear
     para consultar es "ver", y tiene que seguir funcionando. */
  var RUTAS_PERMITIDAS = [
    "/api/usuarios/verificar",   // entrar con PIN
    "/api/instancia/activar",    // cargar la licencia comprada
    "/api/instancia",            // datos de la instancia
    "/api/escanear",             // búsqueda por código, no vende
    "/api/respaldo/exportar",    // su información siempre es suya
    "/api/actividad"
  ];

  function t(clave, respaldo, vars) {
    try {
      if (vars && window.tf) return window.tf(clave, vars);
      if (window.t) { var v = window.t(clave); if (v && v !== clave) return v; }
    } catch (_) {}
    return respaldo;
  }

  function owned() {
    try { return JSON.parse(localStorage.getItem("f123_owned") || "null"); } catch (_) { return null; }
  }

  /* Estado de la prueba de ESTE aparato.
       aplica:false -> demo, sin activar, o licencia pagada: nunca se bloquea.
       aplica:true  -> activado sin pago; vencida dice si ya pasó el plazo. */
  function estado() {
    try {
      var o = owned();
      if (!o || !(o.instanceId || o.licenseCode)) return { aplica: false, motivo: "sin-activar" };
      if (o.licenseEstado === "full") return { aplica: false, pagada: true };
      var ini = Number(localStorage.getItem(CLAVE_INICIO)) || 0;
      if (!ini) {
        ini = Date.now();
        try { localStorage.setItem(CLAVE_INICIO, String(ini)); } catch (_) {}
      }
      var vence = ini + PRUEBA_DIAS * DIA_MS;
      var restante = vence - Date.now();
      return {
        aplica: true,
        vencida: restante <= 0,
        diasRestantes: Math.max(0, Math.ceil(restante / DIA_MS)),
        vence: vence
      };
    } catch (_) {
      return { aplica: false, motivo: "error" }; // falla abierto
    }
  }

  function rutaPermitida(path) {
    var p = String(path || "");
    if (p.indexOf("/api/sync") === 0) return true; // recibir cambios de otros aparatos
    return RUTAS_PERMITIDAS.indexOf(p) !== -1;
  }

  /* La consulta que usa mock-backend antes de cada escritura. Devuelve true
     SOLO si hay certeza: activado, sin pago, prueba vencida, no es demo y la
     ruta escribe algo de negocio. Cualquier duda -> false (no bloquear). */
  function bloquea(path) {
    try {
      if (window.OCAuth && window.OCAuth.esDemo && window.OCAuth.esDemo()) return false;
      if (rutaPermitida(path)) return false;
      var e = estado();
      return !!(e && e.aplica && e.vencida);
    } catch (_) { return false; }
  }

  function mensajeError() {
    return t("prueba.errorEscritura",
      "Your " + PRUEBA_DIAS + "-day trial has ended, so the app is read-only: you can view and export your data. To keep recording, get your license: WhatsApp +593 99 990 5080 or " + CORREO + ".",
      { dias: PRUEBA_DIAS });
  }

  function enlaces() {
    var o = owned() || {};
    var lic = String(o.licenseCode || "").trim();
    var msj = t("prueba.waMensaje", "Hi! I want to buy my friendly-123 license. License: {lic}", { lic: lic || "—" });
    return {
      wa: "https://wa.me/" + WHATSAPP + "?text=" + encodeURIComponent(msj),
      mail: "mailto:" + CORREO + "?subject=" + encodeURIComponent(t("prueba.correoAsunto", "friendly-123 license")) +
            "&body=" + encodeURIComponent(msj)
    };
  }

  // Estilos: tinta sólida, nada de opacidad en texto, esquinas completas,
  // botones de 48px, y texto blanco forzado para el modo oscuro de iOS.
  function botonesCompra() {
    var e = enlaces();
    var base = "display:block;box-sizing:border-box;width:100%;min-height:48px;padding:13px 14px;margin:0 0 10px;" +
      "border-radius:10px;font-size:16px;font-weight:800;text-align:center;text-decoration:none;" +
      "color:#FFFFFF !important;-webkit-text-fill-color:#FFFFFF !important;";
    return '<a href="' + e.wa + '" target="_blank" rel="noopener" style="' + base +
      'background:#1a6e3c;border:2px solid #0f4a27;">' + t("prueba.whatsapp", "Buy via WhatsApp") + '</a>' +
      '<a href="' + e.mail + '" style="' + base +
      'background:#2c4a68;border:2px solid #1c3049;">' + t("prueba.correo", "Buy by email") + ' · ' + CORREO + '</a>';
  }

  var _ultimoModal = 0;
  function mostrarModal() {
    try {
      // Una vez cada 10 minutos como mucho: si varias escrituras rebotan
      // seguidas, no se apilan modales encima del usuario.
      if (Date.now() - _ultimoModal < 10 * 60 * 1000) return;
      if (document.getElementById("oc-prueba-modal")) return;
      _ultimoModal = Date.now();
      var cont = document.createElement("div");
      cont.id = "oc-prueba-modal";
      cont.setAttribute("role", "dialog");
      cont.setAttribute("aria-modal", "true");
      cont.style.cssText = "position:fixed;inset:0;z-index:10050;background:rgba(15,25,35,0.86);display:flex;" +
        "align-items:center;justify-content:center;padding:18px;overflow-y:auto;";
      cont.innerHTML =
        '<div style="background:#FFF8E8;border:2px solid #5294AC;border-radius:12px;max-width:420px;width:100%;' +
        'padding:24px 20px;box-sizing:border-box;">' +
          '<h2 style="margin:0 0 10px;font-size:21px;line-height:1.25;color:#0F1923 !important;-webkit-text-fill-color:#0F1923 !important;">' +
            t("prueba.modalTitulo", "Your " + PRUEBA_DIAS + "-day trial has ended", { dias: PRUEBA_DIAS }) + '</h2>' +
          '<p style="margin:0 0 18px;font-size:16px;line-height:1.5;color:#211c14 !important;-webkit-text-fill-color:#211c14 !important;">' +
            t("prueba.modalTexto", "Your data is safe and stays on your devices. You can still view and export everything. To keep recording sales, get your friendly-123 license.") + '</p>' +
          botonesCompra() +
          '<button type="button" id="oc-prueba-cerrar" style="display:block;width:100%;min-height:48px;margin-top:4px;' +
          'border-radius:10px;border:2px solid #2c4a68;background:#FFFFFF;font-size:16px;font-weight:700;cursor:pointer;' +
          'color:#2c4a68 !important;-webkit-text-fill-color:#2c4a68 !important;">' + t("prueba.cerrar", "Close") + '</button>' +
        '</div>';
      document.body.appendChild(cont);
      var cerrar = function () { try { cont.remove(); } catch (_) {} };
      cont.querySelector("#oc-prueba-cerrar").addEventListener("click", cerrar);
      cont.addEventListener("click", function (ev) { if (ev.target === cont) cerrar(); });
    } catch (_) {}
  }

  // Bloque de Ayuda: estado de la licencia + cómo comprarla. Solo en la guía
  // del dueño (help-ui.js deja el hueco #oc-help-licencia).
  function pintarAyuda(raiz) {
    try {
      if (!raiz) return;
      raiz.querySelectorAll(".oc-prueba-dias").forEach(function (s) { s.textContent = String(PRUEBA_DIAS); });
      var hueco = raiz.querySelector("#oc-help-licencia");
      if (!hueco) return;
      var e = estado();
      var linea;
      if (e.pagada) linea = t("prueba.ayudaPagada", "Full license active.");
      else if (!e.aplica) linea = t("prueba.ayudaSinActivar", "Activate this device (PIN 789) to start your full {dias}-day trial.", { dias: PRUEBA_DIAS });
      else if (e.vencida) linea = t("prueba.ayudaVencida", "Trial ended: read-only until you get your license. Your data is never deleted.");
      else linea = t("prueba.ayudaRestan", "Full trial: {dias} days left.", { dias: e.diasRestantes });
      hueco.innerHTML =
        '<h3>' + t("prueba.ayudaTitulo", "Your license") + '</h3>' +
        '<p style="font-size:15px;line-height:1.5;margin:0 0 12px;font-weight:700;color:#211c14 !important;-webkit-text-fill-color:#211c14 !important;">' + linea + '</p>' +
        (e.pagada ? '' : '<p style="font-size:14px;line-height:1.5;margin:0 0 10px;color:#211c14 !important;-webkit-text-fill-color:#211c14 !important;">' +
          t("prueba.ayudaComprar", "Get your license:") + '</p>' + botonesCompra());
    } catch (_) {}
  }

  // Al entrar a la app con la prueba vencida, se muestra la invitación.
  try {
    window.addEventListener("oc-login", function (ev) {
      try {
        if (ev && ev.detail && ev.detail.demo) return;
        var e = estado();
        if (e.aplica && e.vencida) setTimeout(mostrarModal, 400);
      } catch (_) {}
    });
    // mock-backend avisa cada vez que rechaza una escritura por prueba vencida.
    window.addEventListener("oc-prueba-vencida", function () { mostrarModal(); });
  } catch (_) {}

  window.OCPrueba = {
    PRUEBA_DIAS: PRUEBA_DIAS,
    estado: estado,
    bloquea: bloquea,
    rutaPermitida: rutaPermitida,
    mensajeError: mensajeError,
    mostrarModal: mostrarModal,
    pintarAyuda: pintarAyuda
  };
})();
