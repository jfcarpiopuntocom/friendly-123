'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const MODULE_URL = pathToFileURL(
  path.join(__dirname, '..', 'src', 'port2-typed-ops-reconciler.mjs')
).href;

function makeStore(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    loadAll: () => Array.from(map.values()).map(v => JSON.parse(JSON.stringify(v))),
    save: (entry) => { map.set(entry.opId, JSON.parse(JSON.stringify(entry))); },
    remove: (opId) => { map.delete(opId); },
    dump: () => Array.from(map.values())
  };
}

function makeClock() {
  let t = 1_700_000_000_000;
  let nextId = 1;
  const timers = new Map();
  return {
    now: () => t,
    schedule: (fn, ms) => {
      const id = nextId++;
      timers.set(id, { fn, at: t + ms, ms });
      return id;
    },
    cancelSchedule: (id) => { timers.delete(id); },
    pendingDelays: () => Array.from(timers.values()).map(x => x.ms),
    activeCount: () => timers.size,
    async fireNext() {
      const entries = Array.from(timers.entries()).sort((a, b) => a[1].at - b[1].at);
      if (!entries.length) return false;
      const [id, entry] = entries[0];
      timers.delete(id);
      t = entry.at;
      await entry.fn();
      return true;
    }
  };
}

function sampleSale(opId = 'sale_op_00000001') {
  return {
    opId,
    license: 'F123-SYNTH-QA-01',
    kind: 'sale.record',
    productId: 'prod-1',
    quantity: 2,
    amountCents: 1500
  };
}

test('1. pre-send failure on first attempt allows clean legacy fallback without enqueueing', async () => {
  const { createTypedOpsReconciler } = await import(MODULE_URL);
  const store = makeStore();
  const clock = makeClock();
  const rec = createTypedOpsReconciler({
    store,
    now: clock.now,
    schedule: clock.schedule,
    cancelSchedule: clock.cancelSchedule,
    isVisible: () => true,
    dispatch: async () => ({
      committed: false,
      stage: 'precondition-denied',
      fallbackLegacy: true,
      reconcileRequired: false,
      retryTarget: null
    })
  });

  const res = await rec.submit(sampleSale());
  assert.equal(res.committed, false);
  assert.equal(res.fallbackLegacy, true);
  assert.equal(res.reconcileRequired, false);
  assert.equal(store.dump().length, 0);
  assert.equal(clock.activeCount(), 0);
});

test('2. immediate 200 business-committed resolves without queueing or retry', async () => {
  const { createTypedOpsReconciler } = await import(MODULE_URL);
  const store = makeStore();
  const clock = makeClock();
  const receipt = { opId: 'sale_op_00000002', receiptId: 'a'.repeat(24), stage: 'business-committed' };
  const rec = createTypedOpsReconciler({
    store,
    now: clock.now,
    schedule: clock.schedule,
    cancelSchedule: clock.cancelSchedule,
    isVisible: () => true,
    dispatch: async () => ({
      committed: true,
      duplicate: false,
      stage: 'business-committed',
      fallbackLegacy: false,
      reconcileRequired: false,
      receipt
    })
  });

  const res = await rec.submit(sampleSale('sale_op_00000002'));
  assert.equal(res.committed, true);
  assert.equal(res.fallbackLegacy, false);
  assert.equal(res.receipt.receiptId, receipt.receiptId);
  assert.equal(store.dump().length, 0);
  assert.equal(clock.activeCount(), 0);
});

test('3. 202 queued / timeout latches same-do-only and reconciles to duplicate=true business-committed without legacy fallback', async () => {
  const { createTypedOpsReconciler } = await import(MODULE_URL);
  const store = makeStore();
  const clock = makeClock();
  const calls = [];
  const responses = [
    { committed: false, stage: 'queued-not-committed', fallbackLegacy: false, reconcileRequired: true, retryable: true, retryTarget: 'same-do-only', status: 202 },
    { committed: false, stage: 'commit-unverified', fallbackLegacy: false, reconcileRequired: true, retryable: true, retryTarget: 'same-do-only', status: 0 },
    { committed: true, duplicate: true, stage: 'business-committed', fallbackLegacy: false, reconcileRequired: false, status: 200, receipt: { opId: 'sale_op_00000003', receiptId: 'b'.repeat(24), stage: 'business-committed' } }
  ];
  const settled = [];
  const rec = createTypedOpsReconciler({
    store,
    now: clock.now,
    schedule: clock.schedule,
    cancelSchedule: clock.cancelSchedule,
    isVisible: () => true,
    baseDelayMs: 500,
    maxDelayMs: 5000,
    maxAttempts: 5,
    onSettled: (ev) => settled.push(ev),
    dispatch: async (cmd) => {
      calls.push(cmd);
      return responses[calls.length - 1];
    }
  });

  const first = await rec.submit(sampleSale('sale_op_00000003'));
  assert.equal(first.committed, false);
  assert.equal(first.fallbackLegacy, false);
  assert.equal(first.reconcileRequired, true);
  assert.equal(first.retryTarget, 'same-do-only');
  assert.equal(store.dump().length, 1);
  assert.equal(store.dump()[0].sameDoLocked, true);
  assert.deepEqual(clock.pendingDelays(), [500]);

  await clock.fireNext();
  assert.equal(calls.length, 2);
  assert.equal(store.dump().length, 1);
  assert.deepEqual(clock.pendingDelays(), [1000]);

  await clock.fireNext();
  assert.equal(calls.length, 3);
  assert.equal(store.dump().length, 0);
  assert.equal(clock.activeCount(), 0);
  assert.equal(settled.length, 1);
  assert.equal(settled[0].status, 'committed');
  assert.equal(settled[0].duplicate, true);
  assert.equal(calls[0].opId, calls[2].opId);
});

