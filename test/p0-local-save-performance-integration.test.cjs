'use strict';
// Integration: the actual offline browser fixture runs docs/mock-backend.js.
// No real license, product, remote relay or business data is read/written.
const test = require('node:test');
const assert = require('node:assert/strict');
const { browser } = require('./helpers/browser.cjs');

function startFixture() {
  const w = browser();
  w.sessionStorage.setItem('f123_perf_local', '1');
  let now = 0;
  w.performance = { now: () => { now += 13; return now; } };
  w.localStorage.setItem('f123_device_id', 'synthetic-perf-device');
  let emitted = 0;
  w.OCSyncEmit = () => { emitted++; return true; };
  const events = () => JSON.parse(JSON.stringify(w.OCPerfLocal.leer()));
  return { w, events, emitted: () => emitted };
}
const state = w => w.request('/api/respaldo/exportar');
const adjust = (w, delta) => w.fetch('/api/productos/p24/ajustar', {
  method:'POST', body:JSON.stringify({ delta, motivo:'synthetic-only' })
});

test('offline strict-ACK success emits exactly one stock movement and PII-free timings', async () => {
  const {w,events,emitted} = startFixture();
  const before = await state(w), old = before.productos.find(p => p.id === 'p24');
  w.OCEstadoIDB = { guardarConRevision: () => Promise.resolve(true) };
  const response = await adjust(w,+2);
  assert.equal(response.status, 200);
  const after = await state(w);
  assert.equal(after.productos.find(p => p.id === 'p24').stockActual, old.stockActual+2);
  assert.equal(after.movimientos.length, before.movimientos.length+1);
  assert.equal(emitted(),1,'one outbound op only after local strict ACK');
  const recorded = events();
  for (const stage of ['snapshot_serialize','strict_idb','strict_commit']) {
    assert.ok(recorded.some(e => e.etapa === stage && e.ok === true),
      'missing successful local stage: '+stage);
  }
  assert.ok(recorded.every(e => Object.keys(e).sort().join(',') === 'etapa,ms,ok'));
  assert.doesNotMatch(JSON.stringify(recorded), /p24|synthetic-perf-device|synthetic-only|stockActual/);
});

test('offline strict-ACK refusal keeps original stock/audit, sends zero ops, records NOT saved', async () => {
  const {w,events,emitted} = startFixture();
  const before = await state(w);
  w.OCEstadoIDB = { guardarConRevision: () => Promise.resolve(false) };
  const response = await adjust(w,+2);
  assert.equal(response.status,503,'nonquota CAS refusal is an unconfirmed durable save, not device quota');
  assert.equal((await response.json()).code,'STOCK_DURABILITY_UNCONFIRMED');
  const after = await state(w);
  const old = before.productos.find(p => p.id === 'p24');
  assert.equal(after.productos.find(p => p.id === 'p24').stockActual,old.stockActual);
  assert.equal(after.movimientos.length,before.movimientos.length);
  assert.equal(emitted(),0,'never publish refused local correction');
  const recorded = events();
  for (const stage of ['strict_idb','strict_commit']) {
    assert.ok(recorded.some(e => e.etapa === stage && e.ok === false),
      'missing negative local stage: '+stage);
  }
  assert.ok(!recorded.some(e => e.etapa === 'strict_commit' && e.ok),
    'a rejected strict commit must never be recorded successful');
});
