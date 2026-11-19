'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const crypto = require('node:crypto');
const { IDBFactory } = require('fake-indexeddb');

const ROOT = path.join(__dirname, '..');
const SOURCE_PATH = path.join(ROOT, 'src', 'yparty-piloto.js');
const BUNDLE_PATH = path.join(ROOT, 'docs', 'vendor', 'yparty-piloto.min.js');
const SYNC_YJS_PATH = path.join(ROOT, 'docs', 'sync-yjs.js');

const LICENSE = 'F123-SYNT-C23WIRE';
const INSTANCE = 'synthetic-c23-device';
const ROOM = 'd'.repeat(32);

const YJS_BUNDLE = fs.readFileSync(path.join(ROOT, 'docs', 'vendor', 'yjs-bundle.min.js'), 'utf8');

function makePilotEnv({
  role = 'dueno',
  ownerPin = '123',
  team = { subject: 'emp_01', pin: '234' },
  hidden = false,
  owned = { licenseCode: LICENSE, instanceId: INSTANCE },
  fetchImpl = async () => { throw new Error('unexpected fetch'); }
} = {}) {
  const bundleCode = fs.readFileSync(BUNDLE_PATH, 'utf8');
  const indexedDB = new IDBFactory();
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

  vm.runInContext(YJS_BUNDLE, ctx, { filename: 'yjs-bundle.min.js' });
  window.Y = window.Y || ctx.Y;
  vm.runInContext(bundleCode, ctx, { filename: 'yparty-piloto.min.js' });
  const pilot = window.F123YPartyPilot(ROOM, LICENSE);
  return {
    pilot,
    Y: window.Y,
    ctx,
    window,
    document,
    indexedDB,
    setRole(r) { role = r; },
    setHidden(h) { document.hidden = h; }
  };
}

