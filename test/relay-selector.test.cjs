'use strict';
// JFC 2026-11-02: a device that connects catches up alone. Durable layers in order (Supabase, then Firebase), direct
// peers only as the last fallback; each durable layer has its own per-device daily byte budget so a free plan
// cannot burn again; photos never use a relay. No network: fake transports.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const SRC = fs.readFileSync(path.join(__dirname, '../docs/relay-selector.js'), 'utf8');
const URL1 = 'wss://friendly123-sync-relay.jfcarpio.workers.dev/sala/' + 'a'.repeat(40) + '-y';

class FakeSocket extends EventTarget {
  constructor(kind) { super(); this.kind = kind; this.readyState = 0; this.sent = []; this.closed = null; }
  open() { this.readyState = 1; this.dispatchEvent(new Event('open')); }
  recv(data) { const e = new Event('message'); e.data = data; this.dispatchEvent(e); }
  send(v) { this.sent.push(v); }
  close(code, reason) { this.closed = { code, reason }; this.readyState = 3; this.dispatchEvent(new Event('close')); }
}
function app(now = Date.parse('2026-11-02T12:00:00Z'), store = new Map(), fbHead = null) {
  const timers = [], timeouts = [];
  const fake = kind => ({ ckptFrameBytes: 786432, connect: () => new FakeSocket(kind) });
  const fbFake = fake('firebase');
  if (fbHead) fbFake.leerHead = async () => fbHead.value; // v657 tests: the Firebase head another device moves
  const w = {
    localStorage: { getItem: k => store.has(k) ? store.get(k) : null, setItem: (k, v) => store.set(k, String(v)) },
    F123Relay: fake('supabase'), F123FirebaseRelay: fbFake,
    F123Peer: { create: () => fake('peer') },
    EventTarget, Event, DOMException, JSON, Number, String,
    setInterval: fn => { timers.push(fn); return timers.length; }, clearInterval: () => {},
    setTimeout: fn => { timeouts.push(fn); return timeouts.length; }
  };
  const clock = { now };
  w.Date = class extends Date { constructor(...a) { super(...(a.length ? a : [clock.now])); } static now() { return clock.now; } };
  w.window = w;
  vm.runInNewContext(SRC, w);
  return { R: w.F123Relay, clock, tick: () => timers.slice().forEach(fn => fn()), vencer: () => timeouts.splice(0).forEach(fn => fn()) };
}

// v657 (sync3 QA 2026-11-03, Directiva Prima 1): a device reading only Supabase must catch up with writes another
// device made on Firebase while it was closed.
const espera = () => new Promise(r => setImmediate(r));
test('v657: Firebase moved while this device was closed -> it reads Firebase, then returns to Supabase', async () => {
  const store = new Map(), head = { value: { rev: 1, seq: 10 } };
  const s1 = app(undefined, store, head).R.connect(URL1); s1.open(); await espera(); await espera();
  assert.equal(s1.closed, null, 'first session: only remembers the head');
  head.value = { rev: 1, seq: 11 }; // another device, parked on Firebase, wrote while this one was closed
  const A2 = app(undefined, store, head), s2 = A2.R.connect(URL1);
  assert.equal(s2.kind, 'supabase'); s2.open(); await espera(); await espera();
  assert.equal(s2.closed && s2.closed.code, 1012, 'leaves Supabase to read Firebase');
  assert.equal(A2.R.connect(URL1).kind, 'firebase', 'the reconnect reads Firebase');
  A2.clock.now += 3 * 60 * 1000 + 1000;
  assert.equal(A2.R.connect(URL1).kind, 'supabase', 'after 3 min it is back on Supabase (and uploads its checkpoint)');
});
test('v657: Firebase did not move -> the device stays on Supabase', async () => {
  const store = new Map(), head = { value: { rev: 1, seq: 10 } };
  const s1 = app(undefined, store, head).R.connect(URL1); s1.open(); await espera(); await espera();
  const s2 = app(undefined, store, head).R.connect(URL1); s2.open(); await espera(); await espera();
  assert.equal(s2.closed, null);
});

// v656 (sync3 QA 2026-11-03): an unreachable layer is an outage, not a refusal: short pause, fast hand-over.
test('v656: a network failure before opening pauses the layer only 5 s, then it is used again', () => {
  const { R, clock } = app();
  const s = R.connect(URL1);
  s.dispatchEvent(new Event('error')); s.close();
  assert.equal(R.connect(URL1).kind, 'firebase', 'Supabase unreachable → Firebase right away');
  clock.now += 21 * 1000;
  assert.equal(R.connect(URL1).kind, 'supabase', 'back to Supabase after 5 s, not 15 min');
});
test('v656: a layer that does not open within 8 s hands over within 3 s (no 54 s wait)', () => {
  const { R, vencer, clock } = app();
  const s = R.connect(URL1);
  vencer();
  assert.equal(s.readyState, 3, 'the silent socket was closed');
  assert.equal(R.connect(URL1).kind, 'firebase');
  clock.now += 21 * 1000;
  assert.equal(R.connect(URL1).kind, 'supabase', 'a timeout is an outage: short pause');
});
test('v656: a server refusal still keeps the long pause that protects the free plans', () => {
  const { R, clock } = app();
  R.connect(URL1).close(1011, 'relay route unavailable');
  clock.now += 21 * 1000;
  assert.equal(R.connect(URL1).kind, 'firebase', 'refusal: still paused after 20 s');
});

test('Supabase is the first choice and keeps its checkpoint capability', () => {
  const { R } = app();
  assert.equal(R.connect(URL1).kind, 'supabase');
  assert.equal(R.ckptFrameBytes, 786432);
});

