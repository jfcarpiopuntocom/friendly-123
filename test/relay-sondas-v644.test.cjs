'use strict';
// v644 probes against the REAL Firebase adapter with no network. A fake socket proved the earlier prototypes green while
// they could never fire on a real adapter, so only the Supabase side is simulated, as its bundle behaves:
// readyState 0 on creation, send throws until open, opens in a microtask, and seq is a Postgres identity.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const URL1 = 'wss://friendly123-sync-relay.jfcarpio.workers.dev/sala/' + 'c'.repeat(40) + '-y';
const tick = ms => new Promise(r => setTimeout(r, ms));

function montar(op) {
  op = op || {};
  const firebase = { k: {}, o: { ab: { s: 1793640000000, c: 'QUJD', lam: 1 } } };
  const sb = { rev: 0, seq: 1 }, n = { es: 0, sb: [], gets: 0 }, intervalos = [], store = new Map();
  let adelanto = 0;
  class ES extends EventTarget { constructor() { super(); n.es++; } close() {} }
  class FakeDate extends Date { static now() { return Date.now() + adelanto; } }
  const relaySb = { ckptFrameBytes: 786432, connect() {
    const et = new EventTarget(), s = {
      readyState: 0, enviados: [], addEventListener: et.addEventListener.bind(et),
      close() { if (s.readyState < 3) { s.readyState = 3; et.dispatchEvent(new Event('close')); } },
      send(v) {
        if (s.readyState !== 1) throw new Error('Relay is not open');
        s.enviados.push(v);
        if (typeof v === 'string' && JSON.parse(v).k === 'head') queueMicrotask(() => { const e = new Event('message'); e.data = JSON.stringify({ k: 'head-result', v: 2, rev: sb.rev, seq: sb.seq }); et.dispatchEvent(e); });
      },
      recibir(data) { const e = new Event('message'); e.data = data; et.dispatchEvent(e); }
    };
    n.sb.push(s); queueMicrotask(() => { s.readyState = 1; et.dispatchEvent(new Event('open')); });
    return s;
  } };
  const w = {
    F123Relay: relaySb, EventSource: ES, console: { warn() {}, log() {} },
    localStorage: { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) },
    fetch: async u => {
      n.gets++;
      const url = String(u);
      if (op.firebaseCaida) throw new Error('down');
      let cuerpo = /\/o\.json/.test(url) ? firebase.o : /\/k\.json/.test(url) ? firebase.k : null;
      if (/\/o\.json/.test(url) && /limitToLast/.test(url)) cuerpo = Object.fromEntries(Object.entries(firebase.o).sort((a, b) => a[1].s - b[1].s).slice(-1));
      return new Response(JSON.stringify(cuerpo), { status: 200, headers: { date: new Date().toUTCString() } });
    },
    TextEncoder, TextDecoder, DOMException, Event, EventTarget, JSON, Number, String, Math, Object, Promise, Blob, atob, btoa, Uint8Array,
    encodeURIComponent, URLSearchParams, queueMicrotask, Date: FakeDate, setTimeout, clearTimeout,
    setInterval: f => { intervalos.push(f); return intervalos.length; }, clearInterval() {}
  };
  w.window = w; w.self = w; w.globalThis = w;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../docs/firebase-relay.js'), 'utf8'), w);
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../docs/relay-selector.js'), 'utf8'), w);
  return { w, n, firebase, sb, store, tics: async () => { intervalos.forEach(f => f()); await tick(30); }, adelantar: ms => { adelanto += ms; } };
}

test('same store on both layers: incomparable counters raise no alert', async () => {
  const c = montar();
  c.w.F123Relay.connect(URL1); await tick(30);
  c.adelantar(61000); await c.tics();
  assert.equal(c.w.F123Relay.estadoSondas().otraCapa, false);
  assert.equal(c.w.F123Relay.estadoSondas().sinRecibir, false);
});

test('reading Firebase opens no socket and no event stream', async () => {
  const c = montar();
  c.w.F123Relay.connect(URL1); await tick(30);
  c.adelantar(61000); await c.tics();
  assert.ok(c.n.gets >= 4, 'the head was read');
  assert.equal(c.n.es, 0);
  assert.equal(c.n.sb.length, 1, 'only the working connection exists');
});

test('another device writing on Firebase is reported, and the alert expires', async () => {
  const c = montar();
  c.w.F123Relay.connect(URL1); await tick(30);
  c.adelantar(61000); await c.tics();
  c.firebase.o.cd = { s: 1793640099000, c: 'REVG', lam: 2 };
  c.adelantar(61000); await c.tics();
  assert.equal(c.w.F123Relay.estadoSondas().otraCapa, true);
  c.adelantar(1800000);
  assert.equal(c.w.F123Relay.estadoSondas().otraCapa, false);
});