test('4. once same-do-only latched, a subsequent auth-denied or precondition-denied NEVER authorizes legacy fallback', async () => {
  const { createTypedOpsReconciler } = await import(MODULE_URL);
  const store = makeStore();
  const clock = makeClock();
  let attempt = 0;
  const rec = createTypedOpsReconciler({
    store,
    now: clock.now,
    schedule: clock.schedule,
    cancelSchedule: clock.cancelSchedule,
    isVisible: () => true,
    baseDelayMs: 500,
    dispatch: async () => {
      attempt++;
      if (attempt === 1) {
        return { committed: false, stage: 'commit-unverified', fallbackLegacy: false, reconcileRequired: true, retryable: true, retryTarget: 'same-do-only' };
      }
      return { committed: false, stage: 'auth-denied', fallbackLegacy: true, reconcileRequired: false, retryable: false, status: 401 };
    }
  });

  await rec.submit(sampleSale('sale_op_00000004'));
  const retryResult = await rec.reconcileNow();
  assert.equal(retryResult.results[0].fallbackLegacy, false);
  assert.equal(retryResult.results[0].reconcileRequired, true);
  assert.equal(retryResult.results[0].retryTarget, 'same-do-only');
  assert.equal(retryResult.results[0].stage, 'paused-auth-required');
  assert.equal(store.dump().length, 1);
  assert.equal(store.dump()[0].sameDoLocked, true);
  assert.equal(clock.activeCount(), 0, 'paused on auth-required must not burn retry loops');
});

test('5. HTTP 409 quarantine moves entry to terminal quarantine with no retry and no legacy fallback', async () => {
  const { createTypedOpsReconciler } = await import(MODULE_URL);
  const store = makeStore();
  const clock = makeClock();
  const quarantined = [];
  const rec = createTypedOpsReconciler({
    store,
    now: clock.now,
    schedule: clock.schedule,
    cancelSchedule: clock.cancelSchedule,
    isVisible: () => true,
    onSettled: (ev) => quarantined.push(ev),
    dispatch: async () => ({
      committed: false,
      stage: 'conflict-quarantine',
      fallbackLegacy: false,
      quarantine: true,
      retryable: false,
      status: 409
    })
  });

  const res = await rec.submit(sampleSale('sale_op_00000005'));
  assert.equal(res.quarantine, true);
  assert.equal(res.fallbackLegacy, false);
  assert.equal(clock.activeCount(), 0);
  assert.equal(store.dump().length, 1);
  assert.equal(store.dump()[0].state, 'quarantined');
  assert.equal(quarantined[0].status, 'quarantined');

  // Reconcile must never resend quarantined entries
  const again = await rec.reconcileNow();
  assert.equal(again.attempted, 0);
});

test('6. single-flight per opId prevents duplicate concurrent POSTs and rejects payload mismatch', async () => {
  const { createTypedOpsReconciler } = await import(MODULE_URL);
  const store = makeStore();
  const clock = makeClock();
  let release;
  let calls = 0;
  const rec = createTypedOpsReconciler({
    store,
    now: clock.now,
    schedule: clock.schedule,
    cancelSchedule: clock.cancelSchedule,
    isVisible: () => true,
    dispatch: () => {
      calls++;
      return new Promise((resolve) => {
        release = () => resolve({
          committed: true,
          duplicate: false,
          stage: 'business-committed',
          fallbackLegacy: false,
          receipt: { opId: 'sale_op_00000006', receiptId: 'c'.repeat(24), stage: 'business-committed' }
        });
      });
    }
  });

  const p1 = rec.submit(sampleSale('sale_op_00000006'));
  const p2 = rec.submit(sampleSale('sale_op_00000006'));
  const bad = await rec.submit({ ...sampleSale('sale_op_00000006'), amountCents: 9999 });
  assert.equal(bad.stage, 'opid-payload-mismatch');
  assert.equal(bad.fallbackLegacy, false);

  release();
  const [r1, r2] = await Promise.all([p1, p2]);
  assert.equal(calls, 1, 'same opId must remain strictly single-flight');
  assert.equal(r1.committed, true);
  assert.equal(r2.committed, true);
});

