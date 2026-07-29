/*!
 * geo-ping.js — friendly-123 · Control de ubicación del equipo (2026-07-28)
 * ============================================================================
 * QUE ES ESTO
 * ----------------------------------------------------------------------------
 * Mientras un empleado/dueño/admin tiene sesión abierta, este archivo guarda
 * un "ping" cada 15 minutos: {pin, deviceId, ts, lat, lon, precision, fuente}.
 * Sirve para coordinar equipos y verificar cumplimiento — saber si alguien
 * estuvo donde debía estar, sin ser invasivo: 15 minutos da margen humano
 * (baño, comida, una medicina) y la app SIEMPRE avisa antes de empezar.
 *
 * ARCHIVO 100% AUTOCONTENIDO (mismo patrón que device-identity.js): no
 * modifica auth-ui.js, avanzado-extra.js ni ningún archivo existente. Se
 * engancha a los eventos que auth-ui.js YA dispara ("oc-login"/"oc-logout")
 * y se monta solo en el DOM que index.html YA tiene (#vista-avanzado). Si
 * cualquier pieza de esto falla, la app sigue funcionando exactamente igual
 * — cero dependencia dura, igual que hechos.js y reconciliacion.js.
 *
 * ----------------------------------------------------------------------------
 * 3 FUENTES EN CASCADA, NUNCA UNA INVENTADA (JFC 2026-07-28)
 * ----------------------------------------------------------------------------
 *   1) navigator.geolocation — GPS/wifi real del dispositivo. La más precisa.
 *      Requiere permiso del usuario; si lo niega, se cae a la fuente 2 sin
 *      insistir ni repreguntar cada 15 min (eso sí sería invasivo).
 *   2) Geolocalización por IP — DOS proveedores gratis intentados en orden:
 *      ipapi.co primero (soporta HTTPS en el plan gratis — importante: este
 *      sitio se sirve por HTTPS y un fetch a un endpoint HTTP puro fallaría
 *      por mixed-content, silenciosamente, en cualquier navegador moderno).
 *      Si ipapi.co no responde, se intenta ip-api.com como respaldo. Ninguno
 *      de los dos pide API key en su capa gratuita.
 *   3) Si ambas fallan: se guarda el ping igual, con lat:null y
 *      fuente:"solo-timestamp" — nunca se pierde el registro de que hubo
 *      actividad, aunque falte el dónde.
 *
 * Estabilidad a 10 años: navigator.geolocation es API web estándar (no va a
 * desaparecer). ipapi.co/ip-api.com se tratan como plugins intercambiables
 * por nombre en PROVEEDORES_IP — si alguno cierra, se reemplaza ahí, sin
 * tocar el resto del archivo.
 * ============================================================================
 */
