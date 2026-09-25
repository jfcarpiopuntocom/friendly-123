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

/* ============================================================================
   A4 — AUTODIAGNOSTICO DE VERSION (JFC 2026-08-19)

   EL BUG QUE ESTO ATRAPA, y que ya nos costo un dia: se cambia un archivo del
   shell y no se sube el CACHE de sw.js. El service worker sigue sirviendo el
   shell viejo cacheado, la pagina carga una MEZCLA de version vieja y nueva, y
   Avanzado se ve roto sin que haya un solo error en el codigo de Avanzado. En
   localhost es invisible: ahi no hay service worker. Solo aparece en un
   telefono que YA tiene la app instalada, o sea el del cliente.

   COMO SE DETECTA: el service worker es el unico que sabe de verdad que shell
   esta sirviendo. Se le pregunta, y se compara con el shell que declara
   version.json, que el propio SW tiene prohibido cachear. Si no coinciden, el
   dispositivo quedo a medias y se le ofrece recargar.

   POR QUE NO RECARGA SOLO: una recarga automatica en medio de una venta le
   borra al usuario lo que estaba tecleando. Se avisa y decide el.

   PARA QUE SIGA FUNCIONANDO: el campo "shell" de docs/version.json tiene que
   moverse junto con el CACHE de docs/sw.js. Lo comprueba check-sw.sh.
   ============================================================================ */
(function autodiagnosticoDeVersion() {
  "use strict";
  try {
    if (!("serviceWorker" in navigator)) return;

    function ofrecerRecarga(esperado, sirviendo) {
      try {
        if (document.getElementById("oc-version-vieja")) return;
        var esES = false;
        try { esES = !!(window.OCI18n && window.OCI18n.getLang() === "es"); } catch (_) {}
        var d = document.createElement("div");
        d.id = "oc-version-vieja";
        d.setAttribute("role", "status");
        d.style.cssText = "position:fixed;bottom:0;left:0;right:0;z-index:10002;background:#0F1923;border-top:3px solid #E8A020;padding:12px 16px;text-align:center;";
        d.innerHTML =
          '<span style="color:#FFFFFF !important;-webkit-text-fill-color:#FFFFFF !important;font-size:15px;font-weight:700;">' +
          (esES ? "Hay una version mas nueva de la app. Recarga para tenerla completa."
                : "A newer version of the app is available. Reload to get all of it.") +
          '</span> <button type="button" id="oc-version-recargar" style="margin-left:10px;min-height:44px;padding:9px 18px;border-radius:8px;border:2px solid #E8A020;background:#E8A020;color:#0F1923 !important;-webkit-text-fill-color:#0F1923 !important;font-size:15px;font-weight:700;cursor:pointer;">' +
          (esES ? "Recargar" : "Reload") + "</button>";
        (document.body || document.documentElement).appendChild(d);
        document.getElementById("oc-version-recargar").addEventListener("click", function () {
          /* Se limpian las caches del shell ANTES de recargar: si no, el mismo
             service worker vuelve a servir lo viejo y el boton no hace nada. */
          var fin = function () { try { location.reload(); } catch (_) {} };
          try {
            caches.keys().then(function (ns) {
              /* 2026-09-25 (canarios): solo las caches de ESTE canal; las de /next/ o
                 /previo/ son la copia offline de las otras versiones del aparato. */
              var suf = (/\/(next|previo)\//.exec(location.pathname) || [])[1];
              return Promise.all(ns.filter(function (n) { var m = /-(next|previo)$/.exec(n); return n.indexOf("f123-shell-") === 0 && (suf ? (m && m[1] === suf) : !m); })
                                   .map(function (n) { return caches.delete(n); }));
            }).then(fin, fin);
          } catch (_) { fin(); }
        });
        try {
          if (window.AMG && window.AMG.Salud && window.AMG.Salud.registrar) {
            window.AMG.Salud.registrar("shell desincronizado: sirviendo " + sirviendo + ", esperado " + esperado, "sw.js", 0);
          }
        } catch (_) {}
      } catch (_) {}
    }

    function comprobar() {
      var ctrl = navigator.serviceWorker.controller;
      if (!ctrl) return;   // sin SW controlando no hay nada que comparar
      fetch("version.json", { cache: "no-store" })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (v) {
          if (!v || !v.shell) return;   // version.json viejo, sin el campo: no se opina
          var respondio = false;
          var canal = new MessageChannel();
          canal.port1.onmessage = function (e) {
            respondio = true;
            var sirviendo = e.data && e.data.shell;
            if (sirviendo && sirviendo !== v.shell) { window.__ocMezcla = true; ofrecerRecarga(v.shell, sirviendo); }
          };
          try { ctrl.postMessage({ tipo: "que-shell" }, [canal.port2]); } catch (_) {}
          /* Respaldo: un SW viejo no conoce el mensaje y no contesta nunca.
             Ese silencio ya es la respuesta —esta desactualizado— pero no se
             avisa por las dudas: sin saber que shell sirve, un aviso podria ser
             falso. Se deja anotado en consola para el proximo que investigue. */
          setTimeout(function () {
            if (!respondio) { try { console.warn("[version] el service worker no contesto que shell sirve; probablemente sea anterior a v72"); } catch (_) {} }
          }, 3000);
        })
        .catch(function () { /* sin red: no se opina de versiones */ });
    }

    /* Se comprueba una vez, ya cargada la pagina, para no competir con el
       arranque. No se repite en bucle: el shell no cambia mientras la pestana
       vive. */
    if (document.readyState === "complete") setTimeout(comprobar, 2500);
    else window.addEventListener("load", function () { setTimeout(comprobar, 2500); });
  } catch (_) { /* el autodiagnostico es un extra: jamas puede tumbar la app */ }
})();

