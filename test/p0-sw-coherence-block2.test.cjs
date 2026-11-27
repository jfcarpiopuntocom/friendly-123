'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.join(__dirname, '..');
const swSource = fs.readFileSync(path.join(root, 'docs/sw.js'), 'utf8');
const app03Source = fs.readFileSync(path.join(root, 'src/app/app-inline-03.js'), 'utf8');
const dashboardHtml = fs.readFileSync(path.join(root, 'docs/dashboard.html'), 'utf8');
const versionJson = JSON.parse(fs.readFileSync(path.join(root, 'docs/version.json'), 'utf8'));
const manifestJson = JSON.parse(fs.readFileSync(path.join(root, 'docs/version-manifest.json'), 'utf8'));

const affinityBlock = swSource.slice(
  swSource.indexOf('function cacheDeAfinidad()'),
  swSource.indexOf('function clienteDeMiCanal(')
);
const fetchBlock = swSource.slice(
  swSource.indexOf('self.addEventListener("fetch"'),
  swSource.indexOf('/* A4')
);
assert.ok(affinityBlock.includes('verificarEquivalenciaGeneraciones'), 'real production affinity helpers found');
assert.ok(fetchBlock.includes('verificarEquivalenciaGeneraciones'), 'real production fetch handler found');
assert.ok(!affinityBlock.includes('afinidadesDocumento'), 'in-memory stale Map must not exist');

function sha256Tag(text) {
  return 'sha256-' + crypto.createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex');
}

function makeManifest(shell, files) {
  return new Response(JSON.stringify({ shell, files }), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  });
}

function makeSwHarness({
  cacheLocal = 'f123-shell-v933-golden471',
  shellName = 'f123-shell-v933',
  shellList = ['./index.html', './dashboard.html', './app-inline-03.min.js', './dashboard-main.min.js', './finance-report-worker.js', './pago-intento-idb.mjs'],
  stores = {},
  pins = {},
  networkResponder = null
} = {}) {
  const buckets = new Map();
  for (const [name, entries] of Object.entries(stores)) {
    buckets.set(name, new Map(Object.entries(entries)));
  }
  const pinBucketName = 'f123-shell-client-pins';
  const pinStore = new Map();
  for (const [id, val] of Object.entries(pins)) {
    pinStore.set('https://fixture.test/app/__f123_client_shell__/' + encodeURIComponent(id), new Response(val));
  }
  buckets.set(pinBucketName, pinStore);

  let networkCalls = 0;
  let cacheWrites = 0;
  const cacheWritesByName = {};

  function resolveKey(req) {
    const raw = typeof req === 'string' ? req : req.url;
    const u = new URL(raw, 'https://fixture.test/app/');
    return u.href;
  }

  function matchInMap(map, req, opts = {}) {
    if (!map) return null;
    const href = resolveKey(req);
    const u = new URL(href);
    const rel = './' + u.pathname.slice('/app/'.length);
    for (const [k, v] of map.entries()) {
      if (k === href || k === rel) return v ? v.clone() : null;
      if (opts && opts.ignoreSearch) {
        const ku = new URL(k, 'https://fixture.test/app/');
        if (ku.origin === u.origin && ku.pathname === u.pathname) return v ? v.clone() : null;
      }
    }
    return null;
  }

  const caches = {
    async open(name) {
      if (!buckets.has(name)) buckets.set(name, new Map());
      const m = buckets.get(name);
      return {
        async match(req, opts) { return matchInMap(m, req, opts); },
        async put(req, res) {
          const key = resolveKey(req);
          if (name !== pinBucketName) {
            cacheWrites++;
            cacheWritesByName[name] = (cacheWritesByName[name] || 0) + 1;
          }
          m.set(key, res.clone());
        },
        async keys() { return [...m.keys()].map((url) => ({ url })); },
        async delete(req) { return m.delete(resolveKey(req)); }
      };
    },
    async match(req, opts) {
      if (opts && opts.cacheName) return matchInMap(buckets.get(opts.cacheName), req, opts);
      for (const [name, m] of buckets.entries()) {
        if (name === pinBucketName) continue;
        const hit = matchInMap(m, req, opts);
        if (hit) return hit;
      }
      return null;
    },
    async keys() { return [...buckets.keys()]; }
  };

  let fetchHandler = null;
  const self = {
    location: { origin: 'https://fixture.test', href: 'https://fixture.test/app/sw.js' },
    registration: { scope: 'https://fixture.test/app/' },
    addEventListener(type, fn) { if (type === 'fetch') fetchHandler = fn; }
  };
  const fetchFn = async (req, init) => {
    networkCalls++;
    if (networkResponder) return networkResponder(req, init);
    return new Response('/* NETWORK_LATEST */', { status: 200, headers: { 'content-type': 'application/javascript' } });
  };
  const env = {
    self,
    URL,
    Response,
    AbortController,
    HOSTS_PERMITIDOS: ['https://fixture.test'],
    SHELL: shellList,
    CACHE: shellName,
    CACHE_LOCAL: cacheLocal,
    CANAL: '',
    caches,
    abrirCacheLocal: () => caches.open(cacheLocal),
    esDeMiCanal: (n) => n.startsWith('f123-shell-') && !/-(next|previo)$/.test(n),
    fetch: fetchFn,
    crypto: globalThis.crypto,
    setTimeout,
    clearTimeout,
    console: { warn() {} }
  };
  const api = new Function(
    ...Object.keys(env),
    affinityBlock + '\n' + fetchBlock + '\nreturn { leerShellDeDocumento, fijarShellDeDocumento, firmaSeguridad, verificarEquivalenciaGeneraciones };'
  )(...Object.values(env));

  async function dispatch({
    relPath = 'app-inline-03.min.js',
    search = '',
    mode = 'cors',
    destination = 'script',
    clientId = '',
    resultingClientId = ''
  }) {
    let responsePromise;
    fetchHandler({
      request: {
        url: 'https://fixture.test/app/' + relPath + search,
        method: 'GET',
        mode,
        destination
      },
      clientId,
      resultingClientId,
      respondWith(p) { responsePromise = p; }
    });
    const res = await responsePromise;
    return {
      status: res.status,
      body: await res.text(),
      contentType: res.headers.get('content-type') || '',
      networkCalls,
      cacheWrites,
      cacheWritesByName: { ...cacheWritesByName }
    };
  }

  return {
    dispatch,
    api,
    pinStore,
    stats: () => ({ networkCalls, cacheWrites, cacheWritesByName: { ...cacheWritesByName } })
  };
}

