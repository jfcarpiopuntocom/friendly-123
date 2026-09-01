/*!
 * aislamiento.js — consultorio-123 · Aislamiento total de almacenamiento
 * ============================================================================
 * DEBE CARGAR PRIMERO, antes que cualquier otro script. Si carga tarde, otros
 * modulos ya habran leido/escrito sin namespace y el aislamiento se rompe.
 *
 * ----------------------------------------------------------------------------
 * PROBLEMA 1 — LAS 3 APPS COMPARTEN ORIGEN
 * ----------------------------------------------------------------------------
 * GitHub Pages sirve las tres apps desde el MISMO origen:
 *   https://jfcarpiopuntocom.github.io/consultorio-123/
 *   https://jfcarpiopuntocom.github.io/friendly-123/
 *   https://jfcarpiopuntocom.github.io/AMIGABLE/
 * localStorage e IndexedDB son por ORIGEN, no por carpeta. Como esta app
 * heredo de friendly-123 unas 33 claves con prefijo f123_, las tres se
 * pisaban PINs, intentos de acceso, fotos, respaldos y estado del negocio en
 * el mismo navegador. Verificado en produccion: consultorio-123 arrancaba con
 * 12 claves f123_* que NO eran suyas.
 *
 * Renombrar las 190 llamadas a localStorage repartidas en 24 archivos seria
 * fragil (basta olvidar una para reabrir el agujero). En vez de eso se
 * intercepta el almacenamiento entero: toda clave se guarda con el prefijo de
 * ESTA app, sin que ningun otro archivo tenga que enterarse.
 *
 * ----------------------------------------------------------------------------
 * PROBLEMA 2 — DOS PESTANAS DE LA MISMA APP SE PISAN
 * ----------------------------------------------------------------------------
 * Dos pestanas abiertas mantienen cada una su estado en memoria. La que
 * guarda de ultima sobreescribe lo que hizo la otra, y el trabajo se pierde
 * en silencio. Aqui cada escritura incrementa un contador y se avisa a las
 * demas pestanas por BroadcastChannel; una pestana que quedo atras se entera
 * y puede recargar antes de escribir encima. Ver AMG.Aislamiento.onCambio().
 *
 * ----------------------------------------------------------------------------
 * REGLA DE ORO: NUNCA ROMPER LA APP
 * ----------------------------------------------------------------------------
 * Todo va en try/catch. Si algo de esto falla (navegador viejo, modo privado,
 * almacenamiento bloqueado), se cae de vuelta al localStorage nativo y la app
 * sigue funcionando exactamente igual que antes.
 * ============================================================================
 */
