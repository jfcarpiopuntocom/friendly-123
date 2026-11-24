'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const STORE_URL = pathToFileURL(
  path.join(__dirname, '..', 'src', 'port2-typed-ops-idb-store.mjs')
).href;
const RECONCILER_URL = pathToFileURL(
  path.join(__dirname, '..', 'src', 'port2-typed-ops-reconciler.mjs')
).href;

const NS_A = 'a'.repeat(64);
const NS_B = 'b'.repeat(64);

function makeTransactionalIdbHarness({ abortNextPut = false, blockOpen = false } = {}) {
  const stores = new Map();
  let abortPutFlag = abortNextPut;
  let blockOpenFlag = blockOpen;
  let onCompleteCount = 0;

  function makeReq() {
    return { result: undefined, error: null, onsuccess: null, onerror: null, onupgradeneeded: null, onblocked: null };
  }

  const indexedDB = {
    open(name, version) {
      const req = makeReq();
      queueMicrotask(() => {
        if (blockOpenFlag) {
          if (req.onblocked) req.onblocked({});
          return;
        }
        const existed = stores.has(name);
        if (!existed) stores.set(name, new Map());
        const dbMap = stores.get(name);
        const db = {
          name,
          version,
          objectStoreNames: { contains: (s) => dbMap.has(s) },
          createObjectStore(s) {
            if (!dbMap.has(s)) dbMap.set(s, new Map());
            return {};
          },
          close() {},
          transaction(storeNames, mode) {
            const scope = Array.isArray(storeNames) ? storeNames : [storeNames];
            const scopeStaged = new Map();
            for (const target of scope) {
              const committed = dbMap.get(target);
              if (!committed) throw new Error(`Missing objectStore: ${target}`);
              scopeStaged.set(target, {
                committed,
                staged: new Map([...committed].map(([k, v]) => [k, structuredClone(v)]))
              });
            }
            let aborted = false;
            let settled = false;
            let pendingOps = 0;
            const tx = {
              mode,
              error: null,
              oncomplete: null,
              onabort: null,
              onerror: null,
              abort() {
                if (settled) return;
                aborted = true;
                settled = true;
                queueMicrotask(() => {
                  if (tx.onabort) tx.onabort({});
                });
              },
              objectStore(targetName = scope[0]) {
                const entry = scopeStaged.get(targetName);
                if (!entry) throw new Error(`ObjectStore not in transaction scope: ${targetName}`);
                const staged = entry.staged;
                function runOp(fn) {
                  const opReq = makeReq();
                  pendingOps++;
                  queueMicrotask(() => {
                    if (aborted) return;
                    try {
                      opReq.result = fn();
                      if (opReq.onsuccess) opReq.onsuccess({ target: opReq });
                    } catch (err) {
                      opReq.error = err;
                      tx.error = err;
                      if (opReq.onerror) opReq.onerror({ target: opReq });
                      tx.abort();
                      return;
                    } finally {
                      pendingOps--;
                      if (!aborted && !settled && pendingOps === 0) {
                        settled = true;
                        queueMicrotask(() => {
                          if (aborted) return;
                          if (mode === 'readwrite') {
                            for (const s of scopeStaged.values()) {
                              s.committed.clear();
                              for (const [k, v] of s.staged.entries()) s.committed.set(k, v);
                            }
                          }
                          onCompleteCount++;
                          if (tx.oncomplete) tx.oncomplete({});
                        });
                      }
                    }
                  });
                  return opReq;
                }
                return {
                  get: (k) => runOp(() => staged.has(k) ? structuredClone(staged.get(k)) : undefined),
                  getAll: () => runOp(() => Array.from(staged.values()).map(v => structuredClone(v))),
                  put: (record) => runOp(() => {
                    if (abortPutFlag) {
                      abortPutFlag = false;
                      throw new Error('Synthetic IDB quota/abort failure');
                    }
                    staged.set(record.key, structuredClone(record));
                    return record.key;
                  }),
                  delete: (k) => runOp(() => { staged.delete(k); })
                };
              }
            };
            return tx;
          }
        };
        req.result = db;
        if (!existed && req.onupgradeneeded) req.onupgradeneeded({ target: req });
        if (req.onsuccess) req.onsuccess({ target: req });
      });
      return req;
    }
  };

  return {
    indexedDB,
    setAbortNextPut(v) { abortPutFlag = v; },
    setBlockOpen(v) { blockOpenFlag = v; },
    getOnCompleteCount: () => onCompleteCount
  };
}

