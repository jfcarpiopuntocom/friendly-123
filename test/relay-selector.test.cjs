'use strict';
// JFC 2026-11-02: a device that connects catches up alone. Durable layers in order (Supabase, then Firebase), direct
// peers only as the last fallback; each durable layer has its own per-device daily byte budget so a free plan
// cannot burn again; photos never use a relay. No network: fake transports.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const SRC = fs.readFileSync(path.join(__dirname, '../docs/relay-selector.js'), 'utf8');
// v659: connect() returns a WebSocket-shaped cascade object H; the layer socket is H.capaPrincipal.
const sub = h => h.capaPrincipal || h;
const URL1 = 'wss://friendly123-sync-relay.jfcarpio.workers.dev/sala/' + 'a'.repeat(40) + '-y';

class FakeSocket extends EventTarget {
  constructor(kind) { super(); this.kind = kind; this.readyState = 0; this.sent = []; this.closed = null; }
  open() { this.readyState = 1; this.dispatchEvent(new Event('open')); }
  recv(data) { const e = new Event('message'); e.data = data; this.dispatchEvent(e); }
  send(v) { this.sent.push(v); }
  close(code, reason) { this.closed = { code, reason }; this.readyState = 3; this.dispatchEvent(new Event('close')); }
}
function app(now = Date.parse('2026-11-02T12:00:00Z'), store = new Map(), fbHead = null) {
  const timers = [], timeouts = [], made = [];
  const fake = kind => ({ ckptFrameBytes: 786432, connect: () => { const x = new FakeSocket(kind); made.push(x); return x; } });
  const fbFake = fake('firebase');
  if (fbHead) fbFake.leerHead = async () => fbHead.value; // v657 tests: the Firebase head another device moves
  const w = {
    localStorage: { getItem: k => store.has(k) ? store.get(k) : null, setItem: (k, v) => store.set(k, String(v)) },
    F123Relay: fake('supabase'), F123FirebaseRelay: fbFake,
    F123Peer: { create: () => fake('peer') }, F123_VIVO: false, // v662 live lane dormant by default; its own tests turn it on
    EventTarget, Event, DOMException, JSON, Number, String,
    setInterval: fn => { timers.push(fn); return timers.length; }, clearInterval: () => {},
    setTimeout: fn => { timeouts.push(fn); return timeouts.length; }
  };
  const clock = { now };
  w.Date = class extends Date { constructor(...a) { super(...(a.length ? a : [clock.now])); } static now() { return clock.now; } };
  w.window = w;
  vm.runInNewContext(SRC, w);
  return { w, R: w.F123Relay, clock, made, tick: () => timers.slice().forEach(fn => fn()), vencer: () => timeouts.splice(0).forEach(fn => fn()) };
}

// v657 (sync3 QA 2026-11-03, Directiva Prima 1): a device reading only Supabase must catch up with writes another
// device made on Firebase while it was closed.
const espera = () => new Promise(r => setImmediate(r));
test('v657: Firebase moved while this device was closed -> it reads Firebase, then returns to Supabase', async () => {
  const store = new Map(), head = { value: { rev: 0, seq: 0 } };
  const s1 = sub(app(undefined, store, head).R.connect(URL1)); s1.open(); await espera(); await espera();
  assert.equal(s1.closed, null, 'empty fallback does not interrupt the first session');
  head.value = { rev: 1, seq: 11 }; // another device, parked on Firebase, wrote while this one was closed
  const A2 = app(undefined, store, head), s2 = sub(A2.R.connect(URL1));
  assert.equal(s2.kind, 'supabase'); s2.open(); await espera(); await espera();
  assert.equal(s2.closed && s2.closed.code, 1012, 'leaves Supabase to read Firebase');
  assert.equal(sub(A2.R.connect(URL1)).kind, 'firebase', 'the reconnect reads Firebase');
  A2.clock.now += 3 * 60 * 1000 + 1000;
  assert.equal(sub(A2.R.connect(URL1)).kind, 'supabase', 'after 3 min it is back on Supabase (and uploads its checkpoint)');
});
test('v657: empty Firebase did not move -> the device stays on Supabase', async () => {
  const store = new Map(), head = { value: { rev: 0, seq: 0 } };
  const s1 = sub(app(undefined, store, head).R.connect(URL1)); s1.open(); await espera(); await espera();
  const s2 = sub(app(undefined, store, head).R.connect(URL1)); s2.open(); await espera(); await espera();
  assert.equal(s2.closed, null);
});

