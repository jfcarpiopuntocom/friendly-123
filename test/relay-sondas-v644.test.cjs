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

test('an empty first layer gives way when the next one holds the store', async () => {
  const c = montar();
  c.sb.seq = 0;
  const ws = c.w.F123Relay.connect(URL1); await tick(30);
  ws.send(JSON.stringify({ k: 'head', v: 2 })); await tick(30);
  assert.equal(ws.readyState, 3, 'the empty layer closed');
  assert.equal(c.w.F123Relay.estadoCupo().find(x => !/fb/.test(x.capa)).usable, false, 'it pauses, so the next connection uses Firebase');
});

test('a first layer with data stays, and an empty one stays when the next is empty too', async () => {
  const c = montar();
  const ws = c.w.F123Relay.connect(URL1); await tick(30);
  ws.send(JSON.stringify({ k: 'head', v: 2 })); await tick(30);
  assert.equal(ws.readyState, 1);
  const d = montar();
  d.sb.seq = 0; d.firebase.o = {};
  const ws2 = d.w.F123Relay.connect(URL1); await tick(30);
  ws2.send(JSON.stringify({ k: 'head', v: 2 })); await tick(30);
  assert.equal(ws2.readyState, 1);
});

test('from peers only, the device goes back to a durable layer when its pause ends', async () => {
  const c = montar();
  const hoy = new Date().toISOString().slice(0, 10), hasta = Date.now() + 60000;
  ['f123_relay_cupo_v1', 'f123_relay_cupo_fb_v1'].forEach(k => c.store.set(k, JSON.stringify({ dia: hoy, up: 0, down: 0, pausaHasta: hasta })));
  let cerrado = null;
  c.w.F123Peer = { create: () => ({ connect: () => ({ readyState: 1, addEventListener() {}, close(code) { cerrado = code; this.readyState = 3; } }) }) };
  c.w.F123Relay.connect(URL1); await tick(10);
  await c.tics();
  assert.equal(cerrado, null, 'both layers are still paused');
  c.adelantar(61000); await c.tics();
  assert.equal(cerrado, 1012);
});

test('v646: Firebase failing at open pauses 60 s, not 15 min, and Supabase keeps its longer pause', async () => {
  const c = montar({ firebaseCaida: true });
  const fb = c.w.F123FirebaseRelay.connect;
  const original = c.w.F123Relay;
  c.store.set('f123_relay_cupo_v1', JSON.stringify({ dia: new Date().toISOString().slice(0, 10), up: 0, down: 0, pausaHasta: Date.now() + 900000 }));
  c.w.F123Peer = { create: () => ({ connect: () => ({ readyState: 1, addEventListener() {}, close() {} }) }) };
  original.connect(URL1); await tick(50);
  const pausa = JSON.parse(c.store.get('f123_relay_cupo_fb_v1')).pausaHasta - Date.now();
  assert.ok(pausa > 0 && pausa <= 60000, 'Firebase pause was ' + pausa);
  assert.equal(typeof fb, 'function');
});

test('v651: the app closing its own socket while it opens does not pause Firebase', async () => {
  const c = montar();
  c.store.set('f123_relay_cupo_v1', JSON.stringify({ dia: new Date().toISOString().slice(0, 10), up: 0, down: 0, pausaHasta: Date.now() + 900000 }));
  const ws = c.w.F123Relay.connect(URL1);
  ws.close();
  await tick(50);
  const fb = c.store.get('f123_relay_cupo_fb_v1');
  assert.ok(!fb || !(JSON.parse(fb).pausaHasta > Date.now()), 'Firebase stays usable');
});

test('v651: a refusal the app answers by closing with no code still pauses the layer', async () => {
  const c = montar({ firebaseCaida: true });
  c.store.set('f123_relay_cupo_v1', JSON.stringify({ dia: new Date().toISOString().slice(0, 10), up: 0, down: 0, pausaHasta: Date.now() + 900000 }));
  c.w.F123Peer = { create: () => ({ connect: () => ({ readyState: 1, addEventListener() {}, close() {} }) }) };
  const ws = c.w.F123Relay.connect(URL1);
  ws.addEventListener('error', () => { try { ws.close(); } catch (_) {} });
  await tick(50);
  assert.ok(JSON.parse(c.store.get('f123_relay_cupo_fb_v1')).pausaHasta > Date.now());
});

function firebaseLleno(n) {
  const c = montar();
  const hoy = new Date().toISOString().slice(0, 10);
  c.store.set('f123_relay_cupo_v1', JSON.stringify({ dia: hoy, up: 0, down: 0, pausaHasta: Date.now() + 900000 }));
  c.store.set('f123_relay_cupo_fb_v1', JSON.stringify({ dia: hoy, up: n, down: 0, pausaHasta: 0 }));
  return c;
}
const abre = async (c, url) => { const ws = c.w.F123Relay.connect(url); await tick(40); return ws; };

test('v647: with the upload budget full, Firebase stays connected instead of falling to peers', async () => {
  const c = firebaseLleno(2 * 1024 * 1024);
  c.w.F123Peer = { create: () => { throw new Error('must not reach peers'); } };
  const ws = await abre(c, URL1);
  assert.equal(ws.readyState, 1);
  assert.equal(c.w.F123Relay.estadoCupo().find(x => /fb/.test(x.capa)).usable, true);
});

test('v647: reads cost no upload and pass with the budget full', async () => {
  const c = firebaseLleno(10 * 1024 * 1024);
  const ws = await abre(c, URL1);
  ws.send(JSON.stringify({ k: 'head', v: 2 }));
  ws.send(JSON.stringify({ k: 'pull', v: 2, rev: 0, seq: 0 }));
  assert.equal(JSON.parse(c.store.get('f123_relay_cupo_fb_v1')).up, 10 * 1024 * 1024);
  assert.equal(ws.readyState, 1);
});

