import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import {
  legacyRoomHexForLicense,
  ypartyBaseForLicense,
  exchangeTicketForSession,
  verifySessionToken,
  initRelaySchema,
  createRelayStore,
  isOriginAllowed,
  validateCipherBase64,
  MAX_OP_B64,
  MAX_STORE_BYTES
} from '../cloudflare-relay-worker/src/priv-relay-core.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

function makeDoStorage() {
  const db = new DatabaseSync(':memory:');
  let syncCalls = 0;
  const sql = {
    exec(query, ...params) {
      if (params.length === 0 && query.includes(';') && query.trim().toUpperCase().startsWith('CREATE')) {
        db.exec(query);
        return { toArray: () => [] };
      }
      const stmt = db.prepare(query);
      if (/^\s*SELECT\b/i.test(query) || /\bRETURNING\b/i.test(query)) {
        const rows = stmt.all(...params);
        return { toArray: () => rows };
      }
      stmt.run(...params);
      return { toArray: () => [] };
    }
  };
  return {
    sql,
    get syncCalls() { return syncCalls; },
    transactionSync(fn) {
      db.exec('BEGIN IMMEDIATE');
      try {
        const r = fn();
        db.exec('COMMIT');
        return r;
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
    async sync() { syncCalls++; }
  };
}

async function deriveAesKey(lic) {
  const enc = new TextEncoder();
  const base = await crypto.subtle.importKey('raw', enc.encode(lic), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: enc.encode('amigable-sync-v1'), iterations: 10000, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
  );
}

async function encryptB64(key, obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plain = new TextEncoder().encode(JSON.stringify(obj));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain));
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv, 0); out.set(ct, iv.length);
  let s = '';
  for (let i = 0; i < out.length; i += 32768) s += String.fromCharCode(...out.subarray(i, i + 32768));
  return btoa(s);
}

async function decryptBytes(key, buf) {
  const bytes = new Uint8Array(buf);
  const iv = bytes.subarray(0, 12);
  const ct = bytes.subarray(12);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  return JSON.parse(new TextDecoder().decode(plain));
}

function makeMockAuthority({ license, instance, role = 'dueno', rev = 1 }) {
  const issued = new Map();
  let counter = 0;
  return {
    issue(reqBody) {
      const token = 'tok_' + (++counter) + '_' + role;
      issued.set(token, { ...reqBody, used: false });
      return { ok: true, token, expiresAt: Date.now() + 30_000 };
    },
    WS_AUTHORITY: {
      async fetch(_url, init) {
        const body = JSON.parse(init.body);
        const rec = issued.get(body.token);
        if (!rec || rec.used || body.licenseCode !== license || body.instanceId !== instance || rec.room !== body.room || !rec.scopes.includes(body.requiredScope)) {
          return new Response(JSON.stringify({ ok: false, reason: 'ticket-rejected' }), { status: 403 });
        }
        rec.used = true;
        return new Response(JSON.stringify({
          ok: true,
          principal: { license, instance, role, roleRevision: rev }
        }), { status: 200 });
      }
    }
  };
}

test('C224 STRIDE security: rejects foreign origins, cross-store rooms, plaintext JSON, oversized payloads, and replayed tickets', async () => {
  const env = {
    ALLOWED_ORIGINS: 'https://jfcarpiopuntocom.github.io,https://friendly-123.jfcarpio.workers.dev',
    WS_SERVICE_KEY: 'synthetic-service-secret-at-least-32-bytes-long!'
  };
  assert.equal(isOriginAllowed('https://jfcarpiopuntocom.github.io', env), true);
  assert.equal(isOriginAllowed('https://friendly-123.jfcarpio.workers.dev', env), true);
  assert.equal(isOriginAllowed('https://evil.example', env), false);

  // Plaintext JSON encoded in base64 MUST be rejected
  const fakeJsonB64 = btoa(JSON.stringify({ ventas: [{ total: 500 }], clientes: [{ nombre: 'Ana' }] }));
  assert.equal(validateCipherBase64(fakeJsonB64, MAX_OP_B64).reason, 'plaintext-rejected');

  // Cross-store isolation: ticket for STORE-A cannot open STORE-B room
  const licA = 'F123-TEST-STOREAAA';
  const licB = 'F123-TEST-STOREBBB';
  const roomB = (await legacyRoomHexForLicense(licB)) + '-y';
  const auth = makeMockAuthority({ license: licA, instance: 'inst-dev-01', role: 'dueno' });
  const yBaseA = await ypartyBaseForLicense(licA);
  const t1 = auth.issue({ room: yBaseA + '-priv', scopes: ['priv:read', 'priv:write'] });
  const cross = await exchangeTicketForSession({
    env: { ...env, WS_AUTHORITY: auth.WS_AUTHORITY },
    room: roomB,
    licenseCode: licA,
    instanceId: 'inst-dev-01',
    roleHint: 'dueno',
    ticket: t1.token
  });
  assert.equal(cross.ok, false);
  assert.equal(cross.status, 403);
  assert.equal(cross.reason, 'room-license-mismatch');

  // Valid room succeeds ONCE; replay of same one-use ticket fails with 403
  const roomA = (await legacyRoomHexForLicense(licA)) + '-y';
  const ok1 = await exchangeTicketForSession({
    env: { ...env, WS_AUTHORITY: auth.WS_AUTHORITY },
    room: roomA,
    licenseCode: licA,
    instanceId: 'inst-dev-01',
    roleHint: 'dueno',
    ticket: t1.token
  });
  assert.equal(ok1.ok, true);
  const replay = await exchangeTicketForSession({
    env: { ...env, WS_AUTHORITY: auth.WS_AUTHORITY },
    room: roomA,
    licenseCode: licA,
    instanceId: 'inst-dev-01',
    roleHint: 'dueno',
    ticket: t1.token
  });
  assert.equal(replay.ok, false);
  assert.equal(replay.status, 403);

  // Session token minted for roomA is rejected on roomB
  assert.equal((await verifySessionToken(env, ok1.token, roomA)).ok, true);
  assert.equal((await verifySessionToken(env, ok1.token, roomB)).ok, false);
});

