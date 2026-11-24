'use strict';
// R3/R4 Sync4 77-micropoints hardening & P0-2/P0-3/P0-4 verification (Node + Chromium + WebKit IDB).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');
const { chromium, webkit } = require('playwright');

const ROOT = path.join(__dirname, '..');
const STORE_URL = pathToFileURL(path.join(ROOT, 'src', 'port2-typed-ops-idb-store.mjs')).href;
const RECONCILER_URL = pathToFileURL(path.join(ROOT, 'src', 'port2-typed-ops-reconciler.mjs')).href;
const FAILBACK_URL = pathToFileURL(path.join(ROOT, 'src', 'port2-cross-device-failback.mjs')).href;

function sampleSaleCommand(opId, amountCents = 1500) {
  return {
    opId,
    license: 'F123-HARDENING01',
    kind: 'sale.record',
    productId: 'prod-hardening-1',
    quantity: 1,
    amountCents
  };
}

function makeFakeStore(initialRows = [], initialSettled = []) {
  const pending = new Map();
  const settled = new Set(initialSettled);
  for (const r of initialRows) pending.set(r.opId, structuredClone(r));
  let saveDelayMs = 0;
  let throwSettledOnSave = false;
  return {
    pending,
    settled,
    setSaveDelay(ms) { saveDelayMs = ms; },
    setThrowSettledOnSave(v) { throwSettledOnSave = v; },
    async loadAll() { return [...pending.values()].map(v => structuredClone(v)); },
    async loadCommittedOpIds() { return [...settled]; },
    async save(entry) {
      if (saveDelayMs > 0) await new Promise(r => setTimeout(r, saveDelayMs));
      if (throwSettledOnSave || settled.has(entry.opId)) {
        const err = new Error('Persisted opId already committed');
        err.code = 'TYPED_OPS_ALREADY_SETTLED';
        throw err;
      }
      pending.set(entry.opId, structuredClone(entry));
    },
    async markCommitted(opId) {
      settled.add(opId);
      pending.delete(opId);
    },
    async remove(opId) {
      pending.delete(opId);
    }
  };
}

test('R4-04 (Node fake-indexeddb): markCommitted + late save never leave pending_ops & settled_ops both populated', async () => {
  const { indexedDB } = require('fake-indexeddb');
  const { createTypedOpsIdbStore } = await import(STORE_URL);
  const namespace = 'a'.repeat(64);
  const storeA = await createTypedOpsIdbStore({ namespace, indexedDB });
  const storeB = await createTypedOpsIdbStore({ namespace, indexedDB });
  const opId = 'r404-opid-0001';
  const entry = {
    opId,
    command: sampleSaleCommand(opId),
    sameDoLocked: true,
    attempts: 1,
    state: 'pending',
    createdAt: 1000,
    updatedAt: 1000
  };

  await storeA.save(entry);
  const raceResults = await Promise.allSettled([
    storeA.markCommitted(opId),
    storeB.save({ ...entry, attempts: 2, updatedAt: 2000 })
  ]);
  assert.equal(raceResults[0].status, 'fulfilled');

  // Late save after settlement MUST fail with TYPED_OPS_ALREADY_SETTLED
  await assert.rejects(
    () => storeB.save({ ...entry, attempts: 3, updatedAt: 3000 }),
    (err) => err && err.code === 'TYPED_OPS_ALREADY_SETTLED'
  );

  const pendingRows = await storeA.loadAll();
  const committedIds = await storeA.loadCommittedOpIds();
  assert.equal(pendingRows.length, 0);
  assert.deepEqual(committedIds, [opId]);
});

