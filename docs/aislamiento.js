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
  var PREFIJOS_LEGADO = ["f123_", "c123_", "amigable_", "oc_", "amg_"];

  var nativo = null;
  try { nativo = window.localStorage; } catch (_) { nativo = null; }
  if (!nativo) return; // sin almacenamiento no hay nada que aislar

  // -------------------------------------------------------------------------
  // Migracion unica: copia al namespace lo que ya existia suelto en el origen.
  // -------------------------------------------------------------------------
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
          if (nativo.getItem(PREFIJO + k) === null) {
            nativo.setItem(PREFIJO + k, nativo.getItem(k));
          }
        } catch (_) {}
      });
      nativo.setItem(CLAVE_MIGRADO, String(Date.now()));
      if (aCopiar.length) {
        try { console.info("[aislamiento] " + aCopiar.length + " claves heredadas copiadas al namespace " + NS); } catch (_) {}
      }
    } catch (_) {}
  }
  migrarUnaVez();

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
  // IndexedDB: mismo criterio. hechos.js abre "amg_hechos_db", nombre que las
  // tres apps comparten. Se le antepone el namespace de forma transparente.
  // -------------------------------------------------------------------------
  try {
    if (window.indexedDB && typeof window.indexedDB.open === "function") {
      var abrirNativo = window.indexedDB.open.bind(window.indexedDB);
      window.indexedDB.open = function (nombre, version) {
        var n = (typeof nombre === "string" && nombre.indexOf(PREFIJO) !== 0) ? PREFIJO + nombre : nombre;
        return (version === undefined) ? abrirNativo(n) : abrirNativo(n, version);
      };
      if (typeof window.indexedDB.deleteDatabase === "function") {
        var borrarNativo = window.indexedDB.deleteDatabase.bind(window.indexedDB);
        window.indexedDB.deleteDatabase = function (nombre) {
          var n = (typeof nombre === "string" && nombre.indexOf(PREFIJO) !== 0) ? PREFIJO + nombre : nombre;
          return borrarNativo(n);
        };
      }
    }
  } catch (_) {}

  // -------------------------------------------------------------------------
  // API publica minima, por si algun modulo quiere reaccionar a otra pestana.
  // -------------------------------------------------------------------------
  window.AMG = window.AMG || {};
  window.AMG.Aislamiento = {
    VERSION: "1.0.0",
    namespace: NS,
    onCambio: function (fn) { if (typeof fn === "function") oyentes.push(fn); },
    epoca: function () { return miEpoca; }
  };
})();
