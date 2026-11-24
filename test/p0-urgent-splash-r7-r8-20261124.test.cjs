'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');

function loadActualizacionSola(opts = {}) {
  const src = fs.readFileSync(path.join(ROOT, 'src/app/app-inline-03.js'), 'utf8');
  const start = src.indexOf('(function actualizacionSola()');
  const end = src.indexOf('// Microcirugia 5', start);
  assert.ok(start >= 0 && end > start, 'actualizacionSola block must exist in src/app/app-inline-03.js');
  const snippet = src.slice(start, end);

  let reloads = 0;
  let rafCalls = 0;
  let createdSplash = null;
  let removedSplash = 0;
  let visibilityState = opts.visibilityState || 'visible';
  const docListeners = {};
  const swListeners = {};
  const local = new Map([['f123_version_vista', 'v0.9.24|f123-shell-v924']]);
  const session = new Map([['f123_act_sola_pendiente', '1']]);
  const mkStorage = (m) => ({
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k)
  });
  const gate = opts.pin === false ? null : { style: { display: 'flex' }, getClientRects: () => [{}] };
  const pad = opts.partialPin
    ? { _ocTeclado: { entrada: () => '12' } }
    : { _ocTeclado: { entrada: () => '' } };

  const body = opts.failSplash ? null : {
    appendChild(el) {
      el.isConnected = true;
      createdSplash = el;
    }
  };
  const document = {
    get visibilityState() { return visibilityState; },
    set visibilityState(v) { visibilityState = v; },
    get body() { return body; },
    get documentElement() { return opts.failSplash ? null : body; },
    activeElement: null,
    getElementById(id) {
      if (id === 'oc-gate') return gate;
      if (id === 'oc-pad') return pad;
      if (id === 'f123-update-splash') return createdSplash && createdSplash.isConnected ? createdSplash : null;
      return null;
    },
    querySelectorAll: () => [],
    addEventListener(type, fn) { (docListeners[type] = docListeners[type] || []).push(fn); },
    createElement() {
      if (opts.failSplash) throw new Error('DOM creation failed');
      const el = {
        id: '',
        style: {},
        isConnected: false,
        innerHTML: '',
        attrs: {},
        setAttribute(k, v) { this.attrs[k] = v; },
        getAttribute(k) { return this.attrs[k]; },
        getClientRects: () => [{}],
        remove() { this.isConnected = false; removedSplash++; }
      };
      return el;
    }
  };

  const sw = {
    controller: {
      postMessage() {
        const fn = swListeners.message;
        if (fn) fn({ data: { tipo: 'shell-actual', shell: 'f123-shell-v924' } });
      }
    },
    addEventListener(k, fn) { swListeners[k] = fn; },
    removeEventListener(k, fn) { if (swListeners[k] === fn) delete swListeners[k]; },
    getRegistration: async () => ({ update: async () => {} }),
    getRegistrations: async () => []
  };

  const windowObj = {
    addEventListener() {},
    OCYjs: opts.recovering ? { estado: 'activo', canal: { recuperando: true } } : null
  };
  if (opts.noRaf !== true) {
    windowObj.requestAnimationFrame = (fn) => {
      rafCalls++;
      if (opts.hideMidPaint && rafCalls === 1) {
        visibilityState = 'hidden';
      }
      if (opts.stallRaf) return 1;
      Promise.resolve().then(() => fn(rafCalls * 16));
      return rafCalls;
    };
  }

  const ctx = {
    window: windowObj,
    navigator: { serviceWorker: sw },
    document,
    localStorage: mkStorage(local),
    sessionStorage: mkStorage(session),
    Date: { now: () => 1700000000000 },
    setTimeout: opts.realTimeout ? setTimeout : (fn, ms) => (opts.fireTimeoutImmediately ? (fn(), 1) : 1),
    clearTimeout: opts.realTimeout ? clearTimeout : () => {},
    setInterval: () => 1,
    clearInterval: () => {},
    getComputedStyle: () => ({ display: 'flex' }),
    _ventasEnCurso: new Set(),
    _carritoVenta: [],
    _sellando: false,
    _ocActSolaOn: true,
    _recargarSeguroVersion() {},
    location: { reload() { reloads++; } },
    fetch: async () => ({ ok: false })
  };

  vm.runInNewContext(snippet, ctx);
  return {
    window: windowObj,
    document,
    session,
    local,
    docListeners,
    stats: () => ({ reloads, rafCalls, createdSplash, removedSplash })
  };
}

// ---------------------------------------------------------------------------
// 1. SPLASH-ONLY PROGRAMMATIC RELOADS (JFC urgent reproduction)
// ---------------------------------------------------------------------------
test('Splash P0 RED->GREEN: intentar() must NEVER reload if splash creation fails', async () => {
  const f = loadActualizacionSola({ failSplash: true, visibilityState: 'visible' });
  const ok = await f.window._ocActSola.intentar();
  assert.equal(ok, false, 'must abort reload when splash cannot be created');
  assert.equal(f.stats().reloads, 0, 'zero reloads when splash is null');
  assert.equal(f.session.get('f123_act_sola_pendiente'), '1', 'pending flag must remain intact for next safe attempt');
  assert.equal(f.session.get('f123_autorecarga'), undefined, 'latch KA must NOT be written when reload aborted');
});

