'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { IDBFactory } = require('fake-indexeddb');

const STORE_URL = pathToFileURL(path.resolve(__dirname, '../src/port2-typed-ops-idb-store.mjs')).href;
const RECONCILER_URL = pathToFileURL(path.resolve(__dirname, '../src/port2-typed-ops-reconciler.mjs')).href;
const FAILBACK_URL = pathToFileURL(path.resolve(__dirname, '../src/port2-cross-device-failback.mjs')).href;

const NS = 'a'.repeat(64);
const LICENSE = 'F123-SYNT-C21FAILBK';
const HEAD = 'certified-c21a-head-20261119';

function makeSaleCommand(opId, amountCents = 1500) {
  return {
    license: LICENSE,
    opId,
    kind: 'sale.record',
    productId: 'sku_1',
    quantity: 1,
    amountCents
  };
}

async function createHarness({
  catalogFail = false,
  readOnlyCatalog = false,
  hidden = false,
  dispatchImpl = null
} = {}) {
  const { createTypedOpsIdbStore } = await import(STORE_URL);
  const { createTypedOpsReconciler } = await import(RECONCILER_URL);
  const { createVerifiedCrossDeviceFailbackCoordinator } = await import(FAILBACK_URL);

  const indexedDB = new IDBFactory();
  const store = createTypedOpsIdbStore({ indexedDB, namespace: NS });
  let isTabVisible = !hidden;
  const dispatched = [];

  const defaultDispatch = async (cmd) => {
    dispatched.push(cmd);
    return {
      committed: true,
      duplicate: false,
      fallbackLegacy: false,
      reconcileRequired: false,
      quarantine: false,
      retryable: false,
      retryTarget: null,
      stage: 'business-committed',
      status: 200,
      receipt: {
        opId: cmd.opId,
        license: cmd.license,
        kind: cmd.kind,
        stage: 'business-committed',
        receiptId: 'a'.repeat(24),
        acceptedAt: Date.now()
      }
    };
  };

  let currentDispatch = dispatchImpl || defaultDispatch;
  const makeReconciler = (customStore = store) =>
    createTypedOpsReconciler({
      store: customStore,
      isVisible: () => isTabVisible,
      baseDelayMs: 50,
      maxDelayMs: 200,
      schedule: () => 1,
      cancelSchedule: () => {},
      dispatch: (cmd) => currentDispatch(cmd)
    });

  const reconciler = makeReconciler();
  const catalogSessions = [];

  const openCatalogSession = async ({ onWriterConflict }) => {
    if (catalogFail) throw new Error('certified catalog unavailable');
    let closed = false;
    let active = true;
    const deltas = [];
    const session = {
      frozenHead: HEAD,
      readOnly: readOnlyCatalog,
      deltas,
      isClosed: () => closed,
      isActive: () => active && !closed,
      applyDelta(d) {
        if (closed || !active || readOnlyCatalog) throw new Error('catalog writer inactive');
        deltas.push(d);
        return { ok: true, kind: d.kind, id: d.product?.id || d.shelf?.id || d.id, byteLength: 64 };
      },
      triggerConflict() {
        active = false;
        closed = true;
        onWriterConflict?.({ reason: 'Catalog writer already active' });
      },
      close() {
        closed = true;
        active = false;
      }
    };
    catalogSessions.push(session);
    return session;
  };

  const coordinator = createVerifiedCrossDeviceFailbackCoordinator({
    store,
    reconciler,
    openCatalogSession,
    isVisible: () => isTabVisible
  });

  return {
    indexedDB,
    store,
    reconciler,
    coordinator,
    catalogSessions,
    dispatched,
    setVisible(v) { isTabVisible = v; },
    setDispatch(fn) { currentDispatch = fn; },
    makeReconciler,
    createTypedOpsIdbStore,
    createVerifiedCrossDeviceFailbackCoordinator
  };
}

test('1. C21a activate20 requires durable IDB ready + certified catalog session; failure falls back cleanly to legacy-1.0', async () => {
  const hFail = await createHarness({ catalogFail: true });
  const rFail = await hFail.coordinator.activate20();
  assert.equal(rFail.ok, false);
  assert.equal(hFail.coordinator.mode(), 'failback-legacy-1.0');

  const hHidden = await createHarness({ hidden: true });
  const rHidden = await hHidden.coordinator.activate20();
  assert.equal(rHidden.ok, false);
  assert.equal(hHidden.catalogSessions.length, 0, 'hidden tab must not open catalog session');

  const hOk = await createHarness();
  const rOk = await hOk.coordinator.activate20();
  assert.equal(rOk.ok, true);
  assert.equal(rOk.frozenHead, HEAD);
  assert.equal(hOk.coordinator.mode(), 'active-2.0');
  hOk.coordinator.destroy();
});

