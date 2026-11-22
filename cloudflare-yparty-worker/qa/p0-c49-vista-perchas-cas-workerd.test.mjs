// C52 combined master revalidation: real C49 CAS source after C51 v0.8.21 Web Locks + QA-gated cutover merged; assert unchanged.
// PORT2 C49: End-to-end REAL Workerd SQLite verification of shelf photo CAS (409 vs 200)
// in docs/mock-backend.js + docs/idb-fotos.js + docs/application/recover-shelf-photo.js +
// docs/sync-yjs.js <-> Workerd -fotos DO SQLite (USD 0.00).

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
const DEVICE_A = 'synthetic-c49-owner-pc-a';
const DEVICE_B = 'synthetic-c49-team-safari-b';
const EMP_SUBJECT = 'emp_c49_01';
const SERVICE_KEY = 'synthetic-c49-private-service-key-32chars!';
const ORIGIN = 'https://synthetic-c49.test';
const HEAD = 'certified-c49-frozen-head-20261119';

const roomId = await salaDeLicencia(LICENSE);
const catRoom = roomId + '-cat';
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

const workerDir = fileURLToPath(new URL('..', import.meta.url));
const repoRoot = path.resolve(workerDir, '..');
const MOCK_BACKEND_SRC = fs.readFileSync(path.join(repoRoot, 'docs', 'mock-backend.js'), 'utf8');
const SYNC_YJS_SRC = fs.readFileSync(path.join(repoRoot, 'docs', 'sync-yjs.js'), 'utf8');
const IDB_FOTOS_SRC = fs.readFileSync(path.join(repoRoot, 'docs', 'idb-fotos.js'), 'utf8');
const SHELF_PHOTO_POLICY_SRC = fs.readFileSync(path.join(repoRoot, 'docs', 'core', 'shelf-photo-policy.js'), 'utf8');
const RECOVER_PHOTO_SRC = fs.readFileSync(path.join(repoRoot, 'docs', 'application', 'recover-shelf-photo.js'), 'utf8');
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

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'f123-c49-client-'));
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

function extractMockPutUbicacion() {
  const s = MOCK_BACKEND_SRC.indexOf('      if ((m = path.match(/^\\/api\\/ubicaciones\\/([^/]+)$/)) && opts && opts.method === "PUT") {');
  const e = MOCK_BACKEND_SRC.indexOf('        if (body.nombre && body.nombre.trim())', s);
  assert.ok(s > 0 && e > s, 'PUT /api/ubicaciones/:id CAS guard must exist in docs/mock-backend.js');
  const casSnippet = MOCK_BACKEND_SRC.slice(s, e);
  let revSeq = 0;
  return function putUbicacionFotoCas(ubicaciones, id, body) {
    const fn = new Function('ubicaciones', 'path', 'opts', 'body', 'J', '_revNueva', `
      let m;
      ${casSnippet}
        u.fotoHash = body.fotoHash || null;
        u.fotoRev = _revNueva();
        return J(u);
      }
      return J({ error: "not found" }, 404);
    `);
    return fn(
      ubicaciones,
      '/api/ubicaciones/' + id,
      {method: 'PUT'},
      body,
      (data, status = 200) => ({ok: status >= 200 && status < 300, status, data}),
      () => ({c: ++revSeq, d: DEVICE_A})
    );
  };
}

function extractSyncYjsRuntime(src) {
  const sLector = src.indexOf('    function _instalarLectorFotoShaBajoDemanda() {');
  const eLector = src.indexOf('    _instalarLectorFotoShaBajoDemanda();', sLector);
  const sFacade = src.indexOf('    if (piloto && typeof piloto.crearClienteFotosShaCertificado === "function") {');
  const eFacade = src.indexOf('    API.opsDoc.on("update"', sFacade);
  const sSeed = src.indexOf('  function sembrarFotosAlRelay() {');
  const eSeed = src.indexOf('\n  }', sSeed) + 4;
  assert.ok(sLector > 0 && eLector > sLector);
  assert.ok(sFacade > 0 && eFacade > sFacade);
  assert.ok(sSeed > 0 && eSeed > sSeed);
  return {
    lector: src.slice(sLector, eLector),
    facade: src.slice(sFacade, eFacade),
    sembrarFotosAlRelay: src.slice(sSeed, eSeed)
  };
}

const putUbicacionFotoCas = extractMockPutUbicacion();
const syncSections = extractSyncYjsRuntime(SYNC_YJS_SRC);