(function () {
  "use strict";

  /* GUARD DE REENTRADA (JFC 2026-08-18). Este modulo REEMPLAZA
     window.localStorage por un shim que antepone el prefijo de la app. Si por
     un descuido el <script> quedara dos veces en la pagina, la segunda pasada
     veria el shim de la primera como si fuera el almacenamiento nativo y
     prefijaria TODO otra vez: "c123::c123::owned". Cada clave del negocio
     quedaria inalcanzable de golpe.

     Se detecta con una marca en window y se sale sin tocar nada. */
  if (window.__OC_AISLAMIENTO_INSTALADO__) {
    try { console.warn("[aislamiento] ya estaba instalado; la segunda carga se ignora"); } catch (_) {}
    return;
  }
  /* M2: la marca NO se puede sobrescribir. Antes era una propiedad normal y
     cualquier codigo podia borrarla — la proxima carga de aislamiento
     duplicaria los prefijos. Ahora es una constante. */
  try { Object.defineProperty(window, "__OC_AISLAMIENTO_INSTALADO__", { value: true, writable: false, configurable: false }); }
  catch (_) { window.__OC_AISLAMIENTO_INSTALADO__ = true; }

  // Namespace de ESTA app. Cambiarlo aisla todo de golpe; no debe coincidir
  // con el de las apps hermanas (f123 / amigable).
  var NS = "f123";
  var SEP = "::";
  var PREFIJO = NS + SEP;
  var CLAVE_MIGRADO = PREFIJO + "_migrado_v1";
  var CLAVE_EPOCA = PREFIJO + "_epoca";

  // Prefijos heredados que hay que rescatar UNA vez desde el espacio comun.
  // Se COPIAN, nunca se mueven: friendly-123 puede estar en uso en el mismo
  // navegador y borrarselas lo dejaria sin acceso.
  /* CADA APP RESCATA SOLO LO SUYO (JFC 2026-08-15). Antes las tres tenian la
  // misma lista y una podia importar las claves historicas de otra al abrirlas
  // en el mismo navegador. Compartimentar de verdad empieza aqui. */
  var PREFIJOS_LEGADO = ["f123_"];

  var nativo = null;
  try { nativo = window.localStorage; } catch (_) { nativo = null; }
  if (!nativo) return; // sin almacenamiento no hay nada que aislar

  // -------------------------------------------------------------------------
  // Migracion unica: copia al namespace lo que ya existia suelto en el origen.
  // -------------------------------------------------------------------------
  /* Prefijo de licencia de ESTA app. Cambiar junto con NS. */
  var LIC_PREFIJO = "F123-";

  /* true si el JSON no trae licencia ajena. Ante la duda devuelve true: este es
     un guard contra el cruce entre apps, no una puerta que pueda dejar al
     duenio sin sus propios datos. */
  function licenciaPropia(txt) {
    try {
      var o = JSON.parse(txt);
      var c = o && o.licenseCode;
      if (!c || typeof c !== "string") return true;
      return c.toUpperCase().indexOf(LIC_PREFIJO) === 0;
    } catch (_) { return true; }
  }

  function migrarUnaVez() {
    try {
      if (nativo.getItem(CLAVE_MIGRADO)) return;
      var aCopiar = [];
      for (var i = 0; i < nativo.length; i++) {
        var k = nativo.key(i);
        if (!k || k.indexOf(PREFIJO) === 0) continue;
        for (var j = 0; j < PREFIJOS_LEGADO.length; j++) {
          if (k.indexOf(PREFIJOS_LEGADO[j]) === 0) { aCopiar.push(k); break; }
        }
      }
      aCopiar.forEach(function (k) {
        try {
          if (nativo.getItem(PREFIJO + k) !== null) return;
          var v = nativo.getItem(k);
          /* NO IMPORTAR LA LICENCIA DE OTRA APP (bug en vivo, 2026-08-15).
             Las tres apps son forks y comparten nombres de clave, asi que en un
             telefono donde se abrieron dos, la licencia de una se colaba en la
             otra y el duenio veia un codigo que no era el suyo. Aqui se mira el
             contenido, no el nombre: si trae un licenseCode de otra familia, no
             se copia. Todo lo demas se rescata igual que siempre. */
          if (v && v.indexOf("licenseCode") >= 0 && !licenciaPropia(v)) return;
          nativo.setItem(PREFIJO + k, v);
        } catch (_) {}
      });
      nativo.setItem(CLAVE_MIGRADO, String(Date.now()));
      if (aCopiar.length) {
        try { console.info("[aislamiento] " + aCopiar.length + " claves heredadas copiadas al namespace " + NS); } catch (_) {}
      }
    } catch (_) {}
  }
  migrarUnaVez();

  /* -------------------------------------------------------------------------
     LIMPIEZA DE LICENCIA AJENA (JFC 2026-08-15). Corre SIEMPRE, no una vez: si
     una licencia de otra app ya se colo en ESTE namespace antes del guard de
     arriba, aqui se saca. Borrarla no le quita nada a la otra app, que vive en
     su propio namespace y conserva la suya intacta.

     Solo se toca el campo licenseCode. El resto del registro (correo, nombre,
     fecha de activacion) se conserva: puede ser legitimo aunque la licencia no.
     ------------------------------------------------------------------------- */
  function limpiarLicenciaAjena() {
    try {
      for (var i = 0; i < nativo.length; i++) {
        var k = nativo.key(i);
        if (!k || k.indexOf(PREFIJO) !== 0 || k.indexOf("_owned") < 0) continue;
        var v = nativo.getItem(k);
        if (!v || licenciaPropia(v)) continue;
        var o = JSON.parse(v);
        delete o.licenseCode;
        nativo.setItem(k, JSON.stringify(o));
        try { console.warn("[aislamiento] se quito una licencia de otra app en " + k); } catch (_) {}
      }
    } catch (_) {}
  }
  limpiarLicenciaAjena();

  // -------------------------------------------------------------------------
  // Aviso entre pestanas: cada escritura sube la epoca y se difunde.
  // -------------------------------------------------------------------------
  var canal = null;
  try { canal = ("BroadcastChannel" in window) ? new BroadcastChannel(PREFIJO + "storage") : null; } catch (_) { canal = null; }

  var oyentes = [];
  var miEpoca = 0;
  try { miEpoca = parseInt(nativo.getItem(CLAVE_EPOCA) || "0", 10) || 0; } catch (_) {}

  function anunciarEscritura(clave) {
    try {
      miEpoca += 1;
      nativo.setItem(CLAVE_EPOCA, String(miEpoca));
      if (canal) canal.postMessage({ epoca: miEpoca, clave: clave, ts: Date.now() });
    } catch (_) {}
  }

  if (canal) {
    canal.onmessage = function (ev) {
      try {
        var d = ev && ev.data;
        if (!d || typeof d.epoca !== "number") return;
        if (d.epoca <= miEpoca) return; // ya estamos al dia
        miEpoca = d.epoca;
        // Otra pestana escribio despues que nosotros: lo que tengamos en
        // memoria puede estar viejo. Se avisa a quien quiera reaccionar.
        oyentes.forEach(function (fn) { try { fn({ clave: d.clave, epoca: d.epoca }); } catch (_) {} });
      } catch (_) {}
    };
  }

  // -------------------------------------------------------------------------
  // El shim: misma API que localStorage, con el prefijo puesto por dentro.
  // -------------------------------------------------------------------------
  function esNuestra(k) { return typeof k === "string" && k.indexOf(PREFIJO) === 0; }
  function sinPrefijo(k) { return k.slice(PREFIJO.length); }

  var shim = {
    get length() {
      var n = 0;
      try {
        for (var i = 0; i < nativo.length; i++) if (esNuestra(nativo.key(i))) n++;
      } catch (_) {}
      return n;
    },
    key: function (n) {
      try {
        var vistas = 0;
        for (var i = 0; i < nativo.length; i++) {
          var k = nativo.key(i);
          if (esNuestra(k)) {
            if (vistas === n) return sinPrefijo(k);
            vistas++;
          }
        }
      } catch (_) {}
      return null;
    },
    getItem: function (k) {
      try { return nativo.getItem(PREFIJO + k); } catch (_) { return null; }
    },
    setItem: function (k, v) {
      // Se deja propagar el error de cuota: la app YA tiene manejo propio de
      // "espacio lleno" (storage-durabilidad.js) y tragarselo aqui lo cegaria.
      nativo.setItem(PREFIJO + k, v);
      anunciarEscritura(k);
    },
    removeItem: function (k) {
      try { nativo.removeItem(PREFIJO + k); anunciarEscritura(k); } catch (_) {}
    },
    clear: function () {
      // Borra SOLO lo de esta app: las hermanas quedan intactas.
      try {
        var mias = [];
        for (var i = 0; i < nativo.length; i++) {
          var k = nativo.key(i);
          if (esNuestra(k)) mias.push(k);
        }
        mias.forEach(function (k) { try { nativo.removeItem(k); } catch (_) {} });
        anunciarEscritura("*");
      } catch (_) {}
    }
  };

  try {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get: function () { return shim; }
    });
  } catch (_) {
    // Si el navegador no deja redefinirlo, no se toca nada: mejor la app
    // funcionando sin aislamiento que una app rota.
    try { console.warn("[aislamiento] no se pudo aislar localStorage en este navegador"); } catch (_) {}
  }

  // -------------------------------------------------------------------------
  // AUTO-VERIFICACION (JFC 2026-08-05, H2 del review). El aislamiento entre las
  // 3 apps del mismo origen depende de que el shim de arriba se instale. Si
  // Object.defineProperty NO pudo redefinir window.localStorage (navegador
  // raro/viejo), la app corria SIN aislamiento EN SILENCIO y podia pisar los
  // datos de una app hermana (c123 / amigable) en el mismo navegador. Aqui se
  // comprueba con un canario: si al escribir por window.localStorage el valor
  // NO aparece con el prefijo en el store nativo, el shim no tomo. En ese caso
  // se avisa FUERTE (consola + banner) en vez de callar. No cambia ni una sola
  // clave guardada — solo detecta y avisa.
  var instalado = false;
  try {
    window.localStorage.setItem("__aisl_canario__", "1");
    instalado = (nativo.getItem(PREFIJO + "__aisl_canario__") === "1");
    window.localStorage.removeItem("__aisl_canario__");
  } catch (_) { instalado = false; }
  if (!instalado) {
    // AVISO SOLO EN CONSOLA (JFC 2026-08-26): el banner rojo visible NO fue
    // autorizado y no debe alterar la experiencia de usuario. Se conserva el
    // diagnóstico en consola para depurar, pero NUNCA se pinta nada en pantalla.
    try { console.error("[aislamiento] SIN AISLAMIENTO en este navegador: las apps hermanas del mismo origen podrian pisarse datos. Abre esta app en un Chrome/Safari actualizado."); } catch (_) {}
  }

  // -------------------------------------------------------------------------
  // sessionStorage: mismo criterio que localStorage.
  // -------------------------------------------------------------------------
  // BUG REAL (JFC 2026-08-11, "chocaron un poco en mi Opera Air"): auth-ui.js
  // guarda el contador de intentos fallidos de PIN en sessionStorage bajo la
  // clave "oc_intentos", SIN namespace, y las tres apps usan esa misma clave.
  // Con dos apps hermanas abiertas en el mismo navegador, los intentos se
  // sumaban entre ellas: 8 fallos repartidos entre amigable y friendly
  // bloqueaban las DOS a la vez, aunque en cada una hubieras fallado poco.
  //
  // Se arregla aqui y no renombrando la clave, para que cualquier clave futura
  // de sessionStorage quede cubierta sola, sin que nadie tenga que acordarse.
  // sessionStorage es efimero (muere con la pestana), asi que aislarlo no
  // arriesga ningun dato guardado: lo peor que puede pasar es que un contador
  // de intentos arranque de cero, que es justamente lo que se busca.
  try {
    var nativoSes = window.sessionStorage;
    var shimSes = {
      get length() {
        var n = 0;
        try {
          for (var i = 0; i < nativoSes.length; i++) if (esNuestra(nativoSes.key(i))) n++;
        } catch (_) {}
        return n;
      },
      key: function (n) {
        try {
          var vistas = 0;
          for (var i = 0; i < nativoSes.length; i++) {
            var k = nativoSes.key(i);
            if (esNuestra(k)) {
              if (vistas === n) return sinPrefijo(k);
              vistas++;
            }
          }
        } catch (_) {}
        return null;
      },
      getItem: function (k) {
        try { return nativoSes.getItem(PREFIJO + k); } catch (_) { return null; }
      },
      setItem: function (k, v) { nativoSes.setItem(PREFIJO + k, v); },
      removeItem: function (k) {
        try { nativoSes.removeItem(PREFIJO + k); } catch (_) {}
      },
      clear: function () {
        try {
          var mias = [];
          for (var i = 0; i < nativoSes.length; i++) {
            var k = nativoSes.key(i);
            if (esNuestra(k)) mias.push(k);
          }
          mias.forEach(function (k) { try { nativoSes.removeItem(k); } catch (_) {} });
        } catch (_) {}
      }
    };
    Object.defineProperty(window, "sessionStorage", {
      configurable: true,
      get: function () { return shimSes; }
    });
  } catch (_) {
    try { console.warn("[aislamiento] no se pudo aislar sessionStorage en este navegador"); } catch (_) {}
  }

  // -------------------------------------------------------------------------
  // IndexedDB: mismo criterio. Cualquier base que se abra aqui (aunque su
  // nombre sea literal compartido entre apps, ej. el viejo "amg_hechos_db")
  // recibe el namespace por delante de forma transparente.
  // -------------------------------------------------------------------------
  var abrirNativo = null;
  var abrirAislado = null;
  try {
    if (window.indexedDB && typeof window.indexedDB.open === "function") {
      abrirNativo = window.indexedDB.open.bind(window.indexedDB);
      abrirAislado = function (nombre, version) {
        var n = (typeof nombre === "string" && nombre.indexOf(PREFIJO) !== 0) ? PREFIJO + nombre : nombre;
        return (version === undefined) ? abrirNativo(n) : abrirNativo(n, version);
      };
      window.indexedDB.open = abrirAislado;
      if (typeof window.indexedDB.deleteDatabase === "function") {
        var borrarNativo = window.indexedDB.deleteDatabase.bind(window.indexedDB);
        window.indexedDB.deleteDatabase = function (nombre) {
          var n = (typeof nombre === "string" && nombre.indexOf(PREFIJO) !== 0) ? PREFIJO + nombre : nombre;
          return borrarNativo(n);
        };
      }
    }
  } catch (_) {}

  /* DEBUG Fase 5: the load-time check ran BEFORE later scripts. If something
     after this file stole indexedDB.open, sister apps shared DBs in silence.
     Re-assert the wrapper after DOM and load. Double-prefix is avoided because
     we always wrap the original abrirNativo, never the current open. */
  function reafirmarIdb() {
    try {
      if (!window.indexedDB || !abrirAislado) return;
      if (window.indexedDB.open !== abrirAislado) {
        window.indexedDB.open = abrirAislado;
        try { console.warn("[aislamiento] IndexedDB.open was overwritten; wrapper restored."); } catch (_) {}
      }
    } catch (_) {}
  }
  try { document.addEventListener("DOMContentLoaded", reafirmarIdb); } catch (_) {}
  try { window.addEventListener("load", reafirmarIdb); } catch (_) {}

  // -------------------------------------------------------------------------
  // API publica minima, por si algun modulo quiere reaccionar a otra pestana.
  // -------------------------------------------------------------------------
  window.AMG = window.AMG || {};
  window.AMG.Aislamiento = {
    VERSION: "1.1.0",
    namespace: NS,
    instalado: instalado, // H2 review: false = el shim no tomo, apps hermanas sin aislar
    idbInstalado: !!(abrirAislado),
    onCambio: function (fn) { if (typeof fn === "function") oyentes.push(fn); },
    epoca: function () { return miEpoca; }
  };
})();