test('a refused durable layer hands over to the next one; peers only when every durable layer refused', () => {
  const { R, clock } = app();
  R.connect(URL1).close(1011, 'relay route unavailable');
  const f = R.connect(URL1);
  assert.equal(f.kind, 'firebase', 'Supabase refused → second durable layer, not peers');
  f.close(1011, 'firebase unavailable');
  assert.equal(R.connect(URL1).kind, 'peer', 'both refused → peers, never nothing');
  clock.now += 16 * 60 * 1000;
  assert.equal(R.connect(URL1).kind, 'supabase', 'Supabase retried after the pause');
});

test('the daily upload budget closes the layer without sending and keeps the write for later', () => {
  const { R } = app();
  const s = R.connect(URL1); s.open();
  s.send(new Uint8Array(1024 * 1024)); s.send(new Uint8Array(1024 * 1024 - 10));
  assert.throws(() => s.send(new Uint8Array(100)), e => e.name === 'QuotaExceededError', 'caller keeps it in its outbox');
  assert.equal(s.sent.length, 2, 'the over-budget frame never left the device');
  assert.equal(s.closed.code, 1013);
  assert.equal(R.connect(URL1).kind, 'firebase', 'Supabase budget spent → Firebase keeps the device durable');
  assert.equal(R.estadoCupo()[0].usable, false);
});

test('the daily download budget also pauses the layer; the next day Supabase is used again', () => {
  const { R, clock } = app();
  const s = R.connect(URL1); s.open();
  s.recv(new Uint8Array(20 * 1024 * 1024));
  assert.equal(s.closed.code, 1013);
  assert.equal(R.connect(URL1).kind, 'firebase');
  clock.now += 24 * 60 * 60 * 1000;
  assert.equal(R.connect(URL1).kind, 'supabase', 'budget resets each day');
});

test('photos never use a relay budget: the -fotos channel always goes to direct peers', () => {
  const { R } = app();
  assert.equal(R.connect(URL1.replace(/-y$/, '-fotos')).kind, 'peer');
  assert.equal(R.connect(URL1).kind, 'supabase', 'catalog still prefers the durable relay');
});

test('a device on the fallback layer goes back to the first layer when its pause ends (layers re-converge)', () => {
  const { R, clock, tick } = app();
  R.connect(URL1).close(1011, 'relay route unavailable'); // Supabase refused → paused
  const f = R.connect(URL1); f.open();
  assert.equal(f.kind, 'firebase');
  tick();
  assert.equal(f.closed, null, 'still paused: stays on Firebase');
  clock.now += 16 * 60 * 1000; // pause over
  tick();
  assert.equal(f.closed && f.closed.code, 1012, 'fallback closed so the app reconnects');
  assert.equal(R.connect(URL1).kind, 'supabase', 'reconnect lands on the first layer again');
});

test('without peer-sync the budgets still apply and photos never fall back to a relay', () => {
  const store = new Map();
  const w = {
    localStorage: { getItem: k => store.has(k) ? store.get(k) : null, setItem: (k, v) => store.set(k, String(v)) },
    F123Relay: { ckptFrameBytes: 786432, connect: () => new FakeSocket('supabase') },
    EventTarget, Event, DOMException, JSON, Number, String, Date, setInterval: () => 0, clearInterval: () => {}
  };
  w.window = w;
  vm.runInNewContext(SRC, w);
  assert.equal(w.F123Relay.connect(URL1).kind, 'supabase', 'selector installed even without peer-sync');
  assert.equal(typeof w.F123Relay.estadoCupo, 'function', 'budget wrapper present');
  assert.throws(() => w.F123Relay.connect(URL1.replace(/-y$/, '-fotos')), /unavailable/, 'photos fail closed, caller retries');
});

test('Firebase ignored binary copies spend no upload budget; durable writes still count and closed sockets still reject', async () => {
  const store = new Map(), writes = [];
  const w = { window: null, Date, JSON, Number, String, TextEncoder, Uint8Array, ArrayBuffer,
    Event, EventTarget, DOMException, Promise, setInterval: () => 0, clearInterval() {},
    btoa: s => Buffer.from(s, 'binary').toString('base64'), atob: s => Buffer.from(s, 'base64').toString('binary'),
    localStorage: { getItem: k => store.get(k) || null, setItem: (k, v) => store.set(k, String(v)) } };
  w.window = w;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../docs/firebase-relay.js'), 'utf8'), w);
  w.F123FirebaseRelay = w.F123FirebaseRelay.create({ EventSource: null, fetch: async (_, options) => {
    if (options.method === 'PUT') writes.push(JSON.parse(options.body));
    return new Response('null', { status: 200 });
  } });
  vm.runInNewContext(SRC, w);
  const s = w.F123Relay.connect(URL1);
  await new Promise(resolve => s.addEventListener('open', resolve));
  for (let i = 0; i < 14; i++) s.send(new Uint8Array(160 * 1024));
  assert.equal(w.F123Relay.estadoCupo()[0].up, 0, 'Firebase discarded every binary copy without sending HTTP');
  assert.equal(writes.length, 0);
  const op = JSON.stringify({ k: 'op', id: 'synthetic-count', c: 'AQID', ack: 1 });
  const ack = new Promise(resolve => s.addEventListener('message', e => {
    const m = JSON.parse(e.data); if (m.k === 'persist-result') resolve(m);
  }));
  s.send(op);
  assert.equal((await ack).ok, true);
  assert.equal(writes.length, 1);
  assert.equal(w.F123Relay.estadoCupo()[0].up, Buffer.byteLength(op));
  s.close();
  assert.throws(() => s.send(new Uint8Array(1)), e => e.name === 'InvalidStateError');
});
