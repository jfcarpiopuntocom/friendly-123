'use strict';
// P0 Ponytail: local performance evidence only. No user data, telemetry or mutations.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../docs/mock-backend.js'), 'utf8');
const first = source.indexOf('  var _f123PerfLocalRegistros =');
const last = source.indexOf('  function _guardarMergeInmediatoSeguro()', first);
assert.ok(first > 0 && last > first, 'local perf helper exists in the actual shipped backend');
const helper = source.slice(first, last);

function ctx(enabled) {
  let time = 10;
  const store = enabled ? '1' : null;
  const w = {};
  const context = { window: w, sessionStorage: { getItem: k => {
    assert.equal(k, 'f123_perf_local'); return store;
  } }, performance: { now: () => time } };
  vm.runInNewContext(helper, context);
  return { context, w, advance: n => { time += n; } };
}
test('opt-in only: default device performs no record allocation, even when measured', () => {
  const o = ctx(false), started = o.context._perfLocalInicio();
  o.advance(5500);
  o.context._perfLocalFin('strict_idb', started, false);
  assert.deepEqual(Array.from(o.w.OCPerfLocal.leer()), []);
});
test('only whitelisted stage, milliseconds and success bit; never business data', () => {
  const o = ctx(true), start = o.context._perfLocalInicio();
  o.advance(125.5);
  o.context._perfLocalFin('strict_idb', start, true, { license: 'SECRET', stock: 33, product: 'PRIVATE' });
  o.context._perfLocalFin('unknown', start, false);
  const value = JSON.parse(JSON.stringify(o.w.OCPerfLocal.leer()));
  assert.deepEqual(value, [{ etapa:'strict_idb', ms:126, ok:true }]);
  assert.doesNotMatch(JSON.stringify(value), /SECRET|PRIVATE|stock|license|product|33/);
  value[0].ms = 777;
  assert.equal(o.w.OCPerfLocal.leer()[0].ms, 126, 'reader must return copies');
});
test('failed strict local save is recorded as failure, never as a successful receipt', () => {
  const o = ctx(true), started = o.context._perfLocalInicio();
  o.advance(4000);
  o.context._perfLocalFin('strict_commit', started, false);
  assert.deepEqual(JSON.parse(JSON.stringify(o.w.OCPerfLocal.leer())),
    [{ etapa:'strict_commit', ms:4000, ok:false }]);
});
test('bounded ring prevents local diagnostics growing with a long-running business', () => {
  const o = ctx(true);
  for (let i = 0; i < 170; i++) {
    const started = o.context._perfLocalInicio();
    o.advance(1);
    o.context._perfLocalFin('snapshot_serialize', started, true);
  }
  assert.equal(o.w.OCPerfLocal.leer().length, 120);
  o.w.OCPerfLocal.limpiar();
  assert.equal(o.w.OCPerfLocal.leer().length, 0);
});
test('real strict path measures queue, serialization, IDB and total outcome without touching CAS', () => {
  assert.match(source, /_perfLocalFin\('prior_save_wait'/);
  assert.match(source, /_perfLocalFin\('snapshot_serialize'/);
  assert.match(source, /_perfLocalFin\('strict_idb'/);
  assert.match(source, /_perfLocalFin\('strict_commit'/);
  assert.match(source, /idb\.guardarConRevision\(completo, _localRev\)/);
  assert.match(source, /if \(!guardado\)\s*\{\s*revertir\(\);/);
});


test('Node/VM without window: optional diagnostics cannot break backend module initialization', () => {
  const context = { sessionStorage: { getItem: () => null }, performance: { now: () => 0 } };
  assert.doesNotThrow(() => vm.runInNewContext(helper, context),
    'headless financial and retention fixtures have no window global');
});
