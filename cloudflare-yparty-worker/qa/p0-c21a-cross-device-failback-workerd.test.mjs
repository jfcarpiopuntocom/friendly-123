// PORT2 C21a: REAL 2-device Workerd + real fake-indexeddb + real central authorityWorker
// verification of certified 2.0 cutover, reversible failback to legacy 1.0, C10 -cat
// writer lock handover between Device A (PC) and Device B (Safari/Phone), and
// same-do-only anti-duplication drain across DO restart (0 R2, USD 0.00).
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {Miniflare} from 'miniflare';
import {build} from 'esbuild';
import WebSocket from 'ws';
import authorityWorker,{RegistroLicencias} from '../../cloudflare-worker/worker.js';
import {pinAuthority} from '../../cloudflare-worker/pin-authority.mjs';
import {salaDeLicencia} from '../src/sala.js';
import {dispatchTypedCommercialCommand} from '../../src/port2-typed-ops-client.mjs';
import {createTypedOpsReconciler} from '../../src/port2-typed-ops-reconciler.mjs';
import {createTypedOpsIdbStore} from '../../src/port2-typed-ops-idb-store.mjs';
import {createVerifiedCrossDeviceFailbackCoordinator} from '../../src/port2-cross-device-failback.mjs';

const rootRequire = createRequire(path.resolve(import.meta.dirname, '../../package.json'));
const {IDBFactory} = rootRequire('fake-indexeddb');

const LICENSE = 'F123-SYNT-BUSINESS';
const DEVICE_A = 'synthetic-pc-opera-a';
const DEVICE_B = 'synthetic-iphone-safari-b';
const SERVICE_KEY = 'synthetic-c21a-private-service-key-32chars!';
const ORIGIN = 'https://synthetic-shop.test';
const HEAD = 'certified-c21a-frozen-head-20261119';

const roomId = await salaDeLicencia(LICENSE);
const catRoom = roomId + '-cat';
const opsRoom = roomId + '-ops';
const nsHash = createHash('sha256').update(LICENSE).digest('hex');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

const workerDir = fileURLToPath(new URL('..', import.meta.url));
const seededEntry = path.join(import.meta.dirname, 'fixtures/seeded-real-yparty-business-worker.mjs');
const compiled = (await build({
  entryPoints: [seededEntry],
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  mainFields: ['module', 'main'],
  conditions: ['workerd', 'worker', 'browser'],
  external: ['cloudflare:*'],
  write: false
})).outputFiles[0].text;

