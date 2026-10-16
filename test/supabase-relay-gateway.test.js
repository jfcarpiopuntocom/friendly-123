const { test, before } = require('node:test');
const assert = require('node:assert/strict');
let createRelayGateway;
before(async () => { ({ createRelayGateway } = await import('../supabase-relay/gateway.mjs')); });
const room = 'a'.repeat(40), origin = 'wss://friendly123-sync-relay.jfcarpio.workers.dev/sala/';

test('an inactive migration closes without opening either data backend', async () => {
 let old = 0, active = 0;
 const gateway = createRelayGateway({ resolveRoute: async () => ({ mode: 'legacy' }), legacy: () => { old++; }, native: () => { active++; } });
 for (const suffix of ['', '-y', '-ops', '-fotos']) {
  const connected = gateway.connect(origin + room + suffix), closed = event(connected, 'close');
  const result = await closed;
  assert.equal(result.code, 1013); assert.match(result.reason, /native migration pending; local data retained/);
  assert.equal(connected.readyState, 3);
  assert.throws(() => connected.send('pending ciphertext'), { name: 'InvalidStateError' });
 }
 assert.equal(old, 0); assert.equal(active, 0);
});

test('active room channels use their own native room on the shared adapter', async () => {
 const rooms = [], cache = [];
 const gateway = createRelayGateway({ resolveRoute: async base => { cache.push(base); return { mode: 'supabase' }; }, legacy: () => { throw Error('must not split'); }, native: name => { rooms.push(name); return socket(name); } });
 const a = gateway.connect(origin + room + '-y'), b = gateway.connect(origin + room + '-fotos'); await tick();
 assert.deepEqual(rooms, [room + '-y', room + '-fotos']); assert.deepEqual(cache, [room]);
 a.close(); b.close();
});

test('a routing error cannot silently write into the old relay', async () => {
 let old = false;
 const gateway = createRelayGateway({ resolveRoute: async () => { throw Error('provider unavailable'); }, legacy: () => { old = true; }, native: () => {} });
 const s = gateway.connect(origin + room), close = event(s, 'close');
 assert.equal((await close).code, 1011); assert.equal(old, false);
});

test('unknown routes and native startup failures never open Cloudflare', async () => {
 for (const mode of [null, 'unknown', 'supabase']) {
  let old = false;
  const gateway = createRelayGateway({ resolveRoute: async () => ({ mode }), legacy: () => { old = true; }, native: () => { throw Error('native unavailable'); } });
  const connected = gateway.connect(origin + room), closed = await event(connected, 'close');
  assert.equal(closed.code, 1011); assert.equal(old, false);
 }
});

test('active native transport preserves binary data and forwards sends unchanged', async () => {
 let inner, sent;
 const gateway = createRelayGateway({ resolveRoute: async () => ({ mode: 'supabase' }), native: name => { inner = socket(name); inner.send = value => { sent = value; }; return inner; } });
 const connected = gateway.connect(origin + room + '-y'); connected.binaryType = 'arraybuffer';
 const opened = event(connected, 'open'); await tick(); inner.open(); await opened;
 assert.equal(inner.binaryType, 'arraybuffer');
 const bytes = new Uint8Array([1, 2, 3]).buffer, received = event(connected, 'message');
 inner.emit('message', { data: bytes }); assert.equal((await received).data, bytes);
 connected.send(bytes); assert.equal(sent, bytes); connected.close();
});

test('closing during route discovery never creates a later orphan connection', async () => {
 let finish, opened = false;
 const gateway = createRelayGateway({ resolveRoute: () => new Promise(r => { finish = r; }), native: () => { opened = true; return socket('unused'); } });
 const s = gateway.connect(origin + room); await tick(); s.close(); finish({ mode: 'supabase' }); await tick(); assert.equal(opened, false); assert.equal(s.readyState, 3);
});

// Helpers: controlled socket events, with no network access.
function socket(url) {
 const s = new EventTarget(); Object.assign(s, { url, readyState: 0, binaryType: 'blob', bufferedAmount: 0 });
 s.emit = (type, p = {}) => { const e = new Event(type); Object.assign(e, p); s.dispatchEvent(e); };
 s.open = () => { s.readyState = 1; s.emit('open'); }; s.send = () => {};
 s.close = () => { s.readyState = 3; s.emit('close', { code: 1000, reason: '', wasClean: true }); }; return s;
}
function event(s, type) { return new Promise(r => s.addEventListener(type, r, { once: true })); }
function tick() { return new Promise(r => setTimeout(r, 0)); }
