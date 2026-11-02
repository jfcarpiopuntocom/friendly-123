'use strict';
// JFC 2026-11-02: Supabase is the durable relay (a device that connects catches up alone); peers are only the
// fallback; a per-device daily byte budget keeps the free plan from burning again. No network: fake transports.
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
  const store = new Map();
  const made = [];
  const w = {
    localStorage: { getItem: k => store.has(k) ? store.get(k) : null, setItem: (k, v) => store.set(k, String(v)) },
    F123Relay: { ckptFrameBytes: 786432, connect: () => { const s = new FakeSocket('supabase'); made.push(s); return s; } },
    F123Peer: { create: () => ({ connect: () => { const s = new FakeSocket('peer'); made.push(s); return s; } }) },
    EventTarget, Event, DOMException, JSON, Number, String
  };
  const clock = { now };
  w.Date = class extends Date { constructor(...a) { super(...(a.length ? a : [clock.now])); } static now() { return clock.now; } };
  w.window = w;
  vm.runInNewContext(SRC, w);
  return { R: w.F123Relay, made, clock };
}

test('Supabase is the first choice and keeps its checkpoint capability', () => {
  const { R } = app();
  const s = R.connect(URL1);
  assert.equal(s.kind, 'supabase');
  assert.equal(R.ckptFrameBytes, 786432);
});

test('a room Supabase refuses before opening (402 / inactive) falls back to peers, then retries after the pause', () => {
  const { R, clock } = app();
  const s = R.connect(URL1); s.close(1011, 'relay route unavailable');
  assert.equal(R.connect(URL1).kind, 'peer', 'refused → peers, never nothing');
  clock.now += 16 * 60 * 1000;
  assert.equal(R.connect(URL1).kind, 'supabase', 'Supabase retried after the pause');
});

test('the daily upload budget closes the relay without sending and keeps the write for later', () => {
  const { R } = app();
  const s = R.connect(URL1); s.open();
  s.send(new Uint8Array(1024 * 1024)); s.send(new Uint8Array(1024 * 1024 - 10));
  assert.throws(() => s.send(new Uint8Array(100)), e => e.name === 'QuotaExceededError', 'caller keeps it in its outbox');
  assert.equal(s.sent.length, 2, 'the over-budget frame never left the device');
  assert.equal(s.closed.code, 1013);
  assert.equal(R.connect(URL1).kind, 'peer', 'rest of the day on peers');
  assert.equal(R.estadoCupo().supabase, false);
});

test('the daily download budget also stops the relay; the next day Supabase is used again', () => {
  const { R, clock } = app();
  const s = R.connect(URL1); s.open();
  s.recv(new Uint8Array(20 * 1024 * 1024));
  assert.equal(s.closed.code, 1013);
  assert.equal(R.connect(URL1).kind, 'peer');
  clock.now += 24 * 60 * 60 * 1000;
  assert.equal(R.connect(URL1).kind, 'supabase', 'budget resets each day');
});