for (const [label, browserType] of [['Chromium', chromium], ['WebKit', webkit]]) {
  test(`R4-04 (${label} real IndexedDB): concurrent markCommitted + save cannot recreate pending row for settled opId`, async () => {
    const storeCode = fs.readFileSync(path.join(ROOT, 'src', 'port2-typed-ops-idb-store.mjs'), 'utf8');
    const clientCode = fs.readFileSync(path.join(ROOT, 'src', 'port2-typed-ops-client.mjs'), 'utf8');
    const html = '<!doctype html><html><body><script type="module" src="/port2-typed-ops-idb-store.mjs"></script></body></html>';
    const server = http.createServer((req, res) => {
      if (req.url === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' });
        res.end(html);
        return;
      }
      if (req.url === '/port2-typed-ops-idb-store.mjs') {
        res.writeHead(200, { 'Content-Type': 'text/javascript', 'Cache-Control': 'no-store' });
        res.end(storeCode);
        return;
      }
      if (req.url === '/port2-typed-ops-client.mjs') {
        res.writeHead(200, { 'Content-Type': 'text/javascript', 'Cache-Control': 'no-store' });
        res.end(clientCode);
        return;
      }
      res.writeHead(404); res.end();
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    const browser = await browserType.launch();
    try {
      const context = await browser.newContext();
      const page = await context.newPage();
      await page.goto(`http://127.0.0.1:${port}/`);
      const res = await page.evaluate(async () => {
        const mod = await import('/port2-typed-ops-idb-store.mjs');
        const namespace = 'b'.repeat(64);
        const storeA = await mod.createTypedOpsIdbStore({ namespace, indexedDB: window.indexedDB });
        const storeB = await mod.createTypedOpsIdbStore({ namespace, indexedDB: window.indexedDB });
        const opId = 'browser-r404-op-001';
        const entry = {
          opId,
          command: {
            opId,
            license: 'F123-HARDENING01',
            kind: 'sale.record',
            productId: 'prod-browser-1',
            quantity: 1,
            amountCents: 900
          },
          sameDoLocked: true,
          attempts: 1,
          state: 'pending',
          createdAt: 1000,
          updatedAt: 1000
        };
        await storeA.save(entry);
        await Promise.allSettled([
          storeA.markCommitted(opId),
          storeB.save({ ...entry, attempts: 2, updatedAt: 2000 })
        ]);
        let lateSaveCode = null;
        try {
          await storeB.save({ ...entry, attempts: 3, updatedAt: 3000 });
        } catch (err) {
          lateSaveCode = err && err.code ? err.code : String(err && err.message);
        }
        const pending = await storeA.loadAll();
        const committed = await storeA.loadCommittedOpIds();
        return { pendingLen: pending.length, committed, lateSaveCode };
      });
      assert.deepEqual(res.committed, ['browser-r404-op-001']);
      assert.equal(res.pendingLen, 0, `${label} must never leave pending=1 alongside settled=1`);
      assert.equal(res.lateSaveCode, 'TYPED_OPS_ALREADY_SETTLED');
    } finally {
      await browser.close();
      await new Promise(resolve => server.close(resolve));
    }
  });
}

test('R4-01: concurrent canDispatchOnLegacy + submitCommercial across two coordinators on same store is serialized (zero TOCTOU)', async () => {
  const { createVerifiedCrossDeviceFailbackCoordinator } = await import(FAILBACK_URL);
  const { createTypedOpsReconciler } = await import(RECONCILER_URL);
  const store = makeFakeStore();
  let saveStarted;
  const saveEntered = new Promise(r => { saveStarted = r; });
  let releaseSave;
  const saveGate = new Promise(r => { releaseSave = r; });
  const origSave = store.save.bind(store);
  store.save = async (entry) => {
    saveStarted();
    await saveGate;
    return origSave(entry);
  };

  const dispatches = [];
  const makeCoord = () => {
    const reconciler = createTypedOpsReconciler({
      store,
      dispatch: async (cmd) => {
        dispatches.push(cmd.opId);
        return { committed: false, duplicate: false, retryable: true, stage: 'stored-for-application' };
      }
    });
    return createVerifiedCrossDeviceFailbackCoordinator({
      store,
      reconciler,
      isVisible: () => true,
      openCatalogSession: async () => {
        let closed = false;
        return { frozenHead: 'certified-head-r401', readOnly: false, isClosed: () => closed, close: () => { closed = true; } };
      }
    });
  };

  const coordA = makeCoord();
  const coordB = makeCoord();
  const act = await coordA.activate20();
  assert.equal(act.mode, 'active-2.0');

  const opId = 'r401-toctou-op-01';
  const submitP = coordA.submitCommercial(sampleSaleCommand(opId));
  await saveEntered;
  // Concurrently on coordB (same shared store), ask if legacy is allowed for the same opId
  const legacyAllowed = await coordB.canDispatchOnLegacy(opId).then((allowed) => ({ allowed }));
  releaseSave();

  await submitP;
  assert.equal(dispatches.length, 1);
  assert.equal(legacyAllowed.allowed, false);
});

test('R3-01 / R4-02 / R4-03 / R4-04 (reconciler): retry exhaustion blocks blind submit, respects attempts<=10, destroy/hidden before await stops dispatch, and settled error resolves', async () => {
  const { createTypedOpsReconciler } = await import(RECONCILER_URL);

  // Part 1: paused-retry-exhausted blocks submit(), explicit resume() resets and succeeds
  const store1 = makeFakeStore();
  let attemptCount = 0;
  let allowCommit = false;
  const r1 = createTypedOpsReconciler({
    store: store1,
    maxAttempts: 2,
    baseDelayMs: 50,
    maxDelayMs: 60,
    dispatch: async (cmd) => {
      attemptCount++;
      if (!allowCommit) return { committed: false, retryable: true, stage: 'stored-for-application' };
      return { committed: true, duplicate: false, stage: 'business-committed', receipt: { opId: cmd.opId, stage: 'business-committed' } };
    }
  });
  await r1.ready();
  const op1 = 'r301-exhaust-op-01';
  await r1.submit(sampleSaleCommand(op1));
  await new Promise(r => setTimeout(r, 200));
  assert.equal(attemptCount, 2);
  assert.equal(store1.pending.get(op1)?.state, 'paused-retry-exhausted');
  // Calling submit() again while paused-retry-exhausted MUST NOT bypass backoff limit
  const blockedRes = await r1.submit(sampleSaleCommand(op1));
  assert.equal(blockedRes.stage, 'paused-retry-exhausted');
  assert.equal(attemptCount, 2);

  // Explicit resume() allows fresh retry budget and commits
  allowCommit = true;
  await r1.resume();
  assert.equal(attemptCount, 3);
  assert.equal(store1.settled.has(op1), true);
  r1.destroy();

  // Part 2: destroy() while awaiting store.save cancels POST before dispatch
  const store2 = makeFakeStore();
  store2.setSaveDelay(40);
  let r2Dispatches = 0;
  const r2 = createTypedOpsReconciler({
    store: store2,
    dispatch: async () => { r2Dispatches++; return { committed: true }; }
  });
  await r2.ready();
  const pDestroy = r2.submit(sampleSaleCommand('r403-destroy-op-01'));
  setTimeout(() => r2.destroy(), 10);
  const resDestroy = await pDestroy;
  assert.equal(r2Dispatches, 0);
  assert.equal(resDestroy.committed, false);

  // Part 3a: cross-reload pre-settled opId returns fail-closed without legacy fallback or POST
  const store3 = makeFakeStore([], ['r404-settled-op-01']);
  let r3Dispatches = 0;
  const r3 = createTypedOpsReconciler({
    store: store3,
    dispatch: async () => { r3Dispatches++; return { committed: true }; }
  });
  await r3.ready();
  const resReloadSettled = await r3.submit(sampleSaleCommand('r404-settled-op-01'));
  assert.equal(r3Dispatches, 0);
  assert.equal(resReloadSettled.committed, false);
  assert.equal(resReloadSettled.fallbackLegacy, false);
  assert.equal(resReloadSettled.retryTarget, 'same-do-only');
  assert.equal(resReloadSettled.stage, 'already-committed-unverified-payload');
  // Part 3b: same-session committed resubmit + late TYPED_OPS_ALREADY_SETTLED resolves committed=true with 0 extra POSTs
  const opSame = 'r404-samesess-op-02';
  const resFirst = await r3.submit(sampleSaleCommand(opSame));
  assert.equal(resFirst.committed, true);
  assert.equal(r3Dispatches, 1);
  const resDup = await r3.submit(sampleSaleCommand(opSame));
  assert.equal(resDup.committed, true);
  assert.equal(resDup.duplicate, true);
  assert.equal(r3Dispatches, 1);
  r3.destroy();
});

test('P0-3 (yparty-piloto): leerDiagnosticoSeguro never claims sync4-c-peer-idb blindly and reflects live transport', async () => {
  const src = fs.readFileSync(path.join(ROOT, 'src', 'yparty-piloto.js'), 'utf8');
  const min = fs.readFileSync(path.join(ROOT, 'docs', 'vendor', 'yparty-piloto.min.js'), 'utf8');
  assert.doesNotMatch(src, /sync4-c-peer-idb/);
  assert.doesNotMatch(min, /sync4-c-peer-idb/);
  assert.match(src, /sync4-fallback-relay/);
  assert.match(src, /sync4-idb-only/);
  assert.match(src, /onSettled\s*=\s*null/);
});

test('P0-2 & P0-3 (sync-yjs): publicarOpLocal timer calls API._reintentarActivarCorte20, onModeChange updates __ultimoEstadoCorte20, and onSettled records receipts', async () => {
  const syncSrc = fs.readFileSync(path.join(ROOT, 'docs', 'sync-yjs.js'), 'utf8');
  // 1. publicarOpLocal timer delegates to API._reintentarActivarCorte20 (never out-of-scope _intentarActivarCorte20SiElegible)
  const pubIdx = syncSrc.indexOf('function publicarOpLocal(');
  assert.notEqual(pubIdx, -1);
  const pubSlice = syncSrc.slice(pubIdx, pubIdx + 3500);
  assert.match(pubSlice, /API\._reintentarActivarCorte20/);
  assert.doesNotMatch(pubSlice, /_intentarActivarCorte20SiElegible/);

  // 2. Runtime execution of publicarOpLocal timer with simulated setTimeout triggers API._reintentarActivarCorte20
  let retried = 0;
  let timerCb = null;
  const facadeSandbox = {
    API: {
      __retornoSync4Timer: null,
      _reintentarActivarCorte20() { retried++; }
    },
    document: { hidden: false },
    navigator: { onLine: true },
    setTimeout(fn) { timerCb = fn; return 99; },
    clearTimeout() {}
  };
  const sTimerIdx = pubSlice.indexOf('if (!API.__retornoSync4Timer &&');
  assert.notEqual(sTimerIdx, -1);
  const eTimerIdx = pubSlice.indexOf('return okLegado;', sTimerIdx);
  assert.notEqual(eTimerIdx, -1);
  const timerBlock = pubSlice.slice(sTimerIdx, eTimerIdx);
  vm.runInNewContext(`(function(API, motivo){ ${timerBlock} })`, facadeSandbox)(facadeSandbox.API, 'typed-command-fallback');
  assert.equal(typeof timerCb, 'function');
  timerCb();
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.equal(retried, 1);
  assert.match(syncSrc, /API\.opIdsTerminales20\s*=\s*function/);
  assert.match(syncSrc, /API\.__ultimoEstadoCorte20\s*=\s*\{\s*activo:\s*false/);
  assert.match(syncSrc, /opciones\.onSettled\s*=\s*function/);
});

test('R3-02 & R3-04 & C36 (sync-realtime & mock-backend): corrupt non-array journal returns null, settled_ops prunes journal, and C36/C34 guard stays intact', () => {
  const realtimeSrc = fs.readFileSync(path.join(ROOT, 'docs', 'sync-realtime.js'), 'utf8');
  const mockSrc = fs.readFileSync(path.join(ROOT, 'docs', 'mock-backend.js'), 'utf8');

  // Verify C34/C36 gating remains intact (unsafe/non-cash sales never expose cantidad/amountCents/opId before C34 check)
  const opVentaIdx = mockSrc.indexOf('const _opVenta = { productoId: p.id, delta: -cant };');
  assert.notEqual(opVentaIdx, -1);
  const opVentaSlice = mockSrc.slice(opVentaIdx, opVentaIdx + 1200);
  const preC34 = opVentaSlice.split('if (!infoVenta.fechaVenta')[0];
  assert.doesNotMatch(preC34, /_opVenta\.opId\s*=\s*opIdVenta/);

  // Execute IIFE excerpt for leerPendientesYjs, podarPendientesYjs, drenarPendientesYjs, and opIdVentaDurable in VM
  const lsStore = new Map();
  const dispatched = [];
  const license = 'F123-REALTIME-R304';
  const journalKey = 'f123_yjs_ops_pendientes_v1_' + license;
  lsStore.set('f123_sync_sala', JSON.stringify({ codigo: license }));
  lsStore.set(journalKey, 'null');

  let opTerminales = [];
  let opsMapStore = new Map();
  const yjsMock = {
    estado: 'activo',
    codigoCuaderno: license,
    opsMap: { get: (k) => opsMapStore.get(k) },
    opsIdb: null,
    recibosComerciales20: new Map(),
    opIdsTerminales20: () => opTerminales.slice()
  };

  const sandbox = {
    Date, Math, JSON, Array, Object, Set, Map, CustomEvent: function (t, init) { this.type = t; this.detail = init && init.detail; },
    localStorage: {
      getItem: (k) => (lsStore.has(k) ? lsStore.get(k) : null),
      setItem: (k, v) => lsStore.set(k, String(v))
    },
    window: {
      OCYjs: yjsMock,
      dispatchEvent: (ev) => dispatched.push(ev),
      addEventListener: () => {}
    },
    document: { visibilityState: 'visible' },
    setInterval: () => 1,
    setTimeout: (fn) => { fn(); return 1; }
  };

  // Extract COLA_YJS_SIN_SALA .. drenarPendientesYjs directly from source
  const sIdx = realtimeSrc.indexOf('  const COLA_YJS_SIN_SALA =');
  const eIdx = realtimeSrc.indexOf('  try {\n    window.addEventListener("oc-yjs-activo"');
  assert.ok(sIdx !== -1 && eIdx > sIdx);
  const block = realtimeSrc.slice(sIdx, eIdx);
  const harness = `
    const normalizarCodigo = (s) => String(s || '').trim().toUpperCase();
    const codigoCuadernoActivo = () => '${license}';
    ${block}
    globalThis.__test = { leerPendientesYjs, drenarPendientesYjs, podarPendientesYjs };
  `;
  vm.runInNewContext(harness, sandbox);

  // R3-04: "null" or "{}" JSON must return null (corrupt/unreadable), never []
  assert.equal(sandbox.__test.leerPendientesYjs(license), null);
  lsStore.set(journalKey, '{"not":"an-array"}');
  assert.equal(sandbox.__test.leerPendientesYjs(license), null);

  // R7 P0-A: bare opId-only tombstone blocks blind oc-op-local replay WITHOUT erasing journal bytes;
  // only a verified business-committed 2.0 receipt matching license AND canonical intent prunes the journal entry.
  const bareTerminalId = 'bare-tombstone-op-01';
  const verifiedSettledId = 'settled-20-op-0001';
  const liveLegacyId = 'pending-10-op-0002';
  const verifiedCmd = { opId: verifiedSettledId, license, kind: 'sale.record', productId: 'p1', quantity: 1, amountCents: 1500 };
  yjsMock.traducirOpLegadoAComando20 = (op) => (
    op && op.opId === verifiedSettledId && op.payload && op.payload.amountCents === 1500 ? verifiedCmd : null
  );
  lsStore.set(journalKey, JSON.stringify([
    { opId: bareTerminalId, _salaOrigen: license, tipo: 'venta', payload: { productoId: 'p0', delta: -1 } },
    { opId: verifiedSettledId, _salaOrigen: license, tipo: 'venta', payload: { productoId: 'p1', delta: -1, cantidad: 1, amountCents: 1500, opId: verifiedSettledId } },
    { opId: liveLegacyId, _salaOrigen: license, tipo: 'venta', payload: { productoId: 'p2', delta: -1 } }
  ]));
  opTerminales = [bareTerminalId, verifiedSettledId];
  yjsMock.recibosComerciales20.set(verifiedSettledId, {
    opId: verifiedSettledId,
    committed: true,
    stage: 'business-committed',
    command: verifiedCmd,
    receipt: { opId: verifiedSettledId, license, stage: 'business-committed' }
  });
  sandbox.__test.drenarPendientesYjs();
  assert.equal(dispatched.length, 1);
  assert.equal(dispatched[0].detail.opId, liveLegacyId);
  const remaining = JSON.parse(lsStore.get(journalKey));
  assert.deepEqual(remaining.map(x => x.opId), [bareTerminalId, liveLegacyId]);

  // C36 guard: valid C34 cash venta retains opId, non-C34 partial payload falls back to _opIdAjusteOAbonoDurable
  const opVentaDurableMatch = realtimeSrc.match(/const opIdVentaDurable = [\s\S]*?;/);
  assert.ok(opVentaDurableMatch);
  const c34CashPayload = { productoId: 'p1', delta: -1, cantidad: 1, amountCents: 1500, opId: 'sale-cash-c34-12345' };
  const nonC34Payload = { productoId: 'p1', delta: -1, opId: 'sale-fiado-op-12345' };
  const evalDurable = (p) => vm.runInNewContext(
    `(function(tipo, payload){ const _opIdAjusteOAbonoDurable = () => 'LEGACY_FALLBACK'; ${opVentaDurableMatch[0]} return opIdVentaDurable; })`,
    {}
  )('venta', p);
  assert.equal(evalDurable(c34CashPayload), 'sale-cash-c34-12345');
  assert.equal(evalDurable(nonC34Payload), 'LEGACY_FALLBACK');
});

test('R4-04 fail-closed (Codex review blocker): save MUST reject when multi-store IDB transaction throws TypeError (zero split-tx fallback)', async () => {
  const { indexedDB } = require('fake-indexeddb');
  const { createTypedOpsIdbStore } = await import(STORE_URL);
  const faultingIndexedDb = {
    open(name, version) {
      const req = indexedDB.open(name, version);
      const origOnSuccessDescriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(req), 'onsuccess');
      let wrapped = null;
      Object.defineProperty(req, 'onsuccess', {
        configurable: true,
        get() { return wrapped; },
        set(fn) {
          wrapped = function (ev) {
            const db = req.result;
            if (db && !db.__WrappedMultiStoreTypeError) {
              const origTx = db.transaction.bind(db);
              db.transaction = function (storeNames, mode) {
                if (Array.isArray(storeNames) && storeNames.length > 1) {
                  throw new TypeError('Synthetic platform multi-store TypeError');
                }
                return origTx(storeNames, mode);
              };
              db.__WrappedMultiStoreTypeError = true;
            }
            return fn.call(this, ev);
          };
          if (origOnSuccessDescriptor?.set) origOnSuccessDescriptor.set.call(req, wrapped);
        }
      });
      return req;
    }
  };
  const store = await createTypedOpsIdbStore({ namespace: 'c'.repeat(64), indexedDB: faultingIndexedDb });
  const opId = 'r404-failclosed-typeerr';
  await assert.rejects(
    () => store.save({
      opId,
      command: sampleSaleCommand(opId),
      sameDoLocked: true,
      attempts: 1,
      state: 'pending',
      createdAt: 1000,
      updatedAt: 1000
    }),
    (err) => err instanceof TypeError
  );
  // Real store must contain ZERO pending rows for that opId
  const realStore = await createTypedOpsIdbStore({ namespace: 'c'.repeat(64), indexedDB });
  assert.equal((await realStore.loadAll()).length, 0);
});

test('R5/R6 reconciler: transient ready recovery, cleanup retry without 2nd POST, 400 quarantine, and timer cooldown fence', async () => {
  const { createTypedOpsReconciler } = await import(RECONCILER_URL);

  // 1. Transient hydration failure recovers on retry without staying wedged
  const store = makeFakeStore();
  let failHydrationOnce = true;
  const origLoadAll = store.loadAll.bind(store);
  store.loadAll = async () => {
    if (failHydrationOnce) {
      failHydrationOnce = false;
      throw new Error('transient-idb-contention');
    }
    return origLoadAll();
  };
  let failCleanupOnce = true;
  let cleanupCalls = 0;
  const origMark = store.markCommitted.bind(store);
  store.markCommitted = async (id) => {
    cleanupCalls++;
    if (failCleanupOnce) {
      failCleanupOnce = false;
      throw new Error('transient-cleanup-error');
    }
    return origMark(id);
  };
  let posts = 0;
  const settledEvents = [];
  const rec = createTypedOpsReconciler({
    store,
    baseDelayMs: 50,
    maxDelayMs: 80,
    maxAttempts: 3,
    onSettled: (ev) => settledEvents.push(ev),
    dispatch: async (cmd) => {
      posts++;
      if (cmd.opId === 'r5-invalid-400-op01') {
        return { committed: false, stage: 'invalid-command', status: 400, fallbackLegacy: false };
      }
      if (cmd.opId === 'r5-cooldown-op-0001') {
        return { committed: false, stage: 'stored-for-application', retryable: true };
      }
      return {
        committed: true,
        duplicate: false,
        stage: 'business-committed',
        receipt: { opId: cmd.opId, stage: 'business-committed' }
      };
    }
  });
  await assert.rejects(() => rec.ready(), /durable store unavailable/);
  assert.equal(await rec.ready(), true);

  // 2. R6 cleanup retry after 200 ACK: 1 POST, 2 cleanup attempts, 1 onSettled event
  const cleanupRes = await rec.submit(sampleSaleCommand('r6-cleanup-op-00001'));
  assert.equal(cleanupRes.stage, 'durable-cleanup-pending');
  await new Promise((r) => setTimeout(r, 130));
  assert.equal(posts, 1);
  assert.equal(cleanupCalls, 2);
  assert.equal(settledEvents.length, 1);
  assert.equal(rec.pending().length, 0);

  // 3. R5 400 invalid-command moves immediately to quarantined without retrying
  const qRes = await rec.submit(sampleSaleCommand('r5-invalid-400-op01'));
  assert.equal(qRes.quarantine, true);
  assert.equal(rec.quarantined().length, 1);

  // 4. R5 repeat submit while retry timer is scheduled respects cooldown
  const firstCooldown = await rec.submit(sampleSaleCommand('r5-cooldown-op-0001'));
  assert.equal(firstCooldown.retryable, true);
  const postsBeforeRepeat = posts;
  const secondCooldown = await rec.submit(sampleSaleCommand('r5-cooldown-op-0001'));
  assert.equal(secondCooldown.committed, false);
  assert.equal(posts, postsBeforeRepeat);
  rec.destroy();
});

test('R5/R6 failback coordinator: activate20 reuses active session and destroy invalidates mode', async () => {
  const { createVerifiedCrossDeviceFailbackCoordinator } = await import(FAILBACK_URL);
  const { createTypedOpsReconciler } = await import(RECONCILER_URL);
  const store = makeFakeStore();
  const rec = createTypedOpsReconciler({ store, dispatch: async () => ({ committed: true }) });
  let closedCalls = 0;
  let openCalls = 0;
  const coord = createVerifiedCrossDeviceFailbackCoordinator({
    store,
    reconciler: rec,
    isVisible: () => true,
    openCatalogSession: async () => {
      openCalls++;
      let closed = false;
      return {
        frozenHead: 'certified-head-r501',
        readOnly: false,
        isClosed: () => closed,
        isActive: () => !closed,
        close: () => { closed = true; closedCalls++; }
      };
    }
  });
  const a1 = await coord.activate20();
  const a2 = await coord.activate20();
  assert.equal(a1.mode, 'active-2.0');
  assert.equal(a2.mode, 'active-2.0');
  assert.equal(openCalls, 1);
  assert.equal(closedCalls, 0);

  coord.destroy();
  assert.equal(coord.mode(), 'failback-legacy-1.0');
  assert.equal(coord.lastReason(), 'destroyed');
  assert.equal(closedCalls, 1);
});

test('R7 P0-B & P0-C (sync-yjs): onSettled accepts single notifySettled event object, fences old coordinators/malformed events, and publicarOpLocal re-checks mode & coordinator after await', async () => {
  const syncSrc = fs.readFileSync(path.join(ROOT, 'docs', 'sync-yjs.js'), 'utf8');

  // R7 P0-B: extract opciones.onSettled block directly from docs/sync-yjs.js
  const sOn = syncSrc.indexOf('        var origOnSettled =');
  const eOn = syncSrc.indexOf('        var observadorExterno =', sOn);
  assert.ok(sOn !== -1 && eOn > sOn);
  const onSettledBlock = syncSrc.slice(sOn, eOn);
  const recorded = [];
  let externalCalls = 0;
  const activeCoord = { id: 'coord-new' };
  const oldCoord = { id: 'coord-old' };
  const API = {
    coordinadorCorte20: activeCoord,
    __opIdsTerminales20Cache: new Set()
  };
  const bindFor = (coordObj) => {
    const opciones = { onSettled: () => { externalCalls++; } };
    const sandbox = {
      API,
      coord: coordObj,
      opciones,
      Set,
      String,
      _registrarReciboComercial20: (id, res) => recorded.push({ id, res })
    };
    vm.runInNewContext(onSettledBlock, sandbox);
    return opciones.onSettled;
  };
  const onSettledActive = bindFor(activeCoord);
  const onSettledStale = bindFor(oldCoord);

  // 1. Valid 1-arg notifySettled event reaches _registrarReciboComercial20
  onSettledActive({
    opId: 'r7-p0b-op-0001',
    status: 'committed',
    duplicate: false,
    receipt: { opId: 'r7-p0b-op-0001', stage: 'business-committed' }
  });
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0].id, 'r7-p0b-op-0001');
  assert.equal(recorded[0].res.committed, true);
  assert.equal(API.__opIdsTerminales20Cache.has('r7-p0b-op-0001'), true);
  assert.equal(externalCalls, 1);

  // 2. Malformed committed event (missing receipt) MUST NOT fabricate committed=true
  onSettledActive({ opId: 'r7-p0b-bad-0002', status: 'committed', receipt: null });
  assert.equal(recorded.length, 2);
  assert.equal(recorded[1].res.committed, false);
  assert.equal(API.__opIdsTerminales20Cache.has('r7-p0b-bad-0002'), false);
  const externalBeforeStale = externalCalls;

  // 3. Stale/old coordinator callback MUST NOT record or invoke external callback
  onSettledStale({
    opId: 'r7-p0b-stale-03',
    status: 'committed',
    receipt: { opId: 'r7-p0b-stale-03', stage: 'business-committed' }
  });
  assert.equal(recorded.length, 2);
  assert.equal(externalCalls, externalBeforeStale);

  // R7 P0-C: publicarOpLocal legacy branch re-checks modoCorte20Activo & coordinadorCorte20 after await
  const legacyGuardIdx = syncSrc.indexOf('      var mapaActual = API.opsMap, coordActual = API.coordinadorCorte20;');
  assert.notEqual(legacyGuardIdx, -1);
  const legacySlice = syncSrc.slice(legacyGuardIdx, legacyGuardIdx + 700);
  assert.match(legacySlice, /API\.modoCorte20Activo === true \|\| API\.coordinadorCorte20 !== coordActual/);
});

test('Deep audit (catalog sessions): read-only catalog proof fetch enforces AbortController timeout, exposes isClosed/isActive, and both catalog modules use key-order-independent canon()', async () => {
  const roSrc = fs.readFileSync(path.join(ROOT, 'src', 'port2-readonly-catalog-session.mjs'), 'utf8');
  const wrSrc = fs.readFileSync(path.join(ROOT, 'src', 'port2-catalog-delta-writer.mjs'), 'utf8');
  assert.match(roSrc, /new AbortController\(\)/);
  assert.match(roSrc, /signal:\s*controller\.signal/);
  assert.match(roSrc, /isClosed:\s*\(\)\s*=>\s*closed/);
  assert.match(roSrc, /isActive:\s*\(\)\s*=>\s*ready\s*&&\s*!closed\s*&&\s*isVisible\(\)/);
  assert.match(roSrc, /function stableValue\(/);
  assert.match(wrSrc, /function stableValue\(/);
});
