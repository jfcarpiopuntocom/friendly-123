// C56 RED: real Workerd business-committed receipts and SQL financial readback across A→B→A (C54 active).
// 1. Double-QA bootstrap (f123_yparty_qa=1 + f123_corte20_qa=1) activates 2.0 on Device A.
// 2. Legacy Yjs senders (canalSombra, fotosCanal, opsCanal) emit 0 updates while 2.0 is active.
// 3. Commercial ops (A sale + A adjust + B sale) route to -ops DO SQLite (0 opsMap shadow) +
//    hung navigator.locks.request aborts after bounded timeout and recovers via mutarOutboxAtomicoSinLocks.
// 4. Cross-device A -> B -> A downpath: NO false ACK (fence != business receipt); Device A failbackToLegacy -> legacy senders resume ->
//    Device B takes over 2.0 & emits sale #4 -> Device B oc-logout -> Device A resumes 2.0
//    and converges to THREE NEW business-committed ops in Workerd SQLite with 0 duplicates. No Yjs frozen ops in this QA economic fixture.

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
const DEVICE_A = 'synthetic-c53-owner-pc-a';
const DEVICE_B = 'synthetic-c53-owner-safari-b';
const SERVICE_KEY = 'synthetic-c53-private-service-key-32chars!';
const ORIGIN = 'https://synthetic-c53.test';
const HEAD = 'certified-c53-frozen-head-20261119';

const roomId = await salaDeLicencia(LICENSE);
const catRoom = roomId + '-cat';
const opsRoom = roomId + '-ops';
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

const workerDir = fileURLToPath(new URL('..', import.meta.url));
const repoRoot = path.resolve(workerDir, '..');
const SYNC_YJS_SRC = fs.readFileSync(path.join(repoRoot, 'docs', 'sync-yjs.js'), 'utf8');
const BUNDLE_CODE = fs.readFileSync(path.join(repoRoot, 'docs', 'vendor', 'yparty-piloto.min.js'), 'utf8');
const YJS_BUNDLE_CODE = fs.readFileSync(path.join(repoRoot, 'docs', 'vendor', 'yjs-bundle.min.js'), 'utf8');

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'f123-c53-client-'));
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
const client = await import(pathToFileURL(clientOut).href);
process.on('exit', () => fs.rmSync(scratch, {recursive: true, force: true}));
const CY = client.Y;

function extractSection(src, startMarker, endMarker) {
  const s = src.indexOf(startMarker);
  const e = src.indexOf(endMarker, s);
  assert.ok(s > 0 && e > s, `Missing section: ${startMarker}`);
  return src.slice(s, e);
}

const secOutbox = extractSection(SYNC_YJS_SRC, '    function mutarOutbox(change) {', '    var _durableQueue =');
const secLector = extractSection(SYNC_YJS_SRC, '    function _instalarLectorFotoShaBajoDemanda() {', '    _instalarLectorFotoShaBajoDemanda();');
const secFacade = extractSection(
  SYNC_YJS_SRC,
  '    if (piloto && typeof piloto.crearClienteFotosShaCertificado === "function") {',
  '    API.opsDoc.on("update"'
);
const secPub = extractSection(SYNC_YJS_SRC, '  function publicarOpLocal(op) {', '  function pedirProcesarEventos() {');
const secDocUpdate = extractSection(SYNC_YJS_SRC, '    API.doc.on("update", function (update, origin) {', '    // B3 (JFC 2026-09-10):');
const secFotosUpdate = extractSection(SYNC_YJS_SRC, '    API.fotosDoc.on("update", function (update, origin) {', '    // SYNC DE VENTAS/OPS');
const secOpsUpdate = extractSection(SYNC_YJS_SRC, '    API.opsDoc.on("update", function (update, origin) {', '    // Publicar al doc de ops cada venta/movimiento local');
const secRearmHelper = extractSection(SYNC_YJS_SRC, '    function _intentarActivarCorte20SiElegible() {', '    function sincronizarVisibilidad() {');
const secQaSwitch = extractSection(SYNC_YJS_SRC, '    API.corte20QaHabilitado = function () {', '    API.estado = "activo";');

