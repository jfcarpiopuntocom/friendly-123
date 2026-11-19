'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createRequire } = require('node:module');

function loadYjs() {
  if (process.env.F123_FORCE_BUNDLE_YJS !== '1') {
    try {
      const workerRequire = createRequire(path.resolve(__dirname, '../cloudflare-yparty-worker/package.json'));
      return workerRequire('yjs');
    } catch (_) {}
  }
  const w = {};
  new Function('window', 'self', fs.readFileSync(path.resolve(__dirname, '../docs/vendor/yjs-bundle.min.js'), 'utf8'))(w, w);
  return w.Y || globalThis.Y;
}
const Y = loadYjs();

const WRITER_URL = pathToFileURL(path.resolve(__dirname, '../src/port2-catalog-delta-writer.mjs')).href;
const ROOM = 'a'.repeat(32) + '-cat';
const LICENSE = 'F123-SYNT-C19WRITER';
const INSTANCE = 'synthetic-c19a-browser';
const HEAD = 'certified-frozen-c19a';
const SHA = 'e'.repeat(64);

function makeFixture({
  badProof = false,
  mutateRemote = false,
  privateRemote = false,
  hidden = false,
  conflictOnConnect = false,
  authErrorOnConnect = false
} = {}) {
  const local = new Y.Doc();
  local.getMap('productos').set('book-1', { id: 'book-1', nombre: 'Libro Base', precio: 12.5, stockActual: 4 });
  local.getMap('ubicaciones').set('shelf-1', { id: 'shelf-1', nombre: 'Percha A', tipo: 'estante', activa: true });
  local.getMap('_meta').set('pin', 'NEVER_TO_WORKER');
  local.getMap('ventas').set('sale-1', { importe: 999999 });

  let isTabVisible = !hidden;
  let issued = 0;
  const requests = [];
  const tokenScopes = [];
  const wsTokens = [];
  const providers = [];

  const getCredentials = () => ({ kind: 'owner', licenseCode: LICENSE, instanceId: INSTANCE, pin: '123' });

  const send = async (url, opts) => {
    requests.push({ url, opts });
    if (url.endsWith('/ws/ticket')) {
      const body = JSON.parse(opts.body);
      tokenScopes.push(body.scopes);
      assert.equal(body.room, ROOM);
      return {
        ok: true,
        json: async () => ({ ok: true, token: 'tok' + (++issued) + '.signed', expiresAt: Date.now() + 30000 })
      };
    }
    assert.equal(
      url,
      'https://friendly123-yparty-port2-canary-qa.jfcarpio.workers.dev/parties/tienda/' + ROOM + '?frozen-proof=1'
    );
    assert.equal(opts.method, 'GET');
    assert.equal(opts.headers.authorization, 'Bearer tok1.signed');
    assert.equal(opts.headers['x-f123-license'], LICENSE);
    assert.equal(opts.headers['x-f123-instance'], INSTANCE);
    assert.equal(JSON.stringify(opts).includes('NEVER_TO_WORKER'), false);
    return {
      ok: true,
      json: async () => ({
        ok: true,
        room: ROOM,
        channel: 'cat',
        frozenHead: badProof ? 'wrong-head' : HEAD,
        stateSha256: SHA,
        vectorSha256: SHA
      })
    };
  };

  function createProvider({ doc, room, params, readOnly, purpose }) {
    assert.equal(room, ROOM);
    assert.equal(readOnly, false);
    assert.equal(purpose, 'certified-single-writer-catalog-delta');
    assert.notEqual(doc, local, 'private Sync3 Y.Doc must never be passed to provider');
    assert.equal(doc.share.size, 0, 'writer public Y.Doc must start EMPTY before certified sync');
    const events = new Map();
    const updates = [];
    doc.on('update', (u, origin) => {
      if (origin === 'port2-typed-catalog-delta') updates.push(u);
    });
    const emit = (name, ...args) => {
      for (const fn of [...(events.get(name) || [])]) fn(...args);
    };
    const obj = {
      doc,
      updates,
      closed: false,
      wsconnected: false,
      on(name, fn) {
        if (!events.has(name)) events.set(name, new Set());
        events.get(name).add(fn);
      },
      off(name, fn) {
        events.get(name)?.delete(fn);
      },
      emit,
      async connect() {
        const next = await params();
        wsTokens.push(next.cap);
        if (conflictOnConnect) {
          emit('connection-close', { code: 1008, reason: 'Catalog writer already active' });
          return false;
        }
        if (authErrorOnConnect) {
          emit('authorization-error', { reason: 'authorization-unavailable' });
          return false;
        }
        doc.getMap('productos').set('book-1', {
          id: 'book-1',
          nombre: 'Libro Base',
          precio: mutateRemote ? 99 : 12.5,
          stockActual: 4
        });
        doc.getMap('ubicaciones').set('shelf-1', {
          id: 'shelf-1',
          nombre: 'Percha A',
          tipo: 'estante',
          activa: true
        });
        if (privateRemote) doc.getMap('_meta').set('pin', 'REMOTE_PRIVATE');
        this.wsconnected = true;
        emit('synced', true);
        return true;
      },
      destroy() {
        this.closed = true;
        this.wsconnected = false;
      }
    };
    providers.push(obj);
    return obj;
  }

  return {
    local,
    requests,
    tokenScopes,
    wsTokens,
    providers,
    setVisible(v) { isTabVisible = v; },
    input(overrides = {}) {
      return {
        privateDoc: local,
        Y,
        room: ROOM,
        licenseCode: LICENSE,
        instanceId: INSTANCE,
        expectedFrozenHead: HEAD,
        getCredentials,
        createProvider,
        fetch: send,
        isVisible: () => isTabVisible,
        timeoutMs: 1500,
        ...overrides
      };
    },
    close() {
      local.destroy();
    }
  };
}

