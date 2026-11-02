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
function app(now = Date.parse('2026-11-02T12:00:00Z')) {
  const store = new Map(), timers = [];
  const fake = kind => ({ ckptFrameBytes: 786432, connect: () => new FakeSocket(kind) });
  const w = {
    localStorage: { getItem: k => store.has(k) ? store.get(k) : null, setItem: (k, v) => store.set(k, String(v)) },
    F123Relay: fake('supabase'), F123FirebaseRelay: fake('firebase'),
    F123Peer: { create: () => fake('peer') },
    EventTarget, Event, DOMException, JSON, Number, String,
    setInterval: fn => { timers.push(fn); return timers.length; }, clearInterval: () => {}
  };
  const clock = { now };
  w.Date = class extends Date { constructor(...a) { super(...(a.length ? a : [clock.now])); } static now() { return clock.now; } };
  w.window = w;
  vm.runInNewContext(SRC, w);
  return { R: w.F123Relay, clock, tick: () => timers.slice().forEach(fn => fn()) };
}

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