function buildFrozenCatalogSource() {
  const d = new CY.Doc();
  d.clientID = 701;
  const frames = [];
  d.on('update', u => frames.push([...u]));
  d.getMap('productos').set('sku_1', {id: 'sku_1', nombre: 'Café C49', precio: 15, stockActual: 5});
  d.getMap('ubicaciones').set('shelf-1', {id: 'shelf-1', nombre: 'Percha C49', activa: true});
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

function mountDevice({bridgeFetch, indexedDB, deviceId, role}) {
  const m = new Map([
    ['f123_licencia', LICENSE],
    ['f123_device_id', deviceId],
    ['f123_owned', JSON.stringify({licenseCode: LICENSE, instanceId: deviceId})]
  ]);
  const localStorage = {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: k => m.delete(k)
  };
  const window = {
    indexedDB,
    location: {origin: ORIGIN, href: ORIGIN + '/'},
    OCAuth: {rolActual: () => role},
    OCSecure: {
      leerPinQueAbre: () => (role === 'dueno' ? {owner: '123', team: null} : {owner: null, team: {subject: EMP_SUBJECT, pin: '234'}})
    },
    OCSyncControl: {
      estado: () => 'apagado',
      salaActiva: () => null,
      durabilidadPendiente: () => false,
      onEstado: () => () => {},
      desactivar: () => {}
    },
    OCSync: {
      catalogoPropio: () => ({productos: [], ubicaciones: [], gastos: []})
    },
    addEventListener: () => {},
    removeEventListener: () => {}
  };
  const ctx = vm.createContext({
    window,
    self: window,
    globalThis: null,
    document: {hidden: false, visibilityState: 'visible', addEventListener: () => {}, removeEventListener: () => {}},
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
  window.document = ctx.document;
  window.localStorage = localStorage;
  window.fetch = bridgeFetch;
  window.crypto = globalThis.crypto;

  vm.runInContext(IDB_FOTOS_SRC, ctx, {filename: 'idb-fotos.js'});
  vm.runInContext(SHELF_PHOTO_POLICY_SRC, ctx, {filename: 'shelf-photo-policy.js'});
  vm.runInContext(RECOVER_PHOTO_SRC, ctx, {filename: 'recover-shelf-photo.js'});
  window.F123Application = ctx.F123Application || window.F123Application;
  vm.runInContext(YJS_BUNDLE_CODE, ctx, {filename: 'yjs-bundle.min.js'});
  window.Y = window.Y || ctx.Y;
  vm.runInContext(BUNDLE_CODE, ctx, {filename: 'yparty-piloto.min.js'});

  const piloto = window.F123YPartyPilot(roomId, LICENSE);
  ctx.__c49Boot = {codigo: LICENSE, piloto, headCongeladoQa: HEAD, Y: window.Y};

  const runtime = vm.runInContext(`
    (function () {
      var codigo = __c49Boot.codigo;
      var piloto = __c49Boot.piloto;
      var headCongeladoQa = __c49Boot.headCongeladoQa;
      var Y = __c49Boot.Y;
      var API = {
        doc: new Y.Doc(),
        opsDoc: new Y.Doc(),
        fotosDoc: new Y.Doc(),
        fotosCanal: { conectado: true },
        fotosRefs: null,
        fotoSha: null
      };
      API.opsMap = API.opsDoc.getMap('eventos');
      API.fotosMap = API.fotosDoc.getMap('blobs');
      API.fotosRefs = API.doc.getMap('fotos_refs');
      API.doc.getMap('productos').set('sku_1', { id: 'sku_1', nombre: 'Café C49', precio: 15, stockActual: 5 });
      API.doc.getMap('ubicaciones').set('shelf-1', { id: 'shelf-1', nombre: 'Percha C49', activa: true });
      ${syncSections.lector}
      ${syncSections.facade}
      var _fotosSembrando = false, _fotosReintentoTimer = null, _fotosSembrarDeNuevo = false;
      var _fotosSembradas = {}, _fotosSembradasDoc = null, _fotosReintentosLectura = 0;
      function _esperarFoto(p) { return Promise.resolve(p); }
      ${syncSections.sembrarFotosAlRelay}
      return { API: API, sembrarFotosAlRelay: sembrarFotosAlRelay };
    })()
  `, ctx);

  return {
    window,
    indexedDB,
    API: runtime.API,
    sembrarFotosAlRelay: runtime.sembrarFotosAlRelay,
    vmObj: obj => vm.runInContext('(' + JSON.stringify(obj) + ')', ctx)
  };
}

test('C49 Workerd E2E: mock-backend PUT /ubicaciones CAS (409 vs 200) + idb-fotos + recoverShelfPhoto via -fotos DO', {timeout: 75000}, async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'f123-c49-workerd-'));
  const db = fakeDb();
  await db.transaction(async tx => {
    await tx.put('inst:' + DEVICE_A, {licenseCode: LICENSE, instanceId: DEVICE_A});
    await tx.put('inst:' + DEVICE_B, {licenseCode: LICENSE, instanceId: DEVICE_B});
  });

  const authEnv = {
    PIN_PEPPER: 'synthetic-c49-owner-pepper-long-key-01',
    TEAM_PIN_PEPPER: 'synthetic-c49-team-pepper-long-key--02',
    TEAM_AUTHORITY_QA: '1',
    TEAM_AUTHORITY_LICENSE: LICENSE,
    WS_AUTHORITY_QA: '1',
    WS_QA_ROLE_GRANTS: JSON.stringify({empleado: ['ops:sale', 'fotos:read']}),
    WS_SIGNING_KEY: 'synthetic-c49-signing-key-long-private',
    WS_SERVICE_KEY: SERVICE_KEY
  };

  const ownerAuth = pinAuthority(db, authEnv.PIN_PEPPER);
  await ownerAuth.masterSet(LICENSE, '123', 0, [DEVICE_A, DEVICE_B]);
  await ownerAuth.masterActivate(LICENSE, '123', 0, [DEVICE_A, DEVICE_B]);
  const teamAuth = teamAuthority({storage: db, ownerAuthority: ownerAuth, secret: authEnv.TEAM_PIN_PEPPER});
  assert.equal((await teamAuth.update({
    licenseCode: LICENSE, instanceId: DEVICE_A, ownerPin: '123', opId: 'op_team_c49_01',
    expectedRevision: 0, subject: EMP_SUBJECT, role: 'empleado', pin: '234', active: true
  })).ok, true);

  const registry = new RegistroLicencias({storage: db}, authEnv);
  authEnv.REGISTROS = {idFromName: () => ({}), get: () => ({fetch: (i, init) => registry.fetch(new Request(i, init))})};
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
      HOST_CANONICO: HOST, SALA_PILOTO: roomId, WS_AUTHORITY_QA: '1', WS_SEPARATE_ROOMS_QA: '1',
      WS_CATALOG_ORIGIN_QA: ORIGIN, WS_SIGNING_KEY: authEnv.WS_SIGNING_KEY, WS_OPEN_EXISTING_QA: '1',
      WS_FROZEN_HISTORY_QA: '1', WS_FROZEN_HEAD_QA: HEAD, WS_CATALOG_SINGLE_WRITER_QA: '1',
      WS_TYPED_COMMANDS_QA: '1', WS_TYPED_ORIGIN_QA: ORIGIN, WS_BUSINESS_EXECUTOR_QA: '1',
      WS_PHOTO_BLOBS_QA: '1', WS_PHOTO_ORIGIN_QA: ORIGIN, WS_TEST_ONLY_INTERNAL_SEED: '1', WS_SERVICE_KEY: SERVICE_KEY
    },
    serviceBindings: {
      WS_AUTHORITY: async request => authorityWorker.fetch(new Request(request.url, request), authEnv),
      WS_FROZEN_HISTORY_SOURCE: async request => {
        const body = await request.json();
        if (request.method !== 'POST' || request.headers.get('authorization') !== 'Bearer ' + SERVICE_KEY) {
          return new Response('not authorized', {status: 403});
        }
        if (body.room === catRoom && body.channel === 'cat') return Response.json({room: catRoom, ...catalogSource});
        return new Response('not found', {status: 404});
      }
    }
  });

  try {
    const kv = await mf.getKVNamespace('LICENCIAS');
    await kv.put('inst:' + DEVICE_A, JSON.stringify({licenseCode: LICENSE, instanceId: DEVICE_A}));
    await kv.put('inst:' + DEVICE_B, JSON.stringify({licenseCode: LICENSE, instanceId: DEVICE_B}));
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
      return fetch(new URL(u.pathname + u.search, url), {
        method: opts.method, headers: {...opts.headers, origin: ORIGIN}, body: opts.body, signal: opts.signal
      });
    };

    const createRealWsProvider = ({doc, room, params}) =>
      new client.AuthorizedYProvider(url.host, room, doc, {
        party: 'tienda', params, WebSocketPolyfill: WebSocket, disableBc: true, connect: false,
        wsProtocol: url.protocol === 'https:' ? 'wss' : 'ws', fetchImpl: bridgeFetch, wsHeaders: {origin: ORIGIN}
      });

    const devA = mountDevice({bridgeFetch, indexedDB: new IDBFactory(), deviceId: DEVICE_A, role: 'dueno'});
    const teamB = mountDevice({bridgeFetch, indexedDB: new IDBFactory(), deviceId: DEVICE_B, role: 'empleado'});

    await devA.API.activarCorte20Runtime({
      headCongelado: HEAD, activarDespachoComercial: true, cortarLegadoFotos: true,
      indexedDB: devA.indexedDB, createProvider: createRealWsProvider, fetch: bridgeFetch
    });

    const dataUrlA = 'data:image/png;base64,' + Buffer.from('synthetic-c49-photo-A').toString('base64');
    const dataUrlB = 'data:image/png;base64,' + Buffer.from('synthetic-c49-photo-B').toString('base64');
    const hashA = await devA.window.OCFotos.guardarFotoContenido(dataUrlA);
    const hashB = await devA.window.OCFotos.guardarFotoContenido(dataUrlB);

    // 1) Real mock-backend CAS: first PUT succeeds (200), stale CAS fails (409), valid CAS succeeds (200)
    const ubicaciones = [{id: 'shelf-1', nombre: 'Percha C49', fotoHash: null, fotoRev: null}];
    const r1 = putUbicacionFotoCas(ubicaciones, 'shelf-1', {fotoHash: hashA, expectedFotoHash: null, expectedFotoRev: null});
    assert.equal(r1.status, 200);
    assert.equal(ubicaciones[0].fotoHash, hashA);

    const rStale = putUbicacionFotoCas(ubicaciones, 'shelf-1', {fotoHash: hashB, expectedFotoHash: null, expectedFotoRev: null});
    assert.equal(rStale.status, 409);
    assert.equal(rStale.data.codigo, 'PHOTO_POINTER_CONFLICT');
    assert.equal(ubicaciones[0].fotoHash, hashA, '409 CAS conflict must preserve existing pointer');

    const r2 = putUbicacionFotoCas(ubicaciones, 'shelf-1', {fotoHash: hashB, expectedFotoHash: hashA, expectedFotoRev: ubicaciones[0].fotoRev});
    assert.equal(r2.status, 200);
    assert.equal(ubicaciones[0].fotoHash, hashB);

    // 2) Upload winning hashB to -fotos DO without legacy fotosMap shadow -> Team B recovers exact hashB
    devA.window.OCSync.catalogoPropio = () => devA.vmObj({productos: [], ubicaciones: [{id: 'shelf-1', fotoHash: hashB}], gastos: []});
    devA.sembrarFotosAlRelay();
    for (let i = 0; i < 60 && !devA.API.fotosRefs.get(hashB); i++) await new Promise(r => setTimeout(r, 40));
    assert.ok(devA.API.fotosRefs.get(hashB));
    assert.equal(devA.API.fotosMap.size, 0);

    teamB.API.fotosRefs.set(hashB, teamB.vmObj(devA.API.fotosRefs.get(hashB)));
    teamB.API.cambiarRolComercial20('empleado', {cortarLegadoFotos: true, fetch: bridgeFetch});
    const rec = await teamB.window.F123Application.recoverShelfPhoto(
      {id: 'shelf-1', fotoHash: hashB},
      {
        currentMappedHash: async () => hashB,
        historyHashes: async () => [],
        readPerId: async () => null,
        hashBytes: async b => teamB.window.OCFotos.hashDeDataUrl(b),
        readByHash: async h => teamB.window.OCFotos.leerPorHash(h),
        readSyncByHash: async () => null,
        preserveByHash: async (h, b) => teamB.window.OCFotos.guardarPorHash(h, b),
        preserveById: async (id, b) => teamB.window.OCFotos.guardarFoto(id, b),
        setPointer: async () => false,
        warn: () => {}
      }
    );
    assert.equal(rec?.displayBytes, dataUrlB);
  } finally {
    await mf.dispose();
    fs.rmSync(folder, {recursive: true, force: true});
  }
});