function getRealOrHarnessIdb() {
  try {
    const { IDBFactory } = require('fake-indexeddb');
    return { indexedDB: new IDBFactory(), isRealFakeIdb: true };
  } catch (err) {
    if (process.env.CI === 'true') throw err;
    return { indexedDB: makeTransactionalIdbHarness().indexedDB, isRealFakeIdb: false };
  }
}

function sampleEntry(opId, amountCents = 1500, extra = {}) {
  return {
    opId,
    command: {
      opId,
      license: 'F123-SYNT-STORE',
      kind: 'sale.record',
      productId: 'sku_1',
      quantity: 1,
      amountCents
    },
    sameDoLocked: true,
    attempts: 1,
    state: 'pending',
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_100,
    ...extra
  };
}

test('1. constructor enforces real indexedDB and SHA-256 64-hex namespace (never plaintext license)', async () => {
  const { createTypedOpsIdbStore } = await import(STORE_URL);
  const { indexedDB } = getRealOrHarnessIdb();
  assert.throws(() => createTypedOpsIdbStore({ indexedDB: null, namespace: NS_A }), /IndexedDB/);
  assert.throws(() => createTypedOpsIdbStore({ indexedDB, namespace: 'F123-PLAINTEXT-LICENSE' }), /SHA-256/);
  assert.throws(() => createTypedOpsIdbStore({ indexedDB, namespace: 'abc' }), /SHA-256/);
  const store = createTypedOpsIdbStore({ indexedDB, namespace: NS_A });
  assert.equal(typeof store.loadAll, 'function');
  assert.equal(typeof store.save, 'function');
  assert.equal(typeof store.remove, 'function');
});

test('2. strict namespace isolation: business A and business B share IDB without leaking or deleting each other ops', async () => {
  const { createTypedOpsIdbStore } = await import(STORE_URL);
  const { indexedDB } = getRealOrHarnessIdb();
  const storeA = createTypedOpsIdbStore({ indexedDB, namespace: NS_A });
  const storeB = createTypedOpsIdbStore({ indexedDB, namespace: NS_B });

  await storeA.save(sampleEntry('op_shared_id_0001', 1500));
  await storeB.save(sampleEntry('op_shared_id_0001', 9900));

  const rowsA = await storeA.loadAll();
  const rowsB = await storeB.loadAll();
  assert.equal(rowsA.length, 1);
  assert.equal(rowsB.length, 1);
  assert.equal(rowsA[0].command.amountCents, 1500);
  assert.equal(rowsB[0].command.amountCents, 9900);

  await storeA.remove('op_shared_id_0001');
  assert.equal((await storeA.loadAll()).length, 0);
  assert.equal((await storeB.loadAll()).length, 1, 'removing in business A must never touch business B');
});

test('3. save rejects missing sameDoLocked, secret fields (pin/token/cap/authorization), oversize or payload tampering', async () => {
  const { createTypedOpsIdbStore } = await import(STORE_URL);
  const { indexedDB } = getRealOrHarnessIdb();
  const store = createTypedOpsIdbStore({ indexedDB, namespace: NS_A });

  await assert.rejects(store.save(sampleEntry('op_bad_lock_01', 1500, { sameDoLocked: false })));
  await assert.rejects(store.save(sampleEntry('op_bad_secret_1', 1500, { pin: '123' })));
  await assert.rejects(store.save({
    ...sampleEntry('op_bad_secret_2', 1500),
    command: { ...sampleEntry('op_bad_secret_2', 1500).command, token: 'leaked.sig' }
  }));
  await assert.rejects(store.save({
    ...sampleEntry('op_bad_secret_3', 1500),
    command: { ...sampleEntry('op_bad_secret_3', 1500).command, authorization: 'Bearer x' }
  }));
  await assert.rejects(store.save(sampleEntry('op_bad_size_01', 1500, { padding: 'x'.repeat(40_000) })));

  // First save succeeds; updating attempts/state with identical command succeeds; tampering command fails closed
  await store.save(sampleEntry('op_immut_000001', 1500));
  await store.save(sampleEntry('op_immut_000001', 1500, { attempts: 2, state: 'paused-auth-required' }));
  await assert.rejects(
    store.save(sampleEntry('op_immut_000001', 9999, { attempts: 2 })),
    /payload/i,
    'persisted opId command payload must remain immutable'
  );
});

