/*!
 * salud-app.js — friendly-123 · Autorreporte de fallas de la app
 * ============================================================================
 * QUE ES: la app avisa sola cuando se rompe, para poder arreglarlo ANTES de
 * que un cliente se queje. Nada mas.
 *
 * QUE NO ES, y esto es lo que decide todo el diseño: NO es telemetria de
 * negocio. NO manda productos, ni ventas, ni clientes, ni saldos, ni nombres,
 * ni montos. La regla NO CLOUD sigue intacta, y no por promesa sino por
 * construccion: este modulo arma el payload por LISTA BLANCA. Solo pueden
 * viajar los seis campos de abajo. Cualquier otra cosa, aunque alguien la meta
 * en el objeto de error, se queda fuera porque nunca se copia.
 *
 *   msg      texto del error, recortado y depurado
 *   archivo  nombre del .js, SIN la ruta ni el dominio
 *   linea    numero de linea
 *   ver      version de la app
 *   cuando   timestamp
 *   veces    cuantas veces se repitio ese mismo error
 *
 * POR QUE NO SENTRY NI UN CDN: no es dogma, son dos razones concretas.
 * Primero, estas apps tienen que arrancar sin internet, y un <script> de un
 * tercero en el head es un punto de fallo que no controlamos. Segundo, y mas
 * importante: un SDK de errores captura "breadcrumbs" por defecto, o sea el
 * estado de la UI y a veces el contenido de los campos. En una app de
 * inventario eso es nombres de clientes y montos saliendo del dispositivo. Se
 * puede desactivar, si, pero entonces el default juega en contra y basta una
 * actualizacion del SDK para que vuelva a activarse sin que nadie lo note.
 * Aca el default es "no sale nada" y hay que agregar codigo para que salga.
 *
 * LIMITE CONOCIDO DE LA DEPURACION, dicho para que nadie confie de mas:
 * se limpian correos, URLs y corridas largas de digitos, que es como se ven
 * los montos y telefonos. NO se pueden limpiar los NOMBRES: no hay forma
 * confiable de distinguir "Maria Gonzalez" de "ReferenceError" con una
 * expresion regular, y borrar de mas dejaria los errores inservibles.
 *
 * Por eso el verdadero guard NO esta aca, esta en la regla: NUESTRO CODIGO NO
 * INTERPOLA DATOS DE NEGOCIO EN UN new Error(). Los errores nativos del
 * navegador nunca traen datos del usuario; los unicos que podrian traerlos son
 * los que escribimos nosotros. Auditado el 2026-08-14: CERO ocurrencias en las
 * tres apps. Si algun dia agregas un throw, no le pongas el nombre del cliente
 * ni el monto adentro: pon el id y ya.
 *
 * COMO VIAJA: pegado al heartbeat de licencia que YA existe y que YA va al
 * Worker de JFC. Cero endpoints nuevos en el cliente, cero dependencias, cero
 * bytes de CDN. Ver "LADO SERVIDOR" al final de este archivo.
 *
 * SI FALLA ESTE MODULO no pasa absolutamente nada: la app no lo espera, no lo
 * consulta y no depende de el. Es un observador, nunca un participante.
 * ============================================================================
 */