// Action 26: cross-worker document affinity reads never use stale in-memory Map
test('Action 26: document affinity reads directly from CacheStorage without stale RAM memoization', async () => {
  const buckets = new Map();
  const caches = {
    async open(name) {
      if (!buckets.has(name)) buckets.set(name, new Map());
      const m = buckets.get(name);
      return {
        async match(k) { return m.get(k) ? m.get(k).clone() : null; },
        async put(k, v) { m.set(k, v.clone()); }
      };
    }
  };
  const makeWorker = () => new Function(
    'caches', 'Response', 'URL', 'self', 'CANAL', 'esDeMiCanal', 'crypto',
    affinityBlock + '\nreturn { leerShellDeDocumento, fijarShellDeDocumento };'
  )(caches, Response, URL, { registration: { scope: 'https://fixture.test/app/' } }, '', (n) => n.startsWith('f123-shell-') && !n.endsWith('-next'), globalThis.crypto);

  const workerA = makeWorker();
  const workerB = makeWorker();
  assert.equal(await workerB.leerShellDeDocumento('tab-1'), null);
  await workerA.fijarShellDeDocumento('tab-1', 'f123-shell-v932-golden470');
  assert.equal(await workerB.leerShellDeDocumento('tab-1'), 'f123-shell-v932-golden470');
  await workerA.fijarShellDeDocumento('tab-1', 'f123-shell-v933-golden471');
  assert.equal(await workerB.leerShellDeDocumento('tab-1'), 'f123-shell-v933-golden471');
  await workerA.fijarShellDeDocumento('tab-other', 'f123-shell-v933-golden471-next');
  assert.equal(await workerB.leerShellDeDocumento('tab-other'), '?');
});

// Action 25 + 27: missing clientId & uncertain generation fail-closed with 0 network, 0 cache writes
test('Action 25 & 27: missing clientId and uncertain generation fail-closed with 0 writes and 0 network', async () => {
  const bodyNew = '/* NEW_933 */';
  const bodyOld = '/* OLD_932 */';
  const h = makeSwHarness({
    stores: {
      'f123-shell-v933-golden471': {
        './app-inline-03.min.js': new Response(bodyNew, { headers: { 'content-type': 'application/javascript' } }),
        './version-manifest.json': makeManifest('f123-shell-v933', { './app-inline-03.min.js': sha256Tag(bodyNew) })
      },
      'f123-shell-v932-golden470': {
        './app-inline-03.min.js': new Response(bodyOld, { headers: { 'content-type': 'application/javascript' } }),
        './version-manifest.json': makeManifest('f123-shell-v932', { './app-inline-03.min.js': sha256Tag(bodyOld) })
      }
    },
    pins: { 'ambiguous-tab': '?' }
  });
  const rNoId = await h.dispatch({ relPath: 'app-inline-03.min.js', clientId: '' });
  assert.equal(rNoId.status, 503);
  assert.equal(rNoId.networkCalls, 0);
  assert.equal(rNoId.cacheWrites, 0);

  const rNoIdQuery = await h.dispatch({ relPath: 'app-inline-03.min.js', search: '?v=932', clientId: '' });
  assert.equal(rNoIdQuery.status, 503);
  assert.equal(rNoIdQuery.networkCalls, 0);
  assert.equal(rNoIdQuery.cacheWrites, 0);

  const rAmbig = await h.dispatch({ relPath: 'app-inline-03.min.js', clientId: 'ambiguous-tab' });
  assert.equal(rAmbig.status, 503);
  assert.equal(rAmbig.networkCalls, 0);
  assert.equal(rAmbig.cacheWrites, 0);
});

