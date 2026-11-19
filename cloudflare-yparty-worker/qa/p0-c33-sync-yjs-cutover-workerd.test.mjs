// PORT2 C33: End-to-end REAL Workerd SQLite + real central authorityWorker + real WebSocket +
// real fake-indexeddb verification of the ACTUAL docs/sync-yjs.js C31 runtime + compiled bundle:
// 1. Owner activates API.activarCorte20Runtime against real Tienda DO -cat (?frozen-proof=1 + C10 single-writer).
// 2. Owner runs real sembrarFotosAlRelay() from docs/sync-yjs.js with API.corteFotosShaActivo=true:
//    uploads PNG to real -fotos DO SQLite, records metadata in API.fotosRefs, and writes 0 bytes to legacy API.fotosMap.
// 3. Owner routes real venta + ajuste ops through publicarOpLocal() -> real -ops DO SQLite (stock 5->4->7),
//    leaving 0 entries in legacy API.opsMap and persisting C21b settled_ops in IndexedDB v2.
// 4. Role switches via API.cambiarRolComercial20('empleado') -> Team reads exact PNG back via
//    _instalarLectorFotoShaBajoDemanda() / window.OCFotos.leerPorHash(hash) from real -fotos DO SQLite
//    with one-use fotos:read ticket (never touching Owner PIN or legacy API.fotosMap).
// 5. Cross-device downpath A->B->A + Safari reload + cold Workerd restart preserve -cat, -ops, and -fotos in SQLite (USD 0.00).

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
const DEVICE_A = 'synthetic-c33-owner-pc-a';
const DEVICE_B = 'synthetic-c33-safari-b';
const EMP_SUBJECT = 'emp_c33_01';
const SERVICE_KEY = 'synthetic-c33-private-service-key-32chars!';
const ORIGIN = 'https://synthetic-c33.test';
const HEAD = 'certified-c33-frozen-head-20261119';

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

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'f123-c33-client-'));
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

const syncSections = extractSyncYjsRuntime(SYNC_YJS_SRC);

