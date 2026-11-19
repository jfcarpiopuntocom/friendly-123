'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.join(__dirname, '..');
const SOURCE_PATH = path.join(ROOT, 'src', 'yparty-piloto.js');
const BUNDLE_PATH = path.join(ROOT, 'docs', 'vendor', 'yparty-piloto.min.js');
const SYNC_YJS_PATH = path.join(ROOT, 'docs', 'sync-yjs.js');

const LICENSE = 'F123-SYNT-C16B';
const INSTANCE = 'synthetic-c16b-dev';
const ROOM = 'c'.repeat(32);

function makeAsyncDurableStore() {
  const map = new Map();
  let saveCalls = 0;
  let abortNext = false;
  return {
    setAbortNext(v) { abortNext = v; },
    getSaveCalls: () => saveCalls,
    dump: () => Array.from(map.values()),
    async loadAll() { return Array.from(map.values()).map(v => JSON.parse(JSON.stringify(v))); },
    async save(entry) {
      saveCalls++;
      if (abortNext) {
        abortNext = false;
        throw new Error('Synthetic durable IDB abort');
      }
      map.set(entry.opId, JSON.parse(JSON.stringify(entry)));
    },
    async remove(opId) { map.delete(opId); }
  };
}

async function computeReceiptId(cmd) {
  const canonical = {
    license: cmd.license,
    opId: cmd.opId,
    kind: cmd.kind,
    productId: cmd.productId,
    quantity: cmd.quantity,
    amountCents: cmd.amountCents
  };
  const bytes = new TextEncoder().encode(JSON.stringify(canonical));
  const hash = await crypto.webcrypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('').slice(0, 24);
}

function loadCompiledBundle({ role = 'dueno', ownerPin = '123', team = null, hidden = false } = {}) {
  const bundle = fs.readFileSync(BUNDLE_PATH, 'utf8');
  const listeners = { visibilitychange: [], pageshow: [] };
  const win = {
    Y: { Doc: class {} },
    OCAuth: { rolActual: () => role },
    OCSecure: {
      leerPinQueAbre: () => ({ owner: ownerPin, team })
    },
    addEventListener(type, fn) { if (listeners[type]) listeners[type].push(fn); },
    removeEventListener(type, fn) {
      if (!listeners[type]) return;
      const i = listeners[type].indexOf(fn);
      if (i >= 0) listeners[type].splice(i, 1);
    }
  };
  const doc = {
    hidden,
    addEventListener(type, fn) { if (listeners[type]) listeners[type].push(fn); },
    removeEventListener(type, fn) {
      if (!listeners[type]) return;
      const i = listeners[type].indexOf(fn);
      if (i >= 0) listeners[type].splice(i, 1);
    }
  };
  const ctx = {
    window: win,
    document: doc,
    localStorage: {
      getItem: (k) => k === 'f123_owned' ? JSON.stringify({ licenseCode: LICENSE, instanceId: INSTANCE }) : null
    },
    setTimeout,
    clearTimeout,
    AbortController,
    TextEncoder,
    TextDecoder,
    URL,
    URLSearchParams,
    Promise,
    Array,
    Uint8Array,
    ArrayBuffer,
    Math,
    Date,
    JSON,
    Object,
    Map,
    Set,
    Error,
    TypeError,
    RangeError,
    crypto: crypto.webcrypto,
    console: { warn() {}, error() {} },
    WebSocket: class { constructor() { throw new Error('must not open bare WebSocket'); } }
  };
  vm.runInNewContext(bundle, ctx, { filename: 'yparty-piloto.min.js' });
  const pilot = win.F123YPartyPilot(ROOM, LICENSE);
  return {
    pilot,
    listeners,
    setHidden(v) {
      doc.hidden = v;
      listeners.visibilitychange.slice().forEach(fn => fn());
    },
    fireBFCache() {
      listeners.pageshow.slice().forEach(fn => fn({ persisted: true }));
    }
  };
}

