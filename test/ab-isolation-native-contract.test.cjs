'use strict';
// Characterization of the REAL isolation shim; no app runtime or client data changed.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../docs/aislamiento.js'), 'utf8');
const begin = source.indexOf('  var shim = {');
const end = source.indexOf('  try {\n    Object.defineProperty(window, "localStorage"', begin);
assert.ok(begin >= 0 && end > begin, 'extract actual published isolation shim object');
const realShim = source.slice(begin, end);

function adapter({ failingDelete = false, failingWrite = false } = {}) {
  const data = new Map([['f123::B', 'SYNTHETIC_UNCONFIRMED']]);
  const observed = [];
  const native = {
    get length() { return data.size; },
    key(i) { return [...data.keys()][i] || null; },
    getItem(key) { return data.get(key) || null; },
    setItem(key, value) {
      if (failingWrite) throw Error('synthetic storage refusal');
      data.set(key, String(value));
    },
    removeItem(key) {
      if (failingDelete) throw Error('synthetic removal refusal');
      data.delete(key);
    },
  };
  const context = vm.createContext({
    nativo: native, PREFIJO: 'f123::',
    esNuestra: key => typeof key === 'string' && key.startsWith('f123::'),
    sinPrefijo: key => key.slice('f123::'.length),
    anunciarEscritura: key => observed.push(key),
  });
  vm.runInContext(realShim, context);
  return { shim: context.shim, native, data, observed };
}

test('real isolation wrapper preserves native setItem failure for caller', () => {
  const f = adapter({ failingWrite: true });
  assert.throws(() => f.shim.setItem('B', 'NEW'), /synthetic storage refusal/);
  assert.equal(f.shim.getItem('B'), 'SYNTHETIC_UNCONFIRMED');
});

test('real isolation wrapper currently swallows failed native removeItem', () => {
  const f = adapter({ failingDelete: true });
  assert.doesNotThrow(() => f.shim.removeItem('B'));
  assert.equal(f.shim.getItem('B'), 'SYNTHETIC_UNCONFIRMED');
  assert.deepEqual(f.observed, [], 'no broadcast if deletion fails');
});

test('real isolation wrapper really deletes and announces on native success', () => {
  const f = adapter();
  f.shim.removeItem('B');
  assert.equal(f.shim.getItem('B'), null);
  assert.deepEqual(f.observed, ['B']);
});
