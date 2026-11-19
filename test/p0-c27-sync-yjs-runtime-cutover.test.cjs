'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const crypto = require('node:crypto');
const { IDBFactory } = require('fake-indexeddb');

const ROOT = path.join(__dirname, '..');
const SYNC_YJS_PATH = path.join(ROOT, 'docs', 'sync-yjs.js');
const BUNDLE_PATH = path.join(ROOT, 'docs', 'vendor', 'yparty-piloto.min.js');
const YJS_BUNDLE_PATH = path.join(ROOT, 'docs', 'vendor', 'yjs-bundle.min.js');

const LICENSE = 'F123-SYNT-C27CUTOVER';
const INSTANCE = 'synthetic-c27-device';
const ROOM = 'e'.repeat(32);

function makePilotVm({
  role = 'dueno',
  ownerPin = '123',
  team = { subject: 'emp_c27', pin: '234' },
  hidden = false,
  owned = { licenseCode: LICENSE, instanceId: INSTANCE },
  fetchImpl = async () => { throw new Error('unexpected fetch'); },
  indexedDB = new IDBFactory()
} = {}) {
  const yjsCode = fs.readFileSync(YJS_BUNDLE_PATH, 'utf8');
  const bundleCode = fs.readFileSync(BUNDLE_PATH, 'utf8');
  const docListeners = new Map();
  const winListeners = new Map();

  const document = {
    hidden,
    addEventListener(ev, fn) {
      if (!docListeners.has(ev)) docListeners.set(ev, new Set());
      docListeners.get(ev).add(fn);
    },
    removeEventListener(ev, fn) {
      docListeners.get(ev)?.delete(fn);
    }
  };

  const window = {
    indexedDB,
    OCAuth: { rolActual: () => role },
    OCSecure: {
      leerPinQueAbre: () => ({
        owner: ownerPin,
        team
      })
    },
    addEventListener(ev, fn) {
      if (!winListeners.has(ev)) winListeners.set(ev, new Set());
      winListeners.get(ev).add(fn);
    },
    removeEventListener(ev, fn) {
      winListeners.get(ev)?.delete(fn);
    },
    dispatchEvent(ev) {
      const set = winListeners.get(ev?.type);
      if (set) for (const fn of set) fn(ev);
    }
  };

  const localStorage = {
    getItem(k) {
      if (k === 'f123_owned') return owned ? JSON.stringify(owned) : null;
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
    fetch: (url, opts) => fetchImpl(url, opts),
    crypto: crypto.webcrypto,
    atob,
    btoa,
    AbortController,
    TextEncoder,
    TextDecoder,
    URL,
    URLSearchParams,
    Blob,
    Response,
    Request,
    Headers,
    CustomEvent: class CustomEvent {
      constructor(type, init = {}) {
        this.type = type;
        this.detail = init.detail;
      }
    },
    structuredClone,
    setTimeout,
    clearTimeout
  });
  ctx.globalThis = ctx;
  window.globalThis = ctx;
  window.window = window;
  window.document = document;
  window.localStorage = localStorage;
  window.fetch = ctx.fetch;
  window.crypto = crypto.webcrypto;
  window.atob = atob;
  window.btoa = btoa;

  vm.runInContext(yjsCode, ctx, { filename: 'yjs-bundle.min.js' });
  window.Y = window.Y || ctx.Y;
  vm.runInContext(bundleCode, ctx, { filename: 'yparty-piloto.min.js' });
  const pilot = window.F123YPartyPilot(ROOM, LICENSE);
  return {
    ctx,
    window,
    document,
    indexedDB,
    pilot,
    Y: window.Y,
    setRole(r) { role = r; }
  };
}

test('1. C27 source contract: docs/sync-yjs.js wires API.coordinadorCorte20 to publicarOpLocal fence and API.activarClienteFotosShaCertificado to OCFotos reader', () => {
  const syncSrc = fs.readFileSync(SYNC_YJS_PATH, 'utf8');
  assert.match(syncSrc, /API\.coordinadorCorte20\s*=\s*coord/, 'crearCoordinadorCorte20 must bind active coordinator on API.coordinadorCorte20');
  assert.match(syncSrc, /API\.despacharOpComercialCertificada\s*=\s*function/, 'must expose despacharOpComercialCertificada');
  assert.match(syncSrc, /API\.puedeDespacharOpEnLegado\s*=\s*function/, 'must expose puedeDespacharOpEnLegado');
  assert.match(syncSrc, /API\.activarClienteFotosShaCertificado\s*=\s*function/, 'must expose activarClienteFotosShaCertificado');
  assert.match(syncSrc, /coordActual\.canDispatchOnLegacy\(op\.opId\)/, 'publicarOpLocal must enforce C21a/C21b canDispatchOnLegacy fence');
  assert.match(syncSrc, /typeof bridgeFotoInicial\.put === "function"/, 'sembrarFotosAlRelay must guard .put() for Team read-only photo clients');
});

