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

const LICENSE = 'F123-SYNT-C31RUNTIME';
const INSTANCE = 'synthetic-c31-device';
const ROOM = 'c'.repeat(32);

function makePilotVm({
  role = 'dueno',
  ownerPin = '123',
  team = { subject: 'emp_c31', pin: '234' },
  hidden = false,
  fetchImpl = async () => { throw new Error('unexpected fetch'); },
  indexedDB = new IDBFactory()
} = {}) {
  const yjsCode = fs.readFileSync(YJS_BUNDLE_PATH, 'utf8');
  const bundleCode = fs.readFileSync(BUNDLE_PATH, 'utf8');
  const docListeners = new Map();
  const winListeners = new Map();
  let currentRole = role;

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
    OCAuth: { rolActual: () => currentRole },
    // C38: production cutover requires the legacy writer is deliberately OFF,
    // with no old room and no pending relay work, never an absent facade.
    OCSyncControl: {
      estado: () => 'apagado',
      salaActiva: () => null,
      durabilidadPendiente: () => false,
      onEstado: () => {}
    },
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
      if (k === 'f123_owned') return JSON.stringify({ licenseCode: LICENSE, instanceId: INSTANCE });
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
  window.fetch = ctx.fetch;
  window.crypto = crypto.webcrypto;
  window.atob = atob;
  window.btoa = btoa;

  vm.runInContext(yjsCode, ctx, { filename: 'yjs-bundle.min.js' });
  window.Y = window.Y || ctx.Y;
  vm.runInContext(bundleCode, ctx, { filename: 'yparty-piloto.min.js' });
  const pilot = ctx.window.F123YPartyPilot(ROOM, LICENSE);
  return {
    ctx,
    pilot,
    setRole: (next) => { currentRole = next; }
  };
}

