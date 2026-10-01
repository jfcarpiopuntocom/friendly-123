/* canarios.js — BACKEND DE LOS CANARIOS: Sentry + PostHog (JFC 2026-10-01).
   "Mas canarios ... DESDE /next/ ... ponle Sentry y PostHog ... el canario nos avisa y
   reparamos". Corre en /next/ y en la app de los clientes (estable/previo).

   QUE SALE (lista blanca, armada aqui campo por campo; nunca un objeto de la app):
   - Sentry: errores de JS y fallos silenciosos (codigo fijo como "foto-no-abre"),
     con shell, canal, seccion y archivo:linea. Mensajes LIMPIOS: sin texto entre
     comillas, sin numeros, sin correos, sin licencias.
   - PostHog: flujos (app abierta, cambio de seccion) y checksums (dinero cuadra: si/no).
   QUE NO SALE JAMAS: productos, ventas, clientes, montos, nombres, PIN, licencias,
   instanceId. La identidad es un id ANONIMO al azar de este aparato (no se puede
   ligar a la licencia). Decision de JFC 2026-10-01: flujos y checksums no son datos
   del negocio; la PRIME DIRECTIVE sigue intacta (ver CLAUDE.md).

   AVISA, NO FRENA: nada de esto toca promover.yml ni el Sonar que decide la promocion.
   Nunca puede romper la app: todo va en try/catch, fire-and-forget, con tope por sesion.
   En file:// o localhost NO envia (pruebas): solo deja el payload en OCCanarios.ultimos(). */
