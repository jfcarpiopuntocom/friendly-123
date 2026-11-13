'use strict';
// v751 (cold join): a complete device renews the checkpoint when the tail grows, with frequency and byte caps;
// the Firebase pull stops re-reading the revision on every page and serves larger pages.
const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const sync = fs.readFileSync(path.join(__dirname, '../docs/sync-yjs.js'), 'utf8');
const relay = fs.readFileSync(path.join(__dirname, '../docs/firebase-relay.js'), 'utf8');

function canalDePrueba() {
  const a = sync.indexOf('    var CKPT_RENUEVA_FRAMES'), b = sync.indexOf('    var _tCkpt = null;', a);
  assert.ok(a > 0 && b > a, 'checkpoint renewal block present');
  const socket = { readyState: 1 };
  const ctx = { ahora: 1e12, pulls: [], deuda: false, permiteCkpt: true, _soloMemoria: false, API: { clave: {} },
    canal: { ws: socket, recuperando: false }, _currentPullState: { enCurso: false },
    _appliedPullCursor: { rev: 3, seq: 10 }, Number };
  ctx.Date = { now: () => ctx.ahora };
  ctx.deudaPendiente = () => ctx.deuda;
  ctx.pedirPagina = (s, e) => { ctx.pulls.push(s); e.enCurso = true; };
  vm.createContext(ctx); vm.runInContext(sync.slice(a, b), ctx);
  ctx.frames = (n, bytes) => { for (let i = 0; i < n; i++) ctx.contarColaCkpt(bytes); };
  // What the real flow does when the tail re-read ends.
  ctx.terminarPull = () => { ctx._currentPullState.enCurso = false; };
  return ctx;
}

test('v751: below the threshold nothing new happens', () => {
  const c = canalDePrueba();
  c.frames(1023, 300); // v771: ~300 KiB stays under the 384 KiB size trigger
  assert.equal(c.pulls.length, 0);
  assert.equal(c._currentPullState.renovarCkpt, undefined);
});

test('v751: a complete device re-reads its tail once when the threshold is reached', () => {
  const c = canalDePrueba();
  c.frames(1024, 1000);
  assert.equal(c.pulls.length, 1);
  assert.equal(c.pulls[0], c.canal.ws);
  assert.equal(c._currentPullState.renovarCkpt, true);
});

test('v751: frequency cap, at most one renewal every 6 hours', () => {
  const c = canalDePrueba();
  c.frames(1024, 1000); c.terminarPull();
  c.frames(5000, 100);
  assert.equal(c.pulls.length, 1, 'a busy store cannot renew again right away');
  c.ahora += 6 * 3600000 - 1; c.frames(1, 100);
  assert.equal(c.pulls.length, 1);
  c.ahora += 1; c.frames(1, 100);
  assert.equal(c.pulls.length, 2);
});

test('v751: byte cap, at most 4 MiB of re-read tail per day', () => {
  const c = canalDePrueba();
  // v771: big tails now only build up while the device is incomplete (the size trigger renews earlier otherwise).
  c.deuda = true; c.frames(1024, 3000); c.deuda = false; c.frames(1, 100); c.terminarPull(); // ~2.9 MiB
  assert.equal(c.pulls.length, 1);
  c.ahora += 6 * 3600000; c.deuda = true; c.frames(1024, 3000); c.deuda = false; c.frames(1, 100);
  assert.equal(c.pulls.length, 1, 'a second 2.9 MiB tail would pass the daily budget');
  c.ahora += 18 * 3600000; c.frames(1, 100);
  assert.equal(c.pulls.length, 2, 'the budget returns the next day');
});

test('v751: an incomplete device never renews, and renews once it is complete', () => {
  const casos = [
    c => { c.canal.recuperando = true; return () => { c.canal.recuperando = false; }; },
    c => { c.deuda = true; return () => { c.deuda = false; }; },
    c => { c._currentPullState.enCurso = true; return () => { c._currentPullState.enCurso = false; }; },
    c => { c._appliedPullCursor.rev = -1; return () => { c._appliedPullCursor.rev = 3; }; },
    c => { c.canal.ws.peerOnly = true; return () => { c.canal.ws.peerOnly = false; }; },
    c => { c.canal.ws.readyState = 3; return () => { c.canal.ws.readyState = 1; }; },
    c => { c._soloMemoria = true; return () => { c._soloMemoria = false; }; }
  ];
  casos.forEach((preparar, i) => {
    const c = canalDePrueba(), sanar = preparar(c);
    c.frames(2000, 100);
    assert.equal(c.pulls.length, 0, 'case ' + i + ' must not renew');
    sanar(); c.frames(1, 100);
    assert.equal(c.pulls.length, 1, 'case ' + i + ' renews when complete');
  });
  const fotos = canalDePrueba(); fotos.permiteCkpt = false; fotos.frames(3000, 100);
  assert.equal(fotos.pulls.length, 0, 'photo rooms have no checkpoint');
});

