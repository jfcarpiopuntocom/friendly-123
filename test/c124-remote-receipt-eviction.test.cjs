'use strict';
// C124: runtime receipt dedup must never evict older opIds before durable proof.
// Run: node --test test/c124-remote-receipt-eviction.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../docs/mock-backend.js'), 'utf8');
test('C124: oldest of 2001 applied remote opIds remains in the active dedup set', () => {
  const start = source.indexOf('  function _marcarOpAplicada(opId) {');
  const end = source.indexOf('\n  // The immutable opId', start);
  assert.ok(start >= 0 && end > start, 'extract production dedup function');
  const code = source.slice(start, end);
  const applied = new Set();
  const sandbox = {
    _cargarOpsAplicadas: () => applied,
    OPS_APLICADAS_KEY: 'test',
    localStorage: { setItem() { throw new Error('quota full'); } },
  };
  vm.runInNewContext(code + '\nthis.mark = _marcarOpAplicada;', sandbox);
  for (let i = 0; i < 2001; i++) sandbox.mark('remote-stock:' + i);
  assert.equal(applied.size, 2001);
  assert.ok(applied.has('remote-stock:0'), 'oldest receipt cannot be forgotten and replayed');
});