// Bundle client modules sharing the exact same Yjs instance for WebSocket sync (100% on master).
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'f123-c21a-client-'));
const clientOut = path.join(scratch, 'client.mjs');
await build({
  stdin: {
    contents: [
      `export {createOwnerTicketParams} from ${JSON.stringify(path.resolve(workerDir, '../src/ws-owner-ticket-params.mjs'))};`,
      `export {openCertifiedPublicCatalogWriter} from ${JSON.stringify(path.resolve(workerDir, '../src/port2-catalog-delta-writer.mjs'))};`,
      `export {assertPublicCatalogTransportDoc} from ${JSON.stringify(path.resolve(workerDir, 'src/catalog-safe-projection.mjs'))};`,
      `export {default as AuthorizedYProvider} from ${JSON.stringify(path.resolve(workerDir, '../src/authorized-yprovider.mjs'))};`,
      `export * as Y from 'yjs';`
    ].join('\n'),
    resolveDir: workerDir
  },
  nodePaths: [path.join(workerDir, 'node_modules')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  external: ['ws'],
  outfile: clientOut
});
const client = await import(pathToFileURL(clientOut));
process.on('exit', () => fs.rmSync(scratch, {recursive: true, force: true}));
const CY = client.Y;

// Use the ACTUAL product C19a writer instead of a locally reimplemented
// WebSocket-only stand-in. C19a enforces C11 frozen HEAD proof, C9 allowlist,
// empty public Y.Doc parity, and distinct one-use tickets for proof and WS.

function buildFrozenCatalogSource() {
  const d = new CY.Doc();
  d.clientID = 521;
  const frames = [];
  d.on('update', u => frames.push([...u]));
  d.getMap('productos').set('sku_1', {id: 'sku_1', nombre: 'Café Especial', precio: 15, stockActual: 5});
  d.getMap('ubicaciones').set('shelf-1', {id: 'shelf-1', nombre: 'Mostrador Principal', activa: true});
  const src = {
    channel: 'cat',
    frozenHead: HEAD,
    completeToHead: true,
    frames,
    expectedStateSha256: sha256(CY.encodeStateAsUpdate(d)),
    expectedVectorSha256: sha256(CY.encodeStateVector(d))
  };
  d.destroy();
  return src;
}

function buildFrozenOpsSource() {
  const d = new CY.Doc();
  d.clientID = 522;
  const frames = [];
  d.on('update', u => frames.push([...u]));
  d.getMap('eventos').set('hist-001', {opId: 'hist-001', kind: 'sale.record', amountCents: 100});
  const src = {
    channel: 'ops',
    frozenHead: HEAD,
    completeToHead: true,
    frames,
    expectedStateSha256: sha256(CY.encodeStateAsUpdate(d)),
    expectedVectorSha256: sha256(CY.encodeStateVector(d)),
    expectedOpIds: 1
  };
  d.destroy();
  return src;
}

function makePrivateDoc() {
  const d = new CY.Doc();
  d.getMap('productos').set('sku_1', {id: 'sku_1', nombre: 'Café Especial', precio: 15, stockActual: 5});
  d.getMap('ubicaciones').set('shelf-1', {id: 'shelf-1', nombre: 'Mostrador Principal', activa: true});
  d.getMap('_meta').set('pinsRol', {owner: 'PRIVATE_NEVER_EXPOSE'});
  return d;
}

function fakeDb() {
  let records = new Map(), tail = Promise.resolve();
  return {
    get: async k => structuredClone(records.get(k)),
    transaction: async fn => {
      let release;
      const previous = tail;
      tail = new Promise(r => (release = r));
      await previous;
      const txRows = new Map([...records].map(([k, v]) => [k, structuredClone(v)]));
      try {
        const result = await fn({
          get: async k => structuredClone(txRows.get(k)),
          put: async (k, v) => txRows.set(k, structuredClone(v)),
          delete: async k => txRows.delete(k),
          list: async ({prefix, limit}) =>
            new Map([...txRows].filter(([k]) => k.startsWith(prefix)).slice(0, limit))
        });
        records = txRows;
        return result;
      } finally {
        release();
      }
    }
  };
}

test('C21a REAL Workerd 2-device failback: Device A latches 202 sale in IDB -> fails back releasing C10 -cat lock to Device B -> blocks legacy duplicate -> drains same-do-only after restart', {timeout: 75000}, async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'f123-c21a-workerd-'));
  const db = fakeDb();
  await db.transaction(async tx => {
    await tx.put('inst:' + DEVICE_A, {licenseCode: LICENSE, instanceId: DEVICE_A});
    await tx.put('inst:' + DEVICE_B, {licenseCode: LICENSE, instanceId: DEVICE_B});
  });
  const authEnv = {
    PIN_PEPPER: 'synthetic-c21a-owner-pepper-long-key-01',
    TEAM_PIN_PEPPER: 'synthetic-c21a-team-pepper-long-key--02',
    TEAM_AUTHORITY_QA: '1',
    TEAM_AUTHORITY_LICENSE: LICENSE,
    WS_AUTHORITY_QA: '1',
    WS_SIGNING_KEY: 'synthetic-c21a-signing-key-long-private',
    WS_SERVICE_KEY: SERVICE_KEY
  };
  const owner = pinAuthority(db, authEnv.PIN_PEPPER);
  await owner.masterSet(LICENSE, '123', 0, [DEVICE_A, DEVICE_B]);
  await owner.masterActivate(LICENSE, '123', 0, [DEVICE_A, DEVICE_B]);
  const registry = new RegistroLicencias({storage: db}, authEnv);
  authEnv.REGISTROS = {
    idFromName: () => ({}),
    get: () => ({fetch: (input, init) => registry.fetch(new Request(input, init))})
  };

  const catalogSource = buildFrozenCatalogSource();
  const opsSource = buildFrozenOpsSource();
  let sourceOnline = true;
  let executorOn = false;
  let mf = null;
  let url = null;

  async function startWorkerd() {
    mf = new Miniflare({
      modules: true,
      script: compiled,
      compatibilityDate: '2026-06-01',
      compatibilityFlags: ['nodejs_compat'],
      durableObjects: {Tienda: {className: 'Tienda', useSQLite: true}},
      durableObjectsPersist: path.join(folder, 'do'),
      kvNamespaces: ['LICENCIAS'],
      bindings: {
        SALA_PILOTO: roomId,
        WS_AUTHORITY_QA: '1',
        WS_SEPARATE_ROOMS_QA: '1',
        WS_CATALOG_ORIGIN_QA: ORIGIN,
        WS_TYPED_COMMANDS_QA: '1',
        WS_TYPED_ORIGIN_QA: ORIGIN,
        WS_BUSINESS_EXECUTOR_QA: executorOn ? '1' : '0',
        WS_TEST_ONLY_INTERNAL_SEED: '1',
        WS_SERVICE_KEY: SERVICE_KEY
      },
      serviceBindings: {
        WS_AUTHORITY: async request =>
          authorityWorker.fetch(new Request(request.url, request), authEnv),
        WS_FROZEN_HISTORY_SOURCE: async request => {
          if (!sourceOnline) return new Response('frozen source offline', {status: 503});
          const body = await request.json();
          if (request.method !== 'POST' || request.headers.get('authorization') !== 'Bearer ' + SERVICE_KEY) {
            return new Response('not authorized', {status: 403});
          }
          if (body.room === catRoom && body.channel === 'cat') {
            return Response.json({room: catRoom, ...catalogSource});
          }
          if (body.room === opsRoom && body.channel === 'ops') {
            return Response.json({room: opsRoom, ...opsSource});
          }
          return new Response('not authorized', {status: 403});
        }
      }
    });
    const kv = await mf.getKVNamespace('LICENCIAS');
    await kv.put('inst:' + DEVICE_A, JSON.stringify({licenseCode: LICENSE, instanceId: DEVICE_A}));
    await kv.put('inst:' + DEVICE_B, JSON.stringify({licenseCode: LICENSE, instanceId: DEVICE_B}));
    url = await mf.ready;
  }

  await startWorkerd();

  const bridgeFetch = async (target, opts = {}) => {
    const s = String(target);
    if (s === 'https://friendly123-licencias.jfcarpio.workers.dev/ws/ticket') {
      return authorityWorker.fetch(
        new Request('https://authority.invalid/ws/ticket', {
          method: 'POST',
          headers: opts.headers,
          body: opts.body
        }),
        authEnv
      );
    }
    const u = new URL(s);
    assert.equal(u.host, 'friendly123-yparty-port2-canary-qa.jfcarpio.workers.dev');
    return mf.dispatchFetch('https://synthetic-worker.example' + u.pathname + u.search, {
      method: opts.method,
      headers: {...opts.headers, origin: ORIGIN},
      body: opts.body
    });
  };

  function makeDeviceCoordinator(instanceId, privateDoc) {
    const indexedDB = new IDBFactory();
    const store = createTypedOpsIdbStore({indexedDB, namespace: nsHash});
    const getCredentials = () => ({kind: 'owner', licenseCode: LICENSE, instanceId, pin: '123'});
    const reconciler = createTypedOpsReconciler({
      store,
      isVisible: () => true,
      baseDelayMs: 50,
      maxDelayMs: 200,
      schedule: () => 1,
      cancelSchedule: () => {},
      dispatch: command =>
        dispatchTypedCommercialCommand({
          room: opsRoom,
          licenseCode: LICENSE,
          instanceId,
          command,
          getCredentials,
          isVisible: () => true,
          timeoutMs: 5000,
          fetch: bridgeFetch
        })
    });
    const coordinator = createVerifiedCrossDeviceFailbackCoordinator({
      store,
      reconciler,
      isVisible: () => true,
      openCatalogSession: ({onWriterConflict}) =>
        client.openCertifiedPublicCatalogWriter({
          privateDoc,
          Y: CY,
          room: catRoom,
          licenseCode: LICENSE,
          instanceId,
          expectedFrozenHead: HEAD,
          getCredentials,
          fetch: bridgeFetch,
          isVisible: () => true,
          timeoutMs: 8000,
          createProvider: ({doc, room, params, readOnly}) => {
            assert.equal(readOnly, false);
            return new client.AuthorizedYProvider(url.host, room, doc, {
              party: 'tienda', params,
              WebSocketPolyfill: WebSocket,
              disableBc: true, connect: false,
              maxBackoffTime: 200
            });
          },
          onWriterConflict
        })
    });
    return {store, reconciler, coordinator};
  }

  const docA = makePrivateDoc();
  const docB = makePrivateDoc();
  const devA = makeDeviceCoordinator(DEVICE_A, docA);
  const devB = makeDeviceCoordinator(DEVICE_B, docB);

  try {
    // 1) Device A activates 2.0 (acquires C10 single-writer lock on -cat DO)
    const actA = await devA.coordinator.activate20();
    assert.equal(actA.ok, true);
    assert.equal(devA.coordinator.mode(), 'active-2.0');

    // While Device A holds the -cat writer lock, Device B cannot acquire a second writer lock (C10)
    const actBWhileLocked = await devB.coordinator.activate20();
    assert.equal(actBWhileLocked.ok, false);
    assert.equal(devB.coordinator.mode(), 'failback-legacy-1.0');

    // Device A submits a typed sale while executorOn=false -> HTTP 202 stored-for-application, latched in IDB
    const saleCmd = {
      license: LICENSE,
      opId: 'op_c21a_cross_sale_01',
      kind: 'sale.record',
      productId: 'sku_1',
      quantity: 1,
      amountCents: 1500
    };
    const firstTry = await devA.coordinator.submitCommercial(saleCmd);
    assert.equal(firstTry.committed, false);
    assert.equal(firstTry.status, 202);
    assert.equal(firstTry.reconcileRequired, true);
    assert.equal(firstTry.retryTarget, 'same-do-only');
    assert.equal((await devA.store.loadAll()).length, 1);

    // 2) Device A fails back to legacy 1.0 -> releases -cat C10 lock & blocks op_c21a_cross_sale_01 on legacy 1.0
    await devA.coordinator.failbackToLegacy('switch-to-legacy');
    assert.equal(devA.coordinator.mode(), 'failback-legacy-1.0');
    assert.equal(await devA.coordinator.canDispatchOnLegacy('op_c21a_cross_sale_01'), false);
    await assert.rejects(
      devA.coordinator.assertLegacyAllowed('op_c21a_cross_sale_01'),
      err => err && err.code === 'latched-same-do-only'
    );
    // Fresh opId created after failback IS allowed on legacy 1.0
    assert.equal(await devA.coordinator.canDispatchOnLegacy('op_c21a_fresh_legacy_02'), true);

    await new Promise(r => setTimeout(r, 250));

    // Device B now activates 2.0 and IMMEDIATELY acquires the -cat single-writer lock released by Device A!
    const actBAfterHandover = await devB.coordinator.activate20();
    assert.equal(actBAfterHandover.ok, true, 'Device B must take over -cat writer after Device A failback');
    assert.equal(devB.coordinator.mode(), 'active-2.0');
    const deltaOut = devB.coordinator.applyCatalogDelta({
      kind: 'product.upsert',
      product: {id: 'sku_2', nombre: 'Té Verde Device B', precio: 9, stockActual: 12}
    });
    assert.equal(deltaOut.ok, true);
    await devB.coordinator.failbackToLegacy('device-b-done');

    // 3) Restart Workerd with executorOn=true and frozen source OFFLINE: Device A drains latched sale to SAME DO
    sourceOnline = false;
    executorOn = true;
    await mf.dispose();
    await startWorkerd();

    const drained = await devA.coordinator.drainLatchedSameDo();
    assert.equal(drained.attempted, 1);
    assert.equal(drained.results[0].committed, true);
    assert.equal(drained.results[0].stage, 'business-committed');
    assert.deepEqual(await devA.store.loadAll(), []);
    assert.equal(await devA.coordinator.canDispatchOnLegacy('op_c21a_cross_sale_01'), false);

    // Inspect authoritative SQLite in real -ops DO: exactly 1 sale committed (stock 5->4, cash 500->2000)
    const inspectRes = await mf.dispatchFetch('https://synthetic-worker.example/parties/tienda/' + opsRoom, {
      method: 'POST',
      headers: {origin: ORIGIN, 'x-f123-synthetic-inspect': '1'}
    });
    const sqlState = await inspectRes.json();
    assert.deepEqual(sqlState, {stock: 4, cash: 2000, effects: 1, receipts: 1});
  } finally {
    devA.coordinator.destroy();
    devB.coordinator.destroy();
    docA.destroy();
    docB.destroy();
    try { await mf?.dispose(); } finally { fs.rmSync(folder, {recursive: true, force: true}); }
  }
});