// v656 (sync3 QA 2026-11-03): an unreachable layer is an outage, not a refusal: short pause, fast hand-over.
test('v656: a network failure before opening pauses the layer only 5 s, then it is used again', () => {
  const { R, clock } = app();
  const s = sub(R.connect(URL1));
  s.dispatchEvent(new Event('error')); s.close();
  assert.equal(sub(R.connect(URL1)).kind, 'firebase', 'Supabase unreachable → Firebase right away');
  clock.now += 21 * 1000;
  assert.equal(sub(R.connect(URL1)).kind, 'supabase', 'back to Supabase after 5 s, not 15 min');
});
// v659 (JFC 2026-11-04: «no dije que abandones NADA a los 3 segundos ... desde los 3 segundos ya nutras desde el
// siguiente fallback»): the first layer is never closed by the timer; the next layer is added and feeds the app.
test('v659 (a): first layer silent -> after 3 s Firebase also starts, H opens when it opens, the first is NOT closed', () => {
  const { R, vencer, made } = app();
  const h = R.connect(URL1), eventos = [];
  h.onopen = () => eventos.push('prop'); h.addEventListener('open', () => eventos.push('listener'));
  assert.equal(made.length, 1);
  vencer();
  assert.equal(made.length, 2, 'second layer started');
  assert.equal(made[1].kind, 'firebase');
  assert.equal(made[0].closed, null, 'the silent first layer is NOT closed');
  assert.equal(h.readyState, 0);
  made[1].open();
  assert.equal(h.readyState, 1);
  assert.equal(eventos.length, 2, 'open emitted once');
  made[1].recv('hola');
  const got = []; h.onmessage = e => got.push(e.data); made[1].recv('otro');
  assert.deepEqual(got, ['otro'], 'frames of the fallback reach the app');
  assert.equal(made[0].closed, null);
});
test('v659 (b): first layer opens before 3 s -> no second layer', () => {
  const { R, vencer, made } = app();
  const h = R.connect(URL1); made[0].open();
  vencer();
  assert.equal(made.length, 1);
  assert.equal(h.readyState, 1);
});
test('v659 (c): first layer opens later while the fallback fed the app -> restart (1012) so the catch-up reaches the first layer', () => {
  const { R, vencer, made } = app();
  const h = R.connect(URL1); let cierres = 0, code = null; h.onclose = e => { cierres++; code = e.code; };
  vencer(); made[1].open();
  assert.equal(h.readyState, 1);
  made[0].open();
  assert.deepEqual(made[1].closed, { code: 1000, reason: 'first layer answered' });
  assert.equal(made[0].closed && made[0].closed.code, 1000, 'the preferred socket is reopened by the app reconnect');
  assert.equal(cierres, 1); assert.equal(code, 1012); assert.equal(h.readyState, 3);
});
test('v659 (c2): the layer feeding the app drops while the first is still connecting -> restart, never a silent H', () => {
  const { R, vencer, made } = app();
  const h = R.connect(URL1); let code = null; h.onclose = e => { code = e.code; };
  vencer(); made[1].open(); made[1].close(1000, 'gone');
  assert.equal(code, 1012); assert.equal(h.readyState, 3);
  assert.equal(made[0].closed && made[0].closed.code, undefined, 'the never-opened first layer is closed with no code (no refusal pause)');
});
test('v659 (d): send goes to the open layer; none open throws InvalidStateError; a failing send rethrows', () => {
  const { R, vencer, made } = app();
  const h = R.connect(URL1);
  assert.throws(() => h.send('x'), e => e.name === 'InvalidStateError');
  vencer(); made[1].open();
  h.send('uno');
  assert.deepEqual(made[1].sent, ['uno']); assert.deepEqual(made[0].sent || [], []);
  made[1].send = () => { throw new DOMException('q2', 'QuotaExceededError'); };
  assert.throws(() => h.send('dos'), e => e.name === 'QuotaExceededError');
});
test('v659 (e) / v662: peer frames reach the app (the app filters); only a peer persist-result needs peerAccepted', () => {
  const { R, vencer, made, clock } = app();
  sub(R.connect(URL1)).close(1011, 'x'); // Supabase paused 15 min
  const h = R.connect(URL1); // Firebase first, silent
  vencer(); // peers added
  const peerSub = made.length && made[made.length - 1];
  assert.equal(peerSub.kind, 'peer');
  peerSub.peerOnly = true; peerSub.open();
  const got = []; h.onmessage = e => got.push(e.data);
  peerSub.recv('sin aceptar');
  const ev = new Event('message'); ev.data = 'aceptado'; ev.peerAccepted = true; peerSub.dispatchEvent(ev);
  peerSub.recv(JSON.stringify({ k: 'persist-result', id: 'z', ok: true }));
  assert.deepEqual(got, ['sin aceptar', 'aceptado'], 'business frames pass; an unaccepted peer ack does not');
  assert.equal(h.peerOnly, true);
  assert.ok(clock);
});
test('v659 (f): first layer refuses before 3 s -> the fallback starts at once (no timer needed)', () => {
  const { R, made } = app();
  const h = R.connect(URL1);
  made[0].close(1011, 'refused');
  assert.equal(made.length, 2); assert.equal(made[1].kind, 'firebase');
  assert.equal(h.readyState, 0);
  made[1].open(); assert.equal(h.readyState, 1);
});
test('v659: when no layer is open or can open, H emits close once', () => {
  const { R, made } = app();
  const h = R.connect(URL1); let cierres = 0, code = null; h.onclose = e => { cierres++; code = e.code; };
  made[0].close(1011, 'a'); made[1].close(1011, 'b');
  assert.equal(made[2].kind, 'peer');
  made[2].readyState = 3; const ev = new Event('close'); ev.code = 1006; ev.reason = 'c'; made[2].dispatchEvent(ev);
  assert.equal(cierres, 1); assert.equal(code, 1006); assert.equal(h.readyState, 3);
});
test('v656: a server refusal still keeps the long pause that protects the free plans', () => {
  const { R, clock } = app();
  sub(R.connect(URL1)).close(1011, 'relay route unavailable');
  clock.now += 21 * 1000;
  assert.equal(sub(R.connect(URL1)).kind, 'firebase', 'refusal: still paused after 20 s');
});

