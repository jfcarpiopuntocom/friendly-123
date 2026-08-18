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
   "la última vez que te oí". El silencio ES la señal.

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
    try {
      var r = window.OCAuth && window.OCAuth.rolActual && window.OCAuth.rolActual();
      return r || "";
    } catch (_) { return ""; }
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
    al_dia:   { texto: "Al día",    color: "#00C87A", tinta: "#0A2E1E" },
    rezagado: { texto: "Rezagado",  color: "#FFC700", tinta: "#3D2E00" },
    ciegas:   { texto: "A ciegas",  color: "#E8365D", tinta: "#FFFFFF" },
  };

  /* "hace 3 minutos", no un timestamp. El dueño no lee ISO. */
  function haceCuanto(ms) {
    if (ms < 45000) return "hace un momento";
    var min = Math.round(ms / 60000);
    if (min < 60) return "hace " + min + (min === 1 ? " minuto" : " minutos");
    var h = Math.round(min / 60);
    if (h < 24) return "hace " + h + (h === 1 ? " hora" : " horas");
    var d = Math.round(h / 24);
    return "hace " + d + (d === 1 ? " día" : " días");
  }

  /* ------------------------------------------------------------- equipo --- */
  function equipo() {
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
      visto: Date.now(),
    };
    escribir(K_EQUIPO, m);
    try { window.dispatchEvent(new CustomEvent("oc-micelio-cambio")); } catch (_) {}
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
      canal.emitirLatido({ id: m.id, apodo: m.apodo, rol: rolActual() });
      /* Mi propio latido no vuelve a mí por el relay, así que me anoto solo. */
      anotar({ id: m.id, apodo: m.apodo, rol: rolActual() });
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
        avisar("Estás fuera del loop",
          "Tu dispositivo lleva un rato sin sincronizar con el equipo. Cuidado con vender algo que otro ya vendió.");
      } else if (previo.yo === "ciegas" && mio === "al_dia") {
        avisar("Ya estás al día", "Tu dispositivo volvió a sincronizar con el equipo.");
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
          avisar("Un dispositivo está a ciegas",
            (m.apodo || m.rol || "Un dispositivo") + " lleva " + m.cuando.replace("hace ", "") + " sin sincronizar.");
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
    equipo: equipo, recibir: recibir, latir: latir,
    umbrales: umbrales, ponerUmbrales: ponerUmbrales,
    estadoPorSilencio: estadoPorSilencio, haceCuanto: haceCuanto,
    etiquetas: ETIQUETAS, miEstado: miEstado, marcarConectado: marcarConectado,
    pedirPermisoAviso: pedirPermisoAviso, pedirPersistencia: pedirPersistencia,
    arrancar: arrancar, TIPO_LATIDO: TIPO_LATIDO,
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
