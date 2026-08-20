/*!
 * hechos.js — Amigable-123 · MICELIO FASE A
 * ============================================================================
 * QUE ES ESTO
 * ----------------------------------------------------------------------------
 * El registro de HECHOS: la base del cuaderno compartido. Ver el documento de
 * diseño en _private/DISENO-MICELIO.md.
 *
 * La idea central, en una linea: dejar de sincronizar ESTADO y empezar a
 * sincronizar HECHOS.
 *
 *   Estado  -> "el producto X tiene 5 unidades".
 *              Es una OPINION sobre el mundo. Dos opiniones distintas se
 *              pisan, y la ultima en llegar borra a la otra. Eso es perdida
 *              de datos silenciosa cuando dos celulares vendieron offline.
 *
 *   Hecho   -> "a las 10:32, Ana vendio 2 unidades del producto X en D1".
 *              Es algo que PASO. Dos hechos distintos no se pisan: se SUMAN.
 *
 * El inventario deja de ser un numero guardado y pasa a ser el resultado de
 * aplicar todos los hechos conocidos. Si aparece un hecho viejo que faltaba,
 * se aplica y el numero se corrige solo. Nada se pierde porque nada se
 * sobreescribe.
 *
 * ----------------------------------------------------------------------------
 * FASE A: ESCRIBIR EN PARALELO, SIN QUE NADIE LEA
 * ----------------------------------------------------------------------------
 * Este archivo SOLO ESCRIBE. No cambia ninguna pantalla, no reemplaza al
 * estado actual y nadie consume todavia lo que guarda. Es deliberado:
 *
 *   - Riesgo cero. Si esto falla entero, la app sigue funcionando igual.
 *   - Empieza a acumular historia REAL desde ya, para que cuando lleguen las
 *     fases que la usan (reconstruir inventario, sincronizar, micelio) haya
 *     meses de hechos verdaderos en vez de una base vacia.
 *
 * NO conectar esto a la UI ni usarlo como fuente de verdad hasta la Fase B,
 * que primero reconstruye el inventario desde los hechos y lo COMPARA contra
 * el estado actual para detectar discrepancias sin que el usuario vea nada.
 *
 * ----------------------------------------------------------------------------
 * POR QUE NO ES audit-store.js
 * ----------------------------------------------------------------------------
 * Son dos cosas distintas y ambas deben existir:
 *
 *   audit-store.js  Forense LOCAL. "Quien hizo que, cuando, con que resultado"
 *                   para que JFC pueda auditar un negocio. Se queda en el
 *                   dispositivo y no necesita ordenarse contra nadie.
 *
 *   hechos.js       Registro REPLICABLE. Esta pensado para viajar entre
 *                   dispositivos y fusionarse sin perder nada. Por eso lleva
 *                   tres cosas que audit-store no necesita: identidad de
 *                   dispositivo, reloj vectorial y cadena de hash.
 *
 * ----------------------------------------------------------------------------
 * DECISIONES DE JFC QUE ESTE ARCHIVO RESPETA
 * ----------------------------------------------------------------------------
 * "guardar todo para siempre, el log es algo que es central, los logs"
 *   -> NO hay poda, ni limite de registros, ni borrado por antiguedad.
 *      El crecimiento se ataca comprimiendo y leyendo bajo demanda, NUNCA
 *      descartando. Si algun dia se agrega compactacion, debe conservar el
 *      hecho original, no reemplazarlo.
 *
 * ============================================================================
 */