test('Supabase is the first choice and keeps its checkpoint capability', () => {
  const { R } = app();
  assert.equal(sub(R.connect(URL1)).kind, 'supabase');
  assert.equal(R.ckptFrameBytes, 786432);
});

test('a refused durable layer hands over to the next one; peers only when every durable layer refused', () => {
  const { R, clock } = app();
  sub(R.connect(URL1)).close(1011, 'relay route unavailable');
  const f = sub(R.connect(URL1));
  assert.equal(f.kind, 'firebase', 'Supabase refused → second durable layer, not peers');
  f.close(1011, 'firebase unavailable');
  assert.equal(sub(R.connect(URL1)).kind, 'peer', 'both refused → peers, never nothing');
  clock.now += 16 * 60 * 1000;
  assert.equal(sub(R.connect(URL1)).kind, 'supabase', 'Supabase retried after the pause');
});

test('the daily upload budget closes the layer without sending and keeps the write for later', () => {
  const { R } = app();
  const s = sub(R.connect(URL1)); s.open();
  s.send(new Uint8Array(1024 * 1024)); s.send(new Uint8Array(1024 * 1024 - 10));
  assert.throws(() => s.send(new Uint8Array(100)), e => e.name === 'QuotaExceededError', 'caller keeps it in its outbox');
  assert.equal(s.sent.length, 2, 'the over-budget frame never left the device');
  assert.equal(s.closed.code, 1013);
  assert.equal(sub(R.connect(URL1)).kind, 'firebase', 'Supabase budget spent → Firebase keeps the device durable');
  assert.equal(R.estadoCupo()[0].usable, false);
});