test('a checkpoint on Firebase also counts as activity on the other layer, a repeat read does not', async () => {
  const c = montar();
  c.w.F123Relay.connect(URL1); await tick(30);
  c.adelantar(61000); await c.tics();
  c.adelantar(61000); await c.tics();
  assert.equal(c.w.F123Relay.estadoSondas().otraCapa, false);
  c.firebase.k['1'] = { s: 1, c: 'QQ==', lam: 1 };
  c.adelantar(61000); await c.tics();
  assert.equal(c.w.F123Relay.estadoSondas().otraCapa, true);
});

test('the probe is debounced to one Firebase read per minute per room', async () => {
  const c = montar();
  c.w.F123Relay.connect(URL1); await tick(30);
  const antes = c.n.gets;
  await c.tics(); await c.tics();
  assert.equal(c.n.gets, antes);
});

test('head moved, nothing sent, no frame arrived: flagged only after the wait, and a frame clears it', async () => {
  const c = montar();
  c.w.F123Relay.connect(URL1); await tick(30);
  await c.tics(); // baseline
  c.sb.seq = 2;
  await c.tics();
  assert.equal(c.w.F123Relay.estadoSondas().sinRecibir, false, 'not yet: live delivery may be on its way');
  c.adelantar(600000);
  assert.equal(c.w.F123Relay.estadoSondas().sinRecibir, true);
  c.n.sb[0].recibir(new Uint8Array(4).buffer);
  c.sb.seq = 3;
  await c.tics();
  assert.equal(c.w.F123Relay.estadoSondas().sinRecibir, false);
});

test('this device writing explains the head moving: no flag', async () => {
  const c = montar();
  const ws = c.w.F123Relay.connect(URL1); await tick(30);
  await c.tics();
  ws.send(JSON.stringify({ k: 'op', id: 'x', c: 'AQID' }));
  c.sb.seq = 2;
  await c.tics();
  c.adelantar(600000);
  assert.equal(c.w.F123Relay.estadoSondas().sinRecibir, false);
});

test('a frame that arrived before the head explains it moving: no flag', async () => {
  const c = montar();
  c.w.F123Relay.connect(URL1); await tick(30);
  await c.tics();
  c.n.sb[0].recibir(new Uint8Array(4).buffer);
  c.sb.seq = 2;
  await c.tics();
  c.adelantar(600000);
  assert.equal(c.w.F123Relay.estadoSondas().sinRecibir, false);
});

test('broken probes change nothing for the caller', async () => {
  const c = montar({ firebaseCaida: true });
  const ws = c.w.F123Relay.connect(URL1); await tick(30);
  c.adelantar(61000); await c.tics();
  assert.equal(ws.readyState, 1);
  assert.equal(c.w.F123Relay.estadoSondas().otraCapa, false);
  const d = montar();
  d.w.F123FirebaseRelay.leerHead = () => { throw new Error('rota'); };
  const ws2 = d.w.F123Relay.connect(URL1); await tick(30);
  assert.equal(ws2.readyState, 1);
});

test('Firebase reads are charged to its daily budget, once, across restart and a new day', async () => {
  const c = montar();
  c.w.F123Relay.connect(URL1); await tick(30);
  const cupoFb = () => c.w.F123Relay.estadoCupo().find(x => /fb/.test(x.capa)).down;
  const primero = cupoFb();
  assert.ok(primero > 0, 'the head read counted');
  c.adelantar(61000); await c.tics();
  const segundo = cupoFb();
  assert.ok(segundo > primero);
  const leido = JSON.parse(c.store.get('f123_relay_cupo_fb_v1')).down;
  assert.equal(leido, segundo);
  c.store.set('f123_relay_cupo_fb_v1', JSON.stringify({ dia: '2000-01-01', up: 0, down: 19999999, pausaHasta: 0 }));
  c.adelantar(61000); await c.tics();
  assert.ok(cupoFb() < 1000, 'yesterday is not inherited');
});

test('an exhausted Firebase budget is not spent on a probe', async () => {
  const c = montar();
  const hoy = new Date().toISOString().slice(0, 10);
  c.store.set('f123_relay_cupo_fb_v1', JSON.stringify({ dia: hoy, up: 0, down: 20 * 1024 * 1024, pausaHasta: 0 }));
  c.w.F123Relay.connect(URL1); await tick(30);
  c.adelantar(61000); await c.tics();
  assert.equal(c.n.gets, 0);
});

test('photos never start a probe', async () => {
  const c = montar();
  c.w.F123Peer = { create: () => ({ connect: () => ({ readyState: 1, addEventListener() {} }) }) };
  c.w.F123Relay.connect(URL1.replace(/-y$/, '-fotos')); await tick(30);
  assert.equal(c.n.gets, 0);
  assert.equal(c.n.sb.length, 0);
});
