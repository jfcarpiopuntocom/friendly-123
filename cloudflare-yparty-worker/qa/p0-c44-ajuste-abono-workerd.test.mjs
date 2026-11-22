// PORT2 C44: End-to-end REAL Workerd SQLite verification of ajuste (stock.adjust) and abono (credit.payment.record):
// docs/sync-realtime.js (OCSyncEmit preserving durable opId) -> docs/sync-yjs.js (publicarOpLocal +
// _traducirOpLegadoAComando20 + obtenerReciboComercial20) -> compiled yparty-piloto.min.js ->
// real Workerd -ops DO SQLite (stock 5->8, receivable debt 3000->1500, 0 duplicates on replay, USD 0.00).

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
const DEVICE_A = 'synthetic-c44-owner-pc-a';
const SERVICE_KEY = 'synthetic-c44-private-service-key-32chars!';
const ORIGIN = 'https://synthetic-c44.test';
const HEAD = 'certified-c44-frozen-head-20261119';

const roomId = await salaDeLicencia(LICENSE);
const catRoom = roomId + '-cat';
const opsRoom = roomId + '-ops';
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

const workerDir = fileURLToPath(new URL('..', import.meta.url));
const repoRoot = path.resolve(workerDir, '..');
const SYNC_YJS_SRC = fs.readFileSync(path.join(repoRoot, 'docs', 'sync-yjs.js'), 'utf8');
const SYNC_REALTIME_SRC = fs.readFileSync(path.join(repoRoot, 'docs', 'sync-realtime.js'), 'utf8');
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

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'f123-c44-client-'));
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

function extractSyncEmit(src) {
  const s = src.indexOf('window.OCSyncEmit = function (tipo, payload) {');
  const e = src.indexOf('\n  };', s) + 4;
  assert.ok(s > 0 && e > s);
  return src.slice(s, e);
}

const syncSections = extractSyncYjsRuntime(SYNC_YJS_SRC);
const syncEmitSrc = extractSyncEmit(SYNC_REALTIME_SRC);

function buildFrozenCatalogSource() {
  const d = new CY.Doc();
  d.clientID = 701;
  const frames = [];
  d.on('update', u => frames.push([...u]));
  d.getMap('productos').set('sku_1', {id: 'sku_1', nombre: 'Café C44', precio: 15, stockActual: 5});
  d.getMap('ubicaciones').set('shelf-1', {id: 'shelf-1', nombre: 'Percha C44', activa: true});
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
  const store = new Map();
  return {
    get: async k => store.get(k),
    put: async (k, v) => { store.set(k, v); },
    transaction: async fn => fn({
      get: async k => store.get(k),
      put: async (k, v) => { store.set(k, v); },
      delete: async k => { store.delete(k); },
      list: async () => new Map(store)
    })
  };
}

function createStorage() {
  const m = new Map([
    ['f123_licencia', LICENSE],
    ['f123_device_id', DEVICE_A],
    ['f123_owned', JSON.stringify({licenseCode: LICENSE, instanceId: DEVICE_A})]
  ]);
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: k => m.delete(k)
  };
}