/* ============================================================================
   R5 — INTEGRIDAD DE ASSETS CACHEADOS (JFC 2026-08-20, complemento de A4)

   QUE ATRAPA: A4 ya compara que shell esta sirviendo el service worker
   contra version.json. Le falta un nivel: un archivo INDIVIDUAL puede
   quedar truncado o corrupto dentro de CacheStorage (ej. la conexion se
   corto a mitad de un cache.add() durante la instalacion) sin que el
   numero de CACHE cambie ni A4 detecte nada -- el shell "coincide", pero
   uno de sus archivos esta roto.

   COMO SE DETECTA, barato: cada carga compara el Content-Length de UNA
   muestra chica de archivos cacheados (no todos: eso pesaria en cada
   carga) contra el tamano real que reporta una peticion de red fresca
   (cache:"reload", igual que hace el propio precache). Si difieren, se
   borra esa entrada de la cache y se vuelve a pedir con reload -- el
   proximo load ya sirve el archivo integro. Sin aviso al usuario: esto es
   autocuracion silenciosa, no un error que necesite su atencion.

   MUESTREO, no barrido completo: 3 archivos al azar por carga. Con uso
   normal, todo el shell queda cubierto en pocas cargas sin que ninguna
   carga individual pague el costo de verificar decenas de archivos. */