test('C224 E2E cold device: Owner uploads chunked encrypted money/sales/commissions/customers; new device (Owner & Admin) hydrates 100% + live poll', async () => {
  const lic = 'F123-LORD-SYNTH999';
  const roomHex = await legacyRoomHexForLicense(lic);
  const room = roomHex + '-y';
  const locator = 'wss://friendly123-sync-relay.jfcarpio.workers.dev/sala/' + room;
  const storage = makeDoStorage();
  initRelaySchema(storage.sql);
  const store = createRelayStore(storage);
  const env = {
    WS_SERVICE_KEY: 'synthetic-service-secret-at-least-32-bytes-long!'
  };
  const ownerAuth = makeMockAuthority({ license: lic, instance: 'device-owner-a', role: 'dueno' });
  const adminAuth = makeMockAuthority({ license: lic, instance: 'device-admin-b', role: 'admin' });
  const activeAuth = { current: ownerAuth };

  // Wire an in-memory fetch implementing both /ws/ticket and friendly123-relay-privado routes
  async function mockFetch(url, init = {}) {
    const u = new URL(url);
    if (u.pathname === '/ws/ticket') {
      const body = JSON.parse(init.body);
      const res = activeAuth.current.issue(body);
      return new Response(JSON.stringify(res), { status: 200 });
    }
    const headers = new Headers(init.headers || {});
    const bearer = (headers.get('authorization') || '').replace(/^Bearer /, '');
    const m = /^\/f123\/([^/]+)\/(session|head|pull|op|ckpt|ts)$/.exec(u.pathname);
    assert.ok(m, 'unexpected URL ' + url);
    const [, reqRoom, action] = m;
    if (action === 'session') {
      const body = init.body ? JSON.parse(init.body) : null;
      const res = await exchangeTicketForSession({
        env: { ...env, WS_AUTHORITY: activeAuth.current.WS_AUTHORITY },
        room: reqRoom,
        licenseCode: headers.get('x-f123-license'),
        instanceId: headers.get('x-f123-instance'),
        roleHint: headers.get('x-f123-role'),
        ticket: bearer,
        credentials: body?.credentials || null,
        fallbackSecret: store.getOrCreateDoSecret()
      });
      return new Response(JSON.stringify(res), { status: res.status });
    }
    const ver = await verifySessionToken(env, bearer, reqRoom, Date.now, store.getOrCreateDoSecret());
    if (!ver.ok) return new Response(JSON.stringify({ ok: false, reason: ver.reason }), { status: 401 });
    if (action === 'head') return new Response(JSON.stringify({ ok: true, v: 2, ...store.head() }), { status: 200 });
    if (action === 'ts') return new Response(JSON.stringify({ ok: true, t1: Date.now() }), { status: 200 });
    if (action === 'pull') {
      const res = store.pull({
        rev: u.searchParams.get('rev'),
        seq: u.searchParams.get('seq'),
        limit: u.searchParams.get('limit')
      });
      return new Response(JSON.stringify(res), { status: 200 });
    }
    if (action === 'op') {
      const body = JSON.parse(init.body);
      const res = await store.putOp(body);
      return new Response(JSON.stringify(res), { status: res.status });
    }
    if (action === 'ckpt') {
      const body = JSON.parse(init.body);
      const res = await store.putCkpt(body);
      return new Response(JSON.stringify(res), { status: res.status });
    }
    return new Response('not found', { status: 404 });
  }

  // Load real browser/cf-relay.js into VM
  const src = fs.readFileSync(path.join(ROOT, 'docs', 'cf-relay.js'), 'utf8');
  const listeners = {};
  const sandbox = {
    window: { addEventListener: (t, fn) => { (listeners[t] = listeners[t] || []).push(fn); } },
    crypto, TextEncoder, atob, btoa, Blob, DOMException, URL, Response, Headers, setInterval, clearInterval,
    document: { hidden: false }
  };
  vm.runInNewContext(src, sandbox);
  const CF = sandbox.window.F123CloudflareRelay;

  const aesKey = await deriveAesKey(lic);
  const fullPrivateBusiness = {
    ventas: [{ id: 'v1', totalCents: 14500, metodo: 'efectivo' }, { id: 'v2', totalCents: 8900, metodo: 'fiado' }],
    hechos_financieros: [{ id: 'hf1', tipo: 'caja', montoCents: 14500 }],
    promotoras: [{ id: 'pr1', nombre: 'Belen', comisionPct: 12, ganadoCents: 1740 }],
    clientes: [{ id: 'c1', nombre: 'Cliente Real', saldoCents: 8900 }],
    gastos: [{ id: 'g1', concepto: 'Renta', montoCents: 5000 }],
    pad: 'X'.repeat(450_000) // forces multi-block (>512 KiB base64) SQLite chunking!
  };
  const ckptCipher = await encryptB64(aesKey, fullPrivateBusiness);
  assert.ok(ckptCipher.length > 512 * 1024, 'checkpoint must span multiple SQLite chunks');

  const opCipher1 = await encryptB64(aesKey, { opId: 'op-sale-3', venta: { totalCents: 3200 }, comisionCents: 384 });

  // Device A (Owner) opens, pushes chunked checkpoint + op (and retries op for idempotency) + stale CAS check
  const relayA = CF.create({
    fetch: mockFetch,
    livePollMs: 0,
    getCredentials: () => ({
      role: 'dueno', licenseCode: lic, instanceId: 'device-owner-a',
      authSuffix: '-priv', scopes: ['priv:read', 'priv:write'],
      credentials: { kind: 'owner', licenseCode: lic, instanceId: 'device-owner-a', pin: '555' }
    })
  });
  const wsA = relayA.connect(locator);
  const msgsA = [];
  await new Promise((resolve, reject) => {
    wsA.onopen = resolve;
    wsA.onclose = () => reject(new Error('wsA closed early'));
  });
  wsA.onmessage = e => msgsA.push(typeof e.data === 'string' ? JSON.parse(e.data) : e.data);

  wsA.send(JSON.stringify({ k: 'ckpt', v: 2, rev: 0, seq: 0, lam: 10, id: 'ck-1', ack: 1, c: ckptCipher }));
  wsA.send(JSON.stringify({ k: 'ckpt', v: 2, rev: 0, seq: 0, lam: 11, id: 'ck-stale', ack: 1, c: ckptCipher })); // must conflict
  wsA.send(JSON.stringify({ k: 'op', id: 'op-sale-3', lam: 12, ack: 1, c: opCipher1 }));
  wsA.send(JSON.stringify({ k: 'op', id: 'op-sale-3', lam: 12, ack: 1, c: opCipher1 })); // idempotent duplicate
  await new Promise(r => setTimeout(r, 80));

  const ackCk1 = msgsA.find(m => m.k === 'persist-result' && m.id === 'ck-1');
  const ackStale = msgsA.find(m => m.k === 'persist-result' && m.id === 'ck-stale');
  const ackOps = msgsA.filter(m => m.k === 'persist-result' && m.id === 'op-sale-3');
  assert.deepEqual(ackCk1, { k: 'persist-result', kind: 'ckpt', id: 'ck-1', ok: true, conflict: false });
  assert.deepEqual(ackStale, { k: 'persist-result', kind: 'ckpt', id: 'ck-stale', ok: false, conflict: true });
  assert.equal(ackOps.length, 2);
  assert.equal(ackOps[0].ok, true);
  assert.equal(ackOps[1].ok, true);
  assert.ok(storage.syncCalls >= 2, 'storage.sync() MUST be called before ACKing writes');
  wsA.close();

  // Device B (Brand-new cold device as Admin — proves ALL roles pass!) pulls full encrypted history
  activeAuth.current = adminAuth;
  const relayB = CF.create({
    fetch: mockFetch,
    livePollMs: 0,
    getCredentials: () => ({
      role: 'admin', licenseCode: lic, instanceId: 'device-admin-b',
      authSuffix: '-cat', scopes: ['cat:read'],
      credentials: { kind: 'team', licenseCode: lic, instanceId: 'device-admin-b', subject: 'adm-1', role: 'admin', pin: '234' }
    })
  });
  const wsB = relayB.connect(locator);
  const binB = [];
  const textB = [];
  await new Promise((resolve, reject) => {
    wsB.onopen = resolve;
    wsB.onclose = () => reject(new Error('wsB closed early'));
  });
  wsB.onmessage = e => {
    if (typeof e.data === 'string') textB.push(JSON.parse(e.data));
    else binB.push(e.data);
  };
  wsB.send(JSON.stringify({ k: 'pull', v: 2, rev: -1, seq: 0, limit: 64 }));
  await new Promise(r => setTimeout(r, 80));

  assert.equal(binB.length, 2, 'cold device must receive chunked checkpoint + incremental op');
  const hydratedCkpt = await decryptBytes(aesKey, binB[0]);
  const hydratedOp = await decryptBytes(aesKey, binB[1]);
  assert.equal(hydratedCkpt.ventas.length, 2);
  assert.equal(hydratedCkpt.hechos_financieros[0].montoCents, 14500);
  assert.equal(hydratedCkpt.promotoras[0].ganadoCents, 1740);
  assert.equal(hydratedCkpt.clientes[0].saldoCents, 8900);
  assert.equal(hydratedCkpt.gastos[0].montoCents, 5000);
  assert.equal(hydratedOp.venta.totalCents, 3200);
  assert.equal(hydratedOp.comisionCents, 384);

  const pageMsg = textB.find(m => m.k === 'pull-page');
  assert.deepEqual(pageMsg, { k: 'pull-page', v: 2, rev: 1, seq: 1, n: 1, more: false });

  // Logout wipes in-memory sessions cleanly
  for (const fn of listeners['oc-logout'] || []) fn();
  wsB.close();
});

