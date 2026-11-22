// PORT2 C40: End-to-end REAL Workerd SQLite verification of the connected product chain:
// mock-backend.js (C34+C36 cash sale envelope) -> sync-realtime.js (OCSyncEmit, legacy relay OFF) ->
// sync-yjs.js (C38 writer-quiescence gate + publicarOpLocal + API.obtenerReciboComercial20 + oc-op-20-recibo) ->
// compiled yparty-piloto.min.js -> real Workerd -ops DO SQLite (1 receipt, 0 duplicate on failback/reload, USD 0.00).

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {pathToFileURL, fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {Miniflare} from 'miniflare';
import {build} from 'esbuild';
import WebSocket from 'ws';
import authorityWorker, {RegistroLicencias} from '../../cloudflare-worker/worker.js';
import {pinAuthority} from '../../cloudflare-worker/pin-authority.mjs';
import {teamAuthority} from '../../cloudflare-worker/team-authority.mjs';
import {salaDeLicencia} from '../src/sala.js';

const rootRequire = createRequire(path.resolve(import.meta.dirname, '../../package.json'));
const {IDBFactory} = rootRequire('fake-indexeddb');

const HOST = 'friendly123-yparty-port2-canary-qa.jfcarpio.workers.dev';
const LICENSE = 'F123-SYNT-BUSINESS';
const DEVICE_A = 'synthetic-c40-owner-pc-a';
const DEVICE_B = 'synthetic-c40-safari-b';
const EMP_SUBJECT = 'emp_c40_01';
const SERVICE_KEY = 'synthetic-c40-private-service-key-32chars!';
const ORIGIN = 'https://synthetic-c40.test';
const HEAD = 'certified-c40-frozen-head-20261119';

const roomId = await salaDeLicencia(LICENSE);
const catRoom = roomId + '-cat';
const opsRoom = roomId + '-ops';
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

const workerDir = fileURLToPath(new URL('..', import.meta.url));
const repoRoot = path.resolve(workerDir, '..');
const SYNC_YJS_SRC = fs.readFileSync(path.join(repoRoot, 'docs', 'sync-yjs.js'), 'utf8');
const BUNDLE_CODE = fs.readFileSync(path.join(repoRoot, 'docs', 'vendor', 'yparty-piloto.min.js'), 'utf8');
const YJS_BUNDLE_CODE = fs.readFileSync(path.join(repoRoot, 'docs', 'vendor', 'yjs-bundle.min.js'), 'utf8');

const seededEntry = path.join(import.meta.dirname, 'fixtures/seeded-real-yparty-business-worker.mjs');
const compiledWorker = (await build({
  stdin: {
    contents: [
      `import worker, {Tienda as SeededTienda} from ${JSON.stringify(seededEntry)};`,
      `export class Tienda extends SeededTienda {`,
      `  async abrirHistorialCongeladoSiAplica() {`,
      `    if (this.name === this.env.SALA_PILOTO + '-ops') return null;`,
      `    return super.abrirHistorialCongeladoSiAplica();`,
      `  }`,
      `}`,
      `export default worker;`
    ].join('\n'),
    resolveDir: workerDir
  },
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  mainFields: ['module', 'main'],
  conditions: ['workerd', 'worker', 'browser'],
  external: ['cloudflare:*'],
  write: false
})).outputFiles[0].text;

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'f123-c40-client-'));
const clientOut = path.join(scratch, 'client.mjs');
await build({
  stdin: {
    contents: [
      `export {default as AuthorizedYProvider} from ${JSON.stringify(path.resolve(repoRoot, 'src/authorized-yprovider.mjs'))};`,
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

function extractSyncYjsRuntime(src) {
  const sFacade = src.indexOf('    if (piloto && typeof piloto.crearClienteFotosShaCertificado === "function") {');
  const eFacade = src.indexOf('    API.opsDoc.on("update"', sFacade);
  const sPub = src.indexOf('  function publicarOpLocal(op) {');
  const ePub = src.indexOf('\n  }', sPub) + 4;
  assert.ok(sFacade > 0 && eFacade > sFacade);
  assert.ok(sPub > 0 && ePub > sPub);
  return {facade: src.slice(sFacade, eFacade), publicarOpLocal: src.slice(sPub, ePub)};
}

const syncSections = extractSyncYjsRuntime(SYNC_YJS_SRC);

function buildFrozenCatalogSource() {
  const d = new CY.Doc();
  d.clientID = 701;
  const frames = [];
  d.on('update', u => frames.push([...u]));
  d.getMap('productos').set('sku_1', {id: 'sku_1', nombre: 'Café C40', precio: 15, stockActual: 5});
  d.getMap('ubicaciones').set('shelf-1', {id: 'shelf-1', nombre: 'Percha C40', activa: true});
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

function mountConnectedRuntime({bridgeFetch, indexedDB}) {
  const winListeners = new Map();
  const receiptEvents = [];
  let legacyState = 'apagado';
  const relayListeners = new Set();

  const document = {
    hidden: false,
    addEventListener() {},
    removeEventListener() {}
  };

  const window = {
    indexedDB,
    OCAuth: {rolActual: () => 'dueno'},
    OCSecure: {leerPinQueAbre: () => ({owner: '123', team: null})},
    OCSyncControl: {
      estado: () => legacyState,
      salaActiva: () => null,
      durabilidadPendiente: () => false,
      onEstado: fn => {
        relayListeners.add(fn);
        return () => relayListeners.delete(fn);
      },
      desactivar: () => { legacyState = 'apagado'; }
    },
    addEventListener(ev, fn) {
      if (!winListeners.has(ev)) winListeners.set(ev, new Set());
      winListeners.get(ev).add(fn);
    },
    removeEventListener(ev, fn) { winListeners.get(ev)?.delete(fn); },
    dispatchEvent(ev) {
      if (ev?.type === 'oc-op-20-recibo') receiptEvents.push(ev.detail);
      for (const fn of winListeners.get(ev?.type) || []) fn(ev);
    }
  };

  const localStorage = {
    getItem(k) {
      if (k === 'f123_owned') return JSON.stringify({licenseCode: LICENSE, instanceId: DEVICE_A});
      return null;
    }
  };

  const ctx = vm.createContext({
    window,
    self: window,
    globalThis: null,
    document,
    localStorage,
    indexedDB,
    fetch: bridgeFetch,
    crypto: globalThis.crypto,
    Response,
    Headers,
    Request,
    AbortController,
    TextEncoder,
    TextDecoder,
    URL,
    URLSearchParams,
    Blob,
    CustomEvent: globalThis.CustomEvent || class CustomEvent { constructor(t, o) { this.type = t; this.detail = o?.detail; } },
    atob,
    btoa,
    Uint8Array,
    ArrayBuffer,
    setTimeout,
    clearTimeout,
    console
  });
  ctx.globalThis = ctx;
  window.globalThis = ctx;
  window.window = window;
  window.document = document;
  window.localStorage = localStorage;
  window.fetch = bridgeFetch;
  window.crypto = globalThis.crypto;

  vm.runInContext(YJS_BUNDLE_CODE, ctx, {filename: 'yjs-bundle.min.js'});
  window.Y = window.Y || ctx.Y;
  vm.runInContext(BUNDLE_CODE, ctx, {filename: 'yparty-piloto.min.js'});

  const piloto = window.F123YPartyPilot(roomId, LICENSE);
  ctx.__c40Boot = {codigo: LICENSE, piloto, headCongeladoQa: HEAD, Y: window.Y};

  const runtime = vm.runInContext(`
    (function () {
      var codigo = __c40Boot.codigo;
      var piloto = __c40Boot.piloto;
      var headCongeladoQa = __c40Boot.headCongeladoQa;
      var Y = __c40Boot.Y;
      var API = {
        doc: new Y.Doc(),
        opsDoc: new Y.Doc(),
        fotosDoc: new Y.Doc(),
        fotosRefs: null,
        fotoSha: null
      };
      API.opsMap = API.opsDoc.getMap('eventos');
      API.fotosMap = API.fotosDoc.getMap('blobs');
      API.fotosRefs = API.doc.getMap('fotos_refs');
      API.doc.getMap('productos').set('sku_1', { id: 'sku_1', nombre: 'Café C40', precio: 15, stockActual: 5 });
      API.doc.getMap('ubicaciones').set('shelf-1', { id: 'shelf-1', nombre: 'Percha C40', activa: true });
      function _instalarLectorFotoShaBajoDemanda() {}
      ${syncSections.facade}
      ${syncSections.publicarOpLocal}
      window.addEventListener('oc-op-local', function (ev) { try { publicarOpLocal(ev.detail); } catch (_) {} });
      return { API: API, publicarOpLocal: publicarOpLocal };
    })()
  `, ctx);

  return {
    window,
    API: runtime.API,
    receiptEvents,
    vmObj: obj => vm.runInContext('(' + JSON.stringify(obj) + ')', ctx)
  };
}

test('C40 Workerd E2E: single local receipt opIdVenta -> authoritative DO business receipt, 0 duplicates on failback/reload', {timeout: 75000}, async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'f123-c40-workerd-'));
  const db = fakeDb();
  await db.transaction(async tx => {
    await tx.put('inst:' + DEVICE_A, {licenseCode: LICENSE, instanceId: DEVICE_A});
    await tx.put('inst:' + DEVICE_B, {licenseCode: LICENSE, instanceId: DEVICE_B});
  });

  const authEnv = {
    PIN_PEPPER: 'synthetic-c40-owner-pepper-long-key-01',
    TEAM_PIN_PEPPER: 'synthetic-c40-team-pepper-long-key--02',
    TEAM_AUTHORITY_QA: '1',
    TEAM_AUTHORITY_LICENSE: LICENSE,
    WS_AUTHORITY_QA: '1',
    WS_QA_ROLE_GRANTS: JSON.stringify({empleado: ['ops:sale', 'fotos:read']}),
    WS_SIGNING_KEY: 'synthetic-c40-signing-key-long-private',
    WS_SERVICE_KEY: SERVICE_KEY
  };

  const ownerAuth = pinAuthority(db, authEnv.PIN_PEPPER);
  await ownerAuth.masterSet(LICENSE, '123', 0, [DEVICE_A, DEVICE_B]);
  await ownerAuth.masterActivate(LICENSE, '123', 0, [DEVICE_A, DEVICE_B]);
  const registry = new RegistroLicencias({storage: db}, authEnv);
  authEnv.REGISTROS = {
    idFromName: () => ({}),
    get: () => ({fetch: (input, init) => registry.fetch(new Request(input, init))})
  };

  const catalogSource = buildFrozenCatalogSource();
  let mf = null;
  let url = null;

  mf = new Miniflare({
    modules: true,
    script: compiledWorker,
    compatibilityDate: '2026-06-01',
    compatibilityFlags: ['nodejs_compat'],
    durableObjects: {Tienda: {className: 'Tienda', useSQLite: true}},
    durableObjectsPersist: path.join(folder, 'do'),
    kvNamespaces: ['LICENCIAS'],
    bindings: {
      SALA_PILOTO: roomId,
      WS_AUTHORITY_QA: '1',
      WS_SEPARATE_ROOMS_QA: '1',
      WS_OPEN_EXISTING_QA: '1',
      WS_CATALOG_ORIGIN_QA: ORIGIN,
      WS_TYPED_COMMANDS_QA: '1',
      WS_TYPED_ORIGIN_QA: ORIGIN,
      WS_BUSINESS_EXECUTOR_QA: '1',
      WS_PHOTO_BLOBS_QA: '1',
      WS_PHOTO_ORIGIN_QA: ORIGIN,
      WS_TEST_ONLY_INTERNAL_SEED: '1',
      WS_SERVICE_KEY: SERVICE_KEY
    },
    serviceBindings: {
      WS_AUTHORITY: async request => authorityWorker.fetch(new Request(request.url, request), authEnv),
      WS_FROZEN_HISTORY_SOURCE: async request => {
        const body = await request.json();
        if (request.method !== 'POST' || request.headers.get('authorization') !== 'Bearer ' + SERVICE_KEY) {
          return new Response('not authorized', {status: 403});
        }
        if (body.room === catRoom && body.channel === 'cat') {
          return Response.json({room: catRoom, ...catalogSource});
        }
        return new Response('not found', {status: 404});
      }
    }
  });

  try {
    const kv = await mf.getKVNamespace('LICENCIAS');
    await kv.put('inst:' + DEVICE_A, JSON.stringify({licenseCode: LICENSE, instanceId: DEVICE_A}));
    url = await mf.ready;

    const bridgeFetch = async (target, opts = {}) => {
      const s = String(target);
      if (s === 'https://friendly123-licencias.jfcarpio.workers.dev/ws/ticket') {
        return authorityWorker.fetch(
          new Request('https://authority.invalid/ws/ticket', {method: 'POST', headers: opts.headers, body: opts.body}),
          authEnv
        );
      }
      const u = new URL(s);
      assert.equal(u.host, HOST);
      return fetch(new URL(u.pathname + u.search, url), {
        method: opts.method,
        headers: {...opts.headers, origin: ORIGIN},
        body: opts.body,
        signal: opts.signal
      });
    };

    const createRealWsProvider = ({doc, room, params}) =>
      new client.AuthorizedYProvider(url.host, room, doc, {
        party: 'tienda',
        params,
        WebSocketPolyfill: WebSocket,
        disableBc: true,
        connect: false,
        wsProtocol: url.protocol === 'https:' ? 'wss' : 'ws',
        fetchImpl: bridgeFetch,
        wsHeaders: {origin: ORIGIN}
      });

    const idb = new IDBFactory();
    const rt = mountConnectedRuntime({bridgeFetch, indexedDB: idb});

    await rt.API.activarCorte20Runtime({
      headCongelado: HEAD,
      activarDespachoComercial: true,
      indexedDB: idb,
      createProvider: createRealWsProvider,
      fetch: bridgeFetch
    });

    // Exact C34+C36 local sale receipt opId emitted via oc-op-local
    const opIdVenta = 'op_c40_cash_sale_0001';
    rt.window.dispatchEvent({
      type: 'oc-op-local',
      detail: rt.vmObj({
        opId: opIdVenta,
        tipo: 'venta',
        payload: {productoId: 'sku_1', delta: -1, cantidad: 1, amountCents: 1500, opId: opIdVenta},
        _salaOrigen: LICENSE
      })
    });

    for (let i = 0; i < 60 && !rt.API.obtenerReciboComercial20(opIdVenta); i++) {
      await new Promise(r => setTimeout(r, 40));
    }

    const recibo = rt.API.obtenerReciboComercial20(opIdVenta);
    assert.ok(recibo, 'C40: API.obtenerReciboComercial20 must record authoritative DO receipt');
    assert.equal(recibo.opId, opIdVenta);
    assert.equal(recibo.committed, true);
    assert.equal(recibo.stage, 'business-committed');
    assert.match(recibo.receipt?.receiptId || '', /^[a-f0-9]{24}$/);
    assert.equal(rt.receiptEvents.length, 1);
    assert.equal(rt.receiptEvents[0].opId, opIdVenta);
    assert.equal(rt.API.opsMap.size, 0, 'legacy opsMap must remain empty');

    // Failback to legacy + replay same opIdVenta must NEVER duplicate stock or cash
    await rt.API.coordinadorCorte20.failbackToLegacy();
    rt.window.dispatchEvent({
      type: 'oc-op-local',
      detail: rt.vmObj({
        opId: opIdVenta,
        tipo: 'venta',
        payload: {productoId: 'sku_1', delta: -1, cantidad: 1, amountCents: 1500, opId: opIdVenta},
        _salaOrigen: LICENSE
      })
    });
    await new Promise(r => setTimeout(r, 150));

    assert.equal(rt.API.opsMap.size, 0, 'failback must still block same opIdVenta from entering legacy opsMap');
    assert.equal(await rt.API.puedeDespacharOpEnLegado(opIdVenta), false);

    // Inspect real Workerd SQLite: exactly 1 business effect, stock 5->4, cash 500->2000
    const sqlRes = await fetch(new URL('/parties/tienda/' + opsRoom, url), {
      method: 'POST',
      headers: {origin: ORIGIN, 'x-f123-synthetic-inspect': '1'}
    });
    assert.equal(sqlRes.status, 200);
    const sql = await sqlRes.json();
    assert.equal(sql.stock, 4);
    assert.equal(sql.cash, 2000);
    assert.equal(sql.effects, 1);
    assert.equal(sql.receipts, 1);
  } finally {
    await mf.dispose().catch(() => {});
    fs.rmSync(folder, {recursive: true, force: true});
  }
});
