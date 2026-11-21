'use strict';
/* P0: execute the actual production Service Worker fetch event, not string checks.
 * Cloudflare Static Assets redirects /dashboard.html -> /dashboard. A cached
 * redirected Response cannot satisfy a navigation request in Chromium.
 * The two RED cases model the real CacheStorage/network response shapes.
 */
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'docs', 'sw.js'), 'utf8');
const origin = 'https://friendly-123.jfcarpio.workers.dev/';

function redirected(html) {
  const response = new Response(html, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  Object.defineProperty(response, 'redirected', { configurable: true, value: true });
  Object.defineProperty(response, 'url', { configurable: true, value: origin + 'dashboard' });
  return response;
}

function setup({ cached = null, network = null, fetchError = false } = {}) {
  const handlers = new Map();
  let networkRequests = 0;
  const cache = {
    match: async () => cached,
    put: async () => undefined,
  };
  const sandbox = {
    URL, Request, Response, TextEncoder, Promise,
    console: { log() {}, warn() {}, error() {} },
    self: {
      location: { origin: new URL(origin).origin, href: origin + 'sw.js' },
      registration: { scope: origin },
      addEventListener: (name, handler) => handlers.set(name, handler),
      clients: { claim() {} },
    },
    caches: {
      open: async () => cache,
      match: async () => cached,
      keys: async () => [],
    },
    fetch: async () => {
      networkRequests += 1;
      if (fetchError) throw new Error('simulated connection loss');
      return network || new Response('network', { status: 200 });
    },
  };
  vm.runInNewContext(source, sandbox, { filename: 'docs/sw.js', timeout: 2000 });
  assert.equal(typeof handlers.get('fetch'), 'function', 'production fetch handler not found');
  async function request(resource = 'dashboard.html', mode = 'navigate') {
    const req = new Request(origin + resource);
    Object.defineProperty(req, 'mode', { value: mode, configurable: true });
    let responsePromise;
    handlers.get('fetch')({
      request: req,
      respondWith(promise) {
        assert.equal(responsePromise, undefined, 'respondWith called twice');
        responsePromise = Promise.resolve(promise);
      },
    });
    return responsePromise ? responsePromise : null;
  }
  return { request, networkCount: () => networkRequests };
}

test('P0 RED: navigation from cache uses a clean 200 without redirect history', async () => {
  const html = '<html><head></head><body>Dashboard</body></html>';
  const h = setup({ cached: redirected(html) });
  const r = await h.request();
  assert.equal(r.status, 200);
  assert.equal(r.redirected, false, 'redirected CacheStorage Response cannot satisfy navigation');
  assert.equal(r.headers.get('content-type'), 'text/html; charset=utf-8');
  assert.equal(await r.text(), html);
  assert.equal(h.networkCount(), 0, 'cache hit must preserve offline availability');
});

test('P0 RED: network-first fallback also cleans redirected navigation responses', async () => {
  const html = '<html><body>Redirect from static assets</body></html>';
  const h = setup({ network: redirected(html) });
  const r = await h.request();
  assert.equal(r.status, 200);
  assert.equal(r.redirected, false, 'redirected network Response cannot be returned by SW navigate');
  assert.equal(await r.text(), html);
});

test('ordinary cached non-redirected response stays unmodified', async () => {
  const cached = new Response('<html>dashboard</html>', { headers: { 'Content-Type': 'text/html' } });
  const h = setup({ cached });
  assert.strictEqual(await h.request(), cached);
});

test('non-navigation cached response keeps original semantics', async () => {
  const cached = redirected('non-navigation asset');
  const h = setup({ cached });
  assert.strictEqual(await h.request('dashboard.html', 'cors'), cached);
});

test('business /api and version.json bypass Service Worker interception', async () => {
  const h = setup();
  assert.equal(await h.request('api/ventas'), null);
  assert.equal(await h.request('version.json'), null);
  assert.equal(h.networkCount(), 0);
});

test('offline uncached shell remains a 503 Response, never undefined', async () => {
  const h = setup({ fetchError: true });
  const r = await h.request();
  assert.equal(r.status, 503);
  assert.match(await r.text(), /sin copia en cache/i);
});
