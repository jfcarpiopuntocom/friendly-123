const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const source = fs.readFileSync(path.join(__dirname, '../cloudflare-sync-relay/worker.js'), 'utf8');
const load = () => import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));

test('encrypted export rejects unsigned, stale and tampered requests before entering a room', async () => {
 const worker = await load(), { env, signed } = signer();
 let entered = false;
 env.SALAS = { idFromString() { entered = true; throw Error('must not enter'); } };
 const body = { v: 1, action: 'export', objectId: 'a'.repeat(64), issuedAt: Date.now() };
 const unsigned = await worker.default.fetch(new Request('https://fixture.invalid/migration/export', { method: 'POST', body: JSON.stringify(body) }), env);
 assert.equal(unsigned.status, 403);
 const stale = await worker.default.fetch(signed({ ...body, issuedAt: Date.now() - 120000 }), env);
 assert.equal(stale.status, 403);
 const good = signed(body), tampered = new Request(good.url, { method: 'POST', headers: good.headers, body: JSON.stringify({ ...body, objectId: 'b'.repeat(64) }) });
 assert.equal((await worker.default.fetch(tampered, env)).status, 403);
 assert.equal((await worker.default.fetch(signed({ ...body, padding: 'x'.repeat(5000) }), env)).status, 403);
 assert.equal(entered, false);
});

test('signed room resolution derives namespace IDs without entering or creating objects', async () => {
 const worker = await load(), { env, signed } = signer();
 const names = [], objectId = 'c'.repeat(64);
 const forbidden = () => { throw Error('resolution must not obtain a stub or enter storage'); };
 env.SALAS = {
  idFromName(name) { names.push(name); return { toString: () => objectId }; },
  idFromString: forbidden, get: forbidden, getByName: forbidden
 };
 const base = 'a'.repeat(40);
 for (const suffix of ['', '-y', '-ops', '-fotos']) {
  const response = await worker.default.fetch(signed({ v: 1, action: 'resolve', room: base + suffix, issuedAt: Date.now() }, '/migration/resolve'), env);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { v: 1, objectId });
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('access-control-allow-origin'), null);
 }
 assert.deepEqual(names, ['', '-y', '-ops', '-fotos'].map(suffix => base + suffix));
});

test('room resolution rejects invalid signatures, targets and cross-endpoint actions before namespace access', async () => {
 const worker = await load(), { env, signed } = signer();
 let namespaceCalls = 0;
 const forbidden = () => { namespaceCalls++; throw Error('invalid requests must not access the namespace'); };
 env.SALAS = { idFromName: forbidden, idFromString: forbidden, get: forbidden, getByName: forbidden };
 const body = { v: 1, action: 'resolve', room: 'synthetic-room', issuedAt: Date.now() };
 const unsigned = new Request('https://fixture.invalid/migration/resolve', { method: 'POST', body: JSON.stringify(body) });
 const good = signed(body, '/migration/resolve');
 const tampered = new Request(good.url, { method: 'POST', headers: good.headers, body: JSON.stringify({ ...body, room: 'other-room' }) });
 for (const request of [
  unsigned, tampered, new Request(good.url),
  signed({ ...body, issuedAt: Date.now() - 120000 }, '/migration/resolve'),
  signed({ ...body, issuedAt: Date.now() + 120000 }, '/migration/resolve'),
  signed({ ...body, padding: 'x'.repeat(5000) }, '/migration/resolve'),
  signed({ ...body, room: '' }, '/migration/resolve'),
  signed({ ...body, room: 'x'.repeat(129) }, '/migration/resolve'),
  signed({ ...body, room: '../room' }, '/migration/resolve'),
  signed({ ...body, room: undefined, objectId: 'a'.repeat(64) }, '/migration/resolve'),
  signed({ ...body, objectId: 'a'.repeat(64) }, '/migration/resolve'),
  signed({ ...body, action: 'export' }, '/migration/resolve'),
  signed(body, '/migration/export')
 ]) assert.equal((await worker.default.fetch(request, env)).status, 403);
 assert.equal(namespaceCalls, 0);
 const wrongKey = signer().env;
 assert.equal((await worker.default.fetch(signed(body, '/migration/resolve'), { ...env, ...wrongKey })).status, 403);
 assert.equal((await worker.default.fetch(signed(body, '/migration/resolve'), { SALAS: env.SALAS })).status, 403);
 assert.equal(namespaceCalls, 0);
});

