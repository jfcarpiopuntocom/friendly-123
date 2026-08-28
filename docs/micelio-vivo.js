/* ============================================================================
   micelio-vivo.js — quién está en el loop y quién anda a ciegas.
   friendly-123-123 · 2026-08-15 · JFC

   EL PROBLEMA QUE RESUELVE, dicho sin adornos: que dos personas del mismo
   negocio pisen el mismo dato es un problema menor. Que una venda a ciegas
   durante tres horas — sin saber que su teléfono lleva tres horas sin hablar
   con el resto — es el problema grande: vende duplicado, promete stock que ya
   no existe y nadie se entera hasta el cierre.

   CÓMO FUNCIONA: cada dispositivo manda un LATIDO cifrado cada minuto por la
   misma sala que ya usa el sync. El latido no lleva ni un dato del negocio:
   solo un id de dispositivo, cómo lo llaman, el rol y la hora. Todos los
   demás lo escuchan y anotan, EN SU PROPIO DISPOSITIVO, cuándo vieron por
   última vez a cada quien.

   POR QUÉ ESO BASTA: un dispositivo desconectado no puede avisar que está
   desconectado. Por eso no se pregunta "¿estás ahí?" sino que se recuerda
   "la ultima vez que se le oyo". El silencio ES la señal.

   EL RELAY NO GUARDA NADA, tampoco esto. La lista del equipo se arma y se
   guarda en cada aparato por separado. Si todos se apagan, se pierde, y no
   pasa nada: se vuelve a armar sola con el primer latido de cada uno.

   TRES ESTADOS, no dos (decisión de JFC, 2026-08-15):
     al día    — habló hace poco. Todo bien.
     rezagado  — lleva un rato callado. Casi siempre es el wifi. No es grave.
     a ciegas  — lleva mucho. Ese dispositivo puede estar vendiendo duplicado.
   Dos estados no alcanzan: un encargado que cerró la app al terminar su turno
   se vería igual de rojo que uno que lleva la mañana entera ciego, y una
   alarma que suena siempre deja de ser una alarma.

   Los umbrales tienen perilla (JFC: "siempre con perilla"). Los valores de
   fábrica sirven para el 95%; quien de verdad exprima la app va a querer
   moverlos.

   Este módulo NO toca datos del negocio. Si falla entero, la app sigue
   vendiendo igual: solo se pierde el aviso.
   ============================================================================ */