(function (global) {
  "use strict";

  var CLAVE = "f123_salud_errores";
  var MAX = 25;              /* tope duro: nunca crece sin control */
  var MAX_MSG = 200;

  /* Depura el mensaje ANTES de guardarlo, no antes de enviarlo. Si nunca se
     guarda sucio, no hay forma de que salga sucio.
     Se quitan: rutas y dominios (delatan al usuario y no sirven para depurar),
     cualquier cosa con pinta de correo, y las corridas largas de digitos, que
     es como se ven los montos y los telefonos dentro de un mensaje de error. */
  function depurar(txt) {
    return String(txt == null ? "" : txt)
      .replace(/https?:\/\/[^\s)]+/g, "[url]")
      .replace(/[\w.+-]+@[\w.-]+/g, "[correo]")
      .replace(/\d{4,}/g, "[num]")
      .slice(0, MAX_MSG);
  }

  /* Del archivo solo interesa el nombre. La ruta completa no ayuda a depurar y
     puede incluir el dominio o el perfil del dispositivo. */
  function soloArchivo(src) {
    var s = String(src || "");
    var i = s.lastIndexOf("/");
    return (i >= 0 ? s.slice(i + 1) : s).split("?")[0].slice(0, 60);
  }

  function leer() {
    try { return JSON.parse(localStorage.getItem(CLAVE) || "[]"); } catch (_) { return []; }
  }
  function guardar(lista) {
    try { localStorage.setItem(CLAVE, JSON.stringify(lista.slice(-MAX))); } catch (_) {}
  }

  function version() {
    try { return String(global.APP_VERSION || (global.AMG_CONTEXT && global.AMG_CONTEXT.appVersion) || ""); }
    catch (_) { return ""; }
  }

  /* Registra un error. Agrupa por firma: el mismo error mil veces es UNA linea
     con veces:1000, no mil lineas. Sin esto, un error dentro de un bucle de
     render llena el tope en un segundo y tapa todo lo demas. */
  function registrar(msg, src, linea) {
    var lista = leer();
    var e = {
      msg: depurar(msg),
      archivo: soloArchivo(src),
      linea: Number(linea) || 0,
      ver: version(),
      cuando: new Date().toISOString(),
      veces: 1
    };
    var firma = e.msg + "|" + e.archivo + "|" + e.linea;
    for (var i = 0; i < lista.length; i++) {
      var o = lista[i];
      if (o && (o.msg + "|" + o.archivo + "|" + o.linea) === firma) {
        o.veces = (o.veces || 1) + 1;
        o.cuando = e.cuando;
        guardar(lista);
        return;
      }
    }
    lista.push(e);
    guardar(lista);
  }

  /* Lo que se adjunta al heartbeat. LISTA BLANCA explicita: se construye un
     objeto nuevo campo por campo. Nunca se pasa el objeto guardado tal cual,
     justamente para que agregar un campo al store no lo publique sin querer. */
  function paraEnviar() {
    var lista = leer();
    if (!lista.length) return null;
    return lista.slice(-10).map(function (e) {
      return {
        msg: String(e.msg || "").slice(0, MAX_MSG),
        archivo: String(e.archivo || "").slice(0, 60),
        linea: Number(e.linea) || 0,
        ver: String(e.ver || "").slice(0, 24),
        cuando: String(e.cuando || "").slice(0, 30),
        veces: Number(e.veces) || 1
      };
    });
  }

  /* Se limpia solo DESPUES de que el heartbeat confirmo. Si el envio falla, los
     errores se quedan y viajan en el proximo: nunca se pierde un reporte por
     un wifi caido. */
  function limpiar() {
    try { localStorage.removeItem(CLAVE); } catch (_) {}
  }

  /* Captura global. Convive con la caja negra local que ya existia (que sigue
     guardando los ultimos 10 sin depurar, para soporte en el propio equipo):
     son dos cosas distintas y ninguna reemplaza a la otra. */
  global.addEventListener("error", function (ev) {
    try { registrar(ev.message, ev.filename, ev.lineno); } catch (_) {}
  });
  global.addEventListener("unhandledrejection", function (ev) {
    try {
      var r = ev.reason;
      registrar((r && r.message) || String(r), (r && r.stack ? soloArchivo(String(r.stack).split("\n")[1] || "") : "promesa"), 0);
    } catch (_) {}
  });

  global.AMG = global.AMG || {};
  global.AMG.Salud = {
    VERSION: "1.0.0",
    registrar: registrar,
    paraEnviar: paraEnviar,
    limpiar: limpiar,
    leer: leer
  };
})(typeof window !== "undefined" ? window : this);

/* ============================================================================
   LADO SERVIDOR — PENDIENTE DE DESPLIEGUE POR JFC
   ----------------------------------------------------------------------------
   Hasta que el Worker guarde este campo, los errores se juntan en el
   dispositivo y NO llegan a nadie. El cliente ya los manda; falta recibirlos.

   En cloudflare-worker/worker.js, dentro de handleCheckin(), despues de leer
   el body y ANTES de guardarConHistorial:

     // Autorreporte de fallas de la app. Solo campos tecnicos, por lista
     // blanca del lado cliente (ver docs/salud-app.js). Tope duro para que
     // nadie llene el KV: 10 entradas, y el payload total ya esta capado en
     // 4096 bytes mas arriba.
     if (Array.isArray(body.errores) && body.errores.length) {
       reg.errores = body.errores.slice(0, 10).map(e => ({
         msg: String(e.msg || "").slice(0, 200),
         archivo: String(e.archivo || "").slice(0, 60),
         linea: Number(e.linea) || 0,
         ver: String(e.ver || "").slice(0, 24),
         cuando: String(e.cuando || "").slice(0, 30),
         veces: Number(e.veces) || 1
       }));
       reg.erroresAt = Date.now();
     }

   Y en docs/panel.html, una columna que muestre reg.errores por instancia,
   ordenada por erroresAt. Ahi se ve que se esta rompiendo y en que version,
   antes de que nadie llame.
   ============================================================================ */