function mountConnectedRuntime({bridgeFetch, indexedDB}) {
  const localStorage = createStorage();
  const listeners = new Map();
  const receiptEvents = [];
  const window = {
    indexedDB,
    location: {origin: ORIGIN, href: ORIGIN + '/'},
    OCAuth: {rolActual: () => 'dueno'},
    OCSecure: {leerPinQueAbre: () => ({owner: '123', team: null})},
    OCSyncControl: {
      estado: () => 'apagado',
      salaActiva: () => null,
      durabilidadPendiente: () => false,
      onEstado: () => () => {},
      desactivar: () => {}
    },
    addEventListener: (t, fn) => {
      if (!listeners.has(t)) listeners.set(t, []);
      listeners.get(t).push(fn);
    },
    removeEventListener: (t, fn) => {
      const a = listeners.get(t) || [];
      const i = a.indexOf(fn);
      if (i >= 0) a.splice(i, 1);
    },
    dispatchEvent: ev => {
      if (ev?.type === 'oc-op-20-recibo') receiptEvents.push(ev.detail);
      for (const fn of [...(listeners.get(ev?.type) || [])]) fn(ev);
      return true;
    }
  };
  const document = {
    visibilityState: 'visible',
    addEventListener: () => {},
    removeEventListener: () => {}
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
  ctx.__c44Boot = {codigo: LICENSE, piloto, headCongeladoQa: HEAD, Y: window.Y};

  const runtime = vm.runInContext(`
    (function () {
      var codigo = __c44Boot.codigo;
      var piloto = __c44Boot.piloto;
      var headCongeladoQa = __c44Boot.headCongeladoQa;
      var Y = __c44Boot.Y;
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
      API.doc.getMap('productos').set('sku_1', { id: 'sku_1', nombre: 'Café C44', precio: 15, stockActual: 5 });
      API.doc.getMap('ubicaciones').set('shelf-1', { id: 'shelf-1', nombre: 'Percha C44', activa: true });
      function _instalarLectorFotoShaBajoDemanda() {}
      ${syncSections.facade}
      ${syncSections.publicarOpLocal}
      window.addEventListener('oc-op-local', function (ev) { try { publicarOpLocal(ev.detail); } catch (_) {} });

      // Mount real OCSyncEmit from docs/sync-realtime.js in roomless Yjs journal mode
      var _seq = 0;
      var _lamport = 0;
      var _pendientes = [];
      function uuidCorto() { return 'u_' + (++_seq); }
      function leerSala() { return null; }
      function codigoCuadernoActivo() { return codigo; }
      function deviceId() { return ${JSON.stringify(DEVICE_A)}; }
      function siguienteLamport() { return ++_lamport; }
      function leerPendientesYjs() { return _pendientes; }
      function guardarPendientesYjs(_c, arr) { _pendientes = arr; return true; }
      function drenarPendientesYjs() {
        while (_pendientes.length) {
          var next = _pendientes.shift();
          window.dispatchEvent(new CustomEvent('oc-op-local', { detail: next }));
        }
      }
      ${syncEmitSrc}
      return { API: API, OCSyncEmit: window.OCSyncEmit };
    })()
  `, ctx);

  return {
    window,
    API: runtime.API,
    OCSyncEmit: runtime.OCSyncEmit,
    receiptEvents,
    vmObj: obj => vm.runInContext('(' + JSON.stringify(obj) + ')', ctx)
  };
}

test('C44 Workerd E2E: OCSyncEmit -> sync-yjs -> Workerd -ops DO executes stock.adjust & credit.payment.record idempotently', {timeout: 75000}, async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'f123-c44-workerd-'));
  const db = fakeDb();
  await db.transaction(async tx => {
    await tx.put('inst:' + DEVICE_A, {licenseCode: LICENSE, instanceId: DEVICE_A});
  });

  const authEnv = {
    PIN_PEPPER: 'synthetic-c44-owner-pepper-long-key-01',
    TEAM_PIN_PEPPER: 'synthetic-c44-team-pepper-long-key--02',
    TEAM_AUTHORITY_QA: '1',
    TEAM_AUTHORITY_LICENSE: LICENSE,
    WS_AUTHORITY_QA: '1',
    WS_QA_ROLE_GRANTS: JSON.stringify({empleado: ['ops:sale', 'fotos:read']}),
    WS_SIGNING_KEY: 'synthetic-c44-signing-key-long-private',
    WS_SERVICE_KEY: SERVICE_KEY
  };

  const ownerAuth = pinAuthority(db, authEnv.PIN_PEPPER);
  await ownerAuth.masterSet(LICENSE, '123', 0, [DEVICE_A]);
  await ownerAuth.masterActivate(LICENSE, '123', 0, [DEVICE_A]);
  const registry = new RegistroLicencias({storage: db}, authEnv);
  authEnv.REGISTROS = {
    idFromName: () => ({}),
    get: () => ({fetch: (input, init) => registry.fetch(new Request(input, init))})
  };
  const catalogSource = buildFrozenCatalogSource();

  let url;
  const mf = new Miniflare({
    modules: true,
    script: compiledWorker,
    compatibilityDate: '2026-06-01',
    compatibilityFlags: ['nodejs_compat'],
    kvNamespaces: ['LICENCIAS'],
    durableObjects: {Tienda: {className: 'Tienda', useSQLite: true}},
    durableObjectsPersist: path.join(folder, 'do'),
    bindings: {
      HOST_CANONICO: HOST,
      SALA_PILOTO: roomId,
      WS_AUTHORITY_QA: '1',
      WS_SEPARATE_ROOMS_QA: '1',
      WS_CATALOG_ORIGIN_QA: ORIGIN,
      WS_SIGNING_KEY: authEnv.WS_SIGNING_KEY,
      WS_OPEN_EXISTING_QA: '1',
      WS_FROZEN_HISTORY_QA: '1',
      WS_FROZEN_HEAD_QA: HEAD,
      WS_CATALOG_SINGLE_WRITER_QA: '1',
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

    // 1) Stock adjustment via real OCSyncEmit -> stock.adjust (5 -> 8)
    const opIdAdj = 'adj_c44_real_0001';
    assert.equal(rt.OCSyncEmit('ajuste', rt.vmObj({
      opId: opIdAdj,
      productoId: 'sku_1',
      delta: 3,
      stockNuevo: 8
    })), true);

    for (let i = 0; i < 60 && !rt.API.obtenerReciboComercial20(opIdAdj); i++) {
      await new Promise(r => setTimeout(r, 40));
    }
    const recAdj = rt.API.obtenerReciboComercial20(opIdAdj);
    assert.ok(recAdj, 'ajuste receipt must be recorded');
    assert.equal(recAdj.opId, opIdAdj);
    assert.equal(recAdj.committed, true);
    assert.equal(recAdj.stage, 'business-committed');

    // 2) Customer credit payment via real OCSyncEmit -> credit.payment.record (3000 -> 1500)
    const opIdAbono = 'abono_c44_real_0001';
    assert.equal(rt.OCSyncEmit('abono', rt.vmObj({
      opId: opIdAbono,
      clienteId: 'cli-1',
      receivableId: 'fiado_1',
      movimientoId: 'mov_1',
      amountCents: 1500,
      monto: 15
    })), true);

    for (let i = 0; i < 60 && !rt.API.obtenerReciboComercial20(opIdAbono); i++) {
      await new Promise(r => setTimeout(r, 40));
    }
    const recAbono = rt.API.obtenerReciboComercial20(opIdAbono);
    assert.ok(recAbono, 'abono receipt must be recorded');
    assert.equal(recAbono.opId, opIdAbono);
    assert.equal(recAbono.committed, true);
    assert.equal(recAbono.stage, 'business-committed');

    // 3) Replay same abono opId must produce 0 duplicate debt reduction
    assert.equal(rt.OCSyncEmit('abono', rt.vmObj({
      opId: opIdAbono,
      clienteId: 'cli-1',
      receivableId: 'fiado_1',
      movimientoId: 'mov_1',
      amountCents: 1500,
      monto: 15
    })), true);
    await new Promise(r => setTimeout(r, 150));

    // Verify real -ops DO SQLite state via Tienda synthetic inspect
    const snapRes = await fetch(new URL('/parties/tienda/' + opsRoom, url), {
      method: 'POST',
      headers: {origin: ORIGIN, 'x-f123-synthetic-inspect': '2'}
    });
    assert.equal(snapRes.status, 200);
    const snap = await snapRes.json();
    assert.equal(snap.stock, 8, 'DO SQLite stock must be adjusted 5 -> 8');
    assert.equal(snap.debt, 1500, 'DO SQLite receivable debt must be reduced 3000 -> 1500 once');
    assert.equal(snap.receipts, 2, 'Exactly 2 receipts (1 ajuste + 1 abono)');
    assert.equal(snap.effects, 2, 'Exactly 2 effects (0 duplicate on replay)');
    assert.equal(rt.API.opsMap.size, 0, 'legacy opsMap must remain empty');
  } finally {
    await mf.dispose();
    fs.rmSync(folder, {recursive: true, force: true});
  }
});
