const { test, before } = require('node:test');
const assert = require('node:assert/strict');
let createRelayGateway;
before(async () => { ({ createRelayGateway } = await import('../supabase-relay/gateway.mjs')); });
const room = 'a'.repeat(40), origin = 'wss://friendly123-sync-relay.jfcarpio.workers.dev/sala/';

test('an inactive room retains the original socket and its binary mode', async () => {
 let legacy; const gateway = createRelayGateway({ resolveRoute: async () => ({ mode: 'legacy' }), legacy: url => { legacy = socket(url); return legacy; }, native: () => { throw Error('must not activate'); } });
 const connected = gateway.connect(origin + room + '-y'); connected.binaryType = 'arraybuffer';
 const open = event(connected, 'open'); await tick(); legacy.open(); await open;
 assert.equal(legacy.url, origin + room + '-y'); assert.equal(legacy.binaryType, 'arraybuffer');
 const msg = event(connected, 'message'); legacy.emit('message', { data: 'unchanged legacy data' }); assert.equal((await msg).data, 'unchanged legacy data');
 connected.close();
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

test('closing during route discovery never creates a later orphan connection', async () => {
 let finish, opened = false;
 const gateway = createRelayGateway({ resolveRoute: () => new Promise(r => { finish = r; }), legacy: () => { opened = true; return socket('unused'); }, native: () => {} });
 const s = gateway.connect(origin + room); await tick(); s.close(); finish({ mode: 'legacy' }); await tick(); assert.equal(opened, false); assert.equal(s.readyState, 3);
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