test('1. C23 source and compiled bundle wire C16b-store, C18a photo SHA client, and C19a catalog delta writer while keeping legacy fotoSha() disabled', () => {
  const src = fs.readFileSync(SOURCE_PATH, 'utf8');
  const sync = fs.readFileSync(SYNC_YJS_PATH, 'utf8');

  // Single-line import rule preserved for VM suites
  const importLines = src.split('\n').filter(l => l.trim().startsWith('import '));
  assert.ok(importLines.length >= 10);
  for (const line of importLines) {
    assert.match(line, /^import .+ from ['"].+['"];\r?$/);
  }

  assert.match(src, /import \{createTypedOpsIdbStore\} from '\.\/port2-typed-ops-idb-store\.mjs';/);
  assert.match(src, /import \{createOwnerPhotoShaClient,createTeamPhotoShaReader\} from '\.\/port2-photo-sha-client\.mjs';/);
  assert.match(src, /import \{openCertifiedPublicCatalogWriter\} from '\.\/port2-catalog-delta-writer\.mjs';/);
  assert.match(src, /import \{createVerifiedCrossDeviceFailbackCoordinator\} from '\.\/port2-cross-device-failback\.mjs';/);

  assert.match(src, /crearAlmacenDurableOpsTipadas\(/);
  assert.match(src, /crearClienteFotosShaCertificado\(/);
  assert.match(src, /abrirEscritorDeltaCatalogoCertificado\(/);
  assert.match(src, /crearCoordinadorCorteYFailback\(/);

  assert.match(sync, /API\.crearAlmacenDurableOpsTipadas/);
  assert.match(sync, /API\.crearClienteFotosShaCertificado/);
  assert.match(sync, /API\.abrirEscritorDeltaCatalogoCertificado/);
  assert.match(sync, /API\.crearCoordinadorCorteYFailback/);
  assert.match(sync, /API\.despacharOpComercialCertificada/);
  assert.match(sync, /API\.puedeDespacharOpEnLegado/);

  const env = makePilotEnv();
  assert.equal(env.pilot.fotoSha(), null, 'legacy unsealed fotoSha() must stay null for RED ULTRA #1b');
  assert.equal(typeof env.pilot.crearAlmacenDurableOpsTipadas, 'function');
  assert.equal(typeof env.pilot.crearClienteFotosShaCertificado, 'function');
  assert.equal(typeof env.pilot.abrirEscritorDeltaCatalogoCertificado, 'function');
  assert.equal(typeof env.pilot.crearCoordinadorCorteYFailback, 'function');
});

test('2. C23 crearAlmacenDurableOpsTipadas in compiled bundle creates real IndexedDB store with SHA-256 namespace and integrates with crearDespachadorComercialTipado', async () => {
  const requests = [];
  const saleCmd = {
    license: LICENSE,
    opId: 'op_c23_idb_bundle_01',
    kind: 'sale.record',
    productId: 'sku_1',
    quantity: 1,
    amountCents: 1500
  };
  const canonicalBytes = new TextEncoder().encode(JSON.stringify(saleCmd));
  const receiptId = Buffer.from(await crypto.webcrypto.subtle.digest('SHA-256', canonicalBytes)).toString('hex').slice(0, 24);

  const env = makePilotEnv({
    fetchImpl: async (url, opts) => {
      requests.push({ url: String(url), opts });
      if (String(url).endsWith('/ws/ticket')) {
        return new Response(
          JSON.stringify({ ok: true, token: 'tok_c23_ops.sig', expiresAt: Date.now() + 30000 }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
      return new Response(
        JSON.stringify({
          ok: true,
          duplicate: false,
          receipt: {
            opId: saleCmd.opId,
            license: LICENSE,
            kind: saleCmd.kind,
            stage: 'business-committed',
            receiptId,
            acceptedAt: Date.now()
          }
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    }
  });

  const store = await env.pilot.crearAlmacenDurableOpsTipadas();
  assert.equal(typeof store.loadAll, 'function');
  assert.equal(typeof store.save, 'function');
  assert.equal(typeof store.remove, 'function');

  // Verify C15 allowlist is enforced inside the bundled IDB store
  await assert.rejects(
    store.save({
      opId: 'op_c23_bad_schema',
      command: { ...saleCmd, opId: 'op_c23_bad_schema', extraPrivateField: 'forbidden' },
      sameDoLocked: true,
      attempts: 0,
      state: 'prepared',
      createdAt: Date.now(),
      updatedAt: Date.now()
    }),
    /invalid|schema|command/i
  );

  // Wire store directly into crearDespachadorComercialTipado
  const dispatcher = env.pilot.crearDespachadorComercialTipado({ store });
  await dispatcher.ready();
  const res = await dispatcher.submit(saleCmd);
  assert.equal(res.committed, true);
  assert.equal(res.stage, 'business-committed');
  assert.equal((await store.loadAll()).length, 0);
  dispatcher.destroy();
});

test('3. C23 crearClienteFotosShaCertificado in compiled bundle provides PUT/GET for Owner, read-only GET for Team (admin/empleado), and denies contador/hidden', async () => {
  const photoBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4]);
  const photoDataUrl = 'data:image/png;base64,' + Buffer.from(photoBytes).toString('base64');
  const photoSha = crypto.createHash('sha256').update(photoBytes).digest('hex');
  const ticketScopes = [];

  const fetchImpl = async (url, opts) => {
    const s = String(url);
    if (s.endsWith('/ws/ticket')) {
      const body = JSON.parse(opts.body);
      ticketScopes.push({ kind: body.credentials.kind, role: body.credentials.role, scopes: body.scopes });
      return new Response(
        JSON.stringify({ ok: true, token: 'photo_tok_' + ticketScopes.length + '.sig', expiresAt: Date.now() + 30000 }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    }
    if (opts.method === 'PUT') {
      return new Response(
        JSON.stringify({ sha: photoSha, bytes: photoBytes.byteLength, tipo: 'image/png' }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    }
    return new Response(photoBytes, {
      status: 200,
      headers: { 'content-type': 'image/png', 'content-length': String(photoBytes.byteLength) }
    });
  };

  // 3a. Owner gets full PUT + GET client
  const ownerEnv = makePilotEnv({ role: 'dueno', fetchImpl });
  const ownerClient = ownerEnv.pilot.crearClienteFotosShaCertificado();
  assert.equal(typeof ownerClient.put, 'function');
  assert.equal(typeof ownerClient.get, 'function');
  const putRes = await ownerClient.put(photoSha, photoDataUrl);
  assert.deepEqual(JSON.parse(JSON.stringify(putRes)), { sha: photoSha, bytes: photoBytes.byteLength, tipo: 'image/png' });

  // 3b. Team (empleado) gets strictly READ-ONLY client (get only, no put)
  const teamEnv = makePilotEnv({ role: 'empleado', fetchImpl });
  const teamReader = teamEnv.pilot.crearClienteFotosShaCertificado();
  assert.equal(teamReader.put, undefined, 'Team photo client must never expose put()');
  assert.equal(typeof teamReader.get, 'function');
  const getRes = await teamReader.get(photoSha);
  assert.equal(getRes, photoDataUrl);

  assert.deepEqual(ticketScopes, [
    { kind: 'owner', role: undefined, scopes: ['fotos:write'] },
    { kind: 'team', role: 'empleado', scopes: ['fotos:read'] }
  ]);

  // 3c. Forbidden role (contador) or hidden tab fails closed
  const acctEnv = makePilotEnv({ role: 'contador', fetchImpl });
  assert.throws(() => acctEnv.pilot.crearClienteFotosShaCertificado(), /photo sha client unavailable/);

  const hiddenEnv = makePilotEnv({ role: 'dueno', hidden: true, fetchImpl });
  assert.throws(() => hiddenEnv.pilot.crearClienteFotosShaCertificado(), /photo sha client unavailable/);
});

test('4. C23 abrirEscritorDeltaCatalogoCertificado in compiled bundle verifies C11 proof, opens single-writer C19a session, applies typed delta and rejects non-Owner', async () => {
  const head = 'certified-c23-head-20261119';
  const sha = 'f'.repeat(64);
  const scopesRequested = [];

  const env = makePilotEnv({
    role: 'dueno',
    fetchImpl: async (url, opts) => {
      const s = String(url);
      if (s.endsWith('/ws/ticket')) {
        const body = JSON.parse(opts.body);
        scopesRequested.push(body.scopes);
        return new Response(
          JSON.stringify({ ok: true, token: 'cat_tok_' + scopesRequested.length + '.sig', expiresAt: Date.now() + 30000 }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
      return new Response(
        JSON.stringify({ ok: true, room: ROOM + '-cat', channel: 'cat', frozenHead: head, stateSha256: sha, vectorSha256: sha }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    }
  });

  const privateDoc = vm.runInContext(`(() => {
    const d = new Y.Doc();
    d.getMap('productos').set('p-1', { id: 'p-1', nombre: 'Libro C23', precio: 10, stockActual: 3 });
    d.getMap('ubicaciones').set('s-1', { id: 's-1', nombre: 'Percha 1', activa: true });
    d.getMap('_meta').set('pin', 'PRIVATE_NEVER_LEAK');
    return d;
  })()`, env.ctx);

  const writer = await env.pilot.abrirEscritorDeltaCatalogoCertificado(privateDoc, head, {
    createProvider({ doc, params, readOnly }) {
      assert.equal(readOnly, false);
      const listeners = new Map();
      return {
        on(name, fn) {
          if (!listeners.has(name)) listeners.set(name, new Set());
          listeners.get(name).add(fn);
        },
        off(name, fn) { listeners.get(name)?.delete(fn); },
        async connect() {
          await params();
          env.ctx.__remoteDoc = doc;
          vm.runInContext(`
            __remoteDoc.getMap('productos').set('p-1', { id: 'p-1', nombre: 'Libro C23', precio: 10, stockActual: 3 });
            __remoteDoc.getMap('ubicaciones').set('s-1', { id: 's-1', nombre: 'Percha 1', activa: true });
          `, env.ctx);
          for (const fn of listeners.get('synced') || []) fn(true);
        },
        destroy() {}
      };
    }
  });

  assert.equal(writer.readOnly, false);
  assert.equal(writer.frozenHead, head);
  assert.deepEqual(scopesRequested, [['cat:read'], ['cat:read', 'cat:write']]);

  const deltaArg = vm.runInContext(`({
    kind: 'product.upsert',
    product: { id: 'p-2', nombre: 'Nuevo C23', precio: 20, stockActual: 5 }
  })`, env.ctx);
  const dOut = writer.applyDelta(deltaArg);
  assert.equal(dOut.ok, true);
  assert.equal(writer.display().productos['p-2'].nombre, 'Nuevo C23');
  writer.close();
  privateDoc.destroy();

  // Team role cannot open catalog delta writer
  const empEnv = makePilotEnv({ role: 'empleado' });
  const d2 = vm.runInContext('new Y.Doc()', empEnv.ctx);
  await assert.rejects(
    empEnv.pilot.abrirEscritorDeltaCatalogoCertificado(d2, head),
    /certified catalog writer unavailable/
  );
  d2.destroy();
});

test('5. C24 crearCoordinadorCorteYFailback in compiled bundle coordinates certified cutover, C21b settled_ops tombstone across Safari reload, and legacy anti-duplication fence', async () => {
  const head = 'certified-c24-head-20261119';
  const sha = 'e'.repeat(64);
  const saleCmd = {
    license: LICENSE,
    opId: 'op_c24_settled_reload_01',
    kind: 'sale.record',
    productId: 'sku_1',
    quantity: 1,
    amountCents: 1500
  };
  const canonicalBytes = new TextEncoder().encode(JSON.stringify(saleCmd));
  const receiptId = Buffer.from(await crypto.webcrypto.subtle.digest('SHA-256', canonicalBytes)).toString('hex').slice(0, 24);

  let tokSeq = 0;
  const fetchImpl = async (url) => {
    const s = String(url);
    if (s.endsWith('/ws/ticket')) {
      return new Response(
        JSON.stringify({ ok: true, token: 'c24_tok_' + (++tokSeq) + '.sig', expiresAt: Date.now() + 30000 }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    }
    if (s.includes('frozen-proof=1')) {
      return new Response(
        JSON.stringify({ ok: true, room: ROOM + '-cat', channel: 'cat', frozenHead: head, stateSha256: sha, vectorSha256: sha }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    }
    return new Response(
      JSON.stringify({
        ok: true,
        duplicate: false,
        receipt: {
          opId: saleCmd.opId,
          license: LICENSE,
          kind: saleCmd.kind,
          stage: 'business-committed',
          receiptId,
          acceptedAt: Date.now()
        }
      }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    );
  };

  const env = makePilotEnv({ role: 'dueno', fetchImpl });
  const privateDoc = vm.runInContext(`(() => {
    const d = new Y.Doc();
    d.getMap('productos').set('sku_1', { id: 'sku_1', nombre: 'Prod C24', precio: 15, stockActual: 5 });
    d.getMap('ubicaciones').set('s-1', { id: 's-1', nombre: 'Percha 1', activa: true });
    return d;
  })()`, env.ctx);

  const createProvider = ({ doc, params, readOnly }) => {
    assert.equal(readOnly, false);
    const listeners = new Map();
    return {
      on(name, fn) {
        if (!listeners.has(name)) listeners.set(name, new Set());
        listeners.get(name).add(fn);
      },
      off(name, fn) { listeners.get(name)?.delete(fn); },
      async connect() {
        await params();
        env.ctx.__c24RemoteDoc = doc;
        vm.runInContext(`
          __c24RemoteDoc.getMap('productos').set('sku_1', { id: 'sku_1', nombre: 'Prod C24', precio: 15, stockActual: 5 });
          __c24RemoteDoc.getMap('ubicaciones').set('s-1', { id: 's-1', nombre: 'Percha 1', activa: true });
        `, env.ctx);
        for (const fn of listeners.get('synced') || []) fn(true);
      },
      destroy() {}
    };
  };

  const coord = await env.pilot.crearCoordinadorCorteYFailback({
    privateDoc,
    expectedFrozenHead: head,
    createProvider
  });

  const act = await coord.activate20();
  assert.equal(act.ok, true);
  assert.equal(coord.mode(), 'active-2.0');

  const out = await coord.submitCommercial(saleCmd);
  assert.equal(out.committed, true);
  assert.equal(out.stage, 'business-committed');

  await coord.failbackToLegacy('switch-to-1.0');
  assert.equal(coord.mode(), 'failback-legacy-1.0');
  assert.equal(await coord.canDispatchOnLegacy(saleCmd.opId), false);
  coord.destroy();

  // Simulate Safari reload on the SAME IndexedDB instance: C21b settled_ops tombstone must block legacy duplicate!
  const reloadedPilot = env.window.F123YPartyPilot(ROOM, LICENSE);
  const reloadedCoord = await reloadedPilot.crearCoordinadorCorteYFailback({
    indexedDB: env.indexedDB,
    privateDoc,
    expectedFrozenHead: head,
    createProvider
  });
  assert.equal(await reloadedCoord.canDispatchOnLegacy(saleCmd.opId), false, 'committed opId tombstone must survive Safari reload');
  await assert.rejects(
    reloadedCoord.assertLegacyAllowed(saleCmd.opId),
    /latched-same-do-only/
  );
  assert.equal(await reloadedCoord.canDispatchOnLegacy('op_c24_fresh_post_reload'), true);
  reloadedCoord.destroy();
  privateDoc.destroy();
});
