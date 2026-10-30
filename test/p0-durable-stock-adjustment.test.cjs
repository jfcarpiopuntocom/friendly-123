'use strict';
// Synthetic only: manual stock corrections must be durable before peer publication.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { browser } = require('./helpers/browser.cjs');

const snapshot = async w => w.request('/api/respaldo/exportar');
const adjust = (w, delta) => w.fetch('/api/productos/p24/ajustar', {
  method: 'POST', body: JSON.stringify({ delta, motivo: 'synthetic physical count' })
});
const awaitPending = async fn => {
  for (let n = 0; n < 150 && !fn(); n++) await Promise.resolve();
  assert.ok(fn(), 'strict durable write must be started before response');
};

test('manual stock adjustment is not visible or emitted until strict durable ACK', async () => {
  const w = browser();
  w.localStorage.setItem('f123_device_id', 'fixture-adjust-device');
  const before = await snapshot(w);
  const old = before.productos.find(p => p.id === 'p24');
  let pending, emitted = 0;
  w.OCSyncEmit = () => { emitted++; return true; };
  w.OCEstadoIDB = { guardar: (state, strict) => new Promise(resolve => {
    pending = { state, strict, resolve };
  }) };
  const originalSetItem = w.localStorage.setItem;
  w.localStorage.setItem = () => { throw Error('synthetic quota'); };
  try {
    const inFlight = adjust(w, +2);
    await awaitPending(() => !!pending);
    assert.equal(pending.strict, true, 'manual correction must require strict persistence');
    assert.equal(emitted, 0, 'stock operation must not be sent before durable commit');
    assert.equal(w.OCSync.catalogoPropio(), null, 'pending correction is not a publishable catalog');
    const staged = pending.state.productos.find(p => p.id === 'p24');
    assert.equal(staged.stockActual, old.stockActual + 2);
    assert.equal(staged.stockPN['fixture-adjust-device'].add, 2, 'movement counter enters the exact ACK snapshot');
    pending.resolve(true);
    const response = await inFlight;
    assert.equal(response.status, 200);
    assert.equal(emitted, 1, 'send exactly one adjustment after ACK');
    const final = await snapshot(w);
    assert.equal(final.productos.find(p => p.id === 'p24').stockActual, old.stockActual + 2);
    assert.equal(final.movimientos.length, before.movimientos.length + 1);
  } finally {
    w.localStorage.setItem = originalSetItem;
    delete w.OCEstadoIDB;
  }
});

test('rejected manual stock correction rolls back stock, PN and audit; no ghost peer event', async () => {
  const w = browser();
  w.localStorage.setItem('f123_device_id', 'fixture-adjust-device');
  const before = await snapshot(w);
  let emitted = 0;
  w.OCSyncEmit = () => { emitted++; return true; };
  w.OCEstadoIDB = { guardar: () => Promise.resolve(false) };
  const originalSetItem = w.localStorage.setItem;
  w.localStorage.setItem = () => { throw Error('synthetic quota'); };
  let response;
  try { response = await adjust(w, -2); }
  finally { w.localStorage.setItem = originalSetItem; delete w.OCEstadoIDB; }
  assert.equal(response.status, 507, 'rejected storage must not confirm a stock correction');
  const after = await snapshot(w);
  const old = before.productos.find(p => p.id === 'p24');
  const now = after.productos.find(p => p.id === 'p24');
  assert.equal(now.stockActual, old.stockActual);
  for (const field of ['stockBase', 'stockPN', 'stockTs', 'stockDeficit']) {
    assert.deepEqual(now[field], old[field], 'rollback '+field);
    assert.equal(Object.hasOwn(now, field), Object.hasOwn(old, field), 'preserve missing metadata '+field);
  }
  assert.equal(after.movimientos.length, before.movimientos.length, 'no ghost audit event');
  assert.equal(after.selloUltimo, before.selloUltimo, 'audit seal remains unchanged');
  assert.equal(emitted, 0, 'failed correction cannot escape to another device');
});
