const { test } = require('node:test');
const assert = require('node:assert/strict');
const { browser } = require('./helpers/browser.cjs');

// Synthetic regression for the customer-reported wrong quantities after v749.
// A structurally plausible witness for ANOTHER epoch is not proof of a
// physical recount for this epoch. Never mutate a real customer's data.
test('P0: unrelated prior-ledger witness cannot turn a known positive balance into zero', async () => {
  const w = browser();
  const fx = await w.request('/api/respaldo/exportar');
  const p = fx.productos.find(x => Number(x.stockActual) >= 10);
  assert.ok(p, 'synthetic fixture needs a stock-bearing product');
  p.id = 'synthetic-belen-mismatched-count-witness';
  p.stockActual = 9;
  p.stockTs = 1000;
  delete p.stockBase;
  delete p.stockPN;
  delete p.stockEpochId;
  delete p.stockCountWitness;
  fx.productos = [p];
  fx.ventas = [];
  fx.movimientos = [];
  await w.request('/api/respaldo/importar', 'POST', fx);

  const remote = w.catalog();
  const rp = remote.productos.find(x => x.id === p.id);
  Object.assign(rp, {
    stockActual: 0, stockTs: 3000, stockBase: 0, stockPN: {},
    stockEpochId: 'remote-epoch', stockCountTs: 3000,
    stockCountWitness: { epoch: 'unrelated-prior-epoch', base: 9, pn: {} }
  });
  w.OCSync.aplicarCatalogo(remote, null);
  const state = await w.request('/api/respaldo/exportar');
  const actual = state.productos.find(x => x.id === p.id);
  assert.equal(actual.stockActual, 9, 'unrelated witness cannot authorize remote zero');
});
