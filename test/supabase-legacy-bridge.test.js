const { test, before } = require('node:test');
const assert = require('node:assert/strict');
let attachLegacySocket;
before(async () => { ({ attachLegacySocket } = await import('../supabase-relay/legacy/bridge.mjs')); });

test('legacy bytes arriving before HTTP upgrade wait for the browser socket to open', async () => {
 const incoming = socket(0), relay = socket(1), timers = [];
 const initial = 'initial private presence';
 const done = attachLegacySocket({ incoming, relay, initialFrames: [initial], cleanup: async () => {}, setTimer: f => { timers.push(f); return 1; }, clearTimer() {} });
 const bytes = new Uint8Array([1, 2, 3]).buffer;
 relay.emit('message', { data: bytes });
 assert.deepEqual(incoming.sent, []);
 incoming.readyState = 1; incoming.emit('open');
 assert.equal(incoming.sent[0], initial);
 assert.equal(incoming.sent[1], bytes);
 incoming.emit('message', { data: '{"k":"pull","v":2}' });
 assert.equal(relay.sent[0], '{"k":"pull","v":2}');
 incoming.close(); await done;
});

test('provider lifetime closes the compatibility socket and cleans up without touching stored history', async () => {
 const incoming = socket(1), relay = socket(1); let expire, cleaned = false;
 const done = attachLegacySocket({ incoming, relay, cleanup: async () => { cleaned = true; }, setTimer: f => { expire = f; return 1; }, clearTimer() {} });
 expire(); await done;
 assert.equal(incoming.readyState, 3); assert.equal(relay.readyState, 3); assert.equal(cleaned, true);
});

test('an upstream failure closes the old transport so its existing outbox reconnects', async () => {
 const incoming = socket(1), relay = socket(1);
 const done = attachLegacySocket({ incoming, relay, cleanup: async () => {}, setTimer: () => 1, clearTimer() {} });
 relay.emit('close'); await done;
 assert.equal(incoming.readyState, 3);
});

function socket(state) {
 const s = new EventTarget(); s.readyState = state; s.sent = [];
 s.emit = (type, properties = {}) => { const e = new Event(type); Object.assign(e, properties); s.dispatchEvent(e); };
 s.send = data => s.sent.push(data);
 s.close = () => { s.readyState = 3; s.emit('close'); };
 return s;
}