test('v647: over the budget a small change rides the reserve and a heavy frame waits with the socket open', async () => {
  const c = firebaseLleno(2 * 1024 * 1024);
  const ws = await abre(c, URL1);
  ws.send(JSON.stringify({ k: 'op', id: 'chica', c: 'AQID' }));
  assert.throws(() => ws.send(JSON.stringify({ k: 'op', id: 'pesada', c: 'x'.repeat(20000) })), e => e.name === 'QuotaExceededError');
  assert.equal(ws.readyState, 1, 'the heavy frame does not close the layer');
});

test('v647: the compact photo in the base room rides the reserve, a catalog checkpoint does not', async () => {
  const foto = JSON.stringify({ k: 'ckpt', id: 'f', c: 'x'.repeat(60000) });
  const c = firebaseLleno(2 * 1024 * 1024);
  const base = await abre(c, URL1.replace(/-y$/, ''));
  base.send(foto);
  const d = firebaseLleno(2 * 1024 * 1024);
  const cat = await abre(d, URL1);
  assert.throws(() => cat.send(foto), e => e.name === 'QuotaExceededError');
});

test('v647: a compact photo of 768 KB rides the reserve by intent; an oversized control frame does not pass as a read', async () => {
  const c = firebaseLleno(2 * 1024 * 1024);
  const base = await abre(c, URL1.replace(/-y$/, ''));
  base.send(JSON.stringify({ k: 'ckpt', id: 'f', c: 'x'.repeat(768 * 1024) }));
  assert.ok(JSON.parse(c.store.get('f123_relay_cupo_fb_v1')).up > 2.7 * 1024 * 1024, 'it is charged to the reserve');
  const d = firebaseLleno(10 * 1024 * 1024);
  const ws = await abre(d, URL1);
  assert.throws(() => ws.send('{"k":"head","x":"' + 'y'.repeat(5000) + '"}'), e => e.name === 'QuotaExceededError');
});

test('v647: the download budget still stops the layer, and a held heavy frame goes the next day', async () => {
  const c = firebaseLleno(0);
  const hoy = new Date().toISOString().slice(0, 10);
  c.store.set('f123_relay_cupo_fb_v1', JSON.stringify({ dia: hoy, up: 0, down: 20 * 1024 * 1024, pausaHasta: 0 }));
  assert.equal(c.w.F123Relay.estadoCupo().find(x => /fb/.test(x.capa)).usable, false, 'reads are bounded');
  const d = firebaseLleno(2 * 1024 * 1024);
  const ws = await abre(d, URL1);
  const pesada = JSON.stringify({ k: 'op', id: 'pesada', c: 'x'.repeat(20000) });
  assert.throws(() => ws.send(pesada), e => e.name === 'QuotaExceededError');
  d.store.set('f123_relay_cupo_fb_v1', JSON.stringify({ dia: '2000-01-01', up: 2 * 1024 * 1024, down: 0, pausaHasta: 0 }));
  ws.send(pesada);
});

test('v647: past the reserve even small writes wait, so a loop cannot burn the account', async () => {
  const c = firebaseLleno(10 * 1024 * 1024);
  const ws = await abre(c, URL1);
  assert.throws(() => ws.send(JSON.stringify({ k: 'op', id: 'x', c: 'AQID' })), e => e.name === 'QuotaExceededError');
  assert.equal(ws.readyState, 1);
});

test('v649: silent sync trouble reaches Sentry once per device per day, with fixed codes', async () => {
  const c = firebaseLleno(2 * 1024 * 1024), avisos = [];
  c.w.OCCanarios = { fallo: (s, k) => avisos.push(s + ':' + k) };
  c.w.__ocMezcla = true;
  await abre(c, URL1);
  await c.tics(); await c.tics();
  assert.deepEqual(avisos.filter(a => a === 'sync:cupo-subida-lleno'), ['sync:cupo-subida-lleno']);
  assert.deepEqual(avisos.filter(a => a === 'sync:shell-no-actualizado'), ['sync:shell-no-actualizado']);
  assert.ok(avisos.every(a => /^sync:[a-z-]+$/.test(a)));
});

test('v650: a catalog past or near its checkpoint limit reports a fixed code, measured once a day', async () => {
  for (const [margen, codigo] of [[-5, 'catalogo-excede-checkpoint'], [100, 'catalogo-cerca-del-limite'], [900, null]]) {
    const c = firebaseLleno(0), avisos = []; let medidas = 0;
    c.w.OCCanarios = { fallo: (s, k) => avisos.push(k) };
    c.w.OCYjs = { medirTamanoCanales: () => { medidas++; return [{ margenBytes: margen, limiteCifradoBytes: 1000 }]; } };
    await abre(c, URL1);
    await c.tics(); await c.tics();
    assert.equal(medidas, 1);
    assert.deepEqual(avisos.filter(k => /^catalogo/.test(k)), codigo ? [codigo] : []);
  }
});

test('v649: a broken Sentry changes nothing for the caller', async () => {
  const c = firebaseLleno(2 * 1024 * 1024);
  c.w.OCCanarios = { fallo: () => { throw new Error('rota'); } };
  const ws = await abre(c, URL1);
  await c.tics();
  assert.equal(ws.readyState, 1);
});

test('photos never start a probe', async () => {
  const c = montar();
  c.w.F123Peer = { create: () => ({ connect: () => ({ readyState: 1, addEventListener() {} }) }) };
  c.w.F123Relay.connect(URL1.replace(/-y$/, '-fotos')); await tick(30);
  assert.equal(c.n.gets, 0);
  assert.equal(c.n.sb.length, 0);
});