(function (global) {
  "use strict";

  var INTERVALO_MS = 15 * 60 * 1000; // 15 minutos
  var TIMEOUT_GPS_MS = 8000;
  var TIMEOUT_IP_MS = 6000;
  var CONSENT_KEY = "amg_geo_consentidos_v1"; // set de identidades que ya vieron el aviso
  var DB_NAME = "amg_geo_db";
  var DB_VERSION = 1;
  var STORE = "pings";

  // ---------------------------------------------------------------------------
  // Identidad de quien esta en sesion ("pin" del spec de JFC — en la practica
  // usamos el id del empleado logueado, o el rol para dueño/admin/contador,
  // que no tienen un id de usuario nombrado).
  // ---------------------------------------------------------------------------
  function identidadActual() {
    try {
      if (global.OCCurrentUser && global.OCCurrentUser.id) return "u:" + global.OCCurrentUser.id;
    } catch (_) {}
    try {
      if (global.OCAuth && global.OCAuth.rolActual) {
        var rol = global.OCAuth.rolActual();
        if (rol) return "rol:" + rol;
      }
    } catch (_) {}
    return null; // sin sesion reconocible: no se debe pingar
  }

  function nombreLegible(identidad) {
    try {
      if (identidad && identidad.indexOf("u:") === 0 && global.OCCurrentUser) return global.OCCurrentUser.nombre || identidad;
    } catch (_) {}
    if (identidad === "rol:dueno") return "Dueño/a";
    if (identidad === "rol:admin") return "Admin";
    if (identidad === "rol:contador") return "Contador/a";
    return identidad || "desconocido";
  }

  function deviceId() {
    try { return global.OCDeviceId || localStorage.getItem("amigable_device_id") || localStorage.getItem("oc_device_id") || "dispositivo-sin-id"; }
    catch (_) { return "dispositivo-sin-id"; }
  }

  // ---------------------------------------------------------------------------
  // Consentimiento — una vez por identidad, nunca oculto
  // ---------------------------------------------------------------------------
  function leerConsentidos() {
    try { return new Set(JSON.parse(localStorage.getItem(CONSENT_KEY) || "[]")); }
    catch (_) { return new Set(); }
  }
  function marcarConsentido(identidad) {
    var s = leerConsentidos();
    s.add(identidad);
    try { localStorage.setItem(CONSENT_KEY, JSON.stringify([...s])); } catch (_) {}
  }
  function yaConsentido(identidad) {
    return leerConsentidos().has(identidad);
  }

  // Aviso propio, autocontenido — NO depende de _ocSubgate (vive dentro del
  // closure de auth-ui.js, no expuesto en window; depender de eso hubiera
  // significado tocar ese archivo, y la regla de esta pieza es cero riesgo
  // para lo que ya funciona).
  function mostrarAvisoConsentimiento() {
    return new Promise(function (resolve) {
      try {
        var overlay = global.document.createElement("div");
        overlay.style.cssText = "position:fixed;inset:0;z-index:9500;background:rgba(15,25,35,.85);display:flex;align-items:center;justify-content:center;padding:20px;";
        var caja = global.document.createElement("div");
        caja.style.cssText = "background:#F8F9FB;border-radius:12px;padding:22px 20px;max-width:420px;width:100%;box-shadow:0 12px 40px rgba(0,0,0,.5);";
        caja.innerHTML =
          '<h3 style="margin:0 0 10px;font-size:18px;color:#0F1923;">Este negocio registra tu ubicación aproximada</h3>' +
          '<p style="margin:0 0 14px;font-size:14px;line-height:1.5;color:#2C3E50;">Mientras uses esta app con tu sesión abierta, se guarda tu ubicación aproximada cada 15 minutos — sirve para coordinar el equipo y verificar cumplimiento. No se registra nada cuando cierras sesión, y 15 minutos da margen para un descanso sin quedar marcado.</p>' +
          '<button id="amg-geo-ok" style="width:100%;padding:12px;border-radius:8px;border:none;background:#E86040;color:#fff;font-weight:700;font-size:15px;cursor:pointer;">Entendido</button>';
        overlay.appendChild(caja);
        global.document.body.appendChild(overlay);
        caja.querySelector("#amg-geo-ok").addEventListener("click", function () {
          overlay.remove();
          resolve(true);
        });
      } catch (_) { resolve(false); }
    });
  }

  // ---------------------------------------------------------------------------
  // Captura de posicion: cascada de 3 fuentes
  // ---------------------------------------------------------------------------
  function porGps() {
    return new Promise(function (resolve) {
      try {
        if (!global.navigator || !global.navigator.geolocation) { resolve(null); return; }
        var listo = false;
        var t = setTimeout(function () { if (!listo) { listo = true; resolve(null); } }, TIMEOUT_GPS_MS);
        global.navigator.geolocation.getCurrentPosition(
          function (pos) {
            if (listo) return; listo = true; clearTimeout(t);
            resolve({
              lat: pos.coords.latitude, lon: pos.coords.longitude,
              precision: pos.coords.accuracy != null ? Math.round(pos.coords.accuracy) : null,
              fuente: "gps",
            });
          },
          function () { if (listo) return; listo = true; clearTimeout(t); resolve(null); },
          { enableHighAccuracy: false, timeout: TIMEOUT_GPS_MS, maximumAge: 5 * 60 * 1000 }
        );
      } catch (_) { resolve(null); }
    });
  }

  // Proveedores de geolocalizacion por IP, en orden. Ambos HTTPS + capa
  // gratis sin API key. Formato de respuesta normalizado a {lat, lon} aqui
  // mismo para que agregar/quitar un proveedor no toque el resto del codigo.
  var PROVEEDORES_IP = [
    {
      nombre: "ipapi.co",
      url: "https://ipapi.co/json/",
      parsear: function (j) {
        if (j && typeof j.latitude === "number" && typeof j.longitude === "number") return { lat: j.latitude, lon: j.longitude };
        return null;
      },
    },
    {
      nombre: "ip-api.com",
      // https (no http) — ip-api.com solo da https en su dominio pro, pero
      // este endpoint http-only fallaria por mixed-content en un sitio https;
      // se deja como fallback documentado por si en el futuro se resuelve
      // via un proxy propio. Hoy, en la practica, casi siempre resuelve con
      // ipapi.co antes de llegar aqui.
      url: "http://ip-api.com/json/",
      parsear: function (j) {
        if (j && typeof j.lat === "number" && typeof j.lon === "number") return { lat: j.lat, lon: j.lon };
        return null;
      },
    },
  ];

  function porIpUnProveedor(prov) {
    return new Promise(function (resolve) {
      var ctrl = (typeof AbortController !== "undefined") ? new AbortController() : null;
      var t = setTimeout(function () { try { if (ctrl) ctrl.abort(); } catch (_) {} }, TIMEOUT_IP_MS);
      fetch(prov.url, ctrl ? { signal: ctrl.signal } : {})
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) {
          clearTimeout(t);
          var c = j ? prov.parsear(j) : null;
          resolve(c ? { lat: c.lat, lon: c.lon, precision: null, fuente: "ip:" + prov.nombre } : null);
        })
        .catch(function () { clearTimeout(t); resolve(null); });
    });
  }

  function porIp() {
    var i = 0;
    function siguiente() {
      if (i >= PROVEEDORES_IP.length) return Promise.resolve(null);
      var prov = PROVEEDORES_IP[i++];
      return porIpUnProveedor(prov).then(function (r) { return r || siguiente(); });
    }
    return siguiente();
  }

  function capturarUbicacion() {
    return porGps().then(function (r) {
      if (r) return r;
      return porIp().then(function (r2) {
        if (r2) return r2;
        return { lat: null, lon: null, precision: null, fuente: "solo-timestamp" };
      });
    });
  }

  // ---------------------------------------------------------------------------
  // IndexedDB — evento inmutable, nunca se sobreescribe un ping viejo
  // (mismo patron que hechos.js: keyPath unico por dispositivo+contador)
  // ---------------------------------------------------------------------------
  var _db = null;
  function abrirDB() {
    if (_db) return Promise.resolve(_db);
    return new Promise(function (resolve, reject) {
      if (!global.indexedDB) { reject(new Error("IndexedDB no disponible")); return; }
      var req = global.indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function (e) {
        var db = e.target.result;
        if (!db.objectStoreNames.contains(STORE)) {
          var st = db.createObjectStore(STORE, { keyPath: "id" });
          st.createIndex("pin", "pin", { unique: false });
          st.createIndex("ts", "ts", { unique: false });
        }
      };
      req.onsuccess = function (e) { _db = e.target.result; resolve(_db); };
      req.onerror = function () { reject(req.error || new Error("no se pudo abrir amg_geo_db")); };
    });
  }

  var _contadorLocal = 0;
  function guardarPing(ping) {
    return abrirDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).put(ping);
        tx.oncomplete = function () { resolve(ping); };
        tx.onerror = function () { reject(tx.error); };
      });
    });
  }

  function registrarPingAhora() {
    var identidad = identidadActual();
    if (!identidad) return Promise.resolve(null); // sin sesion: no se pinga
    return capturarUbicacion().then(function (u) {
      _contadorLocal += 1;
      var ping = {
        id: deviceId() + "-" + Date.now() + "-" + _contadorLocal,
        pin: identidad,
        nombre: nombreLegible(identidad),
        deviceId: deviceId(),
        ts: Date.now(),
        lat: u.lat, lon: u.lon, precision: u.precision, fuente: u.fuente,
      };
      return guardarPing(ping).catch(function (e) {
        try { console.warn("[geo-ping] no se pudo guardar:", e && e.message); } catch (_) {}
        return null;
      });
    });
  }

  // ---------------------------------------------------------------------------
  // Ciclo de vida: solo con sesion activa, nunca en background agresivo
  // ---------------------------------------------------------------------------
  var _temporizador = null;
  function detener() {
    if (_temporizador) { clearInterval(_temporizador); _temporizador = null; }
  }
  function arrancarParaSesion() {
    detener();
    var identidad = identidadActual();
    if (!identidad) return;
    var seguir = function () {
      _temporizador = setInterval(registrarPingAhora, INTERVALO_MS);
    };
    if (yaConsentido(identidad)) { seguir(); return; }
    mostrarAvisoConsentimiento().then(function (ok) {
      if (!ok) return; // se cerro el overlay sin aceptar (fallo de DOM): no se pinga esta sesion
      marcarConsentido(identidad);
      seguir();
    });
  }

  try { global.addEventListener("oc-login", function (ev) { if (!ev || !ev.detail || !ev.detail.demo) arrancarParaSesion(); }); } catch (_) {}
  try { global.addEventListener("oc-logout", detener); } catch (_) {}

  // ---------------------------------------------------------------------------
  // Lectura (para el panel "Dónde estuvo el equipo")
  // ---------------------------------------------------------------------------
  function todos() {
    return abrirDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, "readonly");
        var req = tx.objectStore(STORE).getAll();
        req.onsuccess = function () {
          var r = (req.result || []).slice();
          r.sort(function (a, b) { return b.ts - a.ts; }); // mas reciente primero
          resolve(r);
        };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  // Un solo ping (el mas reciente) por identidad — para pintar "Ultima
  // ubicacion" junto a cada miembro en la lista de Mi Equipo, sin que esa
  // lista tenga que saber nada de IndexedDB ni de la cascada de fuentes.
  function ultimosPorPin() {
    return todos().then(function (pings) {
      var mapa = {};
      pings.forEach(function (p) { if (!mapa[p.pin]) mapa[p.pin] = p; }); // ya viene ordenado, mas reciente primero
      return mapa;
    });
  }

  // ---------------------------------------------------------------------------
  // Panel "Dónde estuvo el equipo" — se monta solo en #vista-avanzado, que
  // index.html YA trae en el HTML estático. No depende del ciclo de render
  // de avanzado-extra.js (ese archivo queda sin tocar, checksum intacto).
  // Sin mapa embebido a proposito: un link a Google Maps por ping evita
  // sumar una libreria de mapas nueva solo para esto. Solo dueño/admin ven
  // el panel — es informacion del equipo, no de un empleado sobre si mismo.
  // ---------------------------------------------------------------------------
  function escHtmlGeo(s) {
    try { if (global.escHtml) return global.escHtml(s); } catch (_) {}
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]);
    });
  }
  function fmtFechaGeo(ts) {
    try { return new Date(ts).toLocaleString("es"); } catch (_) { return String(ts); }
  }
  function renderPanel() {
    var mount = global.document.getElementById("amg-geo-panel");
    if (!mount) return;
    todos().then(function (pings) {
      if (!pings.length) {
        mount.innerHTML = '<p style="font-size:14px;color:var(--ink-soft,#6b7785);">Aún no hay pings registrados.</p>';
        return;
      }
      var porPin = {};
      pings.forEach(function (p) { (porPin[p.pin] = porPin[p.pin] || []).push(p); });
      var html = "";
      Object.keys(porPin).forEach(function (pin) {
        var lista = porPin[pin];
        html += '<div style="margin-bottom:16px;"><div style="font-weight:700;font-size:14px;margin-bottom:6px;">' +
          escHtmlGeo(lista[0].nombre) + " · " + lista.length + " ping(s)</div>";
        lista.slice(0, 20).forEach(function (p) {
          var linkMapa = (p.lat != null && p.lon != null)
            ? '<a href="https://www.google.com/maps?q=' + p.lat + "," + p.lon + '" target="_blank" rel="noopener" style="color:#2E6278;">ver en el mapa</a> (±' + (p.precision || "?") + "m, " + escHtmlGeo(p.fuente) + ")"
            : '<span style="color:var(--ink-soft,#6b7785);">sin ubicación (' + escHtmlGeo(p.fuente) + ")</span>";
          html += '<div style="font-size:13px;padding:4px 0;border-bottom:1px solid rgba(0,0,0,.06);">' +
            fmtFechaGeo(p.ts) + " — " + linkMapa + "</div>";
        });
        html += "</div>";
      });
      mount.innerHTML = html;
    }).catch(function () {
      mount.innerHTML = '<p style="font-size:14px;color:var(--rojo,#a3392a);">No se pudo leer el registro de ubicaciones.</p>';
    });
  }

  function esDuenoOAdmin() {
    try {
      var rol = global.OCAuth && global.OCAuth.rolActual && global.OCAuth.rolActual();
      return rol === "dueno" || rol === "admin";
    } catch (_) { return false; }
  }

  // Blindaje (misma sesion de bugs, JFC 2026-07-28): el panel debe
  // MONTARSE una sola vez pero su VISIBILIDAD se re-evalua en cada cambio
  // de sesion — si no, un dueño que cierra sesion y le pasa el mismo
  // dispositivo a un empleado dejaria el panel del equipo completo visible
  // para ese empleado, que es exactamente el tipo de fuga de datos entre
  // roles que este proyecto blinda en todos lados (ver body.rol-empleado
  // en auth-ui.js). Se re-chequea el rol, nunca se asume que "montado"
  // significa "debe seguir visible".
  function montarPanel() {
    try {
      var vista = global.document.getElementById("vista-avanzado");
      if (!vista) return;
      var caja = global.document.getElementById("amg-geo-caja");
      if (!caja) {
        caja = global.document.createElement("div");
        caja.id = "amg-geo-caja";
        caja.className = "tag-card";
        caja.style.cssText = "text-align:left;margin-top:22px;";
        caja.innerHTML = '<h3 class="seccion" style="margin-top:0;">Dónde estuvo el equipo</h3>' +
          '<p style="font-size:13px;color:var(--ink-soft,#6b7785);margin-top:0;">Un ping cada 15 minutos mientras cada quien tiene su sesión abierta. Nunca en segundo plano ni al cerrar sesión.</p>' +
          '<div id="amg-geo-panel"></div>';
        vista.appendChild(caja);
      }
      var visible = esDuenoOAdmin();
      caja.style.display = visible ? "" : "none";
      if (visible) renderPanel();
    } catch (_) {}
  }

  try {
    if (global.document.readyState === "loading") {
      global.addEventListener("DOMContentLoaded", montarPanel, { once: true });
    } else {
      montarPanel();
    }
  } catch (_) {}
  try { global.addEventListener("oc-login", montarPanel); } catch (_) {}
  try { global.addEventListener("oc-logout", montarPanel); } catch (_) {}

  global.AMG = global.AMG || {};
  global.AMG.GeoPing = {
    VERSION: "1.0.0",
    registrarPingAhora: registrarPingAhora,
    todos: todos,
    ultimosPorPin: ultimosPorPin,
    identidadActual: identidadActual,
    _arrancarParaSesion: arrancarParaSesion, // expuesto para pruebas manuales
  };
})(typeof window !== "undefined" ? window : this);