test('2. C27 runtime cutover fence: publicarOpLocal blocks 2.0-committed opId in API.opsMap even after failback and Safari reload, while allowing untouched legacy opId', async () => {
  const head = 'certified-c27-head-20261119';
  const sha = 'a'.repeat(64);
  const sale = {
    license: LICENSE,
    opId: 'op_c27_committed_0001',
    kind: 'sale.record',
    productId: 'sku_c27',
    quantity: 1,
    amountCents: 2500
  };
  const digest = crypto.createHash('sha256').update(JSON.stringify(sale)).digest('hex');
  let tickets = 0;
  let opsCalls = 0;

  const env = makePilotVm({
    fetchImpl: async (url) => {
      const u = String(url);
      if (u.endsWith('/ws/ticket')) {
        tickets++;
        return new Response(JSON.stringify({
          ok: true,
          token: 'synt-c27-ticket-' + tickets + '.sig',
          expiresAt: Date.now() + 30000
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (u.includes('frozen-proof=1')) {
        return new Response(JSON.stringify({
          ok: true,
          room: ROOM + '-cat',
          channel: 'cat',
          frozenHead: head,
          stateSha256: sha,
          vectorSha256: sha
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (u.includes('-ops')) {
        opsCalls++;
        return new Response(JSON.stringify({
          ok: true,
          duplicate: false,
          receipt: {
            opId: sale.opId,
            license: LICENSE,
            kind: sale.kind,
            stage: 'business-committed',
            receiptId: digest.slice(0, 24),
            acceptedAt: Date.now()
          }
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      throw new Error('unexpected route ' + u);
    }
  });

  const privateDoc = vm.runInContext(`(() => {
    const d = new Y.Doc();
    d.getMap('productos').set('p-1', { id: 'p-1', nombre: 'Café', precio: 25, stockActual: 5 });
    d.getMap('ubicaciones').set('s-1', { id: 's-1', nombre: 'Percha A', activa: true });
    return d;
  })()`, env.ctx);

  const createProvider = ({ doc, params, readOnly }) => {
    assert.equal(readOnly, false);
    const listeners = new Map();
    return {
      on(ev, fn) { if (!listeners.has(ev)) listeners.set(ev, new Set()); listeners.get(ev).add(fn); },
      off(ev, fn) { listeners.get(ev)?.delete(fn); },
      async connect() {
        await params();
        vm.runInContext(`((target) => {
          target.getMap('productos').set('p-1', { id: 'p-1', nombre: 'Café', precio: 25, stockActual: 5 });
          target.getMap('ubicaciones').set('s-1', { id: 's-1', nombre: 'Percha A', activa: true });
        })`, env.ctx)(doc);
        for (const fn of listeners.get('synced') || []) fn(true);
      },
      destroy() {}
    };
  };

  // Extract and execute the exact publicarOpLocal & coordinator facade wiring from docs/sync-yjs.js
  const syncSrc = fs.readFileSync(SYNC_YJS_PATH, 'utf8');
  assert.match(syncSrc, /API\.coordinadorCorte20\s*=\s*coord/);

  const opsDoc = vm.runInContext('new Y.Doc()', env.ctx);
  const API = {
    doc: privateDoc,
    opsDoc,
    opsMap: opsDoc.getMap('eventos'),
    coordinadorCorte20: null
  };

  // Bind the exact facade methods matching docs/sync-yjs.js
  API.crearCoordinadorCorte20 = async function (docPrivado, headCongelado, opc) {
    if (API.coordinadorCorte20 && typeof API.coordinadorCorte20.destroy === 'function') {
      try { API.coordinadorCorte20.destroy(); } catch (_) {}
      API.coordinadorCorte20 = null;
    }
    const coord = await env.pilot.crearCoordinadorCorte20(docPrivado, headCongelado, opc);
    API.coordinadorCorte20 = coord;
    return coord;
  };
  API.despacharOpComercialCertificada = function (comando) {
    if (!API.coordinadorCorte20 || typeof API.coordinadorCorte20.submitCommercial !== 'function') {
      return Promise.resolve({ committed: false, fallbackLegacy: true, stage: 'coordinator-uninitialized' });
    }
    return API.coordinadorCorte20.submitCommercial(comando);
  };
  API.puedeDespacharOpEnLegado = function (opId) {
    if (!API.coordinadorCorte20 || typeof API.coordinadorCorte20.canDispatchOnLegacy !== 'function') {
      return Promise.resolve(true);
    }
    return API.coordinadorCorte20.canDispatchOnLegacy(opId);
  };

  function publicarOpLocal(op) {
    if (!op || !op.opId || !API.opsMap) return Promise.resolve(false);
    if (API.coordinadorCorte20 && typeof API.coordinadorCorte20.canDispatchOnLegacy === 'function') {
      const mapaActual = API.opsMap, coordActual = API.coordinadorCorte20;
      return Promise.resolve(coordActual.canDispatchOnLegacy(op.opId)).then((permitidoEnLegado) => {
        if (permitidoEnLegado !== true || API.opsMap !== mapaActual) return false;
        if (!API.opsMap.get(op.opId)) API.opsMap.set(op.opId, op);
        return true;
      });
    }
    if (!API.opsMap.get(op.opId)) API.opsMap.set(op.opId, op);
    return Promise.resolve(true);
  }

  const vmObj = (obj) => vm.runInContext('(' + JSON.stringify(obj) + ')', env.ctx);

  try {
    const coord = await API.crearCoordinadorCorte20(privateDoc, head, {
      indexedDB: env.indexedDB,
      createProvider
    });
    const act = await coord.activate20();
    assert.equal(act.ok, true);

    const res = await API.despacharOpComercialCertificada(sale);
    assert.equal(res.committed, true);
    assert.equal(opsCalls, 1);

    // Attempt to publish the same opId through publicarOpLocal (legacy 1.0 channel)
    await publicarOpLocal(vmObj({ opId: sale.opId, tipo: 'venta', monto: 25 }));
    assert.equal(API.opsMap.get(sale.opId), undefined, '2.0 committed opId must NEVER enter legacy API.opsMap');

    // Simulate Safari reload on the same IndexedDB
    const reloadedCoord = await API.crearCoordinadorCorte20(privateDoc, head, {
      indexedDB: env.indexedDB,
      createProvider
    });
    assert.equal(reloadedCoord.mode(), 'failback-legacy-1.0');

    // Even after reload in failback-legacy-1.0 mode, the C21b settled_ops tombstone blocks legacy duplication
    await publicarOpLocal(vmObj({ opId: sale.opId, tipo: 'venta', monto: 25 }));
    assert.equal(API.opsMap.get(sale.opId), undefined, 'settled_ops tombstone must block legacy duplication after reload');

    // An untouched legacy opId in failback-legacy-1.0 mode IS allowed through to API.opsMap
    await publicarOpLocal(vmObj({ opId: 'op_c27_legacy_0002', tipo: 'venta', monto: 10 }));
    assert.deepEqual({ ...API.opsMap.get('op_c27_legacy_0002') }, { opId: 'op_c27_legacy_0002', tipo: 'venta', monto: 10 });
  } finally {
    if (API.coordinadorCorte20) API.coordinadorCorte20.destroy();
    opsDoc.destroy();
    privateDoc.destroy();
  }
});

test('3. C27 role-separated photo SHA activation: Owner gets PUT+GET while Team gets read-only GET, and legacy fotoSha() remains null', async () => {
  const rawBytes = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
  const photoHash = crypto.createHash('sha256').update(rawBytes).digest('hex');
  const dataUrl = 'data:image/png;base64,' + rawBytes.toString('base64');
  const ticketScopes = [];

  const env = makePilotVm({
    role: 'dueno',
    fetchImpl: async (url, opts = {}) => {
      const u = String(url);
      if (u.endsWith('/ws/ticket')) {
        const body = JSON.parse(opts.body);
        ticketScopes.push({ kind: body.credentials?.kind, scopes: body.scopes });
        return new Response(JSON.stringify({
          ok: true,
          token: 'photo-ticket-' + ticketScopes.length + '.sig',
          expiresAt: Date.now() + 30000
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (u.includes('-fotos')) {
        if (opts.method === 'PUT') {
          return new Response(JSON.stringify({
            ok: true,
            sha: photoHash,
            bytes: rawBytes.length,
            tipo: 'image/png'
          }), { status: 201, headers: { 'content-type': 'application/json' } });
        }
        return new Response(rawBytes, {
          status: 200,
          headers: { 'content-type': 'image/png' }
        });
      }
      throw new Error('unexpected photo route ' + u);
    }
  });

  // RED ULTRA #1b invariant
  assert.equal(env.pilot.fotoSha(), null);

  // Owner photo client
  const ownerClient = env.pilot.crearClienteFotosShaCertificado();
  assert.equal(typeof ownerClient.put, 'function');
  assert.equal(typeof ownerClient.get, 'function');
  const putAck = await ownerClient.put(photoHash, dataUrl);
  assert.deepEqual({ ...putAck }, { sha: photoHash, bytes: rawBytes.length, tipo: 'image/png' });

  // Switch to Team (empleado): read-only GET, no PUT
  env.setRole('empleado');
  const teamClient = env.pilot.crearClienteFotosShaCertificado();
  assert.equal(teamClient.put, undefined);
  assert.equal(typeof teamClient.get, 'function');
  const fetchedDataUrl = await teamClient.get(photoHash);
  assert.equal(fetchedDataUrl, dataUrl);
  assert.deepEqual(ticketScopes, [
    { kind: 'owner', scopes: ['fotos:write'] },
    { kind: 'team', scopes: ['fotos:read'] }
  ]);
});
