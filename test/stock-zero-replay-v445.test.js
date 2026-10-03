const { test } = require('node:test');
const assert = require('node:assert/strict');
const { browser } = require('./helpers/browser.cjs');

async function fixtureWithStock(w, id, stock) {
  const fx = await w.request('/api/respaldo/exportar');
  const p = fx.productos.find((x) => Number(x.stockActual) >= 10);
  p.id = id;
  p.stockActual = stock;
  p.stockTs = 1000;
  delete p.stockBase;
  delete p.stockPN;
  delete p.stockDeficit;
  fx.productos = [p];
  fx.ventas = [];
  fx.movimientos = [];
  await w.request('/api/respaldo/importar', 'POST', fx);
  return p;
}

test('v445: stale legacy remote zero cannot erase positive local inventory', async () => {
  const w = browser();
  const p = await fixtureWithStock(w, 'p-v445-legacy-zero', 9);
  const remote = w.catalog();
  const rp = remote.productos.find((x) => x.id === p.id);
  rp.stockActual = 0;
  rp.stockTs = Date.now() + 24 * 60 * 60 * 1000; // simulates a device clock ahead
  rp.stockBase = null;
  rp.stockPN = null;

  w.OCSync.aplicarCatalogo(remote, null);

  const state = await w.request('/api/respaldo/exportar');
  assert.equal(state.productos.find((x) => x.id === p.id).stockActual, 9);
});

test('v445: a real zero backed by the stock ledger still converges', async () => {
  const w = browser();
  const p = await fixtureWithStock(w, 'p-v445-real-zero', 1);
  const remote = w.catalog();
  const rp = remote.productos.find((x) => x.id === p.id);
  rp.stockActual = 0;
  rp.stockTs = Date.now() + 1000;
  rp.stockBase = 1;
  rp.stockPN = { 'fixture-device': { add: 0, sub: 1 } };

  w.OCSync.aplicarCatalogo(remote, null);

  const state = await w.request('/api/respaldo/exportar');
  assert.equal(state.productos.find((x) => x.id === p.id).stockActual, 0);
});

test('v445: new stock changes use relay time when a common clock exists', async () => {
  const w = browser();
  const p = await fixtureWithStock(w, 'p-v445-relay-clock', 5);
  w.OCLatencia = { ahoraRelay: () => 1234567890123 };

  await w.request('/api/productos/' + p.id + '/ajustar', 'POST', { delta: 1, motivo: 'fixture' });

  const state = await w.request('/api/respaldo/exportar');
  const actual = state.productos.find((x) => x.id === p.id);
  assert.equal(actual.stockActual, 6);
  assert.equal(actual.stockTs, 1234567890123);
});
