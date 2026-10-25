'use strict';
// RED forensic contract: synthetic storage only, no user fixtures or production writes.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const backend = fs.readFileSync(path.join(__dirname, '../docs/mock-backend.js'), 'utf8');
const start = backend.indexOf('  function _guardarEstadoLocalAhora(');
const end = backend.indexOf('  function avisoEspacioJusto(', start);
assert.ok(start > 0 && end > start, 'extract exact A/B save function');
const realSave = backend.slice(start, end);
const loadStart = backend.indexOf('  function cargarEstadoLocal() {');
const loadEnd = backend.indexOf('  // Cuando otra pestaña guarda', loadStart);
assert.ok(loadStart > end && loadEnd > loadStart, 'extract the real boot A/B reader');
const realLoad = backend.slice(loadStart, loadEnd);

function reload(storage) {
  const applied = [];
  const context = vm.createContext({
    localStorage: {
      getItem(k) { return storage.has(k) ? storage.get(k) : null; },
      setItem(k, v) { storage.set(k, v); },
    },
    OC_STATE_PTR: 'ptr', OC_STATE_SUFIJO: 'synthetic-shop', OC_STATE_KEY: 'legacy',
    _localRev: 0, _cargoBufferReal: false,
    claveBuffer: letter => 'slot_' + letter,
    validarRespaldo() { return null; },
    aplicarRespaldo(value) { applied.push(value); },
    repararRespaldo() { return null; },
    console: { warn() {} }, setTimeout() {},
    avisarBufferRecuperado() {}, avisarEstadoReparado() {},
  });
  vm.runInContext(realLoad + '; this.cargar = cargarEstadoLocal;', context);
  context.cargar();
  return applied;
}

function fixture({ rejectRestore = false, rejectDelete = false, idbOK = false } = {}) {
  const oldA = JSON.stringify({ _rev: 10, photo: 'synthetic-active-A' });
  const oldB = JSON.stringify({ _rev: 9, photo: 'synthetic-unique-legacy-B', movement: 'synthetic-history-B' });
  const storage = new Map([['ptr', 'A'], ['slot_A', oldA], ['slot_B', oldB]]);
  const events = [];
  const localStorage = {
    getItem(k) { return storage.has(k) ? storage.get(k) : null; },
    setItem(k, v) {
      if (k === 'ptr' && v === 'B') { events.push('pointer rejected'); throw Error('synthetic quota on pointer'); }
      if (rejectRestore && k === 'slot_B' && v === oldB) {
        events.push('restore rejected');
        throw Error('synthetic quota on old B restore');
      }
      events.push('set ' + k);
      storage.set(k, v);
    },
    removeItem(k) {
      if (rejectDelete && k === 'slot_B') { events.push('delete rejected'); throw Error('synthetic blocked deletion'); }
      events.push('delete ' + k); storage.delete(k);
    },
  };
  const context = vm.createContext({
    localStorage, OC_STATE_PTR: 'ptr', _localRev: 10, _localRevReservado: 10,
    estadoActualExportable: () => ({ photo: 'synthetic-new-B', movement: 'synthetic-new-movement' }),
    claveBuffer: letter => 'slot_' + letter,
    _espejarEnIDB: () => Promise.resolve(idbOK),
    _miSello: '',
    ocultarAvisoRecorte() {}, despejarAvisoMemoriaLlena() {},
    _publicarAdminPins() {}, avisoEspacioJusto() {},
    avisoMemoriaLlena() { events.push('visible save failure'); },
  });
  vm.runInContext(realSave + '; this.guardar = _guardarEstadoLocalAhora;', context);
  return { context, storage, oldA, oldB, events };
}

test('control: pointer failure + successful rollback retains historical B', async () => {
  const f = fixture();
  assert.equal(await f.context.guardar(true, false), false);
  assert.equal(f.storage.get('ptr'), 'A');
  assert.equal(f.storage.get('slot_A'), f.oldA);
  assert.equal(f.storage.get('slot_B'), f.oldB);
  assert.ok(f.events.includes('visible save failure'));
});

test('1AAA RED: pointer and rollback both fail; unique old B must not be deleted', async () => {
  const f = fixture({ rejectRestore: true });
  assert.equal(await f.context.guardar(true, false), false);
  assert.equal(f.storage.get('ptr'), 'A');
  assert.equal(f.storage.get('slot_A'), f.oldA, 'active A is protected');
  assert.equal(f.storage.get('slot_B'), f.oldB,
    'historical B must survive even if quota rejects pointer and rollback');
  assert.equal(f.events.includes('delete slot_B'), false, 'no destructive fallback');
});

// A GREEN fix must also prove restart chooses only a committed version.
// Keeping an uncommitted new B instead of deleting it is NOT sufficient;
// it may become fallback if the active A later fails validation.

test('1AAA RED: uncommitted B must not become boot fallback if pointer, restore, and delete fail', async () => {
  const f = fixture({ rejectRestore: true, rejectDelete: true });
  assert.equal(await f.context.guardar(true, false), false, 'save was explicitly rejected');
  assert.equal(f.storage.get('ptr'), 'A', 'commit marker never moved');
  assert.ok(f.events.includes('delete rejected'));
  f.storage.set('slot_A', '{synthetically-corrupted-A');
  const loaded = reload(f.storage);
  assert.notEqual(loaded[0] && loaded[0].photo, 'synthetic-new-B',
    'restart must never silently adopt B rejected by its pointer commit');
});

test('boot control: prior B is valid fallback when A is corrupt and old B was restored', async () => {
  const f = fixture();
  assert.equal(await f.context.guardar(true, false), false);
  f.storage.set('slot_A', '{synthetically-corrupted-A');
  const loaded = reload(f.storage);
  assert.equal(loaded[0] && loaded[0].photo, 'synthetic-unique-legacy-B',
    'normal recovery still recovers an older durable B');
});
