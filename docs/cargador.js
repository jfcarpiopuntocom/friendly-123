/*!
 * cargador.js — friendly-123 · Cargador de codigo (Bloque P, JFC 2026-09-24)
 * ============================================================================
 * POR QUE EXISTE. JFC eligio proteger la app contra clones con un CARGADOR:
 * la puerta sigue siendo github.io (ahi estan los datos: localStorage e
 * IndexedDB son por ORIGEN; mover la puerta perderia el cuaderno de cada
 * aparato), pero el codigo puede venir de un origen que controla JFC
 * (Hostinger). Lo que no esta en el repo publico no se puede clonar.
 *
 * COMO FUNCIONA (fase A, canario):
 *   - index.html le pasa una LISTA de scripts (los ultimos de la pagina, que
 *     ya toleraban cargar tarde: se cuidan solos con readyState).
 *   - Si hay un ORIGEN remoto activo, cada script se pide ahi con CORS
 *     (crossorigin=anonymous). Si falla o tarda mas de TIMEOUT_MS, se pide el
 *     MISMO archivo a github.io (fallback local). Nunca deja a nadie afuera:
 *     FALLA ABIERTA, igual que el SRI del service worker.
 *   - Sin origen remoto: carga local, en el mismo orden, y no cambia nada.
 *   - Uno por uno y en orden (inspector-ui.js depende de inspector.js).
 *
 * DE DONDE SALE EL ORIGEN (de mayor a menor prioridad):
 *   1. localStorage["f123_origen_codigo"] = URL  -> canario en ESTE aparato.
 *      "0" fuerza local aunque el meta diga otra cosa (escotilla).
 *   2. <meta name="oc-origen-codigo" content="URL"> en index.html -> para
 *      TODOS los aparatos (fase C). Hoy va vacio a proposito.
 *   Solo se acepta https://. La URL termina en "/" y apunta a la carpeta
 *   docs/ del repo en Hostinger (ej. https://dominio/friendly-123/docs/).
 *
 * MEDICION (regla de JFC: medir antes de prometer): cuando hay origen remoto
 * se compara version.json remoto vs local y se anota `desfase` en estado().
 * Advanced muestra texto() en una linea (avanzado-extra.js).
 *
 * TRAMPAS CONOCIDAS:
 *   - El service worker deja pasar (no cachea) los hosts que no estan en
 *     HOSTS_PERMITIDOS: el codigo remoto no queda en el precache. Es a
 *     proposito en fase A (medir primero). Cuando se sume el host al SW
 *     tambien habra que decidir la estrategia de cache.
 *   - Sin cabecera Access-Control-Allow-Origin en Hostinger (docs/.htaccess)
 *     el navegador rechaza el script y este cargador cae a local: se vera
 *     "fell back" en Advanced. Esa es la senal de que falta el .htaccess.
 *   - Sin SRI a proposito: el manifiesto puede quedar con hashes CRLF en
 *     Windows (ver CLAUDE.md) y un integrity fallido bloquea el script. La
 *     confianza es HTTPS + dominio propio, igual que hoy con github.io.
 */