test('4. tx.onabort and blocked IndexedDB reject cleanly (never resolve on req.onsuccess)', async () => {
  const { createTypedOpsIdbStore } = await import(STORE_URL);
  const h = makeTransactionalIdbHarness({ abortNextPut: true });
  const store = createTypedOpsIdbStore({ indexedDB: h.indexedDB, namespace: NS_A });

  await assert.rejects(store.save(sampleEntry('op_abort_000001', 1500)));
  assert.equal((await store.loadAll()).length, 0);

  h.setBlockOpen(true);
  await assert.rejects(store.loadAll(), /blocked/i);
});

test('5. end-to-end with REAL createTypedOpsReconciler: Safari close during 202 reloads from IDB and reconciles same opId without legacy fallback', async () => {
  const { createTypedOpsIdbStore } = await import(STORE_URL);
  const { createTypedOpsReconciler } = await import(RECONCILER_URL);
  const { indexedDB } = getRealOrHarnessIdb();

  // First browser session: DO returns 202 queued-not-committed; user closes Safari immediately
  const store1 = createTypedOpsIdbStore({ indexedDB, namespace: NS_A });
  const rec1 = createTypedOpsReconciler({
    store: store1,
    isVisible: () => true,
    schedule: () => 1,
    cancelSchedule: () => {},
    dispatch: async () => ({
      committed: false,
      stage: 'queued-not-committed',
      fallbackLegacy: false,
      reconcileRequired: true,
      retryable: true,
      retryTarget: 'same-do-only',
      status: 202
    })
  });
  const sale = {
    opId: 'op_safari_reload_01',
    license: 'F123-SYNT-STORE',
    kind: 'sale.record',
    productId: 'sku_1',
    quantity: 1,
    amountCents: 1500
  };
  const first = await rec1.submit(sale);
  assert.equal(first.committed, false);
  assert.equal(first.fallbackLegacy, false);
  assert.equal(first.reconcileRequired, true);
  rec1.destroy();

  // Second browser session after cold reload: fresh IDB store + fresh reconciler
  const store2 = createTypedOpsIdbStore({ indexedDB, namespace: NS_A });
  const retriedOpIds = [];
  const rec2 = createTypedOpsReconciler({
    store: store2,
    isVisible: () => true,
    schedule: () => 1,
    cancelSchedule: () => {},
    dispatch: async (cmd) => {
      retriedOpIds.push(cmd.opId);
      return {
        committed: true,
        duplicate: true,
        stage: 'business-committed',
        fallbackLegacy: false,
        status: 200,
        receipt: { opId: cmd.opId, receiptId: 'a'.repeat(24), stage: 'business-committed' }
      };
    }
  });
  await rec2.ready();
  assert.equal(rec2.pending().length, 1);
  assert.equal(rec2.pending()[0].opId, 'op_safari_reload_01');
  assert.equal(rec2.pending()[0].sameDoLocked, true);

  const settled = await rec2.reconcileNow();
  assert.equal(settled.attempted, 1);
  assert.deepEqual(retriedOpIds, ['op_safari_reload_01']);
  assert.equal(rec2.pending().length, 0);
  assert.equal((await store2.loadAll()).length, 0, 'committed opId must be removed from IDB on tx.oncomplete');
});