test('Splash P0 RED->GREEN: intentar() must NEVER reload when Safari is in background (hidden)', async () => {
  const f = loadActualizacionSola({ visibilityState: 'hidden' });
  const ok = await f.window._ocActSola.intentar();
  assert.equal(ok, false, 'must abort reload while document is hidden');
  assert.equal(f.stats().reloads, 0, 'zero reloads in background');
  assert.equal(f.stats().rafCalls, 0, 'zero rAF calls in background');
  assert.equal(f.stats().createdSplash, null, 'must not mount splash while hidden');
  assert.equal(f.session.get('f123_act_sola_pendiente'), '1');
});

test('Splash P0 RED->GREEN: intentar() must NEVER reload when paint wait (rAF) is unavailable', async () => {
  const f = loadActualizacionSola({ noRaf: true, visibilityState: 'visible' });
  const ok = await f.window._ocActSola.intentar();
  assert.equal(ok, false, 'must abort reload when requestAnimationFrame is unavailable');
  assert.equal(f.stats().reloads, 0, 'zero reloads without paint confirmation');
  assert.equal(f.stats().removedSplash, 1, 'unpainted splash must be cleaned up');
  assert.equal(f.session.get('f123_act_sola_pendiente'), '1');
});

test('Splash P0 RED->GREEN: intentar() aborts if tab becomes hidden mid-paint between rAF frames', async () => {
  const f = loadActualizacionSola({ visibilityState: 'visible', hideMidPaint: true });
  const ok = await f.window._ocActSola.intentar();
  assert.equal(ok, false, 'must abort reload if document hides during paint');
  assert.equal(f.stats().reloads, 0);
  assert.equal(f.stats().removedSplash, 1);
  assert.equal(f.session.get('f123_act_sola_pendiente'), '1');
});

test('Splash P0 RED->GREEN: visibilitychange->hidden does not trigger reload, and partial PIN defers reload', async () => {
  const fHidden = loadActualizacionSola({ visibilityState: 'hidden' });
  for (const fn of (fHidden.docListeners.visibilitychange || [])) fn();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(fHidden.stats().reloads, 0, 'visibilitychange hidden must never trigger reload');

  const fPin = loadActualizacionSola({ visibilityState: 'visible', partialPin: true });
  const okPin = await fPin.window._ocActSola.intentar();
  assert.equal(okPin, false, 'must defer reload while user has typed partial PIN digits');
  assert.equal(fPin.stats().reloads, 0);
});

test('Splash P0 control: visible PIN screen with painted existing splash reloads exactly once', async () => {
  const f = loadActualizacionSola({ visibilityState: 'visible' });
  const ok1 = await f.window._ocActSola.intentar();
  assert.equal(ok1, true);
  assert.equal(f.stats().reloads, 1);
  assert.equal(f.stats().rafCalls, 2);
  assert.equal(f.stats().createdSplash?.id, 'f123-update-splash');
  assert.equal(f.session.get('f123_act_sola_pendiente'), undefined);
  const ok2 = await f.window._ocActSola.intentar();
  assert.equal(ok2, false);
  assert.equal(f.stats().reloads, 1);
});