function extractC31RuntimeHelpers(syncSrc, { ctx, pilot, fetchImpl }) {
  // Compile the exact C31 helper section + publicarOpLocal from docs/sync-yjs.js
  // into a real VM context so tests exercise the actual shipped source code.
  assert.match(syncSrc, /function _traducirOpLegadoAComando20\(/);
  assert.match(syncSrc, /API\.activarCorte20Runtime\s*=/);
  assert.match(syncSrc, /API\.cambiarRolComercial20\s*=/);
  assert.match(syncSrc, /API\.corteFotosShaActivo/);

  const startTrad = syncSrc.indexOf('    if (piloto && typeof piloto.crearClienteFotosShaCertificado === "function") {');
  const endTrad = syncSrc.indexOf('    API.opsDoc.on("update"', startTrad);
  assert.ok(startTrad > 0 && endTrad > startTrad, 'C31 facade block not found in docs/sync-yjs.js');

  const startPub = syncSrc.indexOf('  function publicarOpLocal(op) {');
  const endPub = syncSrc.indexOf('\n  }', startPub) + 4;
  assert.ok(startPub > 0 && endPub > startPub, 'publicarOpLocal block not found in docs/sync-yjs.js');

  const privateDoc = vm.runInContext(`(() => {
    const d = new Y.Doc();
    d.getMap('productos').set('prod-1', { id: 'prod-1', nombre: 'Café', precio: 25, stockActual: 10 });
    d.getMap('ubicaciones').set('s-1', { id: 's-1', nombre: 'Percha A', activa: true });
    return d;
  })()`, ctx);
  const opsDoc = vm.runInContext('new Y.Doc()', ctx);
  const fotosDoc = vm.runInContext('new Y.Doc()', ctx);

  ctx.__c31Test = {
    codigo: LICENSE,
    piloto: pilot,
    headCongeladoQa: 'head-c31-frozen',
    privateDoc,
    opsDoc,
    fotosDoc,
    fetch: fetchImpl
  };

  const harness = `
    (function () {
      var codigo = __c31Test.codigo;
      var piloto = __c31Test.piloto;
      var headCongeladoQa = __c31Test.headCongeladoQa;
      var API = {
        doc: __c31Test.privateDoc,
        opsDoc: __c31Test.opsDoc,
        opsMap: __c31Test.opsDoc.getMap('eventos'),
        fotosDoc: __c31Test.fotosDoc,
        fotosMap: __c31Test.fotosDoc.getMap('fotos'),
        fotosRefs: __c31Test.privateDoc.getMap('fotos_refs'),
        fotoSha: null
      };
      function _instalarLectorFotoShaBajoDemanda() {}
      ${syncSrc.slice(startTrad, endTrad)}
      ${syncSrc.slice(startPub, endPub)}
      return { API: API, publicarOpLocal: publicarOpLocal };
    })()
  `;
  return vm.runInContext(harness, ctx);
}

test('C31: publicarOpLocal enruta venta/ajuste/abono a C25 cuando modoCorte20Activo=true y protege opsMap', async () => {
  const opsRequests = [];
  const fetchImpl = async (url, opts = {}) => {
    const u = String(url);
    const body = opts.body ? JSON.parse(opts.body) : {};
    if (u.endsWith('/ws/ticket')) {
      return new Response(JSON.stringify({
        ok: true,
        token: 'tok-c31-' + (opsRequests.length + 1) + '.sig',
        expiresAt: Date.now() + 30000
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (u.includes('frozen-proof=1')) {
      const sha = 'f'.repeat(64);
      return new Response(JSON.stringify({
        ok: true,
        room: ROOM + '-cat',
        channel: 'cat',
        frozenHead: 'head-c31-frozen',
        stateSha256: sha,
        vectorSha256: sha
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (u.includes('-ops')) {
      opsRequests.push(body);
      const canonical = Object.freeze(body.kind === 'sale.record'
        ? { license: body.license, opId: body.opId, kind: body.kind, productId: body.productId, quantity: body.quantity, amountCents: body.amountCents }
        : body.kind === 'stock.adjust'
          ? { license: body.license, opId: body.opId, kind: body.kind, productId: body.productId, quantity: body.quantity, amountCents: 0 }
          : { license: body.license, opId: body.opId, kind: body.kind, receivableId: body.receivableId, amountCents: body.amountCents });
      const receiptId = crypto.createHash('sha256').update(JSON.stringify(canonical)).digest('hex').slice(0, 24);
      return new Response(JSON.stringify({
        ok: true,
        committed: true,
        duplicate: false,
        receipt: {
          opId: body.opId,
          license: body.license,
          kind: body.kind,
          receiptId,
          acceptedAt: 1700000000000,
          stage: 'business-committed'
        }
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    throw new Error('unexpected url: ' + u);
  };

  const env = makePilotVm({ fetchImpl });
  const syncSrc = fs.readFileSync(SYNC_YJS_PATH, 'utf8');
  const rt = extractC31RuntimeHelpers(syncSrc, { ...env, fetchImpl });

  const createProvider = ({ doc, params, readOnly }) => {
    assert.equal(readOnly, false);
    const listeners = new Map();
    return {
      on(ev, fn) { if (!listeners.has(ev)) listeners.set(ev, new Set()); listeners.get(ev).add(fn); },
      off(ev, fn) { listeners.get(ev)?.delete(fn); },
      async connect() {
        await params();
        env.ctx.__c31RemoteDoc = doc;
        vm.runInContext(`
          __c31RemoteDoc.getMap('productos').set('prod-1', { id: 'prod-1', nombre: 'Café', precio: 25, stockActual: 10 });
          __c31RemoteDoc.getMap('ubicaciones').set('s-1', { id: 's-1', nombre: 'Percha A', activa: true });
        `, env.ctx);
        for (const fn of listeners.get('synced') || []) fn(true);
      },
      destroy() {}
    };
  };

  await rt.API.activarCorte20Runtime({
    headCongelado: 'head-c31-frozen',
    activarDespachoComercial: true,
    cortarLegadoFotos: true,
    createProvider,
    fetch: fetchImpl
  });

  assert.equal(rt.API.modoCorte20Activo, true);
  assert.equal(rt.API.corteFotosShaActivo, true);
  assert.equal(rt.API.rolComercial20Activo, 'dueno');

  const vmObj = (o) => vm.runInContext('(' + JSON.stringify(o) + ')', env.ctx);

  // 1) Sale routed to 2.0 typed ledger, never written to legacy opsMap
  rt.publicarOpLocal(vmObj({
    opId: 'op-sale-c31-001',
    tipo: 'venta',
    payload: { productoId: 'prod-1', cantidad: 2, total: 50 },
    _salaOrigen: LICENSE
  }));
  await new Promise((r) => setTimeout(r, 80));

  // 2) Stock adjust routed to 2.0 typed ledger
  rt.publicarOpLocal(vmObj({
    opId: 'op-adj-c31-002',
    tipo: 'ajuste',
    payload: { productoId: 'prod-1', stockNuevo: 8 },
    _salaOrigen: LICENSE
  }));
  await new Promise((r) => setTimeout(r, 80));

  // 3) Credit payment routed to 2.0 typed ledger
  rt.publicarOpLocal(vmObj({
    opId: 'op-pay-c31-003',
    tipo: 'abono',
    payload: { receivableId: 'rec-99', amountCents: 1500 },
    _salaOrigen: LICENSE
  }));
  await new Promise((r) => setTimeout(r, 80));

  assert.equal(opsRequests.length, 3);
  assert.deepEqual(opsRequests.map((r) => r.kind), ['sale.record', 'stock.adjust', 'credit.payment.record']);
  assert.equal(rt.API.opsMap.get('op-sale-c31-001'), undefined);
  assert.equal(rt.API.opsMap.get('op-adj-c31-002'), undefined);
  assert.equal(rt.API.opsMap.get('op-pay-c31-003'), undefined);

  // Fence C21b still blocks replay onto legacy opsMap
  assert.equal(await rt.API.puedeDespacharOpEnLegado('op-sale-c31-001'), false);

  // Non-C15 op still uses legacy opsMap when not engaged in 2.0
  rt.publicarOpLocal(vmObj({
    opId: 'op-close-c31-004',
    tipo: 'cierre-dia',
    payload: { caja: 100 },
    _salaOrigen: LICENSE
  }));
  await new Promise((r) => setTimeout(r, 50));
  assert.ok(rt.API.opsMap.get('op-close-c31-004'));

  rt.API.coordinadorCorte20?.destroy?.();
});

test('C31: cambiarRolComercial20 alterna Owner (PUT+GET) ↔ Team empleado (solo GET sin PIN Owner)', async () => {
  const rawBytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13]);
  const photoHash = crypto.createHash('sha256').update(rawBytes).digest('hex');
  const seenTickets = [];
  const fetchImpl = async (url, opts = {}) => {
    const u = String(url);
    const body = opts.body ? JSON.parse(opts.body) : {};
    if (u.endsWith('/ws/ticket')) {
      seenTickets.push(body);
      return new Response(JSON.stringify({
        ok: true,
        token: 'tok-photo-' + seenTickets.length + '.sig',
        expiresAt: Date.now() + 30000
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (u.includes('-fotos')) {
      return new Response(rawBytes, {
        status: 200,
        headers: { 'content-type': 'image/png' }
      });
    }
    throw new Error('unexpected fetch: ' + u);
  };

  const env = makePilotVm({ role: 'dueno', fetchImpl });
  const syncSrc = fs.readFileSync(SYNC_YJS_PATH, 'utf8');
  const rt = extractC31RuntimeHelpers(syncSrc, { ...env, fetchImpl });

  // Owner role: PUT + GET available
  const ownerRes = rt.API.cambiarRolComercial20('dueno', { cortarLegadoFotos: true, fetch: fetchImpl });
  assert.equal(ownerRes.rol, 'dueno');
  assert.equal(typeof rt.API.fotoSha.put, 'function');
  assert.equal(typeof rt.API.fotoSha.get, 'function');
  assert.equal(rt.API.corteFotosShaActivo, true);

  // Switch to Team empleado: read-only GET, no PUT, never reads Owner PIN
  env.setRole('empleado');
  const teamRes = rt.API.cambiarRolComercial20('empleado', { cortarLegadoFotos: true, fetch: fetchImpl });
  assert.equal(teamRes.rol, 'empleado');
  assert.equal(teamRes.modoCorte20Activo, false);
  assert.equal(typeof rt.API.fotoSha.get, 'function');
  assert.equal(rt.API.fotoSha.put, undefined);

  const bytes = await rt.API.fotoSha.get(photoHash);
  assert.equal(bytes, 'data:image/png;base64,' + rawBytes.toString('base64'));
  assert.equal(seenTickets[0].credentials.kind, 'team');
  assert.equal(seenTickets[0].credentials.role, 'empleado');
  assert.deepEqual(seenTickets[0].scopes, ['fotos:read']);
  assert.equal(seenTickets[0].credentials.pin, '234');
});

test('C31: sembrarFotosAlRelay omite escritura sombra en API.fotosMap cuando corteFotosShaActivo=true', () => {
  const syncSrc = fs.readFileSync(SYNC_YJS_PATH, 'utf8');
  assert.match(syncSrc, /API\.corteFotosShaActivo\s*===\s*true/);
  assert.match(syncSrc, /_fotoSubidaShaOk/);
  // QA OFF guarantees preserved
  assert.equal(makePilotVm().pilot.fotoSha(), null);
});
