/*!
 * geo-ping.js — friendly-123 · Control de ubicación del equipo (2026-07-28)
 * ============================================================================
 * QUE ES ESTO
 * ----------------------------------------------------------------------------
 * Mientras un encargado/dueño/admin tiene sesión abierta, este archivo guarda
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
  var TIMEOUT_GPS_MS = 12000; // mas tiempo: alta precision tarda mas en cerrar el primer fix
  var TIMEOUT_IP_MS = 6000;
  var CONSENT_KEY = "f123_geo_consentidos_v1"; // FIX (JFC 2026-08-20, G2): compartido literal con AMIGABLE/Consultorio-123
  var DB_NAME = "f123_geo_db"; // FIX (JFC 2026-08-20, G2): compartido literal con AMIGABLE/Consultorio-123
  var DB_VERSION = 1;
  var STORE = "pings";

  // Bilingue (JFC 2026-07-28, "friendly-123 es EN-first"): mismo patron que
  // reconciliacion.js — T()/TF() envuelven window.t()/window.tf() (definidos
  // en i18n.js) y caen a la propia clave si i18n.js no cargo todavia, para
  // que un fallo de orden de carga nunca deje texto en blanco.
  function T(k) { try { return (global.t ? global.t(k) : k); } catch (_) { return k; } }
  function TF(k, vars) { try { return (global.tf ? global.tf(k, vars) : k); } catch (_) { return k; } }

  // ---------------------------------------------------------------------------
  // Identidad de quien esta en sesion ("pin" del spec de JFC — en la practica
  // usamos el id del encargado logueado, o el rol para dueño/admin/contador,
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
    if (identidad === "rol:dueno") return T("geo.role.owner");
    if (identidad === "rol:admin") return T("geo.role.admin");
    if (identidad === "rol:contador") return T("geo.role.accountant");
    return identidad || T("geo.role.unknown");
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
  //
  // Guard anti-duplicado (JFC 2026-07-30, "pule"): si oc-login dispara mas
  // de una vez seguida (pasa en la practica: login + revisita de vista casi
  // simultanea), arrancarParaSesion() podia llamar esto dos veces antes de
  // que la primera terminara, mostrando 2 overlays apilados. _avisoPendiente
  // cachea la promesa en curso: una segunda llamada mientras la primera
  // sigue abierta espera la MISMA respuesta en vez de crear un overlay nuevo.
  var _avisoPendiente = null;
  function mostrarAvisoConsentimiento() {
    if (_avisoPendiente) return _avisoPendiente;
    _avisoPendiente = new Promise(function (resolve) {
      try {
        var overlay = global.document.createElement("div");
        overlay.style.cssText = "position:fixed;inset:0;z-index:9500;background:rgba(15,25,35,.85);display:flex;align-items:center;justify-content:center;padding:20px;";
        var caja = global.document.createElement("div");
        caja.style.cssText = "background:#F8F9FB;border-radius:12px;padding:22px 20px;max-width:420px;width:100%;box-shadow:0 12px 40px rgba(0,0,0,.5);";
        caja.innerHTML =
          '<h3 style="margin:0 0 10px;font-size:18px;color:#0F1923;">' + T("geo.consent.title") + '</h3>' +
          '<p style="margin:0 0 14px;font-size:14px;line-height:1.5;color:#2C3E50;">' + T("geo.consent.body") + '</p>' +
          '<button id="amg-geo-ok" style="width:100%;padding:12px;border-radius:8px;border:none;background:#E86040;color:#fff;font-weight:700;font-size:15px;cursor:pointer;">' + T("geo.consent.ok") + '</button>';
        overlay.appendChild(caja);
        global.document.body.appendChild(overlay);
        caja.querySelector("#amg-geo-ok").addEventListener("click", function () {
          overlay.remove();
          _avisoPendiente = null;
          resolve(true);
        });
      } catch (_) { _avisoPendiente = null; resolve(false); }
    });
    return _avisoPendiente;
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
            // JFC 2026-07-30: un fix "exitoso" de getCurrentPosition no siempre
            // es GPS real — si el chip no cierra a tiempo, el navegador puede
            // devolver un fix por WiFi/torre celular con accuracy de cientos o
            // miles de metros, y antes lo etiquetabamos "gps" igual. Ahora se
            // distingue por precision para que el panel pueda avisar cuando el
            // pin es solo aproximado, no exacto.
            var acc = pos.coords.accuracy != null ? Math.round(pos.coords.accuracy) : null;
            resolve({
              lat: pos.coords.latitude, lon: pos.coords.longitude,
              precision: acc,
              fuente: (acc != null && acc > 300) ? "gps-baja-precision" : "gps",
            });
          },
          function () { if (listo) return; listo = true; clearTimeout(t); resolve(null); },
          // JFC 2026-07-30: con enableHighAccuracy:false el telefono a veces
          // resuelve por WiFi/torre celular en vez de GPS real (el chip GPS
          // ni se enciende) y el resultado puede caer en el centro de la
          // ciudad — a varias cuadras del sitio real. true fuerza el chip GPS
          // cuando existe. maximumAge bajo (antes 5 min) evita reusar un fix
          // viejo y probablemente impreciso.
          { enableHighAccuracy: true, timeout: TIMEOUT_GPS_MS, maximumAge: 60 * 1000 }
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
    /* GEOTAGGING APAGADO POR DEFECTO (JFC 2026-08-21): "el anuncio del geo
       tagging pasemoslo a dentro de ayuda, me parece innecesario un popup en
       el flujo".
       La causa del popup era que esto se encendia para TODO el mundo al
       entrar, asi que a todos les tocaba el aviso de consentimiento aunque el
       negocio no usara la funcion. Ahora la enciende el dueño en Avanzado, y
       el aviso solo aparece si de verdad se va a registrar la ubicacion de
       alguien. El consentimiento NO se quita: pedir permiso antes de guardar
       donde estuvo una persona no es un tramite que se pueda saltar, es el
       motivo por el que la funcion se puede ofrecer.
       Que hace la funcion y como se enciende: explicado en Ayuda. */
    if (!global.OCGeo || !global.OCGeo.activo()) return;
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
  // el panel — es informacion del equipo, no de un encargado sobre si mismo.
  // ---------------------------------------------------------------------------
  function escHtmlGeo(s) {
    try { if (global.escHtml) return global.escHtml(s); } catch (_) {}
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]);
    });
  }
  function localeActivo() {
    try { return global.document.documentElement.lang === "es" ? "es-US" : "en-US"; } catch (_) { return "en-US"; }
  }
  function fmtFechaGeo(ts) {
    try { return new Date(ts).toLocaleString(localeActivo()); } catch (_) { return String(ts); }
  }
  // JFC 2026-07-30 ("esta muerta, la mataste"): esta lista era el unico
  // panel de la app SIN busqueda ni orden, mientras Clientes/Productos/
  // Perchas ya usan AMG.ListaDinamica (busqueda + orden por columna). La
  // convertimos al mismo componente en vez de mantener un segundo patron.
  function renderPanel() {
    var mount = global.document.getElementById("amg-geo-panel");
    if (!mount) return;
    todos().then(function (pings) {
      if (!pings.length) {
        mount.innerHTML = '<p style="font-size:14px;color:var(--ink-soft,#6b7785);">' + T("geo.panel.empty") + '</p>';
        return;
      }
      if (!global.AMG || !global.AMG.ListaDinamica) {
        // Degradacion segura: si lista-dinamica.js no cargo por algun
        // motivo, no dejamos el panel en blanco - mostramos los pings tal
        // cual, sin buscador ni orden, en vez de romper todo el panel.
        mount.innerHTML = pings.slice(0, 40).map(function (p) {
          return '<div style="font-size:13px;padding:4px 0;border-bottom:1px solid rgba(0,0,0,.06);">' +
            escHtmlGeo(p.nombre) + " — " + fmtFechaGeo(p.ts) + '</div>';
        }).join("");
        return;
      }
      global.AMG.ListaDinamica.crear({
        contenedorId: "amg-geo-panel",
        placeholderBusqueda: T("geo.panel.searchPlaceholder"),
        columnas: [
          { key: "nombre", label: T("geo.panel.colMember"), ordenable: true },
          { key: "ts", label: T("geo.panel.colWhen"), ordenable: true, valor: function (p) { return p.ts; } },
          { key: "precision", label: T("geo.panel.colPrecision"), ordenable: true, valor: function (p) { return p.precision == null ? -1 : p.precision; } }
        ],
        datos: function () { return pings; },
        mensajeVacio: T("geo.panel.noResults"),
        renderFila: function (p) {
          var linkMapa = (p.lat != null && p.lon != null)
            ? '<a href="https://www.google.com/maps?q=' + p.lat + "," + p.lon + '" target="_blank" rel="noopener" style="color:#2E6278;">' + T("geo.panel.viewMap") + '</a> (±' + (p.precision || "?") + "m, " + escHtmlGeo(p.fuente) + ")"
            : '<span style="color:var(--ink-soft,#6b7785);">' + escHtmlGeo(TF("geo.panel.noLocation", { fuente: p.fuente })) + "</span>";
          return '<div style="font-size:13px;padding:6px 0;border-bottom:1px solid rgba(0,0,0,.06);">' +
            "<strong>" + escHtmlGeo(p.nombre) + "</strong> — " + fmtFechaGeo(p.ts) + " — " + linkMapa + "</div>";
        }
      });
    }).catch(function () {
      mount.innerHTML = '<p style="font-size:14px;color:var(--rojo,#a3392a);">' + T("geo.panel.readError") + '</p>';
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
  // dispositivo a un encargado dejaria el panel del equipo completo visible
  // para ese encargado, que es exactamente el tipo de fuga de datos entre
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
        caja.innerHTML = '<h3 class="seccion" style="margin-top:0;">' + T("geo.panel.title") + '</h3>' +
          '<p style="font-size:14px;color:var(--ink-soft,#6b7785);margin-top:0;">' + T("geo.panel.body") + '</p>' +
          /* El interruptor (JFC 2026-08-21). Antes esto se encendia solo para
             todo el mundo y por eso a cada persona le salia el aviso de
             consentimiento al entrar. Ahora es una decision del dueño. */
          '<label style="display:flex;align-items:center;gap:10px;font-size:14px;font-weight:700;cursor:pointer;min-height:44px;color:#2C3E50;">' +
            '<input type="checkbox" id="amg-geo-toggle" style="width:20px;height:20px;">' +
            '<span id="amg-geo-toggle-text">' + T("geo.panel.toggleLabel") + '</span>' +
          '</label>' +
          '<p id="amg-geo-consent" style="font-size:14px;line-height:1.5;color:#2C3E50;margin:0 0 12px;">' + T("geo.panel.consentBody") + '</p>' +
          '<div id="amg-geo-panel"></div>';
        vista.appendChild(caja);
        try {
          var _chk = caja.querySelector("#amg-geo-toggle");
          _chk.checked = !!(global.OCGeo && global.OCGeo.activo());
          _chk.addEventListener("change", function () {
            if (global.OCGeo) global.OCGeo.encender(_chk.checked);
          });
        } catch (_) {}
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
  // Bilingue: re-pinta el titulo/cuerpo estatico y la lista al cambiar de
  // idioma (mismo evento que escuchan las demas vistas dinamicas, ver i18n.js).
  try {
    global.addEventListener("oc-lang-change", function () {
      var caja = global.document.getElementById("amg-geo-caja");
      if (!caja) return;
      var h3 = caja.querySelector("h3.seccion");
      var p = caja.querySelector("p");
      var toggleText = caja.querySelector("#amg-geo-toggle-text");
      var consent = caja.querySelector("#amg-geo-consent");
      if (h3) h3.textContent = T("geo.panel.title");
      if (p) p.textContent = T("geo.panel.body");
      if (toggleText) toggleText.textContent = T("geo.panel.toggleLabel");
      if (consent) consent.textContent = T("geo.panel.consentBody");
      if (esDuenoOAdmin()) renderPanel();
    });
  } catch (_) {}

  /* Interruptor del geotagging (JFC 2026-08-21). Apagado por defecto: la
     ausencia de la clave significa APAGADO, asi que ningun negocio que ya
     estaba usando la app empieza a registrar ubicaciones de golpe por una
     actualizacion. Solo el dueño lo enciende, desde Avanzado. */
  var GEO_ON_KEY = "f123_geo_activo_v1";
  global.OCGeo = {
    activo: function () {
      try { return global.localStorage.getItem(GEO_ON_KEY) === "1"; } catch (_) { return false; }
    },
    encender: function (on) {
      try { global.localStorage.setItem(GEO_ON_KEY, on ? "1" : "0"); } catch (_) {}
      if (on) { try { arrancarParaSesion(); } catch (_) {} } else { detener(); }
    },
  };

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
