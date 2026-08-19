// red-segura.js — que un wifi caido no llene el panel de fallas ni tumbe la app
// ============================================================================
// JFC, 2026-08-18: "verifica que ya hemos lidiado en serio y a fondo y
// redundantemente con lo que sale en esa lista de reportes".
//
// EL HALLAZGO: hay 33 `await fetch(...)` sin try/catch alrededor. `fetch` NO
// rechaza por un 404 ni por un 500 —eso llega como respuesta y el codigo ya lo
// mira con res.ok— pero SI rechaza cuando no hay red: wifi caido, datos
// agotados, tunel del bus, servidor dormido. Y una promesa rechazada que nadie
// atrapa dispara `unhandledrejection`, que es justo lo que salud-app.js reporta.
//
// O sea: cada vez que a alguien se le cae el internet, su telefono manda una
// falla al panel. Esa lista se llena de "Failed to fetch" que no son bugs de la
// app — son el mundo real — y entierran los reportes que si importan.
//
// LA DECISION: en vez de parchar 33 sitios (diff enorme, y el 34 nace sin
// guard manana), se envuelve fetch UNA vez. Cuando la red falla, en lugar de
// rechazar se devuelve una Response de verdad con ok:false y un JSON que
// explica que paso. Todo el codigo que ya hace `if (!res.ok)` o
// `const j = await res.json()` sigue funcionando sin tocarse ni una linea.
//
// LO QUE NO HACE, a proposito:
//   - No se traga errores de la APP. fetch solo rechaza por red, aborto o CORS;
//     un TypeError de un bug tuyo no pasa por aqui.
//   - No oculta el fallo: lo cuenta en AMG.Red.fallos() y lo deja en consola.
//     Lo que evita es que se reporte como si fuera un defecto del programa.
//   - No reintenta. Reintentar solo esta bien donde el llamador sabe que la
//     operacion es idempotente, y aqui no lo sabemos.
//
// ORDEN DE CARGA: va DESPUES de mock-backend.js, que instala su propio
// window.fetch para servir /api. Envuelve lo que haya en ese momento, sea el
// mock o el nativo.
// ============================================================================
(function (global) {
  "use strict";

  if (global.__OC_RED_SEGURA__) return;   // mismo criterio que aislamiento.js
  global.__OC_RED_SEGURA__ = true;

  var anterior = global.fetch;
  if (typeof anterior !== "function") return;
  anterior = anterior.bind(global);

  var fallos = 0, ultimo = null, _ultimoLog = 0;

  /* Una Response real, no un objeto que se le parece: asi funcionan .json(),
     .text(), .ok y .status sin que nadie tenga que saber que paso por aqui.
     503 y no 0 porque el constructor de Response no acepta 0. */
  function respuestaSinRed(url, err) {
    var cuerpo = JSON.stringify({
      error: "No connection. Could not reach the server.",
      offline: true,
      detalle: String((err && err.message) || err || "").slice(0, 200)
    });
    try {
      return new Response(cuerpo, {
        status: 503,
        statusText: "No connection",
        headers: { "Content-Type": "application/json" }
      });
    } catch (_) {
      /* Navegador sin constructor de Response: se devuelve lo minimo que el
         codigo de la app usa, en vez de dejar que el fallo suba. */
      return {
        ok: false, status: 503, statusText: "No connection", offline: true,
        json: function () { return Promise.resolve(JSON.parse(cuerpo)); },
        text: function () { return Promise.resolve(cuerpo); }
      };
    }
  }

  global.fetch = function (entrada, opciones) {
    var url = "";
    try { url = String((entrada && entrada.url) || entrada || ""); } catch (_) {}
    return anterior(entrada, opciones).catch(function (err) {
      /* Un aborto DELIBERADO no es una falla de red: si alguien cancelo la
         peticion a proposito, tiene que enterarse. Se deja pasar. */
      if (err && (err.name === "AbortError" || err.name === "TimeoutError")) throw err;
      fallos++;
      ultimo = { url: url.slice(0, 120), cuando: new Date().toISOString(), msg: String((err && err.message) || err).slice(0, 120) };
      /* M4: solo la primera falla y despues una cada 20 seg. En un dispositivo
         sin senial habia 200 warnings por minuto ahogando la consola. El
         contador (AMG.Red.fallos) sigue subiendo con todos. */
      if (fallos === 1 || (Date.now() - _ultimoLog) > 20000) {
        try { console.warn("[red] " + ultimo.url + " — " + fallos + " fallos acumulados"); } catch (_) {}
        _ultimoLog = Date.now();
      }
      return respuestaSinRed(url, err);
    });
  };

  global.AMG = global.AMG || {};
  global.AMG.Red = {
    VERSION: "1.0.0",
    fallos: function () { return fallos; },
    ultimoFallo: function () { return ultimo; }
  };
})(typeof window !== "undefined" ? window : this);
