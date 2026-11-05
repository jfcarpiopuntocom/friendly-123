// v668: physical count history remains recoverable; old no-epoch readers cannot
// erase the most recent count. The production store is exercised in isolated memory.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { browser } = require('./helpers/browser.cjs');

async function fixture({ base, epoch, ts, pn, actual }) {
  const w = browser();
  const fx = await w.request('/api/respaldo/exportar');
  const p = fx.productos.find(p => Number(p.stockActual) >= 1);
  assert.ok(p);
  Object.assign(p, { id: 'v668-fixture', nombre: 'Convergent count', stockBase: base,
    stockEpochId: epoch, stockPN: pn, stockTs: ts, stockActual: actual });
  fx.productos = [p]; fx.ventas = []; fx.movimientos = [];
  await w.request('/api/respaldo/importar', 'POST', fx);
  w.OCAuth = { rolActual: () => 'dueno' };
  return w;
}
const read = async w => (await w.request('/api/respaldo/exportar')).productos.find(p => p.id === 'v668-fixture');
function incoming(w, changes) {
  const cat = w.catalog();
  Object.assign(cat.productos.find(p => p.id === 'v668-fixture'), changes);
  w.OCSync.aplicarCatalogo(cat, 'dueno');
}
test('a later legacy count with a different base supersedes an older epoch without erasing witnesses', async () => {
  const w = await fixture({ base: 9, epoch: 'old-epoch', pn: {pc:{add:0,sub:2}}, actual:7, ts:1000 });
  incoming(w, { stockBase: 5, stockEpochId: '', stockPN:{phone:{add:0,sub:1}},
    stockActual:4, stockTs:2000 });
  const p = await read(w);
  assert.equal(p.stockActual, 4); assert.equal(p.stockBase, 5);
  assert.equal(p.stockEvidencias[JSON.stringify([9,'old-epoch'])].pn.pc.sub, 2);
  assert.equal(p.stockEvidencias['5'].pn.phone.sub, 1);
});
test('a legacy movement at the same base is not a fresh physical recount', async () => {
  const w = await fixture({ base: 9, epoch: 'current-epoch', pn: {pc:{add:0,sub:2}}, actual:7, ts:1000 });
  incoming(w, { stockBase: 9, stockEpochId: '', stockPN:{old:{add:0,sub:4}},
    stockActual:5, stockTs:2000 });
  const p = await read(w);
  assert.equal(p.stockActual, 7);
  assert.equal(p.stockEpochId, 'current-epoch');
});
test('new physical count retains the previous PN ledger in exported backup', async () => {
  const w = await fixture({ base: 9, epoch: 'old-epoch', pn: {pc:{add:0,sub:2}}, actual:7, ts:Date.now()-1000 });
  const old = await read(w);
  await w.request('/api/productos/v668-fixture/ajustar', 'POST',
    { stockFisico: 12, motivo: 'QA new physical count' });
  const p = await read(w);
  assert.equal(p.stockActual, 12);
  assert.notEqual(p.stockEpochId, old.stockEpochId);
  assert.deepEqual(JSON.parse(JSON.stringify(p.stockPN)), {});
  assert.equal(p.stockEvidencias[JSON.stringify([9,'old-epoch'])].pn.pc.sub, 2);
  assert.equal(p.stockEvidencias[JSON.stringify([9,'old-epoch'])].base, 9);
});