test('1. C19a proof (cat:read) -> fresh WS (cat:read,cat:write) -> surgical typed deltas without touching privateDoc', async () => {
  const { openCertifiedPublicCatalogWriter } = await import(WRITER_URL);
  const f = makeFixture();
  try {
    const writer = await openCertifiedPublicCatalogWriter(f.input());
    assert.equal(writer.readOnly, false);
    assert.equal(writer.frozenHead, HEAD);
    assert.equal(writer.isActive(), true);
    assert.deepEqual(f.tokenScopes, [['cat:read'], ['cat:read', 'cat:write']]);
    assert.deepEqual(f.wsTokens, ['tok2.signed'], 'WS must use a fresh one-use ticket distinct from proof token');

    // Apply surgical product.upsert
    const r1 = writer.applyDelta({
      kind: 'product.upsert',
      product: { id: 'book-2', nombre: 'Cuaderno Nuevo', sku: 'SKU-2', precio: 8.75, stockActual: 10 }
    });
    assert.equal(r1.ok, true);
    assert.equal(r1.kind, 'product.upsert');
    assert.equal(r1.id, 'book-2');
    assert.ok(r1.byteLength > 0 && r1.byteLength < 512, 'delta must be a small surgical Yjs update');

    // Apply shelf.upsert + product.delete + shelf.delete
    const r2 = writer.applyDelta({
      kind: 'shelf.upsert',
      shelf: { id: 'shelf-2', nombre: 'Vitrina B', tipo: 'vitrina', activa: true }
    });
    assert.equal(r2.ok, true);

    const r3 = writer.applyDelta({ kind: 'product.delete', id: 'book-1' });
    assert.equal(r3.ok, true);

    const r4 = writer.applyDelta({ kind: 'shelf.delete', id: 'shelf-1' });
    assert.equal(r4.ok, true);

    const view = writer.display();
    assert.equal(view.productos['book-1'], undefined);
    assert.equal(view.productos['book-2'].nombre, 'Cuaderno Nuevo');
    assert.equal(view.ubicaciones['shelf-1'], undefined);
    assert.equal(view.ubicaciones['shelf-2'].nombre, 'Vitrina B');

    // Private Sync3 doc must remain untouched and completely isolated
    assert.equal(f.local.getMap('_meta').get('pin'), 'NEVER_TO_WORKER');
    assert.equal(f.local.getMap('productos').get('book-2'), undefined);
    assert.equal(f.providers[0].doc.share.has('_meta'), false);
    assert.equal(f.providers[0].doc.share.has('ventas'), false);
    assert.equal(f.providers[0].updates.length, 4);

    writer.close();
  } finally {
    f.close();
  }
});

test('2. C19a bad frozenHead proof rejects BEFORE opening WS provider', async () => {
  const { openCertifiedPublicCatalogWriter } = await import(WRITER_URL);
  const f = makeFixture({ badProof: true });
  try {
    await assert.rejects(openCertifiedPublicCatalogWriter(f.input()), /certified catalog writer unavailable/);
    assert.equal(f.providers.length, 0);
    assert.equal(f.requests.length, 2);
  } finally {
    f.close();
  }
});

test('3. C19a baseline parity mismatch or malicious private root tears down provider fail-closed', async () => {
  const { openCertifiedPublicCatalogWriter } = await import(WRITER_URL);
  for (const opt of [{ mutateRemote: true }, { privateRemote: true }]) {
    const f = makeFixture(opt);
    try {
      await assert.rejects(openCertifiedPublicCatalogWriter(f.input()), /certified catalog writer unavailable/);
      assert.equal(f.providers[0]?.closed, true);
      assert.equal(f.local.getMap('_meta').get('pin'), 'NEVER_TO_WORKER');
    } finally {
      f.close();
    }
  }
});