test('export is ordered, bounded, immutable and detects compaction between pages', async () => {
 const worker = await load(), { env, signed } = signer();
 const db = new DatabaseSync(':memory:');
 const sql = { exec(q, ...a) { const s = db.prepare(q); if (/^SELECT/.test(q)) return { toArray: () => s.all(...a) }; s.run(...a); return { toArray: () => [] }; } };
 const objectId = 'a'.repeat(64);
 const state = { id: { toString: () => objectId }, storage: { sql }, getWebSockets: () => [] };
 const room = new worker.SalaSync(state, env);
 room._guardarOp('synthetic-late-clock', 20, 'AQID');
 room._guardarOp('synthetic-early-clock', 10, 'BAUG');
 const before = db.prepare('SELECT rowid, * FROM ops ORDER BY rowid').all();
 const body = { v: 1, action: 'export', objectId, issuedAt: Date.now(), limit: 1 };
 const first = await (await room.fetch(signed(body, '/__migration/export'))).json();
 assert.equal(first.ops[0].id, 'synthetic-late-clock');
 assert.equal(first.more, true);
 room._guardarOp('synthetic-new-after-cut', 30, 'BwgJ');
 const second = await (await room.fetch(signed({ ...body, cut: first.cut, after: first.after }, '/__migration/export'))).json();
 assert.equal(second.ops[0].id, 'synthetic-early-clock');
 assert.equal(second.more, false);
 assert.deepEqual(db.prepare('SELECT rowid, * FROM ops ORDER BY rowid LIMIT 2').all(), before);
 db.prepare('DELETE FROM ops WHERE id=?').run('synthetic-late-clock');
 const changed = await room.fetch(signed({ ...body, cut: first.cut, after: first.after }, '/__migration/export'));
 assert.equal(changed.status, 409);
 db.close();
});

// Helpers: ephemeral signing keys and synthetic ciphertext only.
test('signed source fence survives hibernation and rejects old writes without deleting export history', async () => {
 const worker = await load(), { env, signed } = signer(), db = new DatabaseSync(':memory:');
 const sql = { exec(q, ...a) { const s = db.prepare(q); if (/^SELECT/.test(q)) return { toArray: () => s.all(...a) }; s.run(...a); return { toArray: () => [] }; } };
 const objectId = 'a'.repeat(64), closed = [], sent = [];
 const socket = { readyState: 1, close: (...args) => closed.push(args), send: data => sent.push(data) };
 const state = { id: { toString: () => objectId }, storage: { sql }, getWebSockets: () => [socket] };
 let room = new worker.SalaSync(state, env);
 room._guardarOp('synthetic-before', 10, 'AQID');
 const body = { v: 1, action: 'fence', objectId, token: 'b'.repeat(64), issuedAt: Date.now() };
 const unsigned = new Request('https://fixture.invalid/__migration/fence', { method: 'POST', body: JSON.stringify(body) });
 assert.equal((await room.fetch(unsigned)).status, 403);
 assert.equal(room._guardarOp('synthetic-unfenced', 20, 'BAUG'), true);
 const before = db.prepare('SELECT rowid,* FROM ops ORDER BY rowid').all();
 const fence = await (await room.fetch(signed(body, '/__migration/fence'))).json();
 assert.equal(fence.fenced, true); assert.equal(fence.token, body.token); assert.equal(fence.cut.maxSeq, 2);
 assert.ok(closed.length);
 assert.equal(room._guardarOp('synthetic-after', 30, 'BwgJ'), false);
 assert.equal(room._guardarCkpt(50, 'CgsM', 1), false);
 await room.webSocketMessage(socket, JSON.stringify({ k: 'op', id: 'old-client', lam: 40, c: 'BwgJ', ack: 1 }));
 await room.webSocketMessage(socket, new Uint8Array([1, 2, 3]).buffer);
 assert.equal(sent.length, 0, 'no durable ACK or live broadcast after fence');
 room = new worker.SalaSync(state, env); // hibernation/restart reads the durable fence
 assert.equal(room._guardarOp('synthetic-restart', 40, 'BwgJ'), false);
 assert.equal((await room.fetch(new Request('https://fixture.invalid/sala/x', { headers: { Upgrade: 'websocket' } }))).status, 409);
 assert.equal((await room.fetch(signed({ ...body, token: 'c'.repeat(64) }, '/__migration/fence'))).status, 409);
 const duplicate = await (await room.fetch(signed(body, '/__migration/fence'))).json(); assert.deepEqual(duplicate.cut, fence.cut);
 const copy = await (await room.fetch(signed({ v: 1, action: 'export', objectId, issuedAt: Date.now(), cut: fence.cut }, '/__migration/export'))).json();
 assert.deepEqual(copy.ops.map(x => x.id), ['synthetic-before', 'synthetic-unfenced']);
 assert.deepEqual(db.prepare('SELECT rowid,* FROM ops ORDER BY rowid').all(), before);
 db.close();
});

function signer() {
 const pair = crypto.generateKeyPairSync('ed25519');
 return { env: { RELAY_MIGRATION_PUBLIC_KEY: pair.publicKey.export({ format: 'jwk' }).x }, signed(body, route = '/migration/export') {
   const text = JSON.stringify(body), signature = crypto.sign(null, Buffer.from(text), pair.privateKey).toString('base64url');
   return new Request('https://fixture.invalid' + route, { method: 'POST', headers: { 'X-Relay-Migration-Signature': signature, 'Content-Type': 'application/json' }, body: text });
 } };
}
