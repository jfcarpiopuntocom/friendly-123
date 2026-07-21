// api-key-fetch.js — adjunta X-Instance-Key a toda petición a /api/* si hay
// una key guardada localmente tras la activación (ver server.js y
// auth-ui.js, JFC 2026-07-21: antes NINGUNA ruta /api/* verificaba nada —
// los PINs de crypto-store.js son 100% client-side, no protegían el
// backend real. Ahora el servidor exige esta key en cada request).
//
// Debe cargar ANTES de cualquier otro script que llame a fetch() o que a su
// vez parchee window.fetch (ej. OCSync en avanzado-extra.js) — así, cuando
// OCSync capture "fetchOriginal", captura ESTA versión ya envuelta, y el
// encadenamiento de parches queda correcto sin importar cuál corre primero
// en tiempo de ejecución real (los parches solo importan en orden de carga
// de <script>, no de cuándo se llama fetch después).
//
// Si no hay key guardada (demo estática con mock-backend.js, o servidor
// real todavía sin activar), este wrapper es un no-op transparente: el
// fetch sale exactamente igual que sin este archivo. Nunca rompe nada por
// ausencia de key — server.js es quien decide si eso es un problema (fail-
// closed ahí, no aquí).
(function () {
  const fetchOriginal = window.fetch.bind(window);

  function leerKey() {
    try {
      const owned = JSON.parse(localStorage.getItem("f123_owned") || "null") || {};
      return owned.instanceKey || "";
    } catch (_) {
      return "";
    }
  }

  function urlDe(input) {
    return typeof input === "string" ? input : (input && input.url) || "";
  }

  window.fetch = function (input, init) {
    const url = urlDe(input);
    const esApi = url.indexOf("/api/") === 0 || /^https?:\/\/[^/]+\/api\//.test(url);
    const key = esApi ? leerKey() : "";
    if (!key) return fetchOriginal(input, init);
    // Headers() acepta plain object, Headers existente, o array de pares —
    // cubre cualquier forma en que el resto del código arme sus headers.
    const h = new Headers((init && init.headers) || {});
    h.set("X-Instance-Key", key);
    return fetchOriginal(input, Object.assign({}, init, { headers: h }));
  };
})();