// Action 28: security headers vs volatile headers
test('Action 28: volatile Date/Age/ETag/Cache-Control pass; MIME/CSP/nosniff/CORP mismatch fail-closed', async () => {
  const body = '/* SAME_BYTES */';
  const hash = sha256Tag(body);

  // Volatile headers differ -> 200 (0 network, 0 writes)
  const hVolatile = makeSwHarness({
    stores: {
      'f123-shell-v933-golden471': {
        './app-inline-03.min.js': new Response(body, {
          headers: {
            'content-type': 'application/javascript; charset=utf-8',
            'x-content-type-options': 'nosniff',
            'date': 'Fri, 27 Nov 2026 10:00:00 GMT',
            'age': '5',
            'etag': '"etag-new"',
            'cache-control': 'public, max-age=600'
          }
        }),
        './version-manifest.json': makeManifest('f123-shell-v933', { './app-inline-03.min.js': hash })
      },
      'f123-shell-v932-golden470': {
        './app-inline-03.min.js': new Response(body, {
          headers: {
            'content-type': 'application/javascript; charset=utf-8',
            'x-content-type-options': 'nosniff',
            'date': 'Thu, 26 Nov 2026 01:00:00 GMT',
            'age': '3600',
            'etag': '"etag-old"',
            'cache-control': 'no-cache'
          }
        }),
        './version-manifest.json': makeManifest('f123-shell-v932', { './app-inline-03.min.js': hash })
      }
    }
  });
  const ok = await hVolatile.dispatch({ relPath: 'app-inline-03.min.js', clientId: '' });
  assert.equal(ok.status, 200);
  assert.equal(ok.body, body);
  assert.equal(ok.networkCalls, 0);
  assert.equal(ok.cacheWrites, 0);

  // Security headers differ -> 503 fail-closed
  for (const [label, hA, hB] of [
    ['mime', { 'content-type': 'application/javascript' }, { 'content-type': 'text/plain' }],
    ['csp', { 'content-type': 'application/javascript', 'content-security-policy': "default-src 'self'" }, { 'content-type': 'application/javascript', 'content-security-policy': 'default-src *' }],
    ['nosniff', { 'content-type': 'application/javascript', 'x-content-type-options': 'nosniff' }, { 'content-type': 'application/javascript' }],
    ['corp', { 'content-type': 'application/javascript', 'cross-origin-resource-policy': 'same-origin' }, { 'content-type': 'application/javascript', 'cross-origin-resource-policy': 'cross-origin' }]
  ]) {
    const hSec = makeSwHarness({
      stores: {
        'f123-shell-v933-golden471': {
          './app-inline-03.min.js': new Response(body, { headers: hA }),
          './version-manifest.json': makeManifest('f123-shell-v933', { './app-inline-03.min.js': hash })
        },
        'f123-shell-v932-golden470': {
          './app-inline-03.min.js': new Response(body, { headers: hB }),
          './version-manifest.json': makeManifest('f123-shell-v932', { './app-inline-03.min.js': hash })
        }
      }
    });
    const res = await hSec.dispatch({ relPath: 'app-inline-03.min.js', clientId: '' });
    assert.equal(res.status, 503, label + ' must fail closed');
    assert.equal(res.networkCalls, 0, label + ' must not hit network');
    assert.equal(res.cacheWrites, 0, label + ' must not write cache');
  }
});