test('the daily download budget also pauses the layer; the next day Supabase is used again', () => {
  const { R, clock } = app();
  const s = sub(R.connect(URL1)); s.open();
  s.recv(new Uint8Array(20 * 1024 * 1024));
  assert.equal(s.closed.code, 1013);
  assert.equal(sub(R.connect(URL1)).kind, 'firebase');
  clock.now += 24 * 60 * 60 * 1000;
  assert.equal(sub(R.connect(URL1)).kind, 'supabase', 'budget resets each day');
});

// v661 (JFC 2026-11-04: photos at LAST priority, but with the cascade like everything else).
test('photos ride the durable cascade at last priority: only under half of the daily cap, then direct', () => {
  const { R } = app();
  const FOTOS = URL1.replace(/-y$/, '-fotos');
  assert.equal(sub(R.connect(FOTOS)).kind, 'supabase', 'photos reach the durable layer');
  assert.equal(sub(R.connect(URL1)).kind, 'supabase', 'catalog still prefers the durable relay');
  const h = sub(R.connect(FOTOS)); h.open();
  assert.throws(() => h.send('x'.repeat(1024 * 1024 + 1)), e => e.name === 'QuotaExceededError', 'a photo never takes more than half');
  assert.ok(!h.closed, 'the layer stays open for inventory and money');
  const c = sub(R.connect(URL1)); c.open(); c.send('x'.repeat(900 * 1024)); c.send('x'.repeat(200 * 1024));
  assert.equal(sub(R.connect(FOTOS)).kind === 'supabase', false, 'over half used: photos leave Supabase');
});