(function (global) {
  "use strict";

  var CLAVE = "f123_origen_codigo";
  var TIMEOUT_MS = 8000;
  var estado = { origen: "", modo: "local", cargados: [], caidas: 0, desfase: null, listo: false, error: "" };

  function documento() { return global.document; }

  function normalizar(url) {
    url = String(url || "").trim();
    if (!url) return "";
    if (!/^https:\/\//i.test(url)) return "";
    if (url.charAt(url.length - 1) !== "/") url += "/";
    return url;
  }

  function leerMeta() {
    try {
      var d = documento();
      var m = d && d.querySelector && d.querySelector('meta[name="oc-origen-codigo"]');
      return m ? (m.getAttribute("content") || "") : "";
    } catch (_) { return ""; }
  }

  function leerCanario() {
    try { return global.localStorage ? (global.localStorage.getItem(CLAVE) || "") : ""; } catch (_) { return ""; }
  }

  function resolverOrigen() {
    var canario = leerCanario();
    if (canario === "0") return "";
    if (canario) return normalizar(canario);
    return normalizar(leerMeta());
  }

  function rutaRemota(origen, archivo) {
    return origen + String(archivo).replace(/^\.\//, "");
  }

  /* Carga UN script. Resuelve siempre (nunca rechaza): la app no debe
     depender de que un modulo opcional llegue. `desde` dice de donde vino. */
  function cargarUno(archivo, origen, opciones) {
    var timeoutMs = (opciones && opciones.timeoutMs) || TIMEOUT_MS;
    var d = documento();
    return new Promise(function (resolver) {
      var t0 = (global.Date && Date.now) ? Date.now() : 0;
      function insertar(src, remoto, alFallar) {
        var s = d.createElement("script");
        var cerrado = false, timer = null;
        var cerrar = function (ok) {
          if (cerrado) return; cerrado = true;
          if (timer) { try { global.clearTimeout(timer); } catch (_) {} }
          if (ok) {
            estado.cargados.push({ archivo: archivo, desde: remoto ? "remoto" : "local", ms: t0 ? Date.now() - t0 : 0 });
            resolver({ archivo: archivo, desde: remoto ? "remoto" : "local" });
          } else {
            try { if (s.parentNode) s.parentNode.removeChild(s); } catch (_) {}
            alFallar();
          }
        };
        s.async = false;
        if (remoto) s.crossOrigin = "anonymous";
        s.onload = function () { cerrar(true); };
        s.onerror = function () { cerrar(false); };
        s.src = src;
        if (remoto) {
          try { timer = global.setTimeout(function () { cerrar(false); }, timeoutMs); } catch (_) {}
        }
        (d.head || d.documentElement || d.body).appendChild(s);
      }
      function local() {
        insertar(archivo, false, function () {
          estado.error = "no cargo " + archivo;
          resolver({ archivo: archivo, desde: "ninguno" });
        });
      }
      if (origen) {
        insertar(rutaRemota(origen, archivo), true, function () {
          estado.caidas += 1;
          local();
        });
      } else {
        local();
      }
    });
  }

  function medirDesfase(origen) {
    if (!origen || !global.fetch) return;
    var leer = function (url) {
      return global.fetch(url, { cache: "no-store", mode: "cors" })
        .then(function (r) { return r && r.ok ? r.json() : null; })
        .catch(function () { return null; });
    };
    Promise.all([leer("./version.json"), leer(rutaRemota(origen, "version.json"))]).then(function (pares) {
      var local = pares[0], remoto = pares[1];
      if (!remoto) { estado.desfase = "remote version.json unreachable"; return; }
      var a = (local && local.shell) || "?", b = (remoto && remoto.shell) || "?";
      estado.desfase = (a === b) ? "same shell (" + a + ")" : "shell differs: github.io " + a + " vs remote " + b;
    }).catch(function () {});
  }

  function estadoCopia() {
    return { origen: estado.origen, modo: estado.modo, cargados: estado.cargados.slice(), caidas: estado.caidas, desfase: estado.desfase, listo: estado.listo, error: estado.error };
  }

  /* Carga la lista en orden. Devuelve una promesa que resuelve al terminar. */
  function cargar(lista, opciones) {
    var origen = "";
    try { origen = resolverOrigen(); } catch (_) { origen = ""; }
    estado.origen = origen;
    estado.modo = origen ? "remoto" : "local";
    var cadena = Promise.resolve();
    (lista || []).forEach(function (archivo) {
      cadena = cadena.then(function () { return cargarUno(archivo, origen, opciones); });
    });
    return cadena.then(function () {
      estado.listo = true;
      if (origen) medirDesfase(origen);
      try {
        if (global.console && console.info) console.info("[cargador] " + estado.modo + " · " + estado.cargados.length + " scripts · fallbacks " + estado.caidas + (origen ? " · " + origen : ""));
      } catch (_) {}
      try {
        var d = documento();
        if (d && d.dispatchEvent && global.CustomEvent) d.dispatchEvent(new global.CustomEvent("oc:cargador-listo", { detail: estadoCopia() }));
      } catch (_) {}
      return estadoCopia();
    });
  }

  function fijarCanario(url) {
    var u = (url === "0") ? "0" : normalizar(url);
    if (!u) return false;
    try { global.localStorage.setItem(CLAVE, u); return true; } catch (_) { return false; }
  }

  function quitarCanario() {
    try { global.localStorage.removeItem(CLAVE); return true; } catch (_) { return false; }
  }

  /* Una linea honesta para Advanced: de donde vino el codigo y si cuadra. */
  function texto() {
    var e = estadoCopia();
    var base = "Code: " + (e.modo === "remoto" ? "remote " + e.origen : "github.io") + " · " + e.cargados.length + " scripts";
    if (e.caidas) base += " · " + e.caidas + " fell back to github.io";
    if (e.desfase) base += " · " + e.desfase;
    if (e.error) base += " · " + e.error;
    if (!e.listo) base += " · loading…";
    return base;
  }

  global.OCCargador = {
    CLAVE: CLAVE,
    cargar: cargar,
    estado: estadoCopia,
    texto: texto,
    origen: resolverOrigen,
    normalizar: normalizar,
    fijarCanario: fijarCanario,
    quitarCanario: quitarCanario,
    _cargarUno: cargarUno
  };
})(typeof window !== "undefined" ? window : this);