(function () {
  "use strict";

  var LATIDO_MS = 60000;          /* un latido por minuto: suficiente para
                                     detectar en minutos, y ~90 bytes cifrados
                                     por dispositivo por minuto. Nada. */
  var TIPO_LATIDO = "__latido__"; /* espejo en sync-realtime.js */

  var K_YO = "f123_micelio_yo";       /* mi apodo y mi id */
  var K_EQUIPO = "f123_micelio_vistos"; /* último latido de cada quien */
  var K_PERILLA = "f123_micelio_umbrales";
  var K_AVISADO = "f123_micelio_avisado";

  /* De fábrica: 5 minutos y 2 horas. Ver el comentario de arriba. */
  var POR_DEFECTO = { rezagado: 5, ciegas: 120 };

  var TOPE_EQUIPO = 40;   /* un negocio con más de 40 dispositivos en la misma
                             sala no existe; el tope evita que un código
                             filtrado llene el storage de basura. */
  var PODA_MS = 24 * 60 * 60 * 1000; /* FASE 2 (2026-08-27): un aparato callado
                             más de 24h se considera dado de baja y se poda del
                             registro, para que no quede "a ciegas" para siempre
                             ni el verificador del watchdog persiga fantasmas. */

  function leer(k, fallback) {
    try {
      var raw = localStorage.getItem(k);
      if (!raw) return fallback;
      var v = JSON.parse(raw);
      return (v && typeof v === "object") ? v : fallback;
    } catch (_) { return fallback; }
  }
  function escribir(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {}
  }

  /* ---------------------------------------------------------------- yo --- */
  function yo() {
    var m = leer(K_YO, null);
    if (m && m.id) return m;
    m = { id: "d" + Math.random().toString(36).slice(2, 10), apodo: "" };
    escribir(K_YO, m);
    return m;
  }
  function miApodo() {
    var m = yo();
    if (m.apodo) return m.apodo;
    /* Sin apodo puesto todavía: se muestra el rol, que siempre existe. Nunca
       el PIN, ni siquiera enmascarado — el PIN no se enseña, se teclea. */
    return "";
  }
  function ponerApodo(txt) {
    var m = yo();
    m.apodo = String(txt || "").trim().slice(0, 28);
    escribir(K_YO, m);
    try { window.dispatchEvent(new CustomEvent("oc-micelio-cambio")); } catch (_) {}
    latir();   /* que el equipo vea el nombre nuevo ya, no en un minuto */
    return m.apodo;
  }

  function rolActual() {
    /* ROL SOPORTE (JFC 2026-08-27): cuando JFC entra a una tienda ajena como
       lord (código maestro), su latido reporta "soporte" (maintenance/support),
       no el rol del PIN. Así aparece como soporte en el panel del equipo de esa
       tienda, no como dueño. */
    try {
      if (localStorage.getItem("f123_lord") === "1") return "soporte";
    } catch (_) {}
    try {
      var r = window.OCAuth && window.OCAuth.rolActual && window.OCAuth.rolActual();
      return r || "";
    } catch (_) { return ""; }
  }

  /* AUTO-NUMERACIÓN DE APODOS (JFC 2026-08-27): si un dispositivo no tiene
     apodo/nickname, se le asigna visiblemente 001, 002, ... para que siempre
     se pueda identificar qué pasa y tener control real. El número es
     DETERMINISTA y ESTABLE: deriva del deviceId, así el mismo dispositivo
     muestra el mismo número en TODOS los aparatos (consistencia entre
     dispositivos, que es lo que pide "estable"). No es "en orden de llegada"
     sino un hash estable → 001-999. */
  function numeroEstable(id) {
    var s = String(id || "");
    if (!s) return "";
    var h = 0;
    for (var i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) >>> 0; }
    return String((h % 999) + 1).padStart(3, "0");
  }
  function apodoVisible(m) {
    if (!m) return "";
    if (m.apodo) return m.apodo;
    var n = numeroEstable(m.id);
    if (n) return n;
    return "Device " + String(m.id || "").slice(1, 5);
  }

  /* ------------------------------------------------------------ perilla --- */
  function umbrales() {
    var u = leer(K_PERILLA, null) || {};
    var rez = Number(u.rezagado), cie = Number(u.ciegas);
    if (!(rez > 0)) rez = POR_DEFECTO.rezagado;
    if (!(cie > 0)) cie = POR_DEFECTO.ciegas;
    /* Un "a ciegas" por debajo del "rezagado" haría que nadie fuera nunca
       rezagado. Se corrige en silencio en vez de dejar el sistema mal
       calibrado sin que nadie se entere. */
    if (cie <= rez) cie = rez * 4;
    return { rezagado: rez, ciegas: cie };
  }
  function ponerUmbrales(rezMin, ciegasMin) {
    escribir(K_PERILLA, { rezagado: Number(rezMin) || POR_DEFECTO.rezagado,
                          ciegas: Number(ciegasMin) || POR_DEFECTO.ciegas });
    try { window.dispatchEvent(new CustomEvent("oc-micelio-cambio")); } catch (_) {}
  }

  /* ------------------------------------------------------------- estado --- */
  /* Función pura: se le dan milisegundos de silencio y devuelve el estado.
     Aparte a propósito, para poder probarla sin red ni storage. */
  function estadoPorSilencio(ms, u) {
    u = u || umbrales();
    if (ms < u.rezagado * 60000) return "al_dia";
    if (ms < u.ciegas * 60000) return "rezagado";
    return "ciegas";
  }

  var ETIQUETAS = {
    al_dia:   { texto: "Up to date",   color: "#00C87A", tinta: "#0A2E1E" },
    rezagado: { texto: "Behind",       color: "#FFC700", tinta: "#3D2E00" },
    ciegas:   { texto: "Flying blind", color: "#E8365D", tinta: "#FFFFFF" },
  };

  /* "hace 3 minutos", no un timestamp. El dueño no lee ISO. */
  function haceCuanto(ms) {
    if (ms < 45000) return "just now";
    var min = Math.round(ms / 60000);
    if (min < 60) return min + (min === 1 ? " minute ago" : " minutes ago");
    var h = Math.round(min / 60);
    if (h < 24) return h + (h === 1 ? " hour ago" : " hours ago");
    var d = Math.round(h / 24);
    return d + (d === 1 ? " day ago" : " days ago");
  }

  /* ------------------------------------------------------------- equipo --- */
  /* Poda los aparatos callados más de PODA_MS (24h): se consideran dados de
     baja. Nunca poda mi propio id (yo siempre estoy en el panel). Se llama al
     leer, así el registro no crece con fantasmas. */
  function podarEquipo() {
    try {
      var m = leer(K_EQUIPO, {});
      var yoId = yo().id;
      var ahora = Date.now();
      var cambio = false;
      Object.keys(m).forEach(function (id) {
        if (id === yoId) return;
        var visto = Number((m[id] || {}).visto) || 0;
        if (visto && (ahora - visto) > PODA_MS) { delete m[id]; cambio = true; }
      });
      if (cambio) escribir(K_EQUIPO, m);
    } catch (_) {}
  }
  function equipo() {
    podarEquipo();
    var m = leer(K_EQUIPO, {});
    var yoId = yo().id;
    var u = umbrales();
    var ahora = Date.now();
    var out = [];
    Object.keys(m).forEach(function (id) {
      var e = m[id] || {};
      var visto = Number(e.visto) || 0;
      if (!visto) return;
      var silencio = ahora - visto;
      out.push({
        id: id,
        soyYo: id === yoId,
        apodo: e.apodo || "",
        rol: e.rol || "",
        huella: e.huella || "",
        visto: visto,
        silencioMs: silencio,
        cuando: haceCuanto(silencio),
        estado: estadoPorSilencio(silencio, u),
      });
    });
    /* Yo siempre estoy en la lista, aunque nunca haya latido: no verse a uno
       mismo en el panel del equipo es desconcertante. */
    if (!out.some(function (x) { return x.soyYo; })) {
      out.push({ id: yoId, soyYo: true, apodo: miApodo(), rol: rolActual(),
                 visto: ahora, silencioMs: 0, cuando: "hace un momento", estado: "al_dia" });
    }
    /* Lo urgente arriba: a ciegas, rezagado, al día. Dentro de cada grupo, el
       que lleva más tiempo callado primero. */
    var ORDEN = { ciegas: 0, rezagado: 1, al_dia: 2 };
    out.sort(function (a, b) {
      return (ORDEN[a.estado] - ORDEN[b.estado]) || (b.silencioMs - a.silencioMs);
    });
    return out;
  }

  function anotar(payload) {
    if (!payload || !payload.id) return;
    var m = leer(K_EQUIPO, {});
    /* Tope: si la sala se llenara de ids desconocidos, se descartan los más
       viejos en vez de crecer sin control. */
    var ids = Object.keys(m);
    if (ids.length >= TOPE_EQUIPO && !m[payload.id]) {
      ids.sort(function (a, b) { return (m[a].visto || 0) - (m[b].visto || 0); });
      delete m[ids[0]];
    }
    m[payload.id] = {
      apodo: String(payload.apodo || "").slice(0, 28),
      rol: String(payload.rol || "").slice(0, 12),
      huella: String(payload.huella || "").slice(0, 12),
      visto: Date.now(),
    };
    escribir(K_EQUIPO, m);
    try { window.dispatchEvent(new CustomEvent("oc-micelio-cambio")); } catch (_) {}
  }

  /* La huella del catalogo de ESTE dispositivo, para mandarla en el latido.
     Si mock-backend no esta cargado todavia, se manda vacia: un latido sin
     huella se trata como "no se sabe", nunca como "coincide". */
  function miHuella() {
    try {
      var h = window.OCSync && window.OCSync.huella ? window.OCSync.huella() : null;
      return h && h.corta ? h.corta : "";
    } catch (_) { return ""; }
  }

  /* Compara la huella de cada miembro con la mia. Devuelve los que estan
     mostrando OTRO inventario. Los que no mandaron huella (version vieja de la
     app) no cuentan como discrepancia: no se sabe, y afirmar sin saber es
     exactamente el error que este paso viene a corregir. */
  function desalineados() {
    try {
      var mia = miHuella();
      if (!mia) return [];
      return equipo().filter(function (x) { return x.huella && x.huella !== mia; });
    } catch (_) { return []; }
  }

  /* Se llama desde sync-realtime.js al recibir un latido ajeno. */
  function recibir(op) {
    if (!op || op.tipo !== TIPO_LATIDO || !op.payload) return;
    anotar(op.payload);
  }

  /* -------------------------------------------------------------- latir --- */
  function latir() {
    try {
      /* El canal es OCSyncControl, no OCSync: ese ultimo solo expone
         aplicarOpRemota. Confundirlos deja el micelio mudo sin un solo error. */
      var canal = window.OCSyncControl;
      if (!canal || !canal.emitirLatido) return;
      var m = yo();
      var hu = miHuella();
      canal.emitirLatido({ id: m.id, apodo: m.apodo, rol: rolActual(), huella: hu });
      /* Mi propio latido no vuelve a mí por el relay, así que me anoto solo. */
      anotar({ id: m.id, apodo: m.apodo, rol: rolActual(), huella: hu });
    } catch (_) {}
  }

  /* ------------------------------------------------------- mi propio yo --- */
  /* Cuánto llevo YO sin que el equipo me oiga. Se mide por el estado real de
     la conexión, no por mi último latido: si el WebSocket está caído, latir no
     sirve de nada aunque la función se ejecute. */
  var ultimoConectado = Date.now();
  function marcarConectado() { ultimoConectado = Date.now(); }
  function miEstado() {
    var silencio = Date.now() - ultimoConectado;
    return { estado: estadoPorSilencio(silencio), silencioMs: silencio, cuando: haceCuanto(silencio) };
  }

  /* -------------------------------------------------------------- aviso --- */
  /* NOTIFICACIONES DEL NAVEGADOR. El permiso NO se pide al arrancar: pedirlo
     de entrada es la forma más rápida de que lo nieguen para siempre. Se pide
     cuando el dueño enciende el aviso a propósito, que es cuando entiende para
     qué sirve. Si lo niega, el aviso en pantalla sigue funcionando igual. */
  function pedirPermisoAviso() {
    try {
      if (!("Notification" in window)) return Promise.resolve("no-soportado");
      if (Notification.permission === "granted") return Promise.resolve("granted");
      if (Notification.permission === "denied") return Promise.resolve("denied");
      return Notification.requestPermission();
    } catch (_) { return Promise.resolve("error"); }
  }

  /* Que el navegador no borre los datos del negocio cuando le falte espacio.
     Sin esto, un teléfono con poca memoria puede tirar el storage del sitio en
     silencio. Se pide junto con el permiso de avisos, que es cuando el dueño
     ya está diciendo "esto lo quiero en serio". */
  function pedirPersistencia() {
    try {
      if (navigator.storage && navigator.storage.persist) return navigator.storage.persist();
    } catch (_) {}
    return Promise.resolve(false);
  }

  function avisar(titulo, cuerpo) {
    try {
      if (!("Notification" in window) || Notification.permission !== "granted") return false;
      var n = new Notification(titulo, { body: cuerpo, tag: "amigable-micelio", renotify: false });
      setTimeout(function () { try { n.close(); } catch (_) {} }, 12000);
      return true;
    } catch (_) { return false; }
  }

  /* Vigilancia: avisa UNA vez por cambio de estado, no cada minuto. Un aviso
     que se repite se silencia, y entonces ya no avisa de nada. */
  function vigilar() {
    var previo = leer(K_AVISADO, {});
    var mio = miEstado().estado;
    if (mio !== previo.yo) {
      if (mio === "ciegas") {
        avisar("You are out of the loop",
          "Your device has not synced with the team in a while. Careful about selling something someone else already sold.");
      } else if (previo.yo === "ciegas" && mio === "al_dia") {
        avisar("You are up to date", "Your device is syncing with the team again.");
      }
      previo.yo = mio;
    }
    /* El dueño y el admin además vigilan al equipo. Un encargado no recibe
       avisos de los demás: no es su trabajo perseguir a nadie. */
    var rol = rolActual();
    if (rol === "dueno" || rol === "admin") {
      previo.otros = previo.otros || {};
      equipo().forEach(function (m) {
        if (m.soyYo) return;
        if (m.estado === "ciegas" && previo.otros[m.id] !== "ciegas") {
          avisar("A device is flying blind",
            (m.apodo || m.rol || "A device") + " has gone " + m.cuando.replace(" ago", "") + " without syncing.");
        }
        previo.otros[m.id] = m.estado;
      });
    }
    escribir(K_AVISADO, previo);
  }

  /* ------------------------------------------------------------ arranque --- */
  var timer = null;
  function arrancar() {
    if (timer) return;
    latir();
    timer = setInterval(function () { latir(); vigilar(); }, LATIDO_MS);
    /* Al volver de segundo plano, latir ya: en un teléfono el intervalo se
       congela cuando la pantalla se apaga, y volver mostrando datos de hace
       media hora sería exactamente el problema que este módulo resuelve. */
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) { latir(); vigilar(); }
    });
    window.addEventListener("online", function () { latir(); });
  }

  window.OCMicelio = {
    yo: yo, miApodo: miApodo, ponerApodo: ponerApodo,
    apodoVisible: apodoVisible, numeroEstable: numeroEstable,
    equipo: equipo, recibir: recibir, latir: latir,
    umbrales: umbrales, ponerUmbrales: ponerUmbrales,
    estadoPorSilencio: estadoPorSilencio, haceCuanto: haceCuanto,
    etiquetas: ETIQUETAS, miEstado: miEstado, marcarConectado: marcarConectado,
    pedirPermisoAviso: pedirPermisoAviso, pedirPersistencia: pedirPersistencia,
    arrancar: arrancar, TIPO_LATIDO: TIPO_LATIDO,
    miHuella: miHuella, desalineados: desalineados,
    /* El tablero arma su lista con los latidos que descifra, sin storage. */
    desdeLatidos: function (mapa) {
      var u = umbrales(), ahora = Date.now(), out = [];
      Object.keys(mapa || {}).forEach(function (id) {
        var e = mapa[id], silencio = ahora - (e.visto || 0);
        out.push({ id: id, apodo: e.apodo || "", rol: e.rol || "", soyYo: false,
                   silencioMs: silencio, cuando: haceCuanto(silencio),
                   estado: estadoPorSilencio(silencio, u) });
      });
      var ORDEN = { ciegas: 0, rezagado: 1, al_dia: 2 };
      out.sort(function (a, b) { return (ORDEN[a.estado] - ORDEN[b.estado]) || (b.silencioMs - a.silencioMs); });
      return out;
    },
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", arrancar);
  else arrancar();
})();