(function (global) {
  "use strict";

  // FIX (JFC 2026-08-20, bug G2): DB_NAME/META_KEY eran literales compartidos
  // sin querer con AMIGABLE/Consultorio-123 (mismo bug ya corregido hoy en
  // consultorio-123). aislamiento.js ya aisla IndexedDB por app a nivel de
  // transporte, asi que esto no era un hoyo activo -- pero se corrige igual,
  // como segunda capa de defensa y por consistencia entre las 3 apps. Rename
  // CON migracion: nunca se borra la base vieja (es el ledger de ventas).
  var DB_NAME = "f123_hechos_db";
  var DB_NAME_VIEJA = "amg_hechos_db";
  var MIGRACION_KEY = "f123_hechos_migrado_v1";
  var DB_VERSION = 1;
  var STORE = "hechos";
  var META_KEY = "f123_hechos_meta_v1";   // contador local + reloj + ultimo hash

  // ---------------------------------------------------------------------------
  // Identidad del dispositivo
  // ---------------------------------------------------------------------------
  // El instanceId ya lo asigna auth-ui.js al activar (f123_owned). Si
  // todavia no existe (demo sin activar), se genera uno local y estable para
  // que los hechos de este dispositivo tengan autor desde el primer minuto.
  // Cuando el dispositivo se active de verdad, auth-ui.js escribira el suyo;
  // los hechos viejos conservan el id con el que nacieron, que es correcto:
  // fueron generados por este aparato antes de tener licencia.
  function instanceId() {
    try {
      /* BUG (JFC 2026-08-19): esto leia "amigable_owned", la clave de la app
         HERMANA. friendly-123 guarda en "f123_owned", asi que el instanceId
         NUNCA se encontraba y toda la cadena de hechos caia al id local
         anonimo "loc-...". El sello antifraude quedaba sin autor real en cada
         dispositivo activado. Clase de bug ya conocida: "codigo correcto pero
         no cambia nada" casi siempre es una clave vieja de localStorage. */
      var owned = JSON.parse(localStorage.getItem("f123_owned") || "null") || {};
      if (owned.instanceId) return owned.instanceId;
    } catch (_) {}
    try {
      var local = localStorage.getItem("f123_hechos_instancia");
      if (local) return local;
      var nuevo = "loc-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
      localStorage.setItem("f123_hechos_instancia", nuevo);
      return nuevo;
    } catch (_) {
      return "loc-efimero";
    }
  }

  function autorActual() {
    try {
      if (global.OCCurrentUser && global.OCCurrentUser.nombre) return String(global.OCCurrentUser.nombre);
    } catch (_) {}
    try {
      if (global.OCAuth && global.OCAuth.rolActual) return String(global.OCAuth.rolActual() || "");
    } catch (_) {}
    return "";
  }

  // ---------------------------------------------------------------------------
  // Meta local: contador, reloj vectorial y ultimo hash de la cadena
  // ---------------------------------------------------------------------------
  function leerMeta() {
    try {
      var m = JSON.parse(localStorage.getItem(META_KEY) || "null");
      if (m && typeof m === "object") {
        m.contador = Number(m.contador) || 0;
        m.reloj = (m.reloj && typeof m.reloj === "object") ? m.reloj : {};
        m.ultimoHash = typeof m.ultimoHash === "string" ? m.ultimoHash : "";
        return m;
      }
    } catch (_) {}
    return { contador: 0, reloj: {}, ultimoHash: "" };
  }

  function guardarMeta(m) {
    try { localStorage.setItem(META_KEY, JSON.stringify(m)); } catch (_) {}
  }

  // ---------------------------------------------------------------------------
  // Hash de encadenamiento
  // ---------------------------------------------------------------------------
  // Encadena los hechos DEL MISMO DISPOSITIVO: cada uno incluye el hash del
  // anterior, asi que alterar uno viejo rompe todos los siguientes y se nota.
  // Es tamper-EVIDENTE, no tamper-PROOF: prueba que algo se toco, no impide
  // tocarlo. La politica de privacidad debe decir exactamente eso y nada mas.
  //
  // Se usa SHA-256 via WebCrypto cuando esta disponible. En contextos sin
  // crypto.subtle (http plano en algunos navegadores viejos) se cae a un hash
  // simple no criptografico: sirve para detectar corrupcion accidental, NO
  // para detectar manipulacion deliberada. Se marca con prefijo "w:" para que
  // una auditoria futura sepa que ese tramo de la cadena es debil.
  function hashDebil(txt) {
    var h1 = 0x811c9dc5, h2 = 0x01000193;
    for (var i = 0; i < txt.length; i++) {
      var c = txt.charCodeAt(i);
      h1 = (h1 ^ c) >>> 0; h1 = (h1 * 0x01000193) >>> 0;
      h2 = (h2 + c * (i + 1)) >>> 0;
    }
    return "w:" + h1.toString(16) + h2.toString(16);
  }

  function calcularHash(txt) {
    try {
      if (global.crypto && global.crypto.subtle && global.crypto.subtle.digest) {
        return global.crypto.subtle
          .digest("SHA-256", new TextEncoder().encode(txt))
          .then(function (buf) {
            return Array.from(new Uint8Array(buf))
              .map(function (b) { return b.toString(16).padStart(2, "0"); })
              .join("");
          })
          .catch(function () { return hashDebil(txt); });
      }
    } catch (_) {}
    return Promise.resolve(hashDebil(txt));
  }

  // ---------------------------------------------------------------------------
  // IndexedDB
  // ---------------------------------------------------------------------------
  function _abrirCruda(nombre) {
    return new Promise(function (resolve, reject) {
      if (!global.indexedDB) { reject(new Error("IndexedDB no disponible")); return; }
      var req = global.indexedDB.open(nombre, DB_VERSION);
      req.onupgradeneeded = function (e) {
        var db = e.target.result;
        if (!db.objectStoreNames.contains(STORE)) {
          // keyPath "id" = "<instanceId>-<contador>". Dos dispositivos NUNCA
          // generan el mismo id sin haberse coordinado, asi que la fusion no
          // puede colisionar. Es la propiedad que elimina de raiz la clase de
          // bug mas fea de un sistema distribuido.
          var st = db.createObjectStore(STORE, { keyPath: "id" });
          st.createIndex("ts", "ts", { unique: false });
          st.createIndex("tipo", "tipo", { unique: false });
          st.createIndex("instanceId", "instanceId", { unique: false });
        }
      };
      req.onsuccess = function (e) { resolve(e.target.result); };
      req.onerror = function () { reject(req.error || new Error("no se pudo abrir " + nombre)); };
    });
  }

  function _migrarDesdeBaseVieja(dbNueva) {
    try { if (localStorage.getItem(MIGRACION_KEY) === "1") return Promise.resolve(); } catch (_) {}
    return _abrirCruda(DB_NAME_VIEJA).then(function (dbVieja) {
      return new Promise(function (resolve) {
        try {
          var txLeer = dbVieja.transaction(STORE, "readonly");
          var reqTodos = txLeer.objectStore(STORE).getAll();
          reqTodos.onsuccess = function () {
            var registros = reqTodos.result || [];
            if (!registros.length) { try { localStorage.setItem(MIGRACION_KEY, "1"); } catch (_) {} resolve(); return; }
            var txEscribir = dbNueva.transaction(STORE, "readwrite");
            registros.forEach(function (r) { try { txEscribir.objectStore(STORE).put(r); } catch (_) {} });
            txEscribir.oncomplete = function () {
              try { localStorage.setItem(MIGRACION_KEY, "1"); } catch (_) {}
              try { console.warn("[hechos] migrados " + registros.length + " hecho(s) desde la base compartida vieja"); } catch (_) {}
              resolve();
            };
            txEscribir.onerror = function () { resolve(); };
          };
          reqTodos.onerror = function () { resolve(); };
        } catch (_) { resolve(); }
      });
    }).catch(function () { try { localStorage.setItem(MIGRACION_KEY, "1"); } catch (_) {} });
  }

  var _db = null;
  function abrirDB() {
    if (_db) return Promise.resolve(_db);
    return _abrirCruda(DB_NAME).then(function (db) {
      return _migrarDesdeBaseVieja(db).then(function () { _db = db; return db; });
    });
  }

  function guardar(hecho) {
    return abrirDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).put(hecho);
        tx.oncomplete = function () { resolve(hecho); };
        tx.onerror = function () { reject(tx.error); };
      });
    });
  }

  // ---------------------------------------------------------------------------
  // Registrar un hecho
  // ---------------------------------------------------------------------------
  var _cola = Promise.resolve();   // serializa: la cadena de hash no admite carreras

  function registrar(tipo, datos) {
    _cola = _cola.then(function () {
      var meta = leerMeta();
      var yo = instanceId();

      meta.contador += 1;
      // Reloj vectorial: cuantos hechos conoce este dispositivo de cada uno.
      // Comparando dos relojes se sabe, SIN depender de la hora del celular,
      // si un hecho paso antes que otro o si fueron concurrentes. Importa
      // porque un telefono con la fecha mal puesta arruinaria cualquier orden
      // basado en ts; ts queda solo para mostrarle algo legible al usuario.
      meta.reloj[yo] = meta.contador;

      var hecho = {
        id: yo + "-" + meta.contador,
        instanceId: yo,
        autor: autorActual(),
        reloj: JSON.parse(JSON.stringify(meta.reloj)),
        ts: Date.now(),
        tipo: String(tipo || "desconocido"),
        datos: datos == null ? {} : datos,
        hashPrevio: meta.ultimoHash,
        hash: ""
      };

      // El hash cubre todo el hecho MENOS el propio campo hash.
      var base = JSON.stringify({
        id: hecho.id, instanceId: hecho.instanceId, autor: hecho.autor,
        reloj: hecho.reloj, ts: hecho.ts, tipo: hecho.tipo,
        datos: hecho.datos, hashPrevio: hecho.hashPrevio
      });

      return calcularHash(base).then(function (h) {
        hecho.hash = h;
        meta.ultimoHash = h;
        return guardar(hecho).then(function () {
          // La meta se persiste SOLO si el hecho llego a disco. Al reves se
          // perderia un eslabon de la cadena y todo lo siguiente pareceria
          // manipulado sin serlo.
          guardarMeta(meta);
          return hecho;
        });
      });
    }).catch(function (e) {
      // Fase A nunca puede tumbar la app: si algo falla, se anota y se sigue.
      try { console.warn("[hechos] no se pudo registrar:", e && e.message); } catch (_) {}
      return null;
    });
    return _cola;
  }

  // ---------------------------------------------------------------------------
  // Lectura (para Fase B; hoy nadie la usa en produccion)
  // ---------------------------------------------------------------------------
  function todos() {
    return abrirDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, "readonly");
        var req = tx.objectStore(STORE).getAll();
        req.onsuccess = function () {
          // Orden estable: primero por ts, y ante empate por id, para que dos
          // dispositivos con el mismo conjunto de hechos produzcan la MISMA
          // lista. Sin desempate por id, dos replicas podrian discrepar.
          var r = (req.result || []).slice();
          r.sort(function (a, b) { return (a.ts - b.ts) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0); });
          resolve(r);
        };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  function contar() {
    return abrirDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, "readonly");
        var req = tx.objectStore(STORE).count();
        req.onsuccess = function () { resolve(req.result || 0); };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  // Verifica la cadena de hash de ESTE dispositivo. Devuelve el primer punto
  // donde se rompe, o null si esta intacta. Herramienta de diagnostico: no
  // corre sola, se llama a mano desde la consola o desde el panel.
  function verificarCadena() {
    return todos().then(function (lista) {
      var yo = instanceId();
      var mios = lista.filter(function (h) { return h.instanceId === yo; });
      mios.sort(function (a, b) {
        return (Number(a.id.split("-").pop()) || 0) - (Number(b.id.split("-").pop()) || 0);
      });
      var previo = "";
      for (var i = 0; i < mios.length; i++) {
        if (mios[i].hashPrevio !== previo) {
          return { ok: false, en: mios[i].id, esperaba: previo, encontro: mios[i].hashPrevio };
        }
        previo = mios[i].hash;
      }
      return null;
    });
  }

  // ---------------------------------------------------------------------------
  // Enganche pasivo al bus de eventos
  // ---------------------------------------------------------------------------
  // Se escucha el MISMO bus que audit-store.js, sin tocarlo. Solo interesan
  // los eventos que representan un cambio real del negocio ya consumado
  // (":completado"). Los ":error" no son hechos: describen algo que NO paso.
  var SUFIJOS = [":completado"];

  function esHecho(nombre) {
    if (!nombre) return false;
    for (var i = 0; i < SUFIJOS.length; i++) {
      if (String(nombre).slice(-SUFIJOS[i].length) === SUFIJOS[i]) return true;
    }
    return false;
  }

  // cartera.js y caja-chica.js ya llaman a Hechos.registrar() directo (para poder
  // esperar a que el hecho quede en disco) ademas de emitir el evento (para quien
  // escuche en vivo). Si este listener comodin tambien registrara esos eventos,
  // cada cargo/abono/ingreso/retiro quedaria duplicado. Se filtran aqui.
  var PREFIJOS_YA_REGISTRADOS_DIRECTO = ["cartera_", "caja_chica_"];

  function yaRegistradoDirecto(nombreSinSufijo) {
    for (var i = 0; i < PREFIJOS_YA_REGISTRADOS_DIRECTO.length; i++) {
      if (String(nombreSinSufijo).slice(0, PREFIJOS_YA_REGISTRADOS_DIRECTO[i].length) === PREFIJOS_YA_REGISTRADOS_DIRECTO[i]) return true;
    }
    return false;
  }

  function manejar(evt) {
    try {
      if (!evt) return;
      var nombre = evt.type || evt.nombre || evt.name;
      if (!esHecho(nombre)) return;
      var nombreLimpio = String(nombre).replace(/:completado$/, "");
      if (yaRegistradoDirecto(nombreLimpio)) return;
      registrar(nombreLimpio, evt.payload || evt.detail || {});
    } catch (_) {}
  }

  function arrancar() {
    try {
      if (global.AMG && global.AMG.EventBus && global.AMG.EventBus.on) {
        global.AMG.EventBus.on("*", manejar);
        return true;
      }
    } catch (_) {}
    return false;
  }

  global.AMG = global.AMG || {};
  global.AMG.Hechos = {
    VERSION: "1.0.0-faseA",
    registrar: registrar,
    todos: todos,
    contar: contar,
    verificarCadena: verificarCadena,
    instanceId: instanceId,
    meta: leerMeta,
    _arrancar: arrancar
  };

  // Si el bus todavia no existe (orden de carga), se reintenta una vez cuando
  // el DOM este listo. No se insiste mas: Fase A no justifica un reintento
  // infinito, y si el bus nunca aparece la app funciona igual sin hechos.
  if (!arrancar()) {
    try {
      global.addEventListener("DOMContentLoaded", function () { arrancar(); }, { once: true });
    } catch (_) {}
  }
})(typeof window !== "undefined" ? window : this);