test('6. end-to-end with REAL createTypedOpsReconciler: aborted IDB save blocks HTTP dispatch (ZERO requests sent)', async () => {
  const { createTypedOpsIdbStore } = await import(STORE_URL);
  const { createTypedOpsReconciler } = await import(RECONCILER_URL);
  const h = makeTransactionalIdbHarness({ abortNextPut: true });
  const store = createTypedOpsIdbStore({ indexedDB: h.indexedDB, namespace: NS_A });

  let httpCalls = 0;
  const rec = createTypedOpsReconciler({
    store,
    isVisible: () => true,
    schedule: () => 1,
    cancelSchedule: () => {},
    dispatch: async () => {
      httpCalls++;
      return { committed: true, stage: 'business-committed', fallbackLegacy: false };
    }
  });

  const out = await rec.submit({
    opId: 'op_idb_abort_no_http',
    license: 'F123-SYNT-STORE',
    kind: 'sale.record',
    productId: 'sku_1',
    quantity: 1,
    amountCents: 1500
  });
  assert.equal(httpCalls, 0, 'aborted durable pre-send save MUST prevent any HTTP call');
  assert.equal(out.committed, false);
});

test('7. corrupted own-namespace pending opId never disappears silently on IndexedDB load/reopen', async () => {
  const { createTypedOpsIdbStore } = await import(STORE_URL);
  const { indexedDB } = getRealOrHarnessIdb();
  const storeA = createTypedOpsIdbStore({ indexedDB, namespace: NS_A });
  const storeB = createTypedOpsIdbStore({ indexedDB, namespace: NS_B });
  await storeA.save(sampleEntry('op_corrupt_00001', 1500));
  await storeB.save(sampleEntry('op_other_shop_01', 1900));

  async function overwriteRaw(record) {
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open('f123_port2_typed_ops_v1', 2);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    try {
      await new Promise((resolve, reject) => {
        const tx = db.transaction('pending_ops', 'readwrite');
        tx.objectStore('pending_ops').put(record);
        tx.oncomplete = () => resolve();
        tx.onabort = () => reject(tx.error || new Error('synthetic IDB write aborted'));
        tx.onerror = () => {};
      });
    } finally { db.close(); }
  }

  const key = JSON.stringify([NS_A, 'op_corrupt_00001']);
  // A browser crash / corrupt legacy entry with an intact own-business key:
  // ignore-and-continue is dangerous: the economic opId appears lost on reload.
  await overwriteRaw({key, namespace:NS_A, value:null});
  await assert.rejects(storeA.loadAll(), /corrupt|invalid|missing/i,
    'same-business malformed row MUST block reconciliation, not return []');
  assert.equal((await storeB.loadAll()).length,1,'other business remains isolated');

  // A forged payload cannot be reconciled under a different opId key.
  await overwriteRaw({key, namespace:NS_A, value:sampleEntry('op_forged_00001', 1500)});
  await assert.rejects(storeA.loadAll(), /corrupt|invalid|mismatch/i);
  assert.equal((await storeB.loadAll()).length,1);
});

