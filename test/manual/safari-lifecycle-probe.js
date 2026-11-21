/* P0 Safari lifecycle probe. Diagnostic only; not loaded by production shell.
 * Run via Safari Web Inspector in an already open tab. No storage/network writes.
 * Never records URL, tokens, license, PIN, app state or business data.
 */
(function installSafariLifecycleProbe() {
  'use strict';
  if (window.__f123SafariProbe) return;
  const max = 80;
  const events = [];
  const record = (type, extra) => {
    const entry = { t: Math.round(performance.now()), type, ...extra };
    events.push(entry);
    if (events.length > max) events.shift();
    try { console.info('[f123-safari-probe]', JSON.stringify(entry)); } catch (_) {}
  };
  const nav = performance.getEntriesByType('navigation')[0];
  record('probe-installed', {
    navigation: nav ? nav.type : 'unknown',
    swControlled: !!(navigator.serviceWorker && navigator.serviceWorker.controller),
    visibility: document.visibilityState
  });
  window.addEventListener('pageshow', e => record('pageshow', { persisted: !!e.persisted }));
  window.addEventListener('pagehide', e => record('pagehide', { persisted: !!e.persisted }));
  // Never log arbitrary ErrorEvent.message: it can contain URLs, PINs or customer data.
  window.addEventListener('error', e => {
    const name = e && e.error && e.error.name;
    const category = typeof name === 'string' && /^(?:TypeError|ReferenceError|RangeError|SyntaxError|SecurityError|QuotaExceededError|AbortError|UnknownError|InvalidStateError)$/.test(name)
      ? name : 'other';
    record('error', { category });
  });
  window.addEventListener('unhandledrejection', () => record('unhandledrejection'));
  document.addEventListener('visibilitychange', () => record('visibility', { state: document.visibilityState }));
  if (navigator.serviceWorker) {
    navigator.serviceWorker.addEventListener('controllerchange', () => record('controllerchange'));
    navigator.serviceWorker.addEventListener('message', () => record('sw-message'));
  }
  window.__f123SafariProbe = Object.freeze({
    snapshot: () => events.map(e => ({ ...e })),
    note: () => record('manual-marker')
  });
})();
