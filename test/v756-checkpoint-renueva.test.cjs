'use strict';
// v756: the Firebase checkpoint renews for real. Synthetic: no network, no customer data.
const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const sync = fs.readFileSync(path.join(__dirname, '../docs/sync-yjs.js'), 'utf8');
const tick = () => new Promise(r => setImmediate(r));

function almacen() {
  const m = new Map();
  return { m, get: async k => m.get(k), set: async (k, v) => { m.set(k, JSON.parse(JSON.stringify(v))); } };
}
function cola(persistencia, ahora) {
  const a = sync.indexOf('    var CKPT_RENUEVA_FRAMES'), b = sync.indexOf('    var _tCkpt = null;', a);
  assert.ok(a > 0 && b > a);
  const ctx = { ahora: ahora || 1e12, pulls: [], logs: [], deuda: false, permiteCkpt: true, _soloMemoria: false, API: { clave: {} },
    canal: { ws: { readyState: 1 }, recuperando: false }, _currentPullState: { enCurso: false },
    _appliedPullCursor: { rev: 3, seq: 10 }, Number, nombre: 'catalogo', suffix: '', persistencia };
  ctx.Date = { now: () => ctx.ahora };
  ctx.log = (...m) => ctx.logs.push(m.join(' '));
  ctx.deudaPendiente = () => ctx.deuda;
  ctx.pedirPagina = (s, e) => { ctx.pulls.push(s); e.enCurso = true; };
  vm.createContext(ctx); vm.runInContext(sync.slice(a, b), ctx);
  ctx.frames = (n, bytes) => { for (let i = 0; i < n; i++) ctx.contarColaCkpt(bytes); };
  return ctx;
}

test('v756: a tail over 4 MiB no longer kills the renewal (24 h later it renews)', () => {
  const c = cola();
  c.deuda = true; c.frames(1024, 5000); // ~4.9 MiB queued while the device was not complete
  c.deuda = false; c.ahora += 24 * 3600000; c.frames(1, 100);
  assert.equal(c.pulls.length, 1);
  assert.equal(c._currentPullState.renovarCkpt, true);
});

test('v756: the first renewal of the day passes even with a tail over 4 MiB; later ones keep the daily cap', () => {
  const c = cola();
  c.frames(1024, 5000);
  assert.equal(c.pulls.length, 1, 'first renewal of the 24 h window');
  c._currentPullState.enCurso = false;
  c.ahora += 6 * 3600000; c.frames(1024, 5000);
  assert.equal(c.pulls.length, 1, 'second big tail the same day waits');
  c.ahora += 18 * 3600000; c.frames(1, 100);
  assert.equal(c.pulls.length, 2, 'next window renews again');
});

test('v756: the tail counters survive a reload (a phone that sleeps reaches the threshold)', async () => {
  const p = almacen();
  const c1 = cola(p); await tick();
  c1.frames(600, 1000); await tick();
  const c2 = cola(p, c1.ahora + 60000); await tick();
  c2.frames(600, 1000);
  assert.equal(c2.pulls.length, 1, '600 + 600 frames across two loads renew');
  await tick();
  const c3 = cola(p, c2.ahora + 60000); await tick();
  c3.frames(2000, 100);
  assert.equal(c3.pulls.length, 0, 'the 6 h spacing also survives the reload');
});

test('v756: a blocked renewal leaves its reason in the internal log once, not per frame', () => {
  const c = cola();
  c.deuda = true; c.frames(3000, 100);
  const r = c.logs.filter(l => /renovacion/.test(l));
  assert.equal(r.length, 1);
  assert.match(r[0], /incompleto/);
});

function ckpt(over) {
  const a = sync.indexOf('    function hacerCkpt() {'), b = sync.indexOf('    function conectar() {', a);
  assert.ok(a > 0 && b > a);
  const ctx = Object.assign({ logs: [], sobres: [], inFlight: {}, _soloMemoria: false, permiteCkpt: true, API: { clave: {} },
    canal: { ws: { readyState: 1, relayLayer: 'firebase' }, recuperando: false }, _currentPullState: { enCurso: false },
    _appliedPullCursor: { rev: 5, seq: 900 }, partesEntrantes: {}, doc: { store: {} }, nombre: 'catalogo',
    Y: { encodeStateAsUpdate: () => new Uint8Array(64) }, _b64: () => 'ESTADO', window: {}, MAX_CKPT_CIPHER_BYTES: 1,
    MAX_CKPT_RPC_BYTES: 300000, cifrarBin: async () => new Uint8Array(32), _frame: (t, p) => p,
    _outbox: { pending: [], checkpoint: '' }, _durableQueue: Promise.resolve(), Promise, Object, Date, Math, JSON, Number, String },
  over || {});
  ctx._durableInFlight = ctx.inFlight;
  ctx.log = (...m) => ctx.logs.push(m.join(' '));
  ctx.diagnosticarCkpt = () => {};
  ctx.guardarSobre = e => ctx.sobres.push(e);
  ctx.mutarOutbox = change => { change(); return Promise.resolve(); };
  vm.createContext(ctx); vm.runInContext(sync.slice(a, b), ctx);
  return ctx;
}
const espera = () => new Promise(r => setTimeout(r, 20));

test('v756: every silent checkpoint skip leaves its reason in the internal log', async () => {
  const casos = [
    [{ canal: { ws: { readyState: 1 }, recuperando: true } }, /recuperando/],
    [{ doc: { store: { pendingStructs: { missing: 1 } } } }, /padres-faltantes/],
    [{ _appliedPullCursor: { rev: -1, seq: 0 } }, /sin-cursor/],
    [{ partesEntrantes: { x: 1 } }, /partes-entrantes/],
    [{ _currentPullState: { enCurso: true } }, /pull-en-curso/],
    [{ canal: { ws: { readyState: 3 }, recuperando: false } }, /socket/]
  ];
  for (const [over, motivo] of casos) {
    const c = ckpt(over); c.hacerCkpt(); await espera();
    assert.equal(c.sobres.length, 0, 'behaviour unchanged: no checkpoint');
    assert.ok(c.logs.some(l => motivo.test(l)), 'reason logged: ' + motivo);
  }
  const p = ckpt({ _outbox: { pending: [{ k: 'ckpt', id: 'ck-a', rev: 5, seq: 900 }], checkpoint: '' } });
  p.hacerCkpt(); await espera();
  assert.equal(p.sobres.length, 0, 'a pending checkpoint with the same cut still waits');
  assert.ok(p.logs.some(l => /pendiente/.test(l)));
});

test('v756: a pending checkpoint with an older cut is replaced by the new one', async () => {
  const viejo = { k: 'ckpt', id: 'ck-viejo', rev: 5, seq: 100, state: 'antes' };
  const op = { k: 'op', id: 'op-1' };
  const c = ckpt({ _outbox: { pending: [op, viejo], checkpoint: '' } });
  c.inFlight['ck-viejo'] = { kind: 'ckpt' };
  c.hacerCkpt(); await espera();
  assert.equal(c.sobres.length, 1, 'the new checkpoint is queued');
  assert.equal(c.sobres[0].rev, 5); assert.equal(c.sobres[0].seq, 900);
  assert.deepEqual(c._outbox.pending.map(x => x.id), ['op-1'], 'only the stale checkpoint envelope left; operations untouched');
  assert.equal(c.inFlight['ck-viejo'], undefined);
});