(function verificarIntegridadCacheada() {
  "use strict";
  try {
    if (!("caches" in window) || !("serviceWorker" in navigator)) return;

    function candidatos() {
      // Mismo SHELL logico que sw.js, pero solo scripts .js (los .html/.png
      // cambian de forma que no vale la pena verificar por tamano: png tiene
      // su propio checksum de formato, html rara vez se trunca sin que A4 ya
      // lo note por el numero de shell).
      var scripts = Array.prototype.slice.call(document.querySelectorAll('script[src$=".js"]'));
      return scripts.map(function (s) { try { return new URL(s.src, location.href).pathname.split("/").pop(); } catch (_) { return null; } }).filter(Boolean);
    }

    function elegirMuestra(lista, n) {
      var copia = lista.slice(), out = [];
      while (copia.length && out.length < n) {
        var i = Math.floor(Math.random() * copia.length);
        out.push(copia.splice(i, 1)[0]);
      }
      return out;
    }

    async function verificarUno(nombre, esperado) {
      try {
        var cache = await caches.open(/* misma CACHE activa */ (await caches.keys()).filter(function (n) { return n.indexOf("f123-shell-") === 0; }).pop() || "");
        var cacheada = await cache.match("./" + nombre);
        if (!cacheada) return; // no esta cacheado todavia, nada que verificar
        /* JFC 2026-08-28 (sistema de integridad de versión): en vez de comparar
           Content-Length (que puede coincidir con contenido corrupto), se
           compara el SHA-256 real del archivo cacheado contra el hash esperado
           del version-manifest.json. Si no cuadra, se re-pide a la red y se
           repara la copia. */
        if (esperado && esperado.indexOf("sha256-") === 0) {
          var txt = await cacheada.clone().text();
          var buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(txt));
          var hex = Array.from(new Uint8Array(buf)).map(function (b) { return b.toString(16).padStart(2, "0"); }).join("");
          if (("sha256-" + hex) === esperado) return; // integro, nada que hacer
          try { console.warn("[integridad] " + nombre + " no cuadra con el manifest -- reparando."); } catch (_) {}
          var fresca = await fetch("./" + nombre, { cache: "reload" });
          if (fresca.ok) await cache.put("./" + nombre, fresca.clone());
          return;
        }
        // Fallback (sin manifest): comparación por tamaño, como antes.
        var tamCacheado = Number(cacheada.headers.get("content-length")) || (await cacheada.clone().blob()).size;
        var fresca = await fetch("./" + nombre, { cache: "reload" });
        if (!fresca.ok) return; // sin red util ahora mismo: no se opina
        var tamFresco = Number(fresca.headers.get("content-length")) || (await fresca.clone().blob()).size;
        if (tamCacheado > 0 && tamFresco > 0 && tamCacheado !== tamFresco) {
          try { console.warn("[integridad] " + nombre + " estaba truncado en cache (" + tamCacheado + " vs " + tamFresco + " bytes) -- reparado."); } catch (_) {}
          await cache.put("./" + nombre, fresca.clone());
        }
      } catch (_) { /* verificacion best-effort: cualquier fallo se ignora */ }
    }

    async function correr() {
      var lista = candidatos();
      if (!lista.length) return;
      /* Cargar el manifest una vez (cache:"no-store" para no usar una copia
         vieja) y verificar la muestra contra sus hashes. */
      var hashes = null;
      try {
        var man = await fetch("./version-manifest.json", { cache: "no-store" });
        if (man.ok) { var j = await man.json(); if (j && j.files) hashes = j.files; }
      } catch (_) {}
      var muestra = elegirMuestra(lista, 3);
      for (var i = 0; i < muestra.length; i++) {
        var esperado = hashes ? (hashes["./" + muestra[i]] || null) : null;
        await verificarUno(muestra[i], esperado);
      }
    }

    if (document.readyState === "complete") setTimeout(correr, 4000);
    else window.addEventListener("load", function () { setTimeout(correr, 4000); });
  } catch (_) { /* la verificacion de integridad es un extra: jamas puede tumbar la app */ }
})();

/* ============================================================================
   CANARIO DE LA APP (plan canarios F3, JFC 2026-09-25)
   Resumen de salud que viaja en el latido (auth-ui.js) y alimenta el Sonar de
   Canarios del panel de JFC. SOLO numeros y codigos, armados aqui campo por
   campo: shell, canal, errores de ESTA sesion, scripts caidos a github.io,
   origen retenido, mezcla de versiones y, en el aparato lord entrando como
   dueno, si Commissions cuadra contra Sold. Cero datos del negocio.
   El chequeo de cuadre compara DOS rutas independientes del mismo dinero
   (/api/ventas/todas vs /api/comisiones/cuadre), ambas sobre ventasActivas.
   Si falla, el canario del Worker se pone en rojo y el shell no llega a los
   clientes (promover.yml). Solo lee: nunca corrige nada.
   ============================================================================ */