test('7. maxAttempts bounds retries strictly (zero runaway request storms) and persists paused state', async () => {
  const { createTypedOpsReconciler } = await import(MODULE_URL);
  const store = makeStore();
  const clock = makeClock();
  let calls = 0;
  const rec = createTypedOpsReconciler({
    store,
    now: clock.now,
    schedule: clock.schedule,
    cancelSchedule: clock.cancelSchedule,
    isVisible: () => true,
    maxAttempts: 3,
    baseDelayMs: 400,
    maxDelayMs: 1000,
    dispatch: async () => {
      calls++;
      return { committed: false, stage: 'commit-unverified', fallbackLegacy: false, reconcileRequired: true, retryable: true, retryTarget: 'same-do-only', status: 503 };
    }
  });

  await rec.submit(sampleSale('sale_op_00000007'));
  assert.equal(calls, 1);
  assert.deepEqual(clock.pendingDelays(), [400]);

  await clock.fireNext();
  assert.equal(calls, 2);
  assert.deepEqual(clock.pendingDelays(), [800]);

  await clock.fireNext();
  assert.equal(calls, 3);
  assert.equal(clock.activeCount(), 0, 'must stop scheduling after maxAttempts');
  assert.equal(store.dump()[0].state, 'paused-retry-exhausted');
  assert.equal(store.dump()[0].sameDoLocked, true);
});

test('8. hidden/BFCache pause cancels timers without dropping queue and resume reconciles on return', async () => {
  const { createTypedOpsReconciler } = await import(MODULE_URL);
  const store = makeStore();
  const clock = makeClock();
  let visible = true;
  let calls = 0;
  const rec = createTypedOpsReconciler({
    store,
    now: clock.now,
    schedule: clock.schedule,
    cancelSchedule: clock.cancelSchedule,
    isVisible: () => visible,
    baseDelayMs: 500,
    dispatch: async () => {
      calls++;
      if (calls === 1) {
        return { committed: false, stage: 'queued-not-committed', fallbackLegacy: false, reconcileRequired: true, retryable: true, retryTarget: 'same-do-only', status: 202 };
      }
      return { committed: true, duplicate: false, stage: 'business-committed', fallbackLegacy: false, receipt: { opId: 'sale_op_00000008', receiptId: 'd'.repeat(24), stage: 'business-committed' } };
    }
  });

  await rec.submit(sampleSale('sale_op_00000008'));
  assert.equal(clock.activeCount(), 1);
  visible = false;
  rec.pause();
  assert.equal(clock.activeCount(), 0, 'pause cancels active retry timers');
  assert.equal(store.dump().length, 1, 'queue preserved across pause');

  const whileHidden = await rec.reconcileNow();
  assert.equal(whileHidden.attempted, 0, 'never dispatches network while hidden');

  visible = true;
  await rec.resume();
  assert.equal(calls, 2);
  assert.equal(store.dump().length, 0);
});

test('9. persisted same-do-only entries survive page reload and never store PIN/token secrets', async () => {
  const { createTypedOpsReconciler } = await import(MODULE_URL);
  const store = makeStore();
  const clock = makeClock();
  const rec1 = createTypedOpsReconciler({
    store,
    now: clock.now,
    schedule: clock.schedule,
    cancelSchedule: clock.cancelSchedule,
    isVisible: () => true,
    dispatch: async () => ({
      committed: false,
      stage: 'commit-unverified',
      fallbackLegacy: false,
      reconcileRequired: true,
      retryable: true,
      retryTarget: 'same-do-only'
    })
  });
  await rec1.submit(sampleSale('sale_op_00000009'));
  const rawJson = JSON.stringify(store.dump());
  assert.doesNotMatch(rawJson, /pin|bearer|token|cap/i);

  // Fresh reconciler instance simulating full browser reload
  let reloadedCalls = 0;
  const rec2 = createTypedOpsReconciler({
    store,
    now: clock.now,
    schedule: clock.schedule,
    cancelSchedule: clock.cancelSchedule,
    isVisible: () => true,
    dispatch: async (cmd) => {
      reloadedCalls++;
      assert.equal(cmd.opId, 'sale_op_00000009');
      return { committed: true, duplicate: true, stage: 'business-committed', fallbackLegacy: false, receipt: { opId: cmd.opId, receiptId: 'e'.repeat(24), stage: 'business-committed' } };
    }
  });
  assert.equal(rec2.pending().length, 1);
  await rec2.reconcileNow();
  assert.equal(reloadedCalls, 1);
  assert.equal(rec2.pending().length, 0);
  assert.equal(store.dump().length, 0);
});