// Action 29: require manifest authenticity & compatibility in addition to byte equality
test('Action 29: equal bytes without authentic compatible manifest in every generation fail-closed', async () => {
  const body = '/* SAME_BYTES */';
  const hash = sha256Tag(body);
  const badHash = sha256Tag('/* OTHER */');

  // Missing manifest in old cache
  const hMissingMan = makeSwHarness({
    stores: {
      'f123-shell-v933-golden471': {
        './app-inline-03.min.js': new Response(body, { headers: { 'content-type': 'application/javascript' } }),
        './version-manifest.json': makeManifest('f123-shell-v933', { './app-inline-03.min.js': hash })
      },
      'f123-shell-v932-golden470': {
        './app-inline-03.min.js': new Response(body, { headers: { 'content-type': 'application/javascript' } })
      }
    }
  });
  assert.equal((await hMissingMan.dispatch({ relPath: 'app-inline-03.min.js' })).status, 503);

  // Spoofed/mismatched shell in old cache manifest
  const hWrongShell = makeSwHarness({
    stores: {
      'f123-shell-v933-golden471': {
        './app-inline-03.min.js': new Response(body, { headers: { 'content-type': 'application/javascript' } }),
        './version-manifest.json': makeManifest('f123-shell-v933', { './app-inline-03.min.js': hash })
      },
      'f123-shell-v932-golden470': {
        './app-inline-03.min.js': new Response(body, { headers: { 'content-type': 'application/javascript' } }),
        './version-manifest.json': makeManifest('f123-shell-v933', { './app-inline-03.min.js': hash })
      }
    }
  });
  assert.equal((await hWrongShell.dispatch({ relPath: 'app-inline-03.min.js' })).status, 503);

  // Hash mismatch in manifest
  const hWrongHash = makeSwHarness({
    stores: {
      'f123-shell-v933-golden471': {
        './app-inline-03.min.js': new Response(body, { headers: { 'content-type': 'application/javascript' } }),
        './version-manifest.json': makeManifest('f123-shell-v933', { './app-inline-03.min.js': hash })
      },
      'f123-shell-v932-golden470': {
        './app-inline-03.min.js': new Response(body, { headers: { 'content-type': 'application/javascript' } }),
        './version-manifest.json': makeManifest('f123-shell-v932', { './app-inline-03.min.js': badHash })
      }
    }
  });
  assert.equal((await hWrongHash.dispatch({ relPath: 'app-inline-03.min.js' })).status, 503);
});

// Action 30: simultaneous 3 generations, missing cache, and executable resources (worker, module, preload)
test('Action 30: 3 simultaneous generations, missing cache, worker/module/preload resources', async () => {
  const workerBody = 'self.onmessage = () => {};';
  const modBody = 'export const ok = true;';
  const preloadBody = 'window.__ok = 1;';
  const files = {
    './finance-report-worker.js': sha256Tag(workerBody),
    './pago-intento-idb.mjs': sha256Tag(modBody),
    './app-inline-03.min.js': sha256Tag(preloadBody)
  };
  const makeGen = (shell, includeWorker = true) => ({
    ...(includeWorker ? { './finance-report-worker.js': new Response(workerBody, { headers: { 'content-type': 'application/javascript' } }) } : {}),
    './pago-intento-idb.mjs': new Response(modBody, { headers: { 'content-type': 'application/javascript' } }),
    './app-inline-03.min.js': new Response(preloadBody, { headers: { 'content-type': 'application/javascript' } }),
    './version-manifest.json': makeManifest(shell, files)
  });

  // 3 generations all present & authentic -> worker, ES module, preload all serve 200 (0 network, 0 writes)
  const h3 = makeSwHarness({
    stores: {
      'f123-shell-v933-golden471': makeGen('f123-shell-v933', true),
      'f123-shell-v932-golden470': makeGen('f123-shell-v932', true),
      'f123-shell-v931-golden469': makeGen('f123-shell-v931', true)
    }
  });
  for (const [relPath, destination, search] of [
    ['finance-report-worker.js', 'worker', ''],
    ['pago-intento-idb.mjs', 'script', ''],
    ['app-inline-03.min.js', 'script', '?preload=1']
  ]) {
    const r = await h3.dispatch({ relPath, destination, search, clientId: '' });
    assert.equal(r.status, 200, relPath + ' across 3 equivalent generations');
    assert.equal(r.networkCalls, 0);
    assert.equal(r.cacheWrites, 0);
  }

  // Missing worker in 1 of 3 generations -> fail-closed 503
  const hMissing = makeSwHarness({
    stores: {
      'f123-shell-v933-golden471': makeGen('f123-shell-v933', true),
      'f123-shell-v932-golden470': makeGen('f123-shell-v932', true),
      'f123-shell-v931-golden469': makeGen('f123-shell-v931', false)
    }
  });
  const rMiss = await hMissing.dispatch({ relPath: 'finance-report-worker.js', destination: 'worker', clientId: '' });
  assert.equal(rMiss.status, 503);
  assert.equal(rMiss.networkCalls, 0);
  assert.equal(rMiss.cacheWrites, 0);
});