test('8. C15 allowlist: extra commercial fields and unsupported kind never enter durable IDB',async()=>{
 const {createTypedOpsIdbStore}=await import(STORE_URL);
 const {indexedDB}=getRealOrHarnessIdb();
 const store=createTypedOpsIdbStore({indexedDB,namespace:NS_A});
 const invalid=sampleEntry('op_c15_allowlist01',1500);
 invalid.command.customerPrivateNotes='Should not be persisted';
 await assert.rejects(store.save(invalid),/invalid|schema|allowlist|command/i);
 const unrecognized=sampleEntry('op_c15_allowlist02',1500);
 unrecognized.command.kind='expense.record';
 await assert.rejects(store.save(unrecognized),/invalid|schema|allowlist|command/i);
 assert.deepEqual(await store.loadAll(),[]);
});
test('9. stalled Safari IndexedDB.open must reject within a bounded timeout; late success closes orphan DB',async()=>{
 const {createTypedOpsIdbStore}=await import(STORE_URL);
 let req,closes=0;
 const blocked={open:()=>{req={};return req;}};
 const store=createTypedOpsIdbStore({indexedDB:blocked,namespace:NS_A,openTimeoutMs:100});
 const started=Date.now();
 const verdict=await Promise.race([store.loadAll().then(()=>({ok:true}),error=>({error})),
  new Promise(resolve=>setTimeout(()=>resolve({timedOut:true}),500))]);
 assert.equal(verdict.timedOut,undefined,'IndexedDB must not remain pending indefinitely');
 assert.ok(verdict.error,'timed out open must fail CLOSED, without in-memory fallback');
 assert.ok(Date.now()-started<500);
 req.result={close:()=>{closes++;}};
 req.onsuccess?.({target:req});
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(closes,1,'late open success must close its orphan database handle');
});
test('10. two tabs same opId with contradictory business payload cannot overwrite each other',async()=>{
 const {createTypedOpsIdbStore}=await import(STORE_URL);
 const {indexedDB}=getRealOrHarnessIdb();
 const one=createTypedOpsIdbStore({indexedDB,namespace:NS_A});
 const two=createTypedOpsIdbStore({indexedDB,namespace:NS_A});
 const result=await Promise.allSettled([
  one.save(sampleEntry('op_twotabs_same_01',1500)),
  two.save(sampleEntry('op_twotabs_same_01',3900))
 ]);
 assert.deepEqual(result.map(x=>x.status).sort(),['fulfilled','rejected']);
 const r1=(await one.loadAll())[0],r2=(await two.loadAll())[0];
 assert.equal(r1.command.amountCents,r2.command.amountCents);
 assert([1500,3900].includes(r1.command.amountCents));
});

test('C21b real IndexedDB: terminal opId marker survives reload, isolates businesses and cannot be deleted by pending cleanup',async()=>{
  const {createTypedOpsIdbStore}=await import(STORE_URL);
  const {IDBFactory}=require('fake-indexeddb');
  const indexedDB=new IDBFactory();
  const a1=createTypedOpsIdbStore({indexedDB,namespace:NS_A});
  const b1=createTypedOpsIdbStore({indexedDB,namespace:NS_B});
  const id='op_committed_terminal_1';
  assert.deepEqual(await a1.loadCommittedOpIds(),[]);
  await assert.rejects(a1.markCommitted(id),/missing pending opId/);
  await a1.save(sampleEntry(id,1500));
  await b1.save(sampleEntry(id,4400));
  await a1.markCommitted(id);
  assert.deepEqual(await a1.loadAll(),[],'pending row deleted atomically with durable marker');
  assert.deepEqual(await a1.loadCommittedOpIds(),[id]);
  assert.deepEqual(await b1.loadCommittedOpIds(),[],'other business namespace invisible');
  assert.equal((await b1.loadAll())[0].command.amountCents,4400);
  await a1.remove(id);
  const cold=createTypedOpsIdbStore({indexedDB,namespace:NS_A});
  assert.deepEqual(await cold.loadCommittedOpIds(),[id],'marker survives fresh store instance');
  await cold.markCommitted(id); // Replayed settled receipt is idempotent.
  assert.deepEqual(await cold.loadCommittedOpIds(),[id]);
  // A committed marker contains only opaque business namespace and opId;
  // no amount, contact, PIN, bearer or receipt bytes can be stored there.
  const request=indexedDB.open('f123_port2_typed_ops_v1',2);
  const db=await new Promise((resolve,reject)=>{
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error);
  });
  try{
    const tx=db.transaction('settled_ops','readonly');
    const req=tx.objectStore('settled_ops').getAll();
    const rows=await new Promise((resolve,reject)=>{
      req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
    });
    assert.equal(rows.length,1);
    assert.deepEqual(Object.keys(rows[0]).sort(),['key','namespace','opId']);
    assert.doesNotMatch(JSON.stringify(rows),/1500|4400|pin|token|receiptId/);
  }finally{db.close();}
});