test('Splash P0 RED->GREEN: auth-ui.js rescate-licencia must not schedule bare unguarded location.reload()', () => {
  const authSrc = fs.readFileSync(path.join(ROOT, 'docs/auth-ui.js'), 'utf8');
  const idx = authSrc.indexOf('rescate-licencia');
  assert.ok(idx > 0, 'rescate-licencia block must exist');
  const slice = authSrc.slice(Math.max(0, idx - 220), idx + 350);
  assert.doesNotMatch(slice, /setTimeout\s*\([\s\S]*?location\.reload\s*\(/, 'rescate-licencia must route through splash-gated reload, not raw setTimeout location.reload()');
});

// ---------------------------------------------------------------------------
// 2. R8-01 & R8-02: CLOUDFLARE RELAY CURSOR & SESSION GENERATION ISOLATION
// ---------------------------------------------------------------------------
function loadCfRelay(windowListeners = {}) {
  const code = fs.readFileSync(path.join(ROOT, 'docs/cf-relay.js'), 'utf8');
  const win = {
    addEventListener(type, fn) {
      (windowListeners[type] = windowListeners[type] || []).push(fn);
    }
  };
  const ctx = {
    window: win,
    document: { hidden: false },
    crypto: globalThis.crypto,
    TextEncoder: globalThis.TextEncoder,
    atob: globalThis.atob,
    btoa: globalThis.btoa,
    Blob: globalThis.Blob,
    DOMException: globalThis.DOMException,
    Uint8Array: globalThis.Uint8Array,
    setInterval: globalThis.setInterval,
    clearInterval: globalThis.clearInterval,
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
    Promise,
    Date,
    Number,
    Math,
    String,
    Array,
    Object,
    JSON,
    Error,
    TypeError,
    encodeURIComponent
  };
  vm.runInNewContext(code, ctx);
  return { relayFactory: win.F123CloudflareRelay.create, win, windowListeners };
}

function b64Frame(label) {
  return Buffer.from('0123456789abcdef0123456789abcdef:' + label, 'utf8').toString('base64');
}

test('R8-01 RED->GREEN: own POST op ACK seq=12 must NOT skip foreign seq=11 on cursor=10', async () => {
  const { relayFactory } = loadCfRelay();
  const frame11 = b64Frame('remote-op-11');
  const frame12 = b64Frame('own-op-12');
  let headCalls = 0;
  const pullCalls = [];
  const serverOps = [
    { seq: 11, cipher: frame11 }
  ];
  const fetchMock = async (url, init = {}) => {
    const u = new URL(url);
    if (u.pathname === '/ws/ticket') {
      return new Response(JSON.stringify({ ok: true, token: 'tkt-1' }), { status: 200 });
    }
    if (u.pathname.endsWith('/session')) {
      return new Response(JSON.stringify({ ok: true, token: 'sess-1', expiresAt: Date.now() + 600_000 }), { status: 200 });
    }
    if (u.pathname.endsWith('/head')) {
      headCalls++;
      // Initial open returns rev=0, seq=10. Subsequent live polls see seq=12.
      const seq = headCalls === 1 ? 10 : 12;
      return new Response(JSON.stringify({ ok: true, rev: 0, seq }), { status: 200 });
    }
    if (u.pathname.endsWith('/op') && init.method === 'POST') {
      serverOps.push({ seq: 12, cipher: JSON.parse(init.body).c });
      return new Response(JSON.stringify({ ok: true, seq: 12, duplicate: false }), { status: 201 });
    }
    if (u.pathname.endsWith('/pull')) {
      const reqSeq = Number(u.searchParams.get('seq') || 0);
      pullCalls.push({ rev: Number(u.searchParams.get('rev') || 0), seq: reqSeq });
      const rows = serverOps.filter((r) => r.seq > reqSeq);
      return new Response(JSON.stringify({
        ok: true,
        rev: 0,
        seq: rows.length ? rows[rows.length - 1].seq : reqSeq,
        n: rows.length,
        more: false,
        frames: rows.map((r) => r.cipher)
      }), { status: 200 });
    }
    return new Response(JSON.stringify({ ok: false }), { status: 404 });
  };

  const relay = relayFactory({
    fetch: fetchMock,
    livePollMs: 25,
    getCredentials: () => ({
      role: 'dueno',
      licenseCode: 'F123-SYNTHETIC01',
      instanceId: 'inst-device-a',
      authSuffix: '-priv',
      scopes: ['priv:read', 'priv:write'],
      credentials: { kind: 'owner', licenseCode: 'F123-SYNTHETIC01', instanceId: 'inst-device-a', pin: '123' }
    })
  });

  const roomHex = 'a'.repeat(40);
  const sock = relay.connect(`wss://friendly123-sync-relay.jfcarpio.workers.dev/sala/${roomHex}`);
  const receivedBinary = [];
  const acks = [];

  await new Promise((resolve, reject) => {
    sock.onopen = resolve;
    sock.onerror = () => reject(new Error('socket failed to open'));
  });
  sock.onmessage = (ev) => {
    if (typeof ev.data === 'string') {
      const msg = JSON.parse(ev.data);
      if (msg.k === 'persist-result') acks.push(msg);
    } else {
      receivedBinary.push(Buffer.from(ev.data).toString('utf8'));
    }
  };

  // Device A sends its own op -> DO assigns seq=12 (while seq=11 from Device B is already there!)
  sock.send(JSON.stringify({ k: 'op', id: 'op-own-12', c: frame12, lam: 12, ack: 1 }));
  await new Promise((r) => setTimeout(r, 150));
  sock.close();

  assert.equal(acks.length, 1, 'own op ACK must arrive');
  assert.equal(acks[0].ok, true);
  assert.ok(pullCalls.length >= 1, 'live poll must pull missing gap after own ACK seq=12');
  assert.equal(pullCalls[0].seq, 10, 'pull must start from contiguous received cursor seq=10, NOT own ACK seq=12');
  assert.equal(receivedBinary.length, 1, 'must deliver foreign seq=11 exactly once and deduplicate own seq=12');
  assert.match(receivedBinary[0], /remote-op-11/);
});

test('R8-02 RED->GREEN: oc-logout during in-flight session exchange must NOT repopulate cache or reuse stale token', async () => {
  const listeners = {};
  const { relayFactory } = loadCfRelay(listeners);
  let releaseSession1;
  let sessionReqCount = 0;
  const authHeadersSeen = [];
  let activeCred = {
    role: 'dueno',
    licenseCode: 'F123-SYNTHETIC01',
    instanceId: 'inst-user-1',
    authSuffix: '-priv',
    scopes: ['priv:read', 'priv:write'],
    credentials: { kind: 'owner', licenseCode: 'F123-SYNTHETIC01', instanceId: 'inst-user-1', pin: '123' }
  };

  const fetchMock = async (url, init = {}) => {
    const u = new URL(url);
    if (u.pathname === '/ws/ticket') {
      return new Response(JSON.stringify({ ok: true, token: 'tkt-' + (sessionReqCount + 1) }), { status: 200 });
    }
    if (u.pathname.endsWith('/session')) {
      sessionReqCount++;
      const n = sessionReqCount;
      if (n === 1) {
        await new Promise((r) => { releaseSession1 = r; });
        return new Response(JSON.stringify({ ok: true, token: 'STALE-TOKEN-USER-1', expiresAt: Date.now() + 600_000 }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: true, token: 'FRESH-TOKEN-USER-2', expiresAt: Date.now() + 600_000 }), { status: 200 });
    }
    if (u.pathname.endsWith('/head')) {
      authHeadersSeen.push(init.headers?.authorization || '');
      return new Response(JSON.stringify({ ok: true, rev: 0, seq: 1 }), { status: 200 });
    }
    return new Response(JSON.stringify({ ok: false }), { status: 404 });
  };

  const relay = relayFactory({
    fetch: fetchMock,
    livePollMs: 0,
    getCredentials: () => activeCred
  });

  const url = `wss://friendly123-sync-relay.jfcarpio.workers.dev/sala/${'b'.repeat(40)}`;
  const pendingRead1 = relay.leerHead(url).catch((e) => ({ err: e }));

  // Wait until /session #1 is in-flight
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(typeof releaseSession1, 'function', 'first session exchange must be in-flight');

  // Fire oc-logout BEFORE session #1 resolves!
  for (const fn of (listeners['oc-logout'] || [])) fn();
  activeCred = {
    ...activeCred,
    instanceId: 'inst-user-2',
    credentials: { ...activeCred.credentials, instanceId: 'inst-user-2', pin: '321' }
  };

  // Now let stale session #1 finish
  releaseSession1();
  await pendingRead1;

  // Next read under User 2 MUST mint a fresh token and NEVER reuse STALE-TOKEN-USER-1!
  const head2 = await relay.leerHead(url);
  assert.deepEqual({ rev: head2?.rev, seq: head2?.seq }, { rev: 0, seq: 1 });
  assert.ok(!authHeadersSeen.includes('Bearer STALE-TOKEN-USER-1'),
    'stale pre-logout token must NEVER be sent or cached: ' + JSON.stringify(authHeadersSeen));
  assert.ok(authHeadersSeen.includes('Bearer FRESH-TOKEN-USER-2'),
    'fresh post-logout session token must be used');
});

// ---------------------------------------------------------------------------
// 3. R8-03 & R8-04: docs/hechos.js MIGRATION & IDB WATCHDOG / ONBLOCKED
// ---------------------------------------------------------------------------
function loadHechosEnv({ openImpl, databasesImpl, amgAislamiento }) {
  const code = fs.readFileSync(path.join(ROOT, 'docs/hechos.js'), 'utf8');
  const local = new Map();
  const idb = { open: openImpl };
  if (typeof databasesImpl === 'function') idb.databases = databasesImpl;
  const win = {
    indexedDB: idb,
    AMG: amgAislamiento ? { Aislamiento: amgAislamiento } : undefined,
    localStorage: {
      getItem: (k) => (local.has(k) ? local.get(k) : null),
      setItem: (k, v) => local.set(k, String(v)),
      removeItem: (k) => local.delete(k)
    },
    addEventListener() {},
    dispatchEvent() {},
    OCInstanceId: 'inst-hechos-test'
  };
  win.window = win;
  const ctx = {
    window: win,
    self: win,
    localStorage: win.localStorage,
    indexedDB: win.indexedDB,
    crypto: globalThis.crypto,
    TextEncoder: globalThis.TextEncoder,
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
    Promise,
    Date,
    Number,
    Math,
    String,
    Array,
    Object,
    JSON,
    Error,
    console: { warn() {}, error() {}, log() {} }
  };
  vm.runInNewContext(code, ctx);
  return { hechos: win.AMG.Hechos, local };
}

test('R8-03 RED->GREEN: hechos.js must NOT mark migration done after transient open failure of legacy DB', async () => {
  let oldOpenAttempts = 0;
  const migratedRecords = [];
  const oldFacts = [
    { id: 'inst-old-1', tipo: 'venta', ts: 100, instanceId: 'inst-old', reloj: { 'inst-old': 1 }, hash: 'h1', prevHash: null, datos: {} },
    { id: 'inst-old-2', tipo: 'abono', ts: 200, instanceId: 'inst-old', reloj: { 'inst-old': 2 }, hash: 'h2', prevHash: 'h1', datos: {} }
  ];

  function fakeDb(name, records) {
    return {
      name,
      closed: false,
      objectStoreNames: { contains: (s) => s === 'hechos' },
      close() { this.closed = true; },
      transaction(storeName, mode) {
        const tx = {
          oncomplete: null,
          onerror: null,
          onabort: null,
          objectStore() {
            return {
              getAll() {
                const r = { onsuccess: null, onerror: null, result: records.slice() };
                queueMicrotask(() => {
                  if (r.onsuccess) r.onsuccess({ target: r });
                  if (tx.oncomplete) tx.oncomplete();
                });
                return r;
              },
              put(rec) {
                migratedRecords.push(rec);
                return {};
              },
              count() {
                const r = { onsuccess: null, onerror: null, result: migratedRecords.length };
                queueMicrotask(() => { if (r.onsuccess) r.onsuccess({ target: r }); });
                return r;
              }
            };
          }
        };
        if (mode === 'readwrite') {
          queueMicrotask(() => { if (tx.oncomplete) tx.oncomplete(); });
        }
        return tx;
      }
    };
  }

  const env = loadHechosEnv({
    openImpl(name) {
      const req = { onupgradeneeded: null, onsuccess: null, onerror: null, onblocked: null };
      if (name === 'amg_hechos_db') {
        oldOpenAttempts++;
        queueMicrotask(() => {
          if (oldOpenAttempts === 1) {
            req.error = new Error('transient Safari IDB glitch');
            if (req.onerror) req.onerror();
          } else {
            req.result = fakeDb(name, oldFacts);
            if (req.onsuccess) req.onsuccess({ target: req });
          }
        });
      } else {
        queueMicrotask(() => {
          req.result = fakeDb(name, migratedRecords);
          if (req.onsuccess) req.onsuccess({ target: req });
        });
      }
      return req;
    }
  });

  // Attempt 1: legacy DB open fails transiently -> MIGRACION_KEY must NOT be marked "1"
  await env.hechos.contar();
  assert.equal(oldOpenAttempts, 1);
  assert.notEqual(env.local.get('f123_hechos_migrado_v1'), '1',
    'transient open failure must NOT permanently mark migration completed');

  // Attempt 2: legacy DB succeeds -> records MUST be migrated and ONLY NOW marked "1"
  await env.hechos.contar();
  assert.equal(oldOpenAttempts, 2, 'second attempt must retry migration');
  assert.equal(migratedRecords.length, 2, 'both legacy facts must be migrated on retry');
  assert.equal(env.local.get('f123_hechos_migrado_v1'), '1', 'migration flag set only after verified commit');
});

test('R8-04 RED->GREEN: hechos.js open handles onblocked cleanly without hanging forever and closes late db', async () => {
  let lateDbClosed = false;
  let capturedReq = null;
  const env = loadHechosEnv({
    openImpl() {
      const req = { onupgradeneeded: null, onsuccess: null, onerror: null, onblocked: null };
      capturedReq = req;
      queueMicrotask(() => {
        if (typeof req.onblocked === 'function') req.onblocked();
      });
      return req;
    }
  });

  const outcome = await Promise.race([
    env.hechos.contar().then(() => 'resolved', (e) => 'rejected:' + e.message),
    new Promise((r) => setTimeout(() => r('HUNG'), 300))
  ]);
  assert.notEqual(outcome, 'HUNG', 'onblocked must never hang open forever');
  assert.match(outcome, /^rejected:/, 'onblocked must reject cleanly');

  // Simulate Safari firing a late onsuccess AFTER rejection -> must close immediately
  if (capturedReq && typeof capturedReq.onsuccess === 'function') {
    capturedReq.result = { close() { lateDbClosed = true; } };
    capturedReq.onsuccess({ target: capturedReq });
  }
  assert.equal(lateDbClosed, true, 'late onsuccess after rejection must close leaked DB handle');
});

test('R8-03 aislamiento.js parity RED->GREEN: hechos.js recognizes prefixed f123::amg_hechos_db in indexedDB.databases()', async () => {
  const migratedRecords = [];
  const oldFacts = [
    { id: 'inst-iso-1', tipo: 'venta', ts: 300, instanceId: 'inst-iso', reloj: { 'inst-iso': 1 }, hash: 'h1', prevHash: null, datos: {} }
  ];
  let openedLegacy = false;

  function fakeDb(name, records) {
    return {
      name,
      objectStoreNames: { contains: (s) => s === 'hechos' },
      close() {},
      transaction(_storeName, mode) {
        const tx = {
          oncomplete: null,
          onerror: null,
          onabort: null,
          objectStore() {
            return {
              getAll() {
                const r = { onsuccess: null, onerror: null, result: records.slice() };
                queueMicrotask(() => {
                  if (r.onsuccess) r.onsuccess({ target: r });
                  if (tx.oncomplete) tx.oncomplete();
                });
                return r;
              },
              put(rec) { migratedRecords.push(rec); return {}; },
              count() {
                const r = { onsuccess: null, onerror: null, result: migratedRecords.length };
                queueMicrotask(() => { if (r.onsuccess) r.onsuccess({ target: r }); });
                return r;
              }
            };
          }
        };
        if (mode === 'readwrite') {
          queueMicrotask(() => { if (tx.oncomplete) tx.oncomplete(); });
        }
        return tx;
      }
    };
  }

  const env = loadHechosEnv({
    amgAislamiento: { namespace: 'f123', idbInstalado: true },
    // aislamiento.js wraps open() with "f123::" but does NOT wrap indexedDB.databases()
    databasesImpl: async () => [{ name: 'f123::amg_hechos_db', version: 1 }, { name: 'f123::f123_hechos_db', version: 1 }],
    openImpl(name) {
      const req = { onupgradeneeded: null, onsuccess: null, onerror: null, onblocked: null };
      queueMicrotask(() => {
        if (name === 'amg_hechos_db') {
          openedLegacy = true;
          req.result = fakeDb('f123::amg_hechos_db', oldFacts);
        } else {
          req.result = fakeDb('f123::' + name, migratedRecords);
        }
        if (req.onsuccess) req.onsuccess({ target: req });
      });
      return req;
    }
  });

  await env.hechos.contar();
  assert.equal(openedLegacy, true, 'must open legacy DB when databases() lists f123::amg_hechos_db');
  assert.equal(migratedRecords.length, 1, 'must migrate legacy record from f123::amg_hechos_db');
  assert.equal(env.local.get('f123_hechos_migrado_v1'), '1');
});

// ---------------------------------------------------------------------------
// 4. R7 HARDENING GAPS: RECEIPT PAYLOAD/LICENSE MATCH & SCOPED TERMINAL CACHE
// ---------------------------------------------------------------------------
test('R7 P0-A RED->GREEN: esReciboVerificado20 rejects missing receipt.license and mismatched amountCents 1500->9999', () => {
  const src = fs.readFileSync(path.join(ROOT, 'docs/sync-realtime.js'), 'utf8');
  const fnMatch = src.match(/function esReciboVerificado20\([\s\S]*?\n  \}/);
  assert.ok(fnMatch, 'esReciboVerificado20 must exist in docs/sync-realtime.js');
  const helperMatch = src.match(/function _canonCmd20\([\s\S]*?\n  \}/);
  const normalizarCodigo = (s) => String(s || '').trim().toUpperCase();
  const fn = new Function(
    'normalizarCodigo',
    `${helperMatch ? helperMatch[0] : ''}\n${fnMatch[0]}\nreturn esReciboVerificado20;`
  )(normalizarCodigo);

  const lic = 'F123-SYNTHETIC01';
  const op15 = {
    opId: 'sale-r7-intent-0001',
    _salaOrigen: lic,
    tipo: 'venta',
    payload: { productoId: 'sku-1', delta: -1, cantidad: 1, amountCents: 1500, opId: 'sale-r7-intent-0001' }
  };
  const traducir = (op) => ({
    opId: op.opId,
    license: lic,
    kind: 'sale.record',
    productId: op.payload.productoId,
    quantity: op.payload.cantidad,
    amountCents: op.payload.amountCents
  });

  // Case 1: missing receipt.license -> MUST return false (never prune)
  const yjsNoLic = {
    traducirOpLegadoAComando20: traducir,
    recibosComerciales20: new Map([[op15.opId, {
      opId: op15.opId,
      committed: true,
      stage: 'business-committed',
      command: traducir(op15),
      receipt: { opId: op15.opId, stage: 'business-committed' }
    }]])
  };
  assert.equal(fn(yjsNoLic, op15, lic), false, 'receipt without license must NOT authorize pruning');

  // Case 2: mismatched amountCents (journal $15 vs confirmed $99.99) -> MUST return false
  const yjsTampered = {
    traducirOpLegadoAComando20: traducir,
    recibosComerciales20: new Map([[op15.opId, {
      opId: op15.opId,
      committed: true,
      stage: 'business-committed',
      command: { ...traducir(op15), amountCents: 9999 },
      receipt: { opId: op15.opId, license: lic, stage: 'business-committed' }
    }]])
  };
  assert.equal(fn(yjsTampered, op15, lic), false, 'amountCents 1500 vs 9999 mismatch must NOT authorize pruning');

  // Case 3: exact license + exact canonical command match -> returns true
  const yjsExact = {
    traducirOpLegadoAComando20: traducir,
    recibosComerciales20: new Map([[op15.opId, {
      opId: op15.opId,
      committed: true,
      stage: 'business-committed',
      command: traducir(op15),
      receipt: { opId: op15.opId, license: lic, stage: 'business-committed' }
    }]])
  };
  assert.equal(fn(yjsExact, op15, lic), true, 'exact verified receipt + license + canonical payload authorizes pruning');
});

test('R7 RED->GREEN: _refrescarOpIdsTerminales20 scopes cache by license/room/authEpoch and discards stale await', async () => {
  const src = fs.readFileSync(path.join(ROOT, 'docs/sync-yjs.js'), 'utf8');
  const start = src.indexOf('function _alcanceTerminales20()');
  const end = src.indexOf('API._reintentarActivarCorte20 =', start);
  assert.ok(start > 0 && end > start, 'terminal cache block must exist in docs/sync-yjs.js');
  const block = src.slice(start, end);

  let releaseLoad;
  const API = {
    codigoCuaderno: 'F123-SHOP-AAAA01',
    roomId: 'room-shop-a',
    __authEpoch20: 1,
    recibosComerciales20: new Map()
  };
  const piloto = {
    crearAlmacenDurableOpsTipadas: async () => ({
      loadCommittedOpIds: () => new Promise((r) => { releaseLoad = () => r(['op-from-shop-a-01']); })
    })
  };
  const win = { indexedDB: {}, dispatchEvent() {}, OCYjs: API };
  const ctx = { API, piloto, codigo: 'F123-SHOP-AAAA01', window: win, CustomEvent: class { constructor(t) { this.type = t; } }, Set, Array, Promise };
  vm.runInNewContext(block, ctx);

  const p = API._refrescarOpIdsTerminales20();
  await new Promise((r) => setTimeout(r, 15));
  assert.equal(typeof releaseLoad, 'function');

  // Switch auth epoch / notebook while loadCommittedOpIds is in-flight!
  API.__authEpoch20 = 2;
  API.codigoCuaderno = 'F123-SHOP-BBBB02';
  API.roomId = 'room-shop-b';
  releaseLoad();
  await p;

  const ids = API.opIdsTerminales20();
  assert.ok(!ids.includes('op-from-shop-a-01'),
    'stale terminal opId from previous notebook/authEpoch must NEVER leak into new scope: ' + JSON.stringify(ids));
});

test('Review Critical #3: fresh commercial op submitted while hidden/paused falls back cleanly to legacy 1.0 without stranding', async () => {
  const { pathToFileURL } = require('node:url');
  const { createTypedOpsReconciler } = await import(pathToFileURL(path.join(ROOT, 'src/port2-typed-ops-reconciler.mjs')).href);
  const { createVerifiedCrossDeviceFailbackCoordinator } = await import(pathToFileURL(path.join(ROOT, 'src/port2-cross-device-failback.mjs')).href);

  let visible = true;
  const pending = new Map();
  const settled = new Set();
  const store = {
    async loadAll() { return Array.from(pending.values()); },
    async loadCommittedOpIds() { return Array.from(settled); },
    async save(entry) { pending.set(entry.opId, entry); },
    async remove(opId) { pending.delete(opId); },
    async markCommitted(opId) { pending.delete(opId); settled.add(opId); }
  };
  let dispatches = 0;
  const reconciler = createTypedOpsReconciler({
    store,
    isVisible: () => visible,
    dispatch: async () => { dispatches++; return { committed: true }; }
  });
  const coord = createVerifiedCrossDeviceFailbackCoordinator({
    store,
    reconciler,
    isVisible: () => visible,
    openCatalogSession: async () => ({
      frozenHead: 'head-rev-1',
      readOnly: false,
      isClosed: () => false,
      isActive: () => true,
      close() {}
    })
  });
  const act = await coord.activate20();
  assert.equal(act.mode, 'active-2.0');

  // Hide Safari right before submitting a fresh commercial op -> must NOT strand!
  visible = false;
  const cmd = {
    opId: 'sale-hidden-nostrand-01',
    license: 'F123-SYNTHETIC01',
    kind: 'sale.record',
    productId: 'sku-1',
    quantity: 1,
    amountCents: 1200
  };
  const res = await coord.submitCommercial(cmd);
  assert.equal(dispatches, 0, 'must not POST while hidden');
  assert.equal(res.fallbackLegacy, true, 'fresh unpersisted op while hidden must authorize clean legacy 1.0 fallback');
  assert.equal(await coord.canDispatchOnLegacy(cmd.opId), true,
    'custody reservation must be released so legacy 1.0 is NOT permanently blocked');
  coord.destroy();
  reconciler.destroy();
});

test('Review Critical #4 & Required #11: onSettled fences authEpoch drift and missing/wrong receipt.license', () => {
  const syncSrc = fs.readFileSync(path.join(ROOT, 'docs/sync-yjs.js'), 'utf8');
  const sOn = syncSrc.indexOf('        var origOnSettled =');
  const eOn = syncSrc.indexOf('        var observadorExterno =', sOn);
  assert.ok(sOn > 0 && eOn > sOn);
  const block = syncSrc.slice(sOn, eOn);

  const recorded = [];
  const activeCoord = { id: 'coord-1' };
  const API = {
    codigoCuaderno: 'F123-SHOP-AAAA01',
    roomId: 'room-a',
    __authEpoch20: 1,
    coordinadorCorte20: activeCoord,
    __opIdsTerminales20Cache: new Set(),
    __opIdsTerminales20Scope: 'F123-SHOP-AAAA01|room-a|1'
  };
  const opciones = {};
  vm.runInNewContext(block, {
    window: { OCYjs: API },
    API,
    coord: activeCoord,
    opciones,
    Set,
    String,
    _alcanceTerminales20: () => `${API.codigoCuaderno}|${API.roomId}|${API.__authEpoch20}`,
    _registrarReciboComercial20: (id, res) => recorded.push({ id, res })
  });

  // 1. Missing license must NOT be accepted as committed
  opciones.onSettled({
    opId: 'op-nolic-01',
    status: 'committed',
    receipt: { opId: 'op-nolic-01', stage: 'business-committed' }
  });
  assert.equal(API.__opIdsTerminales20Cache.has('op-nolic-01'), false);
  assert.equal(recorded[0].res.committed, false);

  // 2. Auth epoch drift must discard callback completely even if coordinator reference unchanged
  API.__authEpoch20 = 2;
  opciones.onSettled({
    opId: 'op-old-epoch-02',
    status: 'committed',
    receipt: { opId: 'op-old-epoch-02', license: 'F123-SHOP-AAAA01', stage: 'business-committed' }
  });
  assert.equal(API.__opIdsTerminales20Cache.has('op-old-epoch-02'), false);
  assert.equal(recorded.length, 1, 'old-epoch callback must be completely dropped');
});

test('Review Required #8: cf-relay rejects in-flight HTTP 200 GET head if oc-logout fires before response resolves', async () => {
  const listeners = {};
  const { relayFactory } = loadCfRelay(listeners);
  let releaseFetch;
  const relay = relayFactory({
    livePollMs: 0,
    fetch: async (url) => {
      const u = new URL(url);
      if (u.pathname === '/ws/ticket') return new Response(JSON.stringify({ ok: true, token: 'tkt' }), { status: 200 });
      if (u.pathname.endsWith('/session')) return new Response(JSON.stringify({ ok: true, token: 'TOK-1', expiresAt: Date.now() + 600000 }), { status: 200 });
      if (u.pathname.endsWith('/head')) {
        await new Promise((r) => { releaseFetch = r; });
        return new Response(JSON.stringify({ ok: true, rev: 0, seq: 99 }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: false }), { status: 404 });
    },
    getCredentials: () => ({
      role: 'dueno',
      licenseCode: 'F123-SYNTHETIC01',
      instanceId: 'inst-1',
      authSuffix: '-priv',
      scopes: ['priv:read', 'priv:write'],
      credentials: { kind: 'owner', licenseCode: 'F123-SYNTHETIC01', instanceId: 'inst-1', pin: '123' }
    })
  });
  const url = `wss://friendly123-sync-relay.jfcarpio.workers.dev/sala/${'c'.repeat(40)}`;
  const p = relay.leerHead(url);
  await new Promise((r) => setTimeout(r, 25));
  assert.equal(typeof releaseFetch, 'function');
  (listeners['oc-logout'] || []).forEach((fn) => fn());
  releaseFetch();
  await assert.rejects(p, /session invalidated/, 'in-flight HTTP 200 resolving after oc-logout must reject as invalidated');
});

test('Review Critical #2: hechos.js abrirDB rejects instead of caching closed handle when onversionchange fires mid-migration', async () => {
  let releaseLegacyOpen;
  let newDbClosed = false;
  let openNewCount = 0;
  const env = loadHechosEnv({
    openImpl(name) {
      const req = { onupgradeneeded: null, onsuccess: null, onerror: null, onblocked: null };
      if (name === 'f123_hechos_db') {
        openNewCount++;
        const db = {
          name,
          objectStoreNames: { contains: (s) => s === 'hechos' },
          close() { newDbClosed = true; },
          onclose: null,
          onversionchange: null,
          transaction() {
            const tx = {
              oncomplete: null,
              objectStore: () => ({ count: () => { const r = { onsuccess: null, result: 0 }; queueMicrotask(() => r.onsuccess && r.onsuccess({ target: r })); return r; } })
            };
            return tx;
          }
        };
        queueMicrotask(() => {
          req.result = db;
          if (req.onsuccess) req.onsuccess({ target: req });
          if (openNewCount === 1) {
            setTimeout(() => { if (db.onversionchange) db.onversionchange(); }, 5);
          }
        });
      } else {
        // Legacy DB open waits until after onversionchange closes newDb
        new Promise((r) => { releaseLegacyOpen = r; }).then(() => {
          req.error = new Error('transient');
          if (req.onerror) req.onerror();
        });
      }
      return req;
    }
  });

  const p1 = env.hechos.contar();
  await new Promise((r) => setTimeout(r, 25));
  assert.equal(newDbClosed, true, 'onversionchange must close newDb');
  releaseLegacyOpen();
  await assert.rejects(p1, /cerrado durante migracion/,
    'abrirDB must reject instead of caching/returning closed handle');
});

// ---------------------------------------------------------------------------
// 5. REAL WEBKIT (SAFARI ENGINE) BROWSER VERIFICATION OF COMPILED app-inline-03.min.js
// ---------------------------------------------------------------------------
test('Splash P0 WebKit E2E: compiled docs/app-inline-03.min.js mounts and paints #f123-update-splash for 2 real rAFs before single reload', { timeout: 30000 }, async () => {
  const { webkit } = require('playwright');
  const http = require('node:http');
  const minSrc = fs.readFileSync(path.join(ROOT, 'docs/app-inline-03.min.js'), 'utf8');
  const start = minSrc.indexOf('(function(){if(!_ocActSolaOn');
  const end = minSrc.indexOf('window.addEventListener("oc-datos-importados"', start);
  assert.ok(start >= 0 && end > start, 'minified actualizacionSola IIFE must exist in docs/app-inline-03.min.js');
  const updaterMin = minSrc.slice(start, end).replace(/,$/, ';');

  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><html><body><div id="oc-gate" style="display:flex;width:320px;height:480px;">PIN</div><div id="oc-pad"></div></body></html>');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const browser = await webkit.launch({ headless: true });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    const result = await page.evaluate(async (code) => {
      localStorage.setItem('f123_version_vista', 'v0.9.24|f123-shell-v924');
      sessionStorage.setItem('f123_act_sola_pendiente', '1');
      let reloads = 0;
      let rafCount = 0;
      let splashVisibleAtReload = false;
      let splashTextAtReload = '';
      const origRaf = window.requestAnimationFrame.bind(window);
      window.requestAnimationFrame = (cb) => origRaf((ts) => { rafCount++; cb(ts); });
      const swListeners = {};
      Object.defineProperty(navigator, 'serviceWorker', {
        configurable: true,
        value: {
          controller: {
            postMessage() {
              const fn = swListeners.message;
              if (fn) fn({ data: { tipo: 'shell-actual', shell: 'f123-shell-v924' } });
            }
          },
          addEventListener(k, fn) { swListeners[k] = fn; },
          removeEventListener(k, fn) { if (swListeners[k] === fn) delete swListeners[k]; },
          getRegistration: async () => ({ update: async () => {} }),
          getRegistrations: async () => []
        }
      });
      const wrapped = `(function(location){ var _ocActSolaOn = true; function _recargarSeguroVersion(){} ${code} })`;
      const run = eval(wrapped);
      run({
        reload() {
          reloads++;
          const el = document.getElementById('f123-update-splash');
          splashVisibleAtReload = !!(el && el.isConnected && getComputedStyle(el).display === 'flex' && el.getClientRects().length > 0);
          splashTextAtReload = el ? el.textContent : '';
        }
      });

      // 1. Simulate hidden document -> MUST NOT reload
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
      const hiddenRes = await window._ocActSola.intentar();
      const hiddenReloads = reloads;

      // 2. Restore visible document -> MUST mount splash, wait >=2 real rAFs, reload once
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
      const visibleRes = await window._ocActSola.intentar();
      const afterFirstReloads = reloads;
      const secondRes = await window._ocActSola.intentar();

      return {
        hiddenRes,
        hiddenReloads,
        visibleRes,
        afterFirstReloads,
        secondRes,
        finalReloads: reloads,
        rafCount,
        splashVisibleAtReload,
        splashTextAtReload
      };
    }, updaterMin);

    assert.equal(result.hiddenRes, false, 'WebKit hidden tab must abort reload');
    assert.equal(result.hiddenReloads, 0);
    assert.equal(result.visibleRes, true, 'WebKit visible PIN screen must adopt update');
    assert.equal(result.afterFirstReloads, 1);
    assert.equal(result.secondRes, false, 'same shell must not loop');
    assert.equal(result.finalReloads, 1);
    assert.ok(result.rafCount >= 2, 'must wait at least 2 real WebKit rAF frames before reload, got ' + result.rafCount);
    assert.equal(result.splashVisibleAtReload, true, '#f123-update-splash must be visibly mounted at reload time');
    assert.match(result.splashTextAtReload, /Updating.*Actualizando la aplicación/);
  } finally {
    await browser.close();
    server.close();
  }
});