test('2. C21a in-flight 202/timeout opId is irreversibly latched same-do-only and BLOCKED from legacy 1.0 across failback', async () => {
  const h = await createHarness({
    dispatchImpl: async (cmd) => ({
      committed: false,
      duplicate: false,
      fallbackLegacy: false,
      reconcileRequired: true,
      quarantine: false,
      retryable: true,
      retryTarget: 'same-do-only',
      stage: 'stored-for-application',
      status: 202,
      receipt: null
    })
  });
  await h.coordinator.activate20();

  const out = await h.coordinator.submitCommercial(makeSaleCommand('op_latched_202_01', 2500));
  assert.equal(out.committed, false);
  assert.equal(out.reconcileRequired, true);
  assert.equal(out.retryTarget, 'same-do-only');
  assert.equal(out.fallbackLegacy, false);

  // Even AFTER failing back to legacy 1.0, op_latched_202_01 MUST NEVER be allowed on legacy 1.0!
  await h.coordinator.failbackToLegacy('network-degraded');
  assert.equal(h.coordinator.mode(), 'failback-legacy-1.0');
  assert.equal(h.catalogSessions[0].isClosed(), true, 'failback must immediately release -cat lock for other devices');

  assert.equal(await h.coordinator.isLatchedToSameDo('op_latched_202_01'), true);
  assert.equal(await h.coordinator.canDispatchOnLegacy('op_latched_202_01'), false);
  await assert.rejects(
    h.coordinator.assertLegacyAllowed('op_latched_202_01'),
    err => err && err.code === 'latched-same-do-only'
  );

  // A brand-new opId created AFTER failback (never touched 2.0 IDB) IS allowed on legacy 1.0
  assert.equal(await h.coordinator.canDispatchOnLegacy('op_fresh_legacy_99'), true);
  assert.deepEqual(await h.coordinator.assertLegacyAllowed('op_fresh_legacy_99'), {
    allowed: true,
    opId: 'op_fresh_legacy_99'
  });
  h.coordinator.destroy();
});

test('3. C21a pre-send denial (never touched DO, removed from IDB) permits clean legacy 1.0 fallback', async () => {
  const h = await createHarness({
    dispatchImpl: async () => ({
      committed: false,
      duplicate: false,
      fallbackLegacy: true,
      reconcileRequired: false,
      quarantine: false,
      retryable: false,
      retryTarget: null,
      stage: 'ticket-unavailable',
      status: 0,
      receipt: null
    })
  });
  await h.coordinator.activate20();

  const out = await h.coordinator.submitCommercial(makeSaleCommand('op_presend_denied_01', 1500));
  assert.equal(out.fallbackLegacy, true);
  assert.equal(await h.coordinator.isLatchedToSameDo('op_presend_denied_01'), false);
  assert.equal(await h.coordinator.canDispatchOnLegacy('op_presend_denied_01'), true);
  h.coordinator.destroy();
});