(function (g) {
  "use strict";
  if (g.OCCanarios) return;
  var SENTRY = { host: "https://o4512176001908736.ingest.us.sentry.io", proyecto: "4512179295682560", clave: "f4871f605cf4563e41d9827edef46500" };
  var POSTHOG = { host: "https://us.i.posthog.com", clave: "phc_rtSScCZkHoR6iqezcfUijdsPniXQALYVGFMbD5E2xFvQ" };
  var TOPE_SESION = 60, TOPE_POR_CLAVE = 3;
  var enviados = 0, porClave = {}, ultimos = [], shell = "";

  function canal() { var m = /\/(next|previo)\//.exec(g.location ? g.location.pathname : ""); return m ? m[1] : "estable"; }
  function puedeEnviar() {
    try { var l = g.location; return /^https:$/.test(l.protocol) && !/^(localhost|127\.)/.test(l.hostname); } catch (_) { return false; }
  }
  function uuid() {
    try { return g.crypto.randomUUID().replace(/-/g, ""); } catch (_) { return (Date.now().toString(16) + Math.random().toString(16).slice(2)).slice(0, 32); }
  }
  function anonimo() {
    try { var k = "f123_canario_anon", v = g.localStorage.getItem(k); if (!v) { v = uuid(); g.localStorage.setItem(k, v); } return v; } catch (_) { return "sin-storage"; }
  }
  /* Limpia cualquier texto antes de que salga: lo que pueda ser dato del negocio se tapa. */
  function limpiar(x, max) {
    return String(x == null ? "" : x)
      .replace(/"[^"]*"|'[^']*'|«[^»]*»|`[^`]*`/g, "\"…\"")
      .replace(/[A-Z0-9]{2,6}-[A-Z0-9-]{4,}/g, "[codigo]")
      .replace(/[^\s@]+@[^\s@]+/g, "[correo]")
      .replace(/data:[^\s)]+/g, "[data]")
      .replace(/\d+([.,]\d+)?/g, "#")
      .slice(0, max || 200);
  }
  function archivo(u) { var m = /([\w.-]+\.(?:js|html))/.exec(String(u || "")); return m ? m[1] : ""; }
  function nodo() {
    try { var b = g.document.querySelector("nav button.activo"); return (b && b.dataset && b.dataset.vista) || "arranque"; } catch (_) { return "arranque"; }
  }
  function cupo(clave) {
    if (enviados >= TOPE_SESION) return false;
    porClave[clave] = (porClave[clave] || 0) + 1;
    if (porClave[clave] > TOPE_POR_CLAVE) return false;
    enviados++; return true;
  }
  function guardar(destino, cuerpo) { ultimos.push({ destino: destino, cuerpo: cuerpo }); if (ultimos.length > 30) ultimos.shift(); }
  function post(url, body) {
    if (!puedeEnviar()) return;
    try { g.fetch(url, { method: "POST", body: body, keepalive: true, headers: { "Content-Type": "text/plain;charset=UTF-8" } }).catch(function () {}); } catch (_) {}
  }

  function aSentry(nivel, mensaje, etiquetas, extra) {
    var ev = {
      event_id: uuid(), timestamp: new Date().toISOString(), platform: "javascript", level: nivel,
      logger: "canarios", release: shell || "desconocido", environment: canal(),
      message: { formatted: mensaje },
      tags: Object.assign({ canal: canal(), shell: shell || "desconocido" }, etiquetas || {}),
      extra: extra || {}, user: { id: anonimo() },
    };
    guardar("sentry", ev);
    var cab = JSON.stringify({ event_id: ev.event_id, sent_at: ev.timestamp });
    post(SENTRY.host + "/api/" + SENTRY.proyecto + "/envelope/?sentry_version=7&sentry_key=" + SENTRY.clave,
      cab + "\n" + JSON.stringify({ type: "event" }) + "\n" + JSON.stringify(ev));
  }
  function aPostHog(evento, props) {
    var cuerpo = { api_key: POSTHOG.clave, event: evento, distinct_id: anonimo(), timestamp: new Date().toISOString(),
      properties: Object.assign({ canal: canal(), shell: shell || "desconocido", $process_person_profile: false }, props || {}) };
    guardar("posthog", cuerpo);
    post(POSTHOG.host + "/i/v0/e/", JSON.stringify(cuerpo));
  }

  /* API publica. Solo acepta strings cortos de vocabulario fijo; lo demas se limpia. */
  function fallo(seccion, codigo) {
    try {
      // Codigos y secciones son vocabulario fijo: minusculas y guiones, nada mas.
      var fijo = function (x, d) { x = String(x || ""); return /^[a-z][a-z0-9-]{0,39}$/.test(x) ? x : d; };
      var s = fijo(seccion || nodo(), "otra"), c = fijo(codigo, "fallo");
      if (!cupo("f:" + c)) return;
      aSentry("warning", "Fallo silencioso: " + c, { seccion: s, codigo: c, tipo: "fallo" });
      aPostHog("canario_fallo", { seccion: s, codigo: c });
    } catch (_) {}
  }
  function error(mensaje, url, linea, pila) {
    try {
      var m = limpiar(mensaje, 200), a = archivo(url);
      if (!cupo("e:" + m + a + linea)) return;
      var pilaLimpia = String(pila || "").split("\n").slice(0, 12).map(function (l) {
        var f = /([\w.-]+\.(?:js|html)):(\d+)(?::(\d+))?/.exec(l); return f ? f[1] + ":" + f[2] : "";
      }).filter(Boolean).join("\n");
      aSentry("error", m || "Error", { seccion: nodo(), archivo: a, tipo: "error" }, { linea: Number(linea) || 0, pila: pilaLimpia });
      aPostHog("canario_error", { seccion: nodo(), archivo: a });
    } catch (_) {}
  }
  var FLUJOS = ["app_abierta", "seccion", "checksum_dinero"];
  function flujo(nombre, props) {
    try {
      if (FLUJOS.indexOf(nombre) < 0) return;
      var p = {};
      Object.keys(props || {}).slice(0, 6).forEach(function (k) {
        var v = props[k]; p[limpiar(k, 30)] = typeof v === "boolean" ? v : limpiar(v, 30);
      });
      if (!cupo("p:" + nombre + JSON.stringify(p))) return;
      aPostHog(nombre, p);
    } catch (_) {}
  }

  try {
    g.addEventListener("error", function (e) {
      if (e && e.target && e.target !== g && e.target.tagName) return; // recurso (img/script): lo cubren sus propios canarios
      error(e && e.message, e && e.filename, e && e.lineno, e && e.error && e.error.stack);
    }, true);
    g.addEventListener("unhandledrejection", function (e) {
      var r = e && e.reason; error((r && r.message) || r || "Promesa rechazada", "", 0, r && r.stack);
    });
    g.document && g.document.addEventListener("click", function (e) {
      var b = e.target && e.target.closest && e.target.closest("nav button[data-vista]");
      if (b) flujo("seccion", { seccion: b.dataset.vista });
    }, true);
  } catch (_) {}
  try {
    g.fetch("version.json", { cache: "no-store" }).then(function (r) { return r.ok ? r.json() : null; })
      .then(function (v) { if (v && v.shell) shell = String(v.shell); flujo("app_abierta", {}); }).catch(function () { flujo("app_abierta", {}); });
  } catch (_) {}

  g.OCCanarios = { fallo: fallo, error: error, flujo: flujo, limpiar: limpiar, ultimos: function () { return ultimos.slice(); } };
})(typeof window !== "undefined" ? window : this);
