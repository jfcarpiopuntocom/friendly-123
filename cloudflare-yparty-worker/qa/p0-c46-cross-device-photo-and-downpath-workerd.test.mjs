// PORT2 C46: End-to-end REAL Workerd SQLite verification of:
// 1) browser-photo-cutover: docs/idb-fotos.js + docs/application/recover-shelf-photo.js + docs/sync-yjs.js
//    (Owner uploads photo -> -fotos DO SQLite without API.fotosMap shadow -> cold Team empleado
//    recovers exact photo via F123Application.recoverShelfPhoto -> OCFotos.leerPorHash -> -fotos DO).
// 2) verified-cross-device-downpath (A -> B -> A x2): Owner A -> Team B -> A failbackToLegacy ->
//    re-cutover -> Owner A2 + replay, proving 0 duplicates in Workerd -ops DO SQLite (USD 0.00).

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
const DEVICE_A = 'synthetic-c46-owner-pc-a';
const DEVICE_B = 'synthetic-c46-team-safari-b';
const EMP_SUBJECT = 'emp_c46_01';
const SERVICE_KEY = 'synthetic-c46-private-service-key-32chars!';
const ORIGIN = 'https://synthetic-c46.test';
const HEAD = 'certified-c46-frozen-head-20261119';

const roomId = await salaDeLicencia(LICENSE);
const catRoom = roomId + '-cat';
const opsRoom = roomId + '-ops';
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

const workerDir = fileURLToPath(new URL('..', import.meta.url));
const repoRoot = path.resolve(workerDir, '..');
const SYNC_YJS_SRC = fs.readFileSync(path.join(repoRoot, 'docs', 'sync-yjs.js'), 'utf8');
const SYNC_REALTIME_SRC = fs.readFileSync(path.join(repoRoot, 'docs', 'sync-realtime.js'), 'utf8');
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

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'f123-c46-client-'));
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
  const sLector = src.indexOf('    function _instalarLectorFotoShaBajoDemanda() {');
  const eLector = src.indexOf('    _instalarLectorFotoShaBajoDemanda();', sLector);
  const sFacade = src.indexOf('    if (piloto && typeof piloto.crearClienteFotosShaCertificado === "function") {');
  const eFacade = src.indexOf('    API.opsDoc.on("update"', sFacade);
  const sPub = src.indexOf('  function publicarOpLocal(op) {');
  const ePub = src.indexOf('\n  }', sPub) + 4;
  const sSeed = src.indexOf('  function sembrarFotosAlRelay() {');
  const eSeed = src.indexOf('\n  }', sSeed) + 4;
  assert.ok(sLector > 0 && eLector > sLector);
  assert.ok(sFacade > 0 && eFacade > sFacade);
  assert.ok(sPub > 0 && ePub > sPub);
  assert.ok(sSeed > 0 && eSeed > sSeed);
  return {
    lector: src.slice(sLector, eLector),
    facade: src.slice(sFacade, eFacade),
    publicarOpLocal: src.slice(sPub, ePub),
    sembrarFotosAlRelay: src.slice(sSeed, eSeed)
  };
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
  d.getMap('productos').set('sku_1', {id: 'sku_1', nombre: 'Café C46', precio: 15, stockActual: 5});
  d.getMap('ubicaciones').set('shelf-1', {id: 'shelf-1', nombre: 'Percha C46', activa: true});
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

function createStorage({deviceId}) {
  const m = new Map([
    ['f123_licencia', LICENSE],
    ['f123_device_id', deviceId],
    ['f123_owned', JSON.stringify({licenseCode: LICENSE, instanceId: deviceId})]
  ]);
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: k => m.delete(k)
  };
}