test('a device on the fallback layer goes back to the first layer when its pause ends (layers re-converge)', () => {
  const { R, clock, tick } = app();
  sub(R.connect(URL1)).close(1011, 'relay route unavailable'); // Supabase refused → paused
  const f = sub(R.connect(URL1)); f.open();
  assert.equal(f.kind, 'firebase');
  tick();
  assert.equal(f.closed, null, 'still paused: stays on Firebase');
  clock.now += 16 * 60 * 1000; // pause over
  tick();
  assert.equal(f.closed && f.closed.code, 1012, 'fallback closed so the app reconnects');
  assert.equal(sub(R.connect(URL1)).kind, 'supabase', 'reconnect lands on the first layer again');
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
  assert.equal(w.F123Relay.connect(URL1.replace(/-y$/, '-fotos')).kind, 'supabase', 'photos use the durable layer even without peer-sync');
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
    if (options.method === 'PUT' || /x-http-method-override=PUT/.test(String(_))) writes.push(JSON.parse(options.body)); // v663: writes are POST + override
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
// v659 review (debug d2, 2026-11-04): Supabase refused, Firebase took over inside the cascade; when Supabase's pause ends
// the device must go back to it (restart 1012), never stay split on Firebase until something else reconnects.
test('v659 (d2): after the first layer refuses and its pause ends, the cascade restarts toward it', () => {
  const { R, made, clock, tick } = app();
  const h = R.connect(URL1); let code = null; h.onclose = e => { code = e.code; };
  made[0].close(1013, 'try later');
  assert.equal(made.length, 2, 'Firebase started at once'); made[1].open();
  tick(); assert.equal(code, null, 'still paused: stays on Firebase');
  clock.now += 16 * 60 * 1000; tick();
  assert.equal(code, 1012); assert.deepEqual(made[1].closed, { code: 1000, reason: 'earlier durable layer available again' });
});
// v661 band quarantine (OpenCode review 2026-11-04): a layer refusing the photo room must not stop inventory there.
test('v661: photo room refused -> only the photo band pauses; inventory keeps the same layer', () => {
  const { R, made } = app();
  const FOTOS = URL1.replace(/-y$/, '-fotos');
  const f = sub(R.connect(FOTOS)); assert.equal(f.kind, 'supabase');
  f.close(1011, 'room not allowed');
  assert.equal(sub(R.connect(URL1)).kind, 'supabase', 'inventory still on Supabase');
  assert.notEqual(sub(R.connect(FOTOS)).kind, 'supabase', 'photos skip the refusing layer');
  assert.ok(made.length >= 3);
});

// v662 (2026-11-04): peer frames must reach the app (v659 dropped them), and a live direct lane runs beside the
// durable layer so two open devices see each other's changes at peer speed.
test('v662: a room on the peers fallback forwards business frames; a peer persist-result never confirms while a durable layer lives', () => {
  const { R, vencer, made } = app();
  const h = R.connect(URL1); const got = []; h.onmessage = e => got.push(e.data);
  vencer(); made[1].close(1013, 'x'); // Firebase refuses; Supabase still connecting
  vencer(); // Firebase's own 3 s timer: nothing open -> peers too
  const peer = made.find(x => x.kind === 'peer'); assert.ok(peer, 'peers fallback started');
  peer.peerOnly = true; peer.open();
  const bin = new Uint8Array([1, 2, 3]).buffer; peer.recv(bin);
  assert.ok(got.includes(bin), 'binary business frame reaches the app');
  const pr = JSON.stringify({ k: 'persist-result', kind: 'op', id: 'x', ok: true });
  const ev = new Event('message'); ev.data = pr; ev.peerAccepted = true; peer.dispatchEvent(ev);
  assert.ok(!got.includes(pr), 'Supabase still connecting: a peer ack is not a durable confirmation');
});
test('v662: live lane beside the durable layer: binary both ways, never control text, closes with the cascade', () => {
  const { w, R, made } = app(); w.F123_VIVO = true;
  const h = R.connect(URL1); const got = []; h.onmessage = e => got.push(e.data);
  const vivo = made.find(x => x.kind === 'peer'); assert.ok(vivo, 'live lane opened at once');
  made[0].open(); vivo.open();
  const bin = new Uint8Array([9]).buffer;
  h.send(bin); h.send('{"k":"op","id":"1"}');
  assert.deepEqual(made[0].sent.length, 2, 'durable layer gets everything');
  assert.deepEqual(vivo.sent, [bin], 'live lane gets only the binary live copy');
  const b2 = new Uint8Array([7]).buffer; vivo.recv(b2); vivo.recv('{"k":"peers","n":2}');
  assert.ok(got.includes(b2)); assert.ok(!got.includes('{"k":"peers","n":2}'));
  h.close(1000, 'bye'); assert.equal(vivo.readyState, 3, 'live lane closes with the cascade');
});
test('v662: photos never open a live lane', () => {
  const { w, R, made } = app(); w.F123_VIVO = true;
  R.connect(URL1.replace(/-y$/, '-fotos'));
  assert.equal(made.filter(x => x.kind === 'peer').length, 0);
});


// v669: first-join with no previous head must not miss old operations on the fallback.
test('v669: initial PWA boot reads existing Firebase inventory history, even with no prior head baseline', async () => {
  const A = app(undefined, new Map(), { value: { rev: 1, seq: 37 } });
  const first = sub(A.R.connect(URL1)); first.open();
  await espera(); await espera();
  assert.equal(first.closed?.code, 1012, 'switches to the history-bearing fallback');
  assert.equal(sub(A.R.connect(URL1)).kind, 'firebase', 'the next connection reads the other history');
});

test('v669: photo room also recovers pre-existing Firebase photo bytes on first PWA start', async () => {
  const A = app(undefined, new Map(), { value: { rev: 0, seq: 14 } });
  const fotos = URL1.replace(/-y$/, '-fotos');
  const first = sub(A.R.connect(fotos)); first.open();
  await espera(); await espera();
  assert.equal(first.closed?.code, 1012, 'photo bootstrap must not stay on an empty preferred room');
  assert.equal(sub(A.R.connect(fotos)).kind, 'firebase');
});

test('v669: photos do not probe a Firebase photo band after its daily download quota is spent', async () => {
  const now = Date.parse('2026-11-02T12:00:00Z');
  const store = new Map([['f123_relay_cupo_fb_v1', JSON.stringify({
    dia: '2026-11-02', up: 0, down: 11 * 1024 * 1024, pausaHasta: 0
  })]]);
  const A = app(now, store, { value: { rev: 0, seq: 14 } });
  const first = sub(A.R.connect(URL1.replace(/-y$/, '-fotos'))); first.open();
  await espera(); await espera();
  assert.equal(first.closed, null, 'no extra bandwidth after exhausting the photo share');
});