test('10. bounded queue capacity (maxPending) fails closed without dropping existing pending opIds', async () => {
  const { createTypedOpsReconciler } = await import(MODULE_URL);
  const store = makeStore();
  const clock = makeClock();
  let calls = 0;
  const rec = createTypedOpsReconciler({
    store,
    now: clock.now,
    schedule: clock.schedule,
    cancelSchedule: clock.cancelSchedule,
    isVisible: () => true,
    maxPending: 2,
    dispatch: async () => {
      calls++;
      return { committed: false, stage: 'queued-not-committed', fallbackLegacy: false, reconcileRequired: true, retryable: true, retryTarget: 'same-do-only', status: 202 };
    }
  });

  await rec.submit(sampleSale('sale_op_00000010'));
  await rec.submit(sampleSale('sale_op_00000011'));
  const overflow = await rec.submit(sampleSale('sale_op_00000012'));
  assert.equal(overflow.stage, 'reconciler-queue-full');
  assert.equal(overflow.fallbackLegacy, false);
  assert.equal(calls, 2, 'overflow command must never be sent to DO');
  assert.equal(store.dump().length, 2);
});

test('11. concurrent initial burst respects maxPending even before responses return', async () => {
  const { createTypedOpsReconciler } = await import(MODULE_URL);
  const store = makeStore();
  const clock = makeClock();
  const resolvers = [];
  let calls = 0;
  const rec = createTypedOpsReconciler({
    store,
    now: clock.now,
    schedule: clock.schedule,
    cancelSchedule: clock.cancelSchedule,
    isVisible: () => true,
    maxPending: 2,
    dispatch: (cmd) => {
      calls++;
      return new Promise((resolve) => {
        resolvers.push(() => resolve({
          committed: true,
          duplicate: false,
          stage: 'business-committed',
          fallbackLegacy: false,
          receipt: { opId: cmd.opId, receiptId: 'f'.repeat(24), stage: 'business-committed' }
        }));
      });
    }
  });

  const p1 = rec.submit(sampleSale('sale_op_00000013'));
  const p2 = rec.submit(sampleSale('sale_op_00000014'));
  const overflow = await rec.submit(sampleSale('sale_op_00000015'));
  assert.equal(overflow.stage, 'reconciler-queue-full');
  assert.equal(calls, 2);
  resolvers.forEach(fn => fn());
  const [r1, r2] = await Promise.all([p1, p2]);
  assert.equal(r1.committed, true);
  assert.equal(r2.committed, true);
});

test('12. scheduled retry stays single-flight against concurrent reconcileNow/submit', async () => {
  const { createTypedOpsReconciler } = await import(MODULE_URL);
  const store = makeStore();
  const clock = makeClock();
  let calls = 0;
  let releaseRetry;
  const rec = createTypedOpsReconciler({
    store,
    now: clock.now,
    schedule: clock.schedule,
    cancelSchedule: clock.cancelSchedule,
    isVisible: () => true,
    baseDelayMs: 300,
    dispatch: () => {
      calls++;
      if (calls === 1) {
        return Promise.resolve({
          committed: false,
          stage: 'queued-not-committed',
          fallbackLegacy: false,
          reconcileRequired: true,
          retryable: true,
          retryTarget: 'same-do-only',
          status: 202
        });
      }
      return new Promise((resolve) => {
        releaseRetry = () => resolve({
          committed: true,
          duplicate: true,
          stage: 'business-committed',
          fallbackLegacy: false,
          receipt: { opId: 'sale_op_00000016', receiptId: '9'.repeat(24), stage: 'business-committed' }
        });
      });
    }
  });

  await rec.submit(sampleSale('sale_op_00000016'));
  const timerPromise = clock.fireNext();
  const concurrent = await rec.reconcileNow();
  assert.equal(concurrent.attempted, 0, 'reconcileNow must skip opId already in flight from timer');
  const joinedSubmit = rec.submit(sampleSale('sale_op_00000016'));
  assert.equal(calls, 2);
  releaseRetry();
  await timerPromise;
  const joinedRes = await joinedSubmit;
  assert.equal(joinedRes.committed, true);
  assert.equal(store.dump().length, 0);
});