(function (global) {
  "use strict";
  var h53 = function(str){var h1=0xdeadbeef,h2=0x41c6ce57;for(var i=0,ch;i<str.length;i++){ch=str.charCodeAt(i);h1=Math.imul(h1^ch,2654435761);h2=Math.imul(h2^ch,1597334677);}h1=Math.imul(h1^(h1>>>16),2246822507)^Math.imul(h2^(h2>>>13),3266489909);h2=Math.imul(h2^(h2>>>16),2246822507)^Math.imul(h1^(h1>>>13),3266489909);return 4294967296*(2097151&h2)+(h1>>>0);};
  var erroresSesion = 0;
  /* NODOS DEL SONAR (JFC 2026-09-25: "el sonar muestra la app y sus nodos ... rojos si
     algo se rompio, para saber donde"). Cada error se anota en la SECCION donde estaba
     la persona (id fijo de la lista blanca), nunca con datos del negocio. */
  var NODOS = ["hoy", "escanear", "inventario", "perchas", "clientes", "comisiones", "gastos", "etiquetas", "avanzado", "arranque"];
  var porNodo = {};
  function nodoActual() {
    try { var b = global.document.querySelector("nav button.activo"); var v = b && b.dataset ? b.dataset.vista : ""; return NODOS.indexOf(v) >= 0 ? v : "arranque"; }
    catch (_) { return "arranque"; }
  }
  function anotar() { erroresSesion++; var n = nodoActual(); porNodo[n] = (porNodo[n] || 0) + 1; }
  try {
    global.addEventListener("error", anotar);
    global.addEventListener("unhandledrejection", anotar);
  } catch (_) {}
  var shell = "";
  try {
    fetch("version.json", { cache: "no-store" }).then(function (r) { return r.ok ? r.json() : null; })
      .then(function (v) { if (v && v.shell) shell = String(v.shell); }).catch(function () {});
  } catch (_) {}
  function canal() { var m = /\/(next|previo)\//.exec(global.location ? global.location.pathname : ""); return m ? m[1] : "estable"; }
  function norm(x) { return typeof x === "string" ? x.trim().toUpperCase().replace(/\s+/g, "") : ""; }
  function esLord() {
    try {
      var o = JSON.parse(global.localStorage.getItem("f123_owned") || "null") || {};
      return [norm(o.licenseCode), norm(o.syncCode)].some(function (l) { return l && h53(l) === 6583453063440131; });
    } catch (_) { return false; }
  }
  function rolActual() { try { return global.OCAuth && global.OCAuth.rolActual ? global.OCAuth.rolActual() : ""; } catch (_) { return ""; } }
  var cuadre = null;
  function medirCuadre() {
    if (!esLord() || rolActual() !== "dueno") return Promise.resolve(cuadre);
    var leer = function (u) { return fetch(u).then(function (r) { return r.json(); }); };
    return Promise.all([leer("/api/ventas/todas"), leer("/api/comisiones/cuadre")]).then(function (par) {
      var ventas = Array.isArray(par[0]) ? par[0] : [], c = par[1] || {};
      var ce = function (n) { return Math.round((Number(n) || 0) * 100); };
      var delMes = ventas.filter(function (v) { return v.delMesActual; });
      var total = delMes.reduce(function (a, v) { return a + ce((Number(v.precioUnit) || 0) * (Number(v.cantidad) || 0)); }, 0);
      var ok = total === ce(c.totalVentas) && delMes.length === Number(c.ventas);
      // Cada venta: comision + neto de la casa = bruto (misma regla R1 del verificador de pruebas).
      ventas.forEach(function (v) {
        if (v.netoCasa === null || v.netoCasa === undefined) return;
        if (ce(v.comisionAsociado) + ce(v.netoCasa) !== ce((Number(v.precioUnit) || 0) * (Number(v.cantidad) || 0))) ok = false;
      });
      cuadre = ok ? "ok" : "fallo";
      return cuadre;
    }).catch(function () { return cuadre; });
  }
  function resumen() {
    var e = {};
    try { e = global.OCCargador && global.OCCargador.estado ? global.OCCargador.estado() : {}; } catch (_) {}
    return { shell: shell, canal: canal(), errores: erroresSesion, caidas: Number(e.caidas) || 0,
      retenido: !!e.retenido, mezcla: global.__ocMezcla === true, cuadre: cuadre,
      nodos: NODOS.reduce(function (o, k) { if (porNodo[k]) o[k] = porNodo[k]; return o; }, {}) };
  }
  global.OCSalud = { resumen: resumen, medirCuadre: medirCuadre, esLord: esLord, canal: canal };
})(typeof window !== "undefined" ? window : this);