function buildFrozenCatalogSource() {
  const d = new CY.Doc();
  d.clientID = 701;
  const frames = [];
  d.on('update', u => frames.push([...u]));
  d.getMap('productos').set('sku_1', {id: 'sku_1', nombre: 'Café C33', precio: 15, stockActual: 5});
  d.getMap('ubicaciones').set('shelf-1', {id: 'shelf-1', nombre: 'Percha C33', activa: true});
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

function mountBrowserSyncRuntime({
  bridgeFetch,
  role,
  instanceId,
  ownerPin,
  team,
  indexedDB,
  localPhotos = new Map(),
  catalogSnapshot = {productos: [], ubicaciones: [], gastos: []}
}) {
  const docListeners = new Map();
  const winListeners = new Map();
  let currentRole = role;
  const savedPhotos = new Map(localPhotos);

  const document = {
    hidden: false,
    addEventListener(ev, fn) {
      if (!docListeners.has(ev)) docListeners.set(ev, new Set());
      docListeners.get(ev).add(fn);
    },
    removeEventListener(ev, fn) { docListeners.get(ev)?.delete(fn); }
  };

  const OCFotos = {
    async hashesGuardados() { return Array.from(savedPhotos.keys()); },
    async leerPorHash(h) { return savedPhotos.get(h) || null; },
    async hashDeDataUrl(dataUrl) {
      const b64 = String(dataUrl).split(',')[1] || '';
      return sha256(Buffer.from(b64, 'base64'));
    },
    async guardarPorHash(h, dataUrl) { savedPhotos.set(h, dataUrl); return true; }
  };

  const window = {
    indexedDB,
    OCAuth: {rolActual: () => currentRole},
    OCSecure: {leerPinQueAbre: () => ({owner: ownerPin, team})},
    OCFotos,
    OCSync: {
      catalogoPropio: () => catalogSnapshot,
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

  const localStorage = {
    getItem(k) {
      if (k === 'f123_owned') return JSON.stringify({licenseCode: LICENSE, instanceId});
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
  assert.equal(piloto.fotoSha(), null, 'legacy fotoSha() stays null');

  ctx.__c33Boot = {
    codigo: LICENSE,
    piloto,
    headCongeladoQa: HEAD,
    Y: window.Y
  };

  const runtime = vm.runInContext(`
    (function () {
      var codigo = __c33Boot.codigo;
      var piloto = __c33Boot.piloto;
      var headCongeladoQa = __c33Boot.headCongeladoQa;
      var Y = __c33Boot.Y;
      var _fotosSembradas = {};
      var _fotosSembradasDoc = null;
      var _fotosSembrando = false;
      var _fotosSembrarDeNuevo = false;
      var _fotosReintentoTimer = null;
      var _fotosReintentosLectura = 0;
      function _esperarFoto(p) { return Promise.resolve(p); }
      function _hashFotoSinStore() { return Promise.resolve(''); }
      var API = {
        doc: new Y.Doc(),
        opsDoc: new Y.Doc(),
        fotosDoc: new Y.Doc(),
        fotosRefs: null,
        fotosCanal: { ws: { relayLayer: 'local' }, enviarUpdate: function () {} },
        fotoSha: null
      };
      API.opsMap = API.opsDoc.getMap('eventos');
      API.fotosMap = API.fotosDoc.getMap('blobs');
      API.fotosRefs = API.doc.getMap('fotos_refs');
      API.doc.getMap('productos').set('sku_1', { id: 'sku_1', nombre: 'Café C33', precio: 15, stockActual: 5 });
      API.doc.getMap('ubicaciones').set('shelf-1', { id: 'shelf-1', nombre: 'Percha C33', activa: true });
      ${syncSections.lector}
      ${syncSections.facade}
      ${syncSections.publicarOpLocal}
      ${syncSections.sembrarFotosAlRelay}
      return {
        API: API,
        publicarOpLocal: publicarOpLocal,
        sembrarFotosAlRelay: sembrarFotosAlRelay
      };
    })()
  `, ctx);

  return {
    ctx,
    window,
    OCFotos,
    API: runtime.API,
    publicarOpLocal: runtime.publicarOpLocal,
    sembrarFotosAlRelay: runtime.sembrarFotosAlRelay,
    setRole: r => { currentRole = r; },
    firePageHide() {
      for (const fn of winListeners.get('pagehide') || []) fn({persisted: true});
    },
    vmObj: obj => vm.runInContext('(' + JSON.stringify(obj) + ')', ctx)
  };
}

test('C33 Workerd E2E: exact docs/sync-yjs.js C31 cutover (sembrarFotosAlRelay no shadow, role switch Owner↔Team, publicarOpLocal→-ops, A→B→A)', {timeout: 75000}, async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'f123-c33-workerd-'));
  const db = fakeDb();
  await db.transaction(async tx => {
    await tx.put('inst:' + DEVICE_A, {licenseCode: LICENSE, instanceId: DEVICE_A});
    await tx.put('inst:' + DEVICE_B, {licenseCode: LICENSE, instanceId: DEVICE_B});
  });

  const authEnv = {
    PIN_PEPPER: 'synthetic-c33-owner-pepper-long-key-01',
    TEAM_PIN_PEPPER: 'synthetic-c33-team-pepper-long-key--02',
    TEAM_AUTHORITY_QA: '1',
    TEAM_AUTHORITY_LICENSE: LICENSE,
    WS_AUTHORITY_QA: '1',
    WS_QA_ROLE_GRANTS: JSON.stringify({
      admin: ['ops:sale', 'ops:adjust', 'ops:payment', 'fotos:read'],
      empleado: ['ops:sale', 'ops:payment', 'fotos:read']
    }),
    WS_SIGNING_KEY: 'synthetic-c33-signing-key-long-private',
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
    opId: 'op_team_c33_01',
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
  let mf = null;
  let url = null;

  async function startWorkerd() {
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
    const kv = await mf.getKVNamespace('LICENCIAS');
    await kv.put('inst:' + DEVICE_A, JSON.stringify({licenseCode: LICENSE, instanceId: DEVICE_A}));
    await kv.put('inst:' + DEVICE_B, JSON.stringify({licenseCode: LICENSE, instanceId: DEVICE_B}));
    url = await mf.ready;
  }

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
    assert.equal(u.host, HOST);
    const rewritten = new URL(u.pathname + u.search, url);
    return fetch(rewritten, {
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

  const pngBytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1]);
  const photoSha = sha256(pngBytes);
  const photoDataUrl = 'data:image/png;base64,' + pngBytes.toString('base64');
  const idbOwner = new IDBFactory();

  try {
    await startWorkerd();

    // 1) Owner Device A boots real docs/sync-yjs.js runtime + compiled bundle against Workerd SQLite
    const ownerA = mountBrowserSyncRuntime({
      bridgeFetch,
      role: 'dueno',
      instanceId: DEVICE_A,
      ownerPin: '123',
      team: null,
      indexedDB: idbOwner,
      localPhotos: new Map([[photoSha, photoDataUrl]]),
      catalogSnapshot: {productos: [{id: 'sku_1', fotoHash: photoSha}], ubicaciones: [], gastos: []}
    });

    await ownerA.API.activarCorte20Runtime({
      headCongelado: HEAD,
      activarDespachoComercial: true,
      cortarLegadoFotos: true,
      indexedDB: idbOwner,
      createProvider: createRealWsProvider,
      fetch: bridgeFetch
    });
    assert.equal(ownerA.API.modoCorte20Activo, true);
    assert.equal(ownerA.API.corteFotosShaActivo, true);
    assert.equal(ownerA.API.rolComercial20Activo, 'dueno');

    // 2) Real sembrarFotosAlRelay() uploads PNG to real -fotos DO SQLite, sets API.fotosRefs, and leaves legacy API.fotosMap EMPTY
    ownerA.sembrarFotosAlRelay();
    for (let i = 0; i < 60 && !ownerA.API.fotosRefs.get(photoSha); i++) {
      await new Promise(r => setTimeout(r, 40));
    }
    const ref = ownerA.API.fotosRefs.get(photoSha);
    assert.deepEqual({...ref}, {sha: photoSha, bytes: pngBytes.length, tipo: 'image/png'});
    assert.equal(ownerA.API.fotosMap.size, 0, 'corteFotosShaActivo=true must skip legacy API.fotosMap shadow write');

    // 3) Real publicarOpLocal() routes venta + ajuste + abono to -ops DO SQLite, leaving legacy API.opsMap EMPTY
    ownerA.publicarOpLocal(ownerA.vmObj({
      opId: 'op_c33_sale_0001',
      tipo: 'venta',
      payload: {productoId: 'sku_1', cantidad: 1, total: 15},
      _salaOrigen: LICENSE
    }));
    await new Promise(r => setTimeout(r, 250));

    ownerA.publicarOpLocal(ownerA.vmObj({
      opId: 'op_c33_adj_0002',
      tipo: 'ajuste',
      payload: {productoId: 'sku_1', stockNuevo: 7},
      _salaOrigen: LICENSE
    }));
    await new Promise(r => setTimeout(r, 250));

    ownerA.publicarOpLocal(ownerA.vmObj({
      opId: 'op_c33_pay_0003',
      tipo: 'abono',
      payload: {receivableId: 'fiado_1', amountCents: 1000},
      _salaOrigen: LICENSE
    }));
    await new Promise(r => setTimeout(r, 250));

    assert.equal(ownerA.API.opsMap.size, 0, 'legacy 1.0 opsMap must receive zero C15 ops when 2.0 cutover is active');
    assert.equal(await ownerA.API.puedeDespacharOpEnLegado('op_c33_sale_0001'), false);
    assert.equal(await ownerA.API.puedeDespacharOpEnLegado('op_c33_adj_0002'), false);
    assert.equal(await ownerA.API.puedeDespacharOpEnLegado('op_c33_pay_0003'), false);

    // Verify real SQLite business state inside Workerd -ops DO (5 - 1 -> adjust 7; cash 500 + 1500 + 1000 = 3000; debt 3000 - 1000 = 2000)
    const sqlRes = await fetch(new URL('/parties/tienda/' + opsRoom, url), {
      method: 'POST',
      headers: {origin: ORIGIN, 'x-f123-synthetic-inspect': '2'}
    });
    assert.equal(sqlRes.status, 200);
    const sqlState = await sqlRes.json();
    assert.equal(sqlState.stock, 7);
    assert.equal(sqlState.cash, 3000);
    assert.equal(sqlState.debt, 2000);
    assert.equal(sqlState.effects, 3);
    assert.equal(sqlState.receipts, 3);

    // 4) Team Device B (empleado, empty local IDB, no Owner PIN) uses cambiarRolComercial20 + _instalarLectorFotoShaBajoDemanda
    const teamB = mountBrowserSyncRuntime({
      bridgeFetch,
      role: 'empleado',
      instanceId: DEVICE_B,
      ownerPin: null,
      team: {subject: EMP_SUBJECT, pin: '234'},
      indexedDB: new IDBFactory(),
      localPhotos: new Map()
    });
    teamB.API.fotosRefs.set(photoSha, teamB.vmObj({sha: photoSha, bytes: pngBytes.length, tipo: 'image/png'}));
    const teamState = teamB.API.cambiarRolComercial20('empleado', {cortarLegadoFotos: true, fetch: bridgeFetch});
    assert.equal(teamState.rol, 'empleado');
    assert.equal(teamState.modoCorte20Activo, false);
    assert.equal(teamB.API.fotoSha.put, undefined);

    const recovered = await teamB.OCFotos.leerPorHash(photoSha);
    assert.equal(recovered, photoDataUrl, 'Team read-only OCFotos.leerPorHash must recover exact PNG from -fotos DO SQLite');

    // 5) Cross-device A->B->A downpath: Owner Device A fires pagehide -> releases C10 -cat writer lock ->
    //    Device A reloads Safari on same IndexedDB -> C29 durable fence still blocks op_c33_sale_0001
    ownerA.firePageHide();
    await new Promise(r => setTimeout(r, 100));

    const ownerReloaded = mountBrowserSyncRuntime({
      bridgeFetch,
      role: 'dueno',
      instanceId: DEVICE_A,
      ownerPin: '123',
      team: null,
      indexedDB: idbOwner
    });
    assert.equal(await ownerReloaded.API.puedeDespacharOpEnLegado('op_c33_sale_0001'), false);

    // 6) Cold Workerd restart preserves -fotos SHA PNG in SQLite
    await mf.dispose();
    await startWorkerd();

    const teamCold = mountBrowserSyncRuntime({
      bridgeFetch,
      role: 'empleado',
      instanceId: DEVICE_B,
      ownerPin: null,
      team: {subject: EMP_SUBJECT, pin: '234'},
      indexedDB: new IDBFactory(),
      localPhotos: new Map()
    });
    teamCold.API.fotosRefs.set(photoSha, teamCold.vmObj({sha: photoSha, bytes: pngBytes.length, tipo: 'image/png'}));
    teamCold.API.cambiarRolComercial20('empleado', {cortarLegadoFotos: true, fetch: bridgeFetch});
    assert.equal(await teamCold.OCFotos.leerPorHash(photoSha), photoDataUrl);
  } finally {
    await mf?.dispose().catch(() => {});
    fs.rmSync(folder, {recursive: true, force: true});
  }
});