test('v751: the renewal is wired to durable ops, live frames, the final page and the confirmed checkpoint', () => {
  assert.match(sync, /if \(tag === 0\) contarColaCkpt\(buf\.byteLength\);/);
  assert.match(sync, /if \(ok && source === "live"\) contarColaCkpt\(d\.byteLength\);/);
  assert.match(sync, /if \(!c\.more && pullEstado\.renovarCkpt\) \{ pullEstado\.renovarCkpt = false; checkpointTrasPull\(ws\); \}/);
  assert.match(sync, /_colaFrames = 0; _colaBytes = 0; \/\/ v751: a confirmed checkpoint/);
});

function firebase(ops, ck) {
  const gets = { k: 0, o: 0, limites: [] };
  const fetchFn = async (url) => {
    const u = new URL(url); let body = null;
    if (/\/k\.json$/.test(u.pathname)) { gets.k++; body = ck.rev ? { [ck.rev]: true } : null; }
    else if (/\/k\/\d+\.json$/.test(u.pathname)) body = { s: ck.s, c: ck.c, lam: 0 };
    else if (/\/o\.json$/.test(u.pathname)) {
      gets.o++;
      const start = Number(u.searchParams.get('startAt') || 0), lim = Number(u.searchParams.get('limitToFirst') || 1e9);
      gets.limites.push(lim);
      body = Object.fromEntries(Object.entries(ops).filter(([, v]) => v.s >= start).sort((a, b) => a[1].s - b[1].s).slice(0, lim));
    }
    const t = JSON.stringify(body);
    return { ok: true, status: 200, text: async () => t, headers: { get: () => null } };
  };
  const w = { TextEncoder, JSON, Promise, Number, String, Object, Math, DOMException, setTimeout, clearTimeout, btoa, atob, Blob, Uint8Array, ArrayBuffer, Date, console };
  w.window = w; vm.runInNewContext(relay, w);
  return { gets, R: w.F123FirebaseRelay.create({ fetch: fetchFn, EventSource: null }) };
}
const sala = s => 'wss://friendly123-sync-relay.jfcarpio.workers.dev/sala/' + 'a'.repeat(40) + s;
const espera = ms => new Promise(r => setTimeout(r, ms));
async function bajarTodo(ws, desde) {
  const paginas = []; let binarios = 0, cursor = desde;
  ws.addEventListener('message', (e) => {
    if (typeof e.data !== 'string') { binarios++; return; }
    const m = JSON.parse(e.data); if (m.k === 'pull-page') paginas.push(m);
  });
  for (let i = 0; i < 20; i++) {
    const antes = paginas.length;
    ws.send(JSON.stringify({ k: 'pull', v: 2, rev: cursor.rev, seq: cursor.seq, limit: 64 }));
    for (let t = 0; t < 50 && paginas.length === antes; t++) await espera(5);
    const p = paginas[paginas.length - 1]; cursor = { rev: p.rev, seq: p.seq };
    if (!p.more) break;
  }
  return { paginas, cursor, binarios: () => binarios };
}

test('v751: a multi-page Firebase pull reads the revision once and asks for 192 operations', async () => {
  const ops = {}; for (let i = 1; i <= 500; i++) ops['op' + i] = { s: i, c: Buffer.from('x' + i).toString('base64'), lam: 0 };
  const ck = { rev: 2, s: 0, c: Buffer.from('ck').toString('base64') };
  const { gets, R } = firebase(ops, ck);
  const ws = R.connect(sala('-y')); await espera(30);
  const kAntes = gets.k;
  const r = await bajarTodo(ws, { rev: 2, seq: 0 });
  assert.ok(r.paginas.length >= 3, 'the history needs several pages');
  assert.equal(gets.k - kAntes, 1, 'one revision read for the whole pull, not one per page');
  assert.equal(gets.limites[0], 192);
  assert.equal(r.paginas.reduce((n, p) => n + p.n, 0), 500, 'every operation is delivered exactly once');
  assert.deepEqual(r.cursor, { rev: 2, seq: 500 });
  // A checkpoint written by another device is seen by the NEXT pull (fresh revision read).
  ck.rev = 3; ck.s = 500;
  const r2 = await bajarTodo(ws, r.cursor);
  assert.equal(r2.paginas[0].rev, 3);
  assert.equal(r2.binarios(), 1, 'the new checkpoint is delivered');
});

test('v751: photo rooms keep their page size', async () => {
  const { gets, R } = firebase({}, { rev: 0 });
  const ws = R.connect(sala('-fotos')); await espera(30);
  ws.send(JSON.stringify({ k: 'pull', v: 2, rev: 0, seq: 0, limit: 4 })); await espera(40);
  assert.equal(gets.limites[0], 4);
});