function buildFrozenCatalogSource() {
  const d = new CY.Doc();
  d.clientID = 801;
  const frames = [];
  d.on('update', u => frames.push([...u]));
  d.getMap('productos').set('sku_1', {id: 'sku_1', nombre: 'Café C53', precio: 15, stockActual: 5});
  d.getMap('ubicaciones').set('shelf-1', {id: 'shelf-1', nombre: 'Percha C53', activa: true});
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
  d.clientID = 802;
  const frames = [];
  d.on('update', u => frames.push([...u]));
  d.getMap('eventos').set('op_frozen_0', {opId: 'op_frozen_0'});
  const src = {
    channel: 'ops',
    frozenHead: HEAD,
    completeToHead: true,
    expectedOpIds: 1,
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

function mountBrowserSyncRuntime({
  bridgeFetch,
  role,
  instanceId,
  ownerPin,
  indexedDB,
  qaStorage = {}
}) {
  const docListeners = new Map();
  const winListeners = new Map();
  const sentLegacy = {canal: 0, canalSombra: 0, fotosCanal: 0, opsCanal: 0};
  let lockFallbackCalls = 0;

  const document = {
    hidden: false,
    addEventListener(ev, fn) {
      if (!docListeners.has(ev)) docListeners.set(ev, new Set());
      docListeners.get(ev).add(fn);
    },
    removeEventListener(ev, fn) { docListeners.get(ev)?.delete(fn); }
  };

  const OCFotos = {
    async hashesGuardados() { return []; },
    async leerPorHash() { return null; },
    async hashDeDataUrl() { return ''; },
    async guardarPorHash() { return true; }
  };

  const window = {
    indexedDB,
    OCAuth: {rolActual: () => role, esDemo: () => false},
    OCSecure: {leerPinQueAbre: () => ({owner: ownerPin, team: null})},
    OCFotos,
    OCSyncControl: {
      estado: () => 'apagado',
      salaActiva: () => null,
      durabilidadPendiente: () => false,
      onEstado: () => {},
      catalogoPropio: () => ({productos: [{id: 'sku_1', nombre: 'Café C53', precio: 15, stockActual: 5}], ubicaciones: [], gastos: []}),
      hashearFotosProductos: async () => 0,
      hashearFotosPerchas: async () => 0
    },
    addEventListener(ev, fn) {
      if (!winListeners.has(ev)) winListeners.set(ev, new Set());
      winListeners.get(ev).add(fn);
    },
    removeEventListener(ev, fn) { winListeners.get(ev)?.delete(fn); },
    dispatchEvent(ev) {
      for (const fn of winListeners.get(ev?.type) || []) fn(ev);
    }
  };

  const qaState = {...qaStorage};
  const localStorage = {
    getItem(k) {
      if (k === 'f123_owned') return JSON.stringify({licenseCode: LICENSE, instanceId});
      return Object.prototype.hasOwnProperty.call(qaState, k) ? qaState[k] : null;
    },
    setItem(k, v) { qaState[k] = String(v); }
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
    console,
    navigator: {
      locks: {
        request(_name, optsOrRun) {
          const sig = optsOrRun && optsOrRun.signal;
          return new Promise((_res, rej) => {
            if (sig) {
              sig.addEventListener('abort', () => {
                const err = new Error('aborted');
                err.name = 'AbortError';
                rej(err);
              }, {once: true});
            }
          });
        }
      }
    }
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

  ctx.__c53Boot = {
    codigo: LICENSE,
    piloto,
    headCongeladoQa: HEAD,
    Y: window.Y,
    sentLegacy,
    onFallback: () => { lockFallbackCalls += 1; }
  };

  const runtime = vm.runInContext(`
    (function () {
      var codigo = __c53Boot.codigo;
      var piloto = __c53Boot.piloto;
      var headCongeladoQa = __c53Boot.headCongeladoQa;
      var Y = __c53Boot.Y;
      var sentLegacy = __c53Boot.sentLegacy;
      var _fotosSembradas = {};
      var _fotosSembradasDoc = null;
      var _fotosSembrando = false;
      var _fotosSembrarDeNuevo = false;
      var _fotosReintentoTimer = null;
      var _fotosReintentosLectura = 0;
      function _esperarFoto(p) { return Promise.resolve(p); }
      function _hashFotoSinStore() { return Promise.resolve(''); }
      var docHandlers = {};
      function wrapDoc(d, name) {
        var orig = d.on.bind(d);
        d.on = function (ev, fn) {
          if (ev === 'update') docHandlers[name] = fn;
          return orig(ev, fn);
        };
        return d;
      }
      var API = {
        roomId: '${roomId}',
        clave: new Uint8Array(32),
        __outboxLockTimeoutMs: 25,
        doc: wrapDoc(new Y.Doc(), 'doc'),
        opsDoc: wrapDoc(new Y.Doc(), 'opsDoc'),
        fotosDoc: wrapDoc(new Y.Doc(), 'fotosDoc'),
        idb: {},
        fotosIdb: {},
        opsIdb: {},
        fotosRefs: null,
        canalPiloto: { proveedor: 'https://${HOST}' },
        canal: { enviarUpdate: function () { sentLegacy.canal += 1; } },
        canalSombra: { enviarUpdate: function () { sentLegacy.canalSombra += 1; } },
        fotosCanal: { ws: { relayLayer: 'local' }, enviarUpdate: function () { sentLegacy.fotosCanal += 1; } },
        opsCanal: { enviarUpdate: function () { sentLegacy.opsCanal += 1; } },
        fotoSha: null
      };
      API.opsMap = API.opsDoc.getMap('eventos');
      API.fotosMap = API.fotosDoc.getMap('blobs');
      API.fotosRefs = API.doc.getMap('fotos_refs');
      API.doc.getMap('productos').set('sku_1', { id: 'sku_1', nombre: 'Café C53', precio: 15, stockActual: 5 });
      API.doc.getMap('ubicaciones').set('shelf-1', { id: 'shelf-1', nombre: 'Percha C53', activa: true });
      var suffix = '';
      var _outbox = { pending: [], checkpoint: '', confirmed: [] };
      var _unsaved = [];
      var _groupAcks = new Set();
      function leerOutbox() { return Promise.resolve({ pending: [], checkpoint: '', confirmed: [] }); }
      function guardarOutbox() { return Promise.resolve(); }
      function avisarDurable() {}
      function mutarOutboxAtomicoSinLocks(change) {
        __c53Boot.onFallback();
        change();
        return Promise.resolve({ fallback: true });
      }
      function pedirVolcarFotos() {}
      function pedirProcesarEventos() {}
      ${secOutbox}
      ${secLector}
      ${secFacade}
      ${secPub}
      ${secDocUpdate}
      ${secFotosUpdate}
      ${secOpsUpdate}
      ${secRearmHelper}
      ${secQaSwitch}
      return {
        API: API,
        docHandlers: docHandlers,
        mutarOutbox: mutarOutbox,
        publicarOpLocal: publicarOpLocal
      };
    })()
  `, ctx);

  return {
    ctx,
    window,
    localStorage,
    API: runtime.API,
    docHandlers: runtime.docHandlers,
    mutarOutbox: runtime.mutarOutbox,
    publicarOpLocal: runtime.publicarOpLocal,
    sentLegacy,
    getLockFallbackCalls: () => lockFallbackCalls,
    vmObj: obj => vm.runInContext('(' + JSON.stringify(obj) + ')', ctx)
  };
}

test('C56 Workerd E2E: three authoritative business receipts, C54 legacy-primary fence and A->B->A SQL downpath', {timeout:120000}, async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'f123-c53-'));
  // GREEN: reuse existing C49 QA-only fixture (already exercised in Workerd).
  // It installs synthetic opening stock/cash in THIS -ops DO, then delegates
  // all production business commands to unmodified RealTienda.onRequest.
  // Frozen -cat continues; -ops Yjs history is deliberately not imported into
  // this synthetic SQL economic seed. Such a join needs REAL historical proof.
  const seededEntry = path.join(workerDir, 'qa/fixtures/seeded-real-yparty-business-worker.mjs');
  const bundleResult = await build({
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
    write: false,
    format: 'esm',
    platform: 'neutral',
    mainFields: ['module', 'main'],
    conditions: ['workerd', 'worker'],
    external: ['cloudflare:*', 'node:*']
  });
  const compiledWorker = bundleResult.outputFiles[0].text;

  const db = fakeDb();
  await db.transaction(async tx => {
    await tx.put('inst:' + DEVICE_A, {licenseCode: LICENSE, instanceId: DEVICE_A});
    await tx.put('inst:' + DEVICE_B, {licenseCode: LICENSE, instanceId: DEVICE_B});
  });

  const authEnv = {
    PIN_PEPPER: 'synthetic-c53-owner-pepper-long-key-01',
    TEAM_PIN_PEPPER: 'synthetic-c53-team-pepper-long-key--02',
    TEAM_AUTHORITY_QA: '1',
    TEAM_AUTHORITY_LICENSE: LICENSE,
    WS_AUTHORITY_QA: '1',
    WS_QA_ROLE_GRANTS: JSON.stringify({
      admin: ['ops:sale', 'ops:adjust', 'ops:payment', 'fotos:read'],
      empleado: ['ops:sale', 'ops:payment', 'fotos:read']
    }),
    WS_SIGNING_KEY: 'synthetic-c53-signing-key-long-private',
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
  // Intentionally no fabricated Yjs frozen-ops source in certified business SQL QA fixture.
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
        if (body.room === opsRoom && body.channel === 'ops') {
          // QA economics baseline must not be passed off as a reconciled
          // historical -ops snapshot + money opening cut.
          return new Response('historical ops/economic cut not certified', {status: 409});
        }
        return new Response('not found', {status: 404});
      }
    }
  });
  const kv = await mf.getKVNamespace('LICENCIAS');
  await kv.put('inst:' + DEVICE_A, JSON.stringify({licenseCode: LICENSE, instanceId: DEVICE_A}));
  await kv.put('inst:' + DEVICE_B, JSON.stringify({licenseCode: LICENSE, instanceId: DEVICE_B}));
  url = await mf.ready;

  // An opId tombstone/legacy-write fence is NOT an authoritative business receipt.
  // RED must fail while this real Workerd has no separately certified SQL baseline.
  async function requireBusinessCommitted(api, opId) {
    for (let attempt = 0; attempt < 25; attempt++) {
      const receipt = api.obtenerReciboComercial20?.(opId);
      if (receipt?.committed === true && receipt?.stage === 'business-committed' &&
          receipt?.receipt?.opId === opId) return receipt;
      await new Promise(resolve => setTimeout(resolve, 80));
    }
    assert.fail('C56 missing business-committed DO receipt for ' + opId +
      '; local outbox/fence or 202 is NOT an ACK');
  }

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

  const idbA = new IDBFactory();
  const idbB = new IDBFactory();

  try {
    // 1) Device A checks double-QA gate (false until both flags set) and activates 2.0
    const devA = mountBrowserSyncRuntime({
      bridgeFetch,
      role: 'dueno',
      instanceId: DEVICE_A,
      ownerPin: '123',
      indexedDB: idbA,
      qaStorage: {f123_yparty_qa: '1'}
    });
    assert.equal(devA.API.corte20QaHabilitado(), false);
    devA.localStorage.setItem('f123_corte20_qa', '1');
    assert.equal(devA.API.corte20QaHabilitado(), true);

    await devA.API.activarCorte20Runtime({
      headCongelado: HEAD,
      activarDespachoComercial: true,
      cortarLegadoFotos: true,
      indexedDB: idbA,
      createProvider: createRealWsProvider,
      fetch: bridgeFetch
    });
    assert.equal(devA.API.modoCorte20Activo, true);

    // 2) C52: legacy senders emit 0 updates while 2.0 cutover is active
    const fakeUpdate = new Uint8Array([1, 2, 3]);
    devA.docHandlers.doc(fakeUpdate, 'local');
    devA.docHandlers.fotosDoc(fakeUpdate, 'local');
    devA.docHandlers.opsDoc(fakeUpdate, 'local');
    assert.deepEqual(devA.sentLegacy, {canal: 0, canalSombra: 0, fotosCanal: 0, opsCanal: 0}, 'C54: selected primary is an OLD relay and MUST NOT publish while 2.0 is active');

    // 3) C51: hung Web Lock aborts and falls back cleanly
    let mutated = false;
    await devA.mutarOutbox(() => { mutated = true; });
    assert.equal(mutated, true);
    assert.equal(devA.getLockFallbackCalls(), 1);

    // 4) Three NEW business-committed operations against synthetic QA SQL opening state.
    for (const op of [
      {opId: 'op_c53_sale_1', tipo: 'venta', payload: {productoId: 'sku_1', cantidad: 1, total: 15}, _salaOrigen: LICENSE},
      {opId: 'op_c53_adj_2', tipo: 'ajuste', payload: {productoId: 'sku_1', stockNuevo: 9}, _salaOrigen: LICENSE}
    ]) {
      devA.publicarOpLocal(devA.vmObj(op));
      await requireBusinessCommitted(devA.API, op.opId);
    }
    assert.equal(devA.API.opsMap.size, 0, 'unexpected opsMap keys: ' + JSON.stringify(Array.from(devA.API.opsMap.entries())));

    // 5) Device A fails back via oc-logout -> legacy senders resume
    devA.window.dispatchEvent({type: 'oc-logout', detail: {}});
    assert.equal(devA.API.modoCorte20Activo, false);
    assert.equal(devA.API.corteFotosShaActivo, false);
    devA.docHandlers.doc(fakeUpdate, 'local');
    devA.docHandlers.fotosDoc(fakeUpdate, 'local');
    devA.docHandlers.opsDoc(fakeUpdate, 'local');
    assert.deepEqual(devA.sentLegacy, {canal: 1, canalSombra: 1, fotosCanal: 1, opsCanal: 1}, 'old relay resumes exactly once only after logout/certified failback');

    // 6) Device B activates 2.0, emits THIRD NEW SQL business op, then logs out
    const devB = mountBrowserSyncRuntime({
      bridgeFetch,
      role: 'dueno',
      instanceId: DEVICE_B,
      ownerPin: '123',
      indexedDB: idbB,
      qaStorage: {f123_yparty_qa: '1'}
    });
    await devB.API.activarCorte20Runtime({
      headCongelado: HEAD,
      activarDespachoComercial: true,
      cortarLegadoFotos: true,
      indexedDB: idbB,
      createProvider: createRealWsProvider,
      fetch: bridgeFetch
    });
    devB.publicarOpLocal(devB.vmObj({
      opId: 'op_c53_sale_b_4',
      tipo: 'venta',
      payload: {productoId: 'sku_1', cantidad: 1, total: 15},
      _salaOrigen: LICENSE
    }));
    await requireBusinessCommitted(devB.API, 'op_c53_sale_b_4');
    devB.window.dispatchEvent({type: 'oc-logout', detail: {}});
    assert.equal(devB.API.modoCorte20Activo, false);

    // 7) Device A re-activates 2.0 and verifies durable C29 fence, three SQL receipts, no duplicate
    await devA.API.activarCorte20Runtime({
      headCongelado: HEAD,
      activarDespachoComercial: true,
      cortarLegadoFotos: true,
      indexedDB: idbA,
      createProvider: createRealWsProvider,
      fetch: bridgeFetch
    });
    assert.equal(devA.API.modoCorte20Activo, true);
    assert.equal(devA.API.opsMap.size, 0);
    assert.equal(devB.API.opsMap.size, 0);
    assert.equal(await devA.API.puedeDespacharOpEnLegado('op_c53_sale_1'), false);
    assert.equal(await devA.API.puedeDespacharOpEnLegado('op_c53_adj_2'), false);
    assert.equal(await devB.API.puedeDespacharOpEnLegado('op_c53_sale_b_4'), false);

    // Assert the REAL authoritative Workerd SQLite economic state, not just a
    // local IDB tombstone or zero legacy opsMap keys. Synthetic frozen catalog
    // is distinct from the NO certified-op-history SQL fixture below.
    const sqlResponse = await fetch(new URL('/parties/tienda/' + opsRoom, url), {
      method: 'POST',
      headers: {origin: ORIGIN, 'x-f123-synthetic-inspect': '2'}
    });
    assert.equal(sqlResponse.status, 200, 'C56 Workerd SQL inspect fixture must be present');
    const sql = await sqlResponse.json();
    assert.deepEqual(
      {stock: Number(sql.stock), cash: Number(sql.cash),
       effects: Number(sql.effects), receipts: Number(sql.receipts),
       debt: Number(sql.debt)},
      {stock: 8, cash: 3500, effects: 3, receipts: 3, debt: 3000},
      'A sale + physical adjustment to9 + B sale must commit three opIds exactly once (5->4->9->8), opening cash500->3500'
    );

    // Simulated replay after A returns. The original opId must not credit cash
    // twice or subtract another stock unit.
    devA.publicarOpLocal(devA.vmObj({
      opId: 'op_c53_sale_1',
      tipo: 'venta',
      payload: {productoId: 'sku_1', cantidad: 1, total: 15},
      _salaOrigen: LICENSE
    }));
    await new Promise(r => setTimeout(r, 180));
    const duplicateSqlResponse = await fetch(new URL('/parties/tienda/' + opsRoom, url), {
      method: 'POST',
      headers: {origin: ORIGIN, 'x-f123-synthetic-inspect': '2'}
    });
    assert.equal(duplicateSqlResponse.status, 200);
    const duplicateSql = await duplicateSqlResponse.json();
    assert.deepEqual(
      {stock:Number(duplicateSql.stock),cash:Number(duplicateSql.cash),
       effects:Number(duplicateSql.effects),receipts:Number(duplicateSql.receipts),
       debt:Number(duplicateSql.debt)},
      {stock:8,cash:3500,effects:3,receipts:3,debt:3000},
      'same opId replay after A->B->A must never move physical or cash twice'
    );
  } finally {
    if (mf) await mf.dispose();
    fs.rmSync(folder, {recursive: true, force: true});
  }
});
