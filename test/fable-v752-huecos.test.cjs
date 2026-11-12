'use strict';
// v752 (holes in a Yjs client's sequence): since fd3ccb88 (2026-10-21) the durable drain lets the newest outbox
// entry jump ahead of the backlog. A device that closes right after leaves on the durable layer a client with a
// gap: a later operation without the earlier ones. A joining device (canal.recuperando) has no user action to
// hurry, so it must upload in order: closing it then loses only a suffix nobody saw, never a middle piece.
const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const sync = fs.readFileSync(path.join(__dirname, '../docs/sync-yjs.js'), 'utf8');

function aparato(recuperando, enVuelo) {
  const a = sync.indexOf('    function drenarDurable() {'), b = sync.indexOf('    /* Oversized legacy outbox', a);
  assert.ok(a > 0 && b > a, 'drenarDurable present');
  const ctx = { enviados: [], _pausado: false, _heredadosListo: true, MAX_DURABLE_INFLIGHT: 4, Math, Object,
    API: { clave: {} }, canal: { ws: { readyState: 1 }, recuperando }, _groupAcks: new Set(),
    _durableInFlight: Object.create(null),
    // Six operations of ONE Yjs client, in causal order (each needs the previous ones).
    _pendientes: [0, 1, 2, 3, 4, 5].map(n => ({ id: 'op' + n, k: 'op', reloj: n })) };
  for (let i = 0; i < (enVuelo || 0); i++) ctx._durableInFlight['op' + i] = { kind: 'op' };
  ctx.permitido = () => true; ctx.programarDurable = () => {}; ctx.absorberHeredado = () => {};
  ctx._vivos = () => ctx._pendientes;
  ctx.enviarDurable = e => { ctx.enviados.push(e.reloj); ctx._durableInFlight[e.id] = { kind: 'op' }; return true; };
  vm.createContext(ctx); vm.runInContext(sync.slice(a, b), ctx);
  return ctx;
}
// What the durable layer holds if the device closes now: everything sent so far.
const sinHueco = relojes => relojes.every((r, i) => r === i);

test('v752: a joining device that closes mid-upload leaves no gap in its own sequence', () => {
  const c = aparato(true);
  c.drenarDurable();
  assert.deepEqual(Array.from(c.enviados), [0, 1, 2, 3]);
  assert.ok(sinHueco(c.enviados), 'the durable layer got a prefix');
});

test('v752: same with operations already in flight (2 free slots, 4 waiting)', () => {
  const c = aparato(true, 2);
  c.drenarDurable();
  assert.deepEqual(Array.from(c.enviados), [2, 3], 'the next two in order, never op5 ahead of op3');
});

test('v752: the joining device still drains everything, in order, as slots free up', () => {
  const c = aparato(true);
  c.drenarDurable();
  c._durableInFlight = Object.create(null); c._pendientes = c._pendientes.slice(4);
  c.drenarDurable();
  assert.deepEqual(Array.from(c.enviados), [0, 1, 2, 3, 4, 5]);
});

test('v752: a complete device keeps the fast slot for its newest change (unchanged since 2026-10-21)', () => {
  const c = aparato(false);
  c.drenarDurable();
  assert.deepEqual(Array.from(c.enviados), [0, 1, 2, 5]);
});