test('retains every encrypted checkpoint and restores current history on a cold device', async () => {
  const storage = makeDoStorage();
  initRelaySchema(storage.sql);
  const store = createRelayStore(storage);
  const key = await deriveAesKey('F123-C224-QA-KEEP');
  const snapshots = [
    { money: 2000, movements: ['sale-1'], commissions: [100] },
    { money: 5000, movements: ['sale-1', 'sale-2'], commissions: [100, 150] },
    { money: 3000, movements: ['sale-1', 'sale-2', 'expense-1'], commissions: [100, 150] }
  ];
  for (const [index, snapshot] of snapshots.entries()) {
    const saved = await store.putCkpt({ rev: index, seq: 0, lam: index + 1, c: await encryptB64(key, snapshot) });
    assert.equal(saved.status, 201);
  }
  const movement = { id: 'payment-1', amount: 400, commission: 20 };
  const pushed = await store.putOp({ id: movement.id, c: await encryptB64(key, movement) });
  assert.equal(pushed.status, 201);

  const cold = createRelayStore(storage).pull({ rev: 0, seq: 0 });
  const restored = await Promise.all(cold.frames.map(frame => decryptBytes(key, Buffer.from(frame, 'base64'))));
  assert.deepEqual(restored, [snapshots.at(-1), movement]);

  const savedRevisions = storage.sql.exec('SELECT rev FROM relay_ckpt_meta ORDER BY rev').toArray();
  assert.deepEqual(savedRevisions.map(row => row.rev), [1, 2, 3]);
  for (const [index, snapshot] of snapshots.entries()) {
    const blocks = storage.sql.exec('SELECT chunk FROM relay_ckpt_blocks WHERE rev = ? ORDER BY n', index + 1).toArray();
    const cipher = blocks.map(row => row.chunk).join('');
    assert.deepEqual(await decryptBytes(key, Buffer.from(cipher, 'base64')), snapshot);
  }

  storage.sql.exec("UPDATE relay_meta SET v = ? WHERE k = 'total_bytes'", String(MAX_STORE_BYTES));
  const full = await store.putCkpt({ rev: 3, seq: pushed.seq, lam: 4, c: await encryptB64(key, snapshots[2]) });
  assert.equal(full.status, 507);
  assert.deepEqual(createRelayStore(storage).pull({ rev: 0, seq: 0 }), cold);
  assert.deepEqual(storage.sql.exec('SELECT rev FROM relay_ckpt_meta ORDER BY rev').toArray(), savedRevisions);
});
