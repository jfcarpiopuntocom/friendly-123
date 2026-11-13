// v759 (JFC: «manda el último conteo físico del dueño o admin; nunca se asume un valor»).
// A known local balance is replaced only by a recount whose witness names THIS history.
// Synthetic fixtures only; never a real customer's data.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { browser } = require('./helpers/browser.cjs');

async function legacy9(w, id) {
  const fx = await w.request('/api/respaldo/exportar');
  const p = fx.productos.find((x) => Number(x.stockActual) >= 10);
  p.id = id; p.stockActual = 9; p.stockTs = 1000;
  ['stockBase', 'stockPN', 'stockDeficit', 'stockEpochId', 'stockCountWitness', 'stockCountTs', 'stockEvidencias']
    .forEach((k) => delete p[k]);
  fx.productos = [p]; fx.ventas = []; fx.movimientos = [];
  await w.request('/api/respaldo/importar', 'POST', fx);
  return p;
}
async function merged(id, remoteFields) {
  const w = browser();
  await legacy9(w, id);
  const remote = w.catalog();
  Object.assign(remote.productos.find((x) => x.id === id), remoteFields);
  w.OCSync.aplicarCatalogo(remote, null);
  return (await w.request('/api/respaldo/exportar')).productos.find((x) => x.id === id);
}

test('v759 (#710): a newer remote epoch WITHOUT witness cannot turn a known 9 into 1', async () => {
  const p = await merged('v759-sin-testigo-1', { stockActual: 1, stockTs: Date.now() + 1000, stockBase: 1,
    stockPN: {}, stockEpochId: 'unwitnessed-positive', stockCountWitness: null });
  assert.equal(p.stockActual, 9);
});

test('v759 (#711): a witness of ANOTHER history cannot turn a known 9 into 0', async () => {
  const p = await merged('v759-otra-historia-0', { stockActual: 0, stockTs: 3000, stockBase: 0, stockPN: {},
    stockEpochId: 'remote-epoch', stockCountTs: 3000,
    stockCountWitness: { epoch: 'unrelated-prior-epoch', base: 9, pn: {} } });
  assert.equal(p.stockActual, 9);
});

// What the owner/admin recount writes (mock-backend.js, conteo físico) when the counted
// product had no epoch yet: witness = { base: null, epoch: "", pn: {} }.
const testigoLegitimo = { base: null, epoch: '', pn: {} };

test('v759: a legitimate owner recount 9 -> 1 IS accepted', async () => {
  const p = await merged('v759-recuento-1', { stockActual: 1, stockTs: 3000, stockBase: 1, stockPN: {},
    stockEpochId: 'stock-epoch-legit-1', stockCountTs: 3000, stockCountWitness: testigoLegitimo });
  assert.equal(p.stockActual, 1);
  assert.equal(p.stockEpochId, 'stock-epoch-legit-1');
});

test('v759: a legitimate owner recount to a real 0 IS accepted', async () => {
  const p = await merged('v759-recuento-0', { stockActual: 0, stockTs: 3000, stockBase: 0, stockPN: {},
    stockEpochId: 'stock-epoch-legit-0', stockCountTs: 3000, stockCountWitness: testigoLegitimo });
  assert.equal(p.stockActual, 0);
});

test('v759: sales made after a legitimate recount add on top of it', async () => {
  const p = await merged('v759-recuento-mas-venta', { stockActual: 4, stockTs: 4000, stockBase: 5,
    stockPN: { 'device-b': { add: 0, sub: 1 } }, stockEpochId: 'stock-epoch-legit-5', stockCountTs: 3000,
    stockCountWitness: testigoLegitimo });
  assert.equal(p.stockActual, 4);
});