test('1. source and compiled docs/vendor/yparty-piloto.min.js export C16b typed dispatcher & C17b Team ticket methods', () => {
  const src = fs.readFileSync(SOURCE_PATH, 'utf8');
  const bundle = fs.readFileSync(BUNDLE_PATH, 'utf8');
  assert.match(src, /^import \{dispatchTypedCommercialCommand\} from '\.\/port2-typed-ops-client\.mjs';/m);
  assert.match(src, /^import \{createTypedOpsReconciler\} from '\.\/port2-typed-ops-reconciler\.mjs';/m);
  assert.match(src, /^import \{createTeamTicketParams\} from '\.\/ws-team-ticket-params\.mjs';/m);
  assert.match(src, /crearDespachadorComercialTipado\(/);
  assert.match(src, /solicitarTicketComercialEquipo\(/);
  assert.ok(bundle.includes('crearDespachadorComercialTipado'), 'compiled bundle must include crearDespachadorComercialTipado');
  assert.ok(bundle.includes('solicitarTicketComercialEquipo'), 'compiled bundle must include solicitarTicketComercialEquipo');
});

test('2. C16b compiled bundle rejects missing durable store (zero volatile RAM fallback)', () => {
  const { pilot } = loadCompiledBundle();
  assert.throws(() => pilot.crearDespachadorComercialTipado(), /durable store/i);
  assert.throws(() => pilot.crearDespachadorComercialTipado({}), /durable store/i);
});

test('3. C16b compiled bundle persists opId BEFORE HTTP, latches same-do-only on 202, and reconciles to 200 business-committed', async () => {
  const { pilot, listeners, setHidden, fireBFCache } = loadCompiledBundle();
  const store = makeAsyncDurableStore();
  let seq = 0;
  let postCount = 0;
  const cmd = {
    opId: 'c16b_bundle_sale_01',
    license: LICENSE,
    kind: 'sale.record',
    productId: 'sku_1',
    quantity: 1,
    amountCents: 1500
  };
  const receiptId = await computeReceiptId(cmd);

  const mockFetch = async (url, opts) => {
    const s = String(url);
    if (s === 'https://friendly123-licencias.jfcarpio.workers.dev/ws/ticket') {
      const req = JSON.parse(opts.body);
      assert.deepEqual(req.scopes, ['ops:sale']);
      assert.equal(req.room, ROOM + '-ops');
      return {
        ok: true,
        status: 200,
        async json() { return { ok: true, token: `c16btok${++seq}.sig`, expiresAt: Date.now() + 30_000 }; }
      };
    }
    assert.equal(s, 'https://friendly123-yparty-port2-canary-qa.jfcarpio.workers.dev/parties/tienda/' + ROOM + '-ops');
    postCount++;
    // Verify opId was persisted durably BEFORE HTTP POST went out
    assert.equal(store.dump().length, 1, 'opId must be persisted BEFORE HTTP POST');
    assert.equal(store.dump()[0].sameDoLocked, true);
    if (postCount === 1) {
      return {
        ok: true,
        status: 202,
        async json() {
          return {
            ok: true,
            duplicate: false,
            receipt: {
              stage: 'stored-for-application',
              license: LICENSE,
              opId: cmd.opId,
              kind: cmd.kind,
              receiptId,
              acceptedAt: Date.now()
            }
          };
        }
      };
    }
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          ok: true,
          duplicate: true,
          receipt: {
            stage: 'business-committed',
            license: LICENSE,
            opId: cmd.opId,
            kind: cmd.kind,
            receiptId,
            acceptedAt: Date.now()
          }
        };
      }
    };
  };

  const dispatcher = pilot.crearDespachadorComercialTipado({
    store,
    fetch: mockFetch,
    baseDelayMs: 5000,
    maxDelayMs: 10_000
  });

  const first = await dispatcher.submit(cmd);
  assert.equal(first.committed, false);
  assert.equal(first.fallbackLegacy, false, '202 must NEVER authorize legacy duplicate');
  assert.equal(first.reconcileRequired, true);
  assert.equal(first.retryTarget, 'same-do-only');
  assert.equal(postCount, 1);

  // Simulate Safari hide -> BFCache pageshow -> reconcile same opId cleanly
  setHidden(true);
  setHidden(false);
  fireBFCache();
  // Wait for async resume reconcile to settle
  await new Promise(r => setTimeout(r, 40));
  assert.equal(postCount, 2);
  assert.equal(store.dump().length, 0, 'committed opId must be removed from durable store');

  dispatcher.destroy();
  assert.equal(listeners.visibilitychange.length, 0, 'destroy must clean up visibilitychange listener');
  assert.equal(listeners.pageshow.length, 0, 'destroy must clean up pageshow listener');
});