// Action 31: onShellTomado takeover race populates version target so PIN adopts with 1 controlled reload
test('Action 31: onShellTomado populates missing version target via revisar() so PIN adopts cleanly', () => {
  const onShellStart = app03Source.indexOf('function onShellTomado()');
  const onShellEnd = app03Source.indexOf('if (tieneSW) {', onShellStart);
  const block = app03Source.slice(onShellStart, onShellEnd);
  assert.match(block, /if\s*\(!puedeRecargarVersion\(\)\)\s*revisar\(\);/, 'controllerchange race must call revisar() when version target is not yet recorded');
});

// Action 32: docs/dashboard.html and app receive compatible versions after takeover
test('Action 32: dashboard.html and index.html pin to CACHE_LOCAL and serve compatible assets after takeover', async () => {
  // Static identity parity
  assert.ok(dashboardHtml.includes(`content="${versionJson.shell}"`), 'dashboard-shell matches version.json');
  assert.ok(dashboardHtml.includes(`content="${versionJson.releaseName}"`), 'dashboard-release matches version.json');
  assert.ok(swSource.includes(`const CACHE = "${versionJson.shell}";`), 'sw.js CACHE matches version.json');
  assert.ok(swSource.includes(`const CACHE_GENERACION = "-${versionJson.cacheGeneration}";`), 'sw.js CACHE_GENERACION matches version.json');
  assert.equal(manifestJson.shell, versionJson.shell, 'version-manifest.json shell matches version.json');
  for (const asset of ['./index.html', './dashboard.html', './app-inline-03.min.js', './dashboard-main.min.js']) {
    assert.match(manifestJson.files[asset] || '', /^sha256-[0-9a-f]{64}$/, asset + ' present in manifest');
  }

  // Runtime navigation pinning for /dashboard and /dashboard.html + /index.html
  const dashNew = '<!doctype html><meta name="dashboard-shell" content="f123-shell-v933">';
  const appNew = '<!doctype html><title>app v933</title>';
  const h = makeSwHarness({
    stores: {
      'f123-shell-v933-golden471': {
        './index.html': new Response(appNew, { headers: { 'content-type': 'text/html' } }),
        './dashboard.html': new Response(dashNew, { headers: { 'content-type': 'text/html' } }),
        './dashboard-main.min.js': new Response('/* dash v933 */', { headers: { 'content-type': 'application/javascript' } }),
        './app-inline-03.min.js': new Response('/* app v933 */', { headers: { 'content-type': 'application/javascript' } })
      },
      'f123-shell-v932-golden470': {
        './dashboard-main.min.js': new Response('/* dash v932 */', { headers: { 'content-type': 'application/javascript' } })
      }
    },
    pins: { 'dash-old-tab': 'f123-shell-v932-golden470' },
    networkResponder: async () => new Response('/* newer-uninstalled-html */', { status: 200, headers: { 'content-type': 'text/html' } })
  });

  // New dashboard navigation pins resultingClientId to CACHE_LOCAL
  const navDash = await h.dispatch({ relPath: 'dashboard', mode: 'navigate', resultingClientId: 'dash-new-tab' });
  assert.equal(navDash.status, 200);
  assert.equal(navDash.body, dashNew);
  assert.equal(await h.api.leerShellDeDocumento('dash-new-tab'), 'f123-shell-v933-golden471');

  // New app navigation pins resultingClientId to CACHE_LOCAL
  const navApp = await h.dispatch({ relPath: 'index.html', mode: 'navigate', resultingClientId: 'app-new-tab' });
  assert.equal(navApp.status, 200);
  assert.equal(navApp.body, appNew);
  assert.equal(await h.api.leerShellDeDocumento('app-new-tab'), 'f123-shell-v933-golden471');

  // Compatible assets for new dashboard, new app, and pre-takeover old dashboard
  const assetDashNew = await h.dispatch({ relPath: 'dashboard-main.min.js', clientId: 'dash-new-tab' });
  assert.deepEqual([assetDashNew.status, assetDashNew.body], [200, '/* dash v933 */']);

  const assetAppNew = await h.dispatch({ relPath: 'app-inline-03.min.js', clientId: 'app-new-tab' });
  assert.deepEqual([assetAppNew.status, assetAppNew.body], [200, '/* app v933 */']);

  const assetDashOld = await h.dispatch({ relPath: 'dashboard-main.min.js', clientId: 'dash-old-tab' });
  assert.deepEqual([assetDashOld.status, assetDashOld.body], [200, '/* dash v932 */']);
});