test('4. C19a applyDelta rejects private/unknown/economic/prototype fields with ZERO mutation', async () => {
  const { openCertifiedPublicCatalogWriter } = await import(WRITER_URL);
  const f = makeFixture();
  try {
    const writer = await openCertifiedPublicCatalogWriter(f.input());
    const beforeUpdates = f.providers[0].updates.length;
    const beforeSnap = JSON.stringify(writer.display());

    const invalidDeltas = [
      null,
      {},
      { kind: 'sale.record', opId: 'op_12345678', amountCents: 1500 },
      { kind: 'product.upsert', product: { id: 'p-bad', nombre: 'X', precio: 5, stockActual: 1, costo: 2 } },
      { kind: 'product.upsert', product: { id: 'p-bad', nombre: 'X', precio: 5, stockActual: 1, pin: '123' } },
      { kind: 'product.upsert', product: { id: 'p-bad', nombre: 'X', precio: 5, stockActual: 1, fotos: ['a'] } },
      { kind: 'product.upsert', product: { id: 'p-bad', nombre: 'X', precio: -1, stockActual: 1 } },
      { kind: 'product.upsert', product: { id: 'p-bad', nombre: 'X', precio: 5, stockActual: 1.5 } },
      { kind: 'product.upsert', product: { id: '__proto__', nombre: 'X', precio: 5, stockActual: 1 } },
      { kind: 'product.delete', id: 'constructor' },
      { kind: 'shelf.upsert', shelf: { id: 's-bad', nombre: 'S', secret: 'nope' } },
      { kind: 'shelf.delete', id: 'bad id with spaces' }
    ];

    for (const delta of invalidDeltas) {
      assert.throws(() => writer.applyDelta(delta), TypeError);
    }

    assert.equal(f.providers[0].updates.length, beforeUpdates, 'invalid deltas must emit ZERO Yjs updates');
    assert.equal(JSON.stringify(writer.display()), beforeSnap, 'invalid deltas must not mutate publicDoc');
    writer.close();
  } finally {
    f.close();
  }
});

test('5. C19a single-writer conflict (1008 Catalog writer already active) fails cleanly on connect and at runtime', async () => {
  const { openCertifiedPublicCatalogWriter } = await import(WRITER_URL);
  // 5a: conflict during connect
  const f1 = makeFixture({ conflictOnConnect: true });
  try {
    await assert.rejects(
      openCertifiedPublicCatalogWriter(f1.input()),
      err => err && err.code === 'writer-conflict'
    );
    assert.equal(f1.providers[0]?.closed, true);
  } finally {
    f1.close();
  }

  // 5b: conflict / revocation after connect
  const f2 = makeFixture();
  try {
    let conflictCount = 0;
    const writer = await openCertifiedPublicCatalogWriter(
      f2.input({ onWriterConflict: () => { conflictCount++; } })
    );
    assert.equal(writer.isActive(), true);

    f2.providers[0].emit('connection-close', { code: 1008, reason: 'Catalog writer already active' });
    assert.equal(conflictCount, 1);
    assert.equal(writer.isActive(), false);
    assert.equal(f2.providers[0].closed, true);
    assert.throws(
      () => writer.applyDelta({ kind: 'product.delete', id: 'book-1' }),
      /writer inactive|closed/i
    );
  } finally {
    f2.close();
  }
});

test('6. C19a hidden tab refuses open before any network fetch and blocks mid-session applyDelta', async () => {
  const { openCertifiedPublicCatalogWriter } = await import(WRITER_URL);
  const fHidden = makeFixture({ hidden: true });
  try {
    await assert.rejects(openCertifiedPublicCatalogWriter(fHidden.input()), /certified catalog writer unavailable/);
    assert.equal(fHidden.requests.length, 0);
  } finally {
    fHidden.close();
  }

  const f = makeFixture();
  try {
    const writer = await openCertifiedPublicCatalogWriter(f.input());
    f.setVisible(false);
    assert.throws(
      () => writer.applyDelta({ kind: 'product.delete', id: 'book-1' }),
      /hidden|visible/i
    );
    assert.equal(f.providers[0].updates.length, 0);
    assert.equal(writer.display(), null);
    writer.close();
  } finally {
    f.close();
  }
});

test('7. C19a non-cat rooms (-ops/-priv) and invalid args fail closed BEFORE any fetch', async () => {
  const { openCertifiedPublicCatalogWriter } = await import(WRITER_URL);
  for (const badRoom of ['b'.repeat(32) + '-ops', 'b'.repeat(32) + '-priv', 'not-a-room']) {
    const f = makeFixture();
    try {
      await assert.rejects(openCertifiedPublicCatalogWriter(f.input({ room: badRoom })));
      assert.equal(f.requests.length, 0);
    } finally {
      f.close();
    }
  }
  const fBadTimeout = makeFixture();
  try {
    await assert.rejects(openCertifiedPublicCatalogWriter(fBadTimeout.input({ timeoutMs: 50 })));
    assert.equal(fBadTimeout.requests.length, 0);
  } finally {
    fBadTimeout.close();
  }
});

test('8. C19a close() is idempotent, tears down provider and isolates privateDoc', async () => {
  const { openCertifiedPublicCatalogWriter } = await import(WRITER_URL);
  const f = makeFixture();
  try {
    const writer = await openCertifiedPublicCatalogWriter(f.input());
    writer.close();
    writer.close();
    assert.equal(writer.isActive(), false);
    assert.equal(f.providers[0].closed, true);
    assert.equal(writer.display(), null);
    assert.throws(() => writer.applyDelta({ kind: 'product.delete', id: 'book-1' }));
    assert.equal(f.local.getMap('_meta').get('pin'), 'NEVER_TO_WORKER');
  } finally {
    f.close();
  }
});