test('4. C21a drainLatchedSameDo reconciles pending 2.0 opIds against SAME DO even in failback-legacy-1.0 and across reload', async () => {
  let shouldCommit = false;
  const h = await createHarness({
    dispatchImpl: async (cmd) => {
      if (!shouldCommit) {
        return {
          committed: false,
          fallbackLegacy: false,
          reconcileRequired: true,
          retryable: true,
          retryTarget: 'same-do-only',
          stage: 'commit-unverified',
          status: 503
        };
      }
      return {
        committed: true,
        duplicate: true,
        fallbackLegacy: false,
        reconcileRequired: false,
        stage: 'business-committed',
        status: 200,
        receipt: {
          opId: cmd.opId,
          license: cmd.license,
          kind: cmd.kind,
          stage: 'business-committed',
          receiptId: 'b'.repeat(24),
          acceptedAt: Date.now()
        }
      };
    }
  });
  await h.coordinator.activate20();
  await h.coordinator.submitCommercial(makeSaleCommand('op_reload_drain_01', 3200));
  await h.coordinator.failbackToLegacy('offline-switch');
  h.coordinator.destroy();

  // Simulate cold browser reload sharing the same IndexedDB
  const reloadedReconciler = h.makeReconciler(h.store);
  const reloadedCoordinator = h.createVerifiedCrossDeviceFailbackCoordinator({
    store: h.store,
    reconciler: reloadedReconciler,
    openCatalogSession: async () => { throw new Error('still on legacy 1.0'); },
    isVisible: () => true
  });

  // Before draining, reloaded coordinator knows op_reload_drain_01 is latched in IDB!
  assert.equal(await reloadedCoordinator.isLatchedToSameDo('op_reload_drain_01'), true);
  assert.equal(await reloadedCoordinator.canDispatchOnLegacy('op_reload_drain_01'), false);

  // Now network to -ops DO recovers: drainLatchedSameDo commits it to the SAME DO
  shouldCommit = true;
  const drained = await reloadedCoordinator.drainLatchedSameDo();
  assert.equal(drained.attempted, 1);
  assert.equal(drained.results[0].committed, true);
  assert.deepEqual(await h.store.loadAll(), []);

  // Even after commit & IDB cleanup, op_reload_drain_01 stays forbidden on legacy 1.0 in this coordinator
  assert.equal(await reloadedCoordinator.canDispatchOnLegacy('op_reload_drain_01'), false);
  reloadedCoordinator.destroy();
});

test('5. C21a quarantined 409 opId stays permanently blocked from legacy 1.0', async () => {
  const h = await createHarness({
    dispatchImpl: async () => ({
      committed: false,
      fallbackLegacy: false,
      reconcileRequired: false,
      quarantine: true,
      retryable: false,
      retryTarget: null,
      stage: 'conflict-quarantine',
      status: 409
    })
  });
  await h.coordinator.activate20();
  const out = await h.coordinator.submitCommercial(makeSaleCommand('op_quarantine_409', 1500));
  assert.equal(out.quarantine, true);
  await h.coordinator.failbackToLegacy('quarantine-test');

  assert.equal(await h.coordinator.isLatchedToSameDo('op_quarantine_409'), true);
  assert.equal(await h.coordinator.canDispatchOnLegacy('op_quarantine_409'), false);
  await assert.rejects(h.coordinator.assertLegacyAllowed('op_quarantine_409'), /latched-same-do-only/);
  h.coordinator.destroy();
});

test('6. C21a runtime C10 writer conflict automatically fails back -cat while keeping same-do-only fence', async () => {
  const h = await createHarness();
  await h.coordinator.activate20();

  const d1 = h.coordinator.applyCatalogDelta({
    kind: 'product.upsert',
    product: { id: 'p-1', nombre: 'Prod 1', precio: 10, stockActual: 3 }
  });
  assert.equal(d1.ok, true);

  // Simulate another device taking over or C10 conflict
  h.catalogSessions[0].triggerConflict();
  assert.equal(h.coordinator.mode(), 'failback-legacy-1.0');
  assert.equal(h.catalogSessions[0].isClosed(), true);
  assert.throws(
    () => h.coordinator.applyCatalogDelta({ kind: 'product.delete', id: 'p-1' }),
    /not in active-2.0|inactive/i
  );
  h.coordinator.destroy();
});

test('7. C21a unreadable/corrupted durable store fails closed on legacy check (never silently authorizes duplicate sale)', async () => {
  const { createVerifiedCrossDeviceFailbackCoordinator } = await import(FAILBACK_URL);
  const brokenStore = {
    loadAll: async () => { throw new Error('corrupted IDB'); },
    save: async () => { throw new Error('corrupted IDB'); },
    remove: async () => { throw new Error('corrupted IDB'); }
  };
  const fakeReconciler = {
    ready: async () => { throw new Error('durable store unavailable'); },
    submit: async () => ({ committed: false, stage: 'durable-store-unavailable', fallbackLegacy: false }),
    reconcileNow: async () => ({ attempted: 0, results: [] }),
    pause() {},
    resume: async () => ({ attempted: 0, results: [] }),
    pending: () => [],
    quarantined: () => [],
    destroy() {}
  };
  const coord = createVerifiedCrossDeviceFailbackCoordinator({
    store: brokenStore,
    reconciler: fakeReconciler,
    openCatalogSession: async () => ({ frozenHead: HEAD, readOnly: true, close() {} })
  });
  assert.equal(await coord.canDispatchOnLegacy('op_any_12345678'), false);
  await assert.rejects(coord.assertLegacyAllowed('op_any_12345678'), /durable-store-unavailable/);
  coord.destroy();
});