function mountDevice({bridgeFetch, indexedDB, deviceId, role}) {
  const localStorage = createStorage({deviceId});
  const listeners = new Map();
  let legacyState = 'apagado';
  const window = {
    indexedDB,
    location: {origin: ORIGIN, href: ORIGIN + '/'},
    OCAuth: {rolActual: () => role},
    OCSecure: {
      leerPinQueAbre: () => (role === 'dueno' ? {owner: '123', team: null} : {owner: null, team: {subject: EMP_SUBJECT, pin: '234'}})
    },
    OCSyncControl: { estado: () => legacyState, salaActiva: () => null, durabilidadPendiente: () => false, onEstado: () => () => {} },
    OCSync: {
      estado: () => legacyState,
      salaActiva: () => null,
      durabilidadPendiente: () => false,
      onEstado: () => () => {},
      desactivar: () => { legacyState = 'apagado'; },
      catalogoPropio: () => ({productos: [], ubicaciones: [], gastos: []})
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
      for (const fn of [...(listeners.get(ev?.type) || [])]) fn(ev);
      return true;
    }
  };
  const document = {
    hidden: false,
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

  // Real idb-fotos.js + real domain/shelf-photo-policy.js + real application/recover-shelf-photo.js
  vm.runInContext(IDB_FOTOS_SRC, ctx, {filename: 'idb-fotos.js'});
  vm.runInContext(SHELF_PHOTO_POLICY_SRC, ctx, {filename: 'shelf-photo-policy.js'});
  vm.runInContext(RECOVER_PHOTO_SRC, ctx, {filename: 'recover-shelf-photo.js'});
  window.F123Application = ctx.F123Application || window.F123Application;
  vm.runInContext(YJS_BUNDLE_CODE, ctx, {filename: 'yjs-bundle.min.js'});
  window.Y = window.Y || ctx.Y;
  vm.runInContext(BUNDLE_CODE, ctx, {filename: 'yparty-piloto.min.js'});

  const piloto = window.F123YPartyPilot(roomId, LICENSE);
  ctx.__c46Boot = {codigo: LICENSE, piloto, headCongeladoQa: HEAD, Y: window.Y, deviceId};

  const runtime = vm.runInContext(`
    (function () {
      var codigo = __c46Boot.codigo;
      var piloto = __c46Boot.piloto;
      var headCongeladoQa = __c46Boot.headCongeladoQa;
      var Y = __c46Boot.Y;
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
      API.doc.getMap('productos').set('sku_1', { id: 'sku_1', nombre: 'Café C46', precio: 15, stockActual: 5 });
      API.doc.getMap('ubicaciones').set('shelf-1', { id: 'shelf-1', nombre: 'Percha C46', activa: true });
      ${syncSections.lector}
      ${syncSections.facade}
      ${syncSections.publicarOpLocal}
      var _fotosSembrando = false, _fotosReintentoTimer = null, _fotosSembrarDeNuevo = false;
      var _fotosSembradas = {}, _fotosSembradasDoc = null, _fotosReintentosLectura = 0;
      function _esperarFoto(p) { return Promise.resolve(p); }
      ${syncSections.sembrarFotosAlRelay}
      window.addEventListener('oc-op-local', function (ev) { try { publicarOpLocal(ev.detail); } catch (_) {} });

      var _seq = 0;
      var _lamport = 0;
      var _pendientes = [];
      function uuidCorto() { return 'u_' + (++_seq); }
      function leerSala() { return null; }
      function codigoCuadernoActivo() { return codigo; }
      function deviceId() { return __c46Boot.deviceId; }
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
      return {
        API: API,
        OCSyncEmit: window.OCSyncEmit,
        sembrarFotosAlRelay: sembrarFotosAlRelay
      };
    })()
  `, ctx);

  return {
    window,
    indexedDB,
    API: runtime.API,
    OCSyncEmit: runtime.OCSyncEmit,
    sembrarFotosAlRelay: runtime.sembrarFotosAlRelay,
    vmObj: obj => vm.runInContext('(' + JSON.stringify(obj) + ')', ctx)
  };
}

test('C46 Workerd E2E: real idb-fotos + recoverShelfPhoto via -fotos DO AND cross-device A->B->A x2 downpath with 0 duplicates', {timeout: 120000}, async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'f123-c46-workerd-'));
  const db = fakeDb();
  await db.transaction(async tx => {
    await tx.put('inst:' + DEVICE_A, {licenseCode: LICENSE, instanceId: DEVICE_A});
    await tx.put('inst:' + DEVICE_B, {licenseCode: LICENSE, instanceId: DEVICE_B});
  });

  const authEnv = {
    PIN_PEPPER: 'synthetic-c46-owner-pepper-long-key-01',
    TEAM_PIN_PEPPER: 'synthetic-c46-team-pepper-long-key--02',
    TEAM_AUTHORITY_QA: '1',
    TEAM_AUTHORITY_LICENSE: LICENSE,
    WS_AUTHORITY_QA: '1',
    WS_QA_ROLE_GRANTS: JSON.stringify({empleado: ['ops:sale', 'fotos:read']}),
    WS_SIGNING_KEY: 'synthetic-c46-signing-key-long-private',
    WS_SERVICE_KEY: SERVICE_KEY
  };

  const ownerAuth = pinAuthority(db, authEnv.PIN_PEPPER);
  await ownerAuth.masterSet(LICENSE, '123', 0, [DEVICE_A, DEVICE_B]);
  await ownerAuth.masterActivate(LICENSE, '123', 0, [DEVICE_A, DEVICE_B]);
  const teamAuth = teamAuthority({storage: db, ownerAuthority: ownerAuth, secret: authEnv.TEAM_PIN_PEPPER});
  const teamUpd = await teamAuth.update({
    licenseCode: LICENSE,
    instanceId: DEVICE_A,
    ownerPin: '123',
    opId: 'op_team_c46_01',
    expectedRevision: 0,
    subject: EMP_SUBJECT,
    role: 'empleado',
    pin: '234',
    active: true
  });
  assert.equal(teamUpd.ok, true);

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

    // Mount Device A (Owner A), Device B (Owner B for A->B->A x2), and Team B (cold empleado for photo recovery)
    const devA = mountDevice({bridgeFetch, indexedDB: new IDBFactory(), deviceId: DEVICE_A, role: 'dueno'});
    const devB = mountDevice({bridgeFetch, indexedDB: new IDBFactory(), deviceId: DEVICE_B, role: 'dueno'});
    const teamB = mountDevice({bridgeFetch, indexedDB: new IDBFactory(), deviceId: DEVICE_B, role: 'empleado'});

    await devA.API.activarCorte20Runtime({
      headCongelado: HEAD,
      activarDespachoComercial: true,
      cortarLegadoFotos: true,
      indexedDB: devA.indexedDB,
      createProvider: createRealWsProvider,
      fetch: bridgeFetch
    });

    // 1) Browser Photo Cutover: Device A saves real photo in idb-fotos.js -> sembrarFotosAlRelay -> -fotos DO
    const shelfDataUrl = 'data:image/png;base64,' + Buffer.from('synthetic-c46-shelf-photo-bytes-0001').toString('base64');
    const photoHash = await devA.window.OCFotos.guardarFotoContenido(shelfDataUrl);
    assert.match(photoHash, /^[a-f0-9]{64}$/);
    devA.API.doc.getMap('ubicaciones').set('shelf-1', devA.vmObj({id: 'shelf-1', nombre: 'Percha C46', activa: true, fotoHash: photoHash}));
    devA.window.OCSync.catalogoPropio = () => devA.vmObj({productos: [], ubicaciones: [{id: 'shelf-1', fotoHash: photoHash}], gastos: []});
    devA.sembrarFotosAlRelay();

    // Wait for -fotos DO to hold photoHash and Device A fotosRefs to record metadata
    for (let i = 0; i < 60 && !devA.API.fotosRefs.get(photoHash); i++) {
      await new Promise(r => setTimeout(r, 50));
    }
    assert.ok(devA.API.fotosRefs.get(photoHash), 'Owner A fotosRefs must record uploaded photo metadata');
    assert.equal(devA.API.fotosMap.size, 0, 'legacy fotosMap must stay empty when corteFotosShaActivo=true');
    assert.equal(teamB.API.fotosMap.size, 0, 'Team B legacy fotosMap must stay empty');

    // Cold Team B activates empleado photo reader and runs real F123Application.recoverShelfPhoto -> -fotos DO
    teamB.API.fotosRefs.set(photoHash, teamB.vmObj(devA.API.fotosRefs.get(photoHash)));
    teamB.API.cambiarRolComercial20('empleado', {cortarLegadoFotos: true, fetch: bridgeFetch});
    const recovered = await teamB.window.F123Application.recoverShelfPhoto(
      {id: 'shelf-1', fotoHash: photoHash},
      {
        currentMappedHash: async () => photoHash,
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
    assert.equal(recovered?.displayBytes, shelfDataUrl, 'Cold Team browser recovers exact shelf photo bytes from -fotos DO');
    assert.equal(await teamB.window.OCFotos.leerPorHash(photoHash), shelfDataUrl, 'Recovered photo cached in Team B local IDB');

    // 2) Cross-device A -> B -> A x2 + failbackToLegacy downpath (C10 single-writer handoff)
    const opA1 = 'op_c46_a1_sale';
    assert.equal(devA.OCSyncEmit('venta', devA.vmObj({opId: opA1, productoId: 'sku_1', delta: -1, cantidad: 1, amountCents: 1500})), true);
    for (let i = 0; i < 60 && !devA.API.obtenerReciboComercial20(opA1); i++) await new Promise(r => setTimeout(r, 40));
    assert.equal(devA.API.obtenerReciboComercial20(opA1)?.committed, true);

    // Device A steps down via failbackToLegacy -> Device B takes over (A -> B)
    const fbA = await devA.API.coordinadorCorte20.failbackToLegacy('qa-handoff-a-to-b');
    assert.equal(fbA?.mode, 'failback-legacy-1.0');

    await devB.API.activarCorte20Runtime({
      headCongelado: HEAD,
      activarDespachoComercial: true,
      cortarLegadoFotos: true,
      indexedDB: devB.indexedDB,
      createProvider: createRealWsProvider,
      fetch: bridgeFetch
    });

    const opB1 = 'op_c46_b1_sale';
    assert.equal(devB.OCSyncEmit('venta', devB.vmObj({opId: opB1, productoId: 'sku_1', delta: -1, cantidad: 1, amountCents: 1500})), true);
    for (let i = 0; i < 60 && !devB.API.obtenerReciboComercial20(opB1); i++) await new Promise(r => setTimeout(r, 40));
    assert.equal(devB.API.obtenerReciboComercial20(opB1)?.committed, true);

    // Device B steps down via failbackToLegacy -> Device A re-arms (B -> A x2)
    const fbB = await devB.API.coordinadorCorte20.failbackToLegacy('qa-handoff-b-to-a');
    assert.equal(fbB?.mode, 'failback-legacy-1.0');

    await devA.API.activarCorte20Runtime({
      headCongelado: HEAD,
      activarDespachoComercial: true,
      cortarLegadoFotos: true,
      indexedDB: devA.indexedDB,
      createProvider: createRealWsProvider,
      fetch: bridgeFetch
    });

    const opA2 = 'op_c46_a2_sale';
    assert.equal(devA.OCSyncEmit('venta', devA.vmObj({opId: opA2, productoId: 'sku_1', delta: -1, cantidad: 1, amountCents: 1500})), true);
    assert.equal(devA.OCSyncEmit('venta', devA.vmObj({opId: opA1, productoId: 'sku_1', delta: -1, cantidad: 1, amountCents: 1500})), true);
    for (let i = 0; i < 60 && !devA.API.obtenerReciboComercial20(opA2); i++) await new Promise(r => setTimeout(r, 40));
    assert.equal(devA.API.obtenerReciboComercial20(opA2)?.committed, true);

    // Second FULL A -> B -> A cycle: B takes ownership again, then A returns.
    // This catches re-activation failures that a single A1 -> B1 -> A2 pass cannot expose.
    const fbA2 = await devA.API.coordinadorCorte20.failbackToLegacy('qa-second-handoff-a-to-b');
    assert.equal(fbA2?.mode, 'failback-legacy-1.0');
    await devB.API.activarCorte20Runtime({
      headCongelado: HEAD,
      activarDespachoComercial: true,
      cortarLegadoFotos: true,
      indexedDB: devB.indexedDB,
      createProvider: createRealWsProvider,
      fetch: bridgeFetch
    });
    const opB2 = 'op_c46_b2_sale';
    assert.equal(devB.OCSyncEmit('venta', devB.vmObj({opId: opB2, productoId: 'sku_1', delta: -1, cantidad: 1, amountCents: 1500})), true);
    for (let i = 0; i < 60 && !devB.API.obtenerReciboComercial20(opB2); i++) await new Promise(r => setTimeout(r, 40));
    assert.equal(devB.API.obtenerReciboComercial20(opB2)?.committed, true);

    const fbB2 = await devB.API.coordinadorCorte20.failbackToLegacy('qa-second-handoff-b-to-a');
    assert.equal(fbB2?.mode, 'failback-legacy-1.0');
    await devA.API.activarCorte20Runtime({
      headCongelado: HEAD,
      activarDespachoComercial: true,
      cortarLegadoFotos: true,
      indexedDB: devA.indexedDB,
      createProvider: createRealWsProvider,
      fetch: bridgeFetch
    });
    const opA3 = 'op_c46_a3_sale';
    assert.equal(devA.OCSyncEmit('venta', devA.vmObj({opId: opA3, productoId: 'sku_1', delta: -1, cantidad: 1, amountCents: 1500})), true);
    // Replayed older A and B operations must not produce more than five business effects.
    assert.equal(devA.OCSyncEmit('venta', devA.vmObj({opId: opA1, productoId: 'sku_1', delta: -1, cantidad: 1, amountCents: 1500})), true);
    assert.equal(devA.OCSyncEmit('venta', devA.vmObj({opId: opB2, productoId: 'sku_1', delta: -1, cantidad: 1, amountCents: 1500})), true);
    for (let i = 0; i < 60 && !devA.API.obtenerReciboComercial20(opA3); i++) await new Promise(r => setTimeout(r, 40));
    assert.equal(devA.API.obtenerReciboComercial20(opA3)?.committed, true);
    await new Promise(r => setTimeout(r, 120));

    // Verify exact Workerd -ops DO SQLite state: 5 -> 0 stock, 500 -> 8000 cash, five effects/receipts
    const sqlRes = await fetch(new URL('/parties/tienda/' + opsRoom, url), {
      method: 'POST',
      headers: {origin: ORIGIN, 'x-f123-synthetic-inspect': '1'}
    });
    assert.equal(sqlRes.status, 200);
    const sql = await sqlRes.json();
    assert.equal(sql.stock, 0, 'Two complete A->B->A cycles must yield exact stock 5 - 5 = 0');
    assert.equal(sql.cash, 8000, 'Two complete A->B->A cycles must yield exact cash 500 + 7500 = 8000');
    assert.equal(sql.effects, 5, 'Exactly 5 business effects (0 duplicates on replay)');
    assert.equal(sql.receipts, 5, 'Exactly 5 receipts');
    assert.equal(devA.API.opsMap.size, 0);
    assert.equal(devB.API.opsMap.size, 0);
  } finally {
    await mf.dispose();
    fs.rmSync(folder, {recursive: true, force: true});
  }
});