test('4. C16b compiled bundle blocks HTTP when durable pre-send save aborts', async () => {
  const { pilot } = loadCompiledBundle();
  const store = makeAsyncDurableStore();
  store.setAbortNext(true);
  let netCalls = 0;
  const dispatcher = pilot.crearDespachadorComercialTipado({
    store,
    fetch: async () => { netCalls++; throw new Error('must not call network'); }
  });
  const res = await dispatcher.submit({
    opId: 'c16b_abort_sale_01',
    license: LICENSE,
    kind: 'sale.record',
    productId: 'sku_1',
    quantity: 1,
    amountCents: 1500
  });
  assert.equal(netCalls, 0);
  assert.equal(res.committed, false);
  dispatcher.destroy();
});

test('5. C17b compiled bundle mints one-use Team tickets (admin/empleado) and denies empleado ops:adjust, contador, raw rooms & hidden tab with ZERO network', async () => {
  let netCalls = 0;
  const mockFetch = async (url, opts) => {
    netCalls++;
    assert.equal(String(url), 'https://friendly123-licencias.jfcarpio.workers.dev/ws/ticket');
    const req = JSON.parse(opts.body);
    return {
      ok: true,
      status: 200,
      async json() {
        return { ok: true, token: `t${netCalls}.${req.credentials.role}`, expiresAt: Date.now() + 25_000 };
      }
    };
  };

  // Admin: ops:sale, ops:adjust, ops:payment, fotos:read
  const adminEnv = loadCompiledBundle({
    role: 'admin',
    team: { subject: 'admin_ana_01', pin: '321' }
  });
  const a1 = await adminEnv.pilot.solicitarTicketComercialEquipo('ops:adjust', { fetch: mockFetch });
  const a2 = await adminEnv.pilot.solicitarTicketComercialEquipo('fotos:read', { fetch: mockFetch });
  assert.equal(a1.licencia, LICENSE);
  assert.equal(a2.licencia, LICENSE);
  assert.equal(netCalls, 2);

  // Empleado: ops:sale & ops:payment OK; ops:adjust DENIED locally with 0 network
  const empEnv = loadCompiledBundle({
    role: 'empleado',
    team: { subject: 'emp_luis_02', pin: '654' }
  });
  const e1 = await empEnv.pilot.solicitarTicketComercialEquipo('ops:sale', { fetch: mockFetch });
  assert.equal(e1.licencia, LICENSE);
  assert.equal(netCalls, 3);
  await assert.rejects(
    empEnv.pilot.solicitarTicketComercialEquipo('ops:adjust', { fetch: mockFetch }),
    /WS authorization unavailable/
  );
  await assert.rejects(
    empEnv.pilot.solicitarTicketComercialEquipo('fotos:write', { fetch: mockFetch }),
    /WS authorization unavailable/
  );
  await assert.rejects(
    empEnv.pilot.solicitarTicketComercialEquipo('ops:read', { fetch: mockFetch }),
    /WS authorization unavailable/
  );
  assert.equal(netCalls, 3, 'forbidden empleado scopes must emit ZERO network');

  // Hidden tab & contador denied with 0 network
  const hiddenEnv = loadCompiledBundle({ role: 'empleado', team: { subject: 'emp_luis_02', pin: '654' }, hidden: true });
  await assert.rejects(hiddenEnv.pilot.solicitarTicketComercialEquipo('ops:sale', { fetch: mockFetch }), /WS authorization unavailable/);
  const contEnv = loadCompiledBundle({ role: 'contador', team: { subject: 'cnt_01', pin: '321' } });
  await assert.rejects(contEnv.pilot.solicitarTicketComercialEquipo('ops:sale', { fetch: mockFetch }), /WS authorization unavailable/);
  assert.equal(netCalls, 3);
});

test('6. docs/sync-yjs.js exposes opt-in C16b/C17b hooks behind QA pilot switch and keeps legacy default intact', () => {
  const syncSrc = fs.readFileSync(SYNC_YJS_PATH, 'utf8');
  assert.match(syncSrc, /API\.crearDespachadorComercialTipado\s*=/);
  assert.match(syncSrc, /API\.solicitarTicketComercialEquipo\s*=/);
  const rollout = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs', 'sync-rollout.json'), 'utf8'));
  assert.equal(rollout.allApproved, false, 'sync-rollout.json allApproved must remain false');
  assert.equal(
    Object.values(rollout.licenses || {}).some(entry => entry?.yparty === true),
    false,
    'no license may have yparty enabled in sync-rollout.json by default'
  );
});
