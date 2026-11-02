const { test } = require('node:test');
const assert = require('node:assert/strict');
const { browser } = require('./helpers/browser.cjs');

// Reproduced in real browsers: the first device to join saw 5/6/7, the next ones 0/0/0 for good, because the old relay
// checkpoint delivered the product at 0 before Yjs and the stockTs tie then kept that 0.
async function montar(extra) {
  const source = browser(), dest = browser();
  const fixture = await source.request('/api/respaldo/exportar');
  const shelf = { ...fixture.ubicaciones[0], id: 'shelf-frio', nombre: 'Shelf' };
  const product = { ...fixture.productos[0], id: 'prod-frio', nombre: 'Frio', sku: 'FRIO', barcode: 'FRIO-1', ubicacionId: shelf.id, stockActual: 5, stockEpochId: 'stock-epoch-frio', stockTs: 0, stockBase: null, stockPN: null, ...extra };
  await dest.request('/api/instancia/activar', 'POST', { instanceId: 'fixture-dest-frio', vaciar: true });
  dest.OCSync.aplicarCheckpoint({ ubicaciones: [{ id: shelf.id, nombre: shelf.nombre, activa: true }], productos: [{ id: product.id, nombre: product.nombre, sku: product.sku, barcode: product.barcode, ubicacionId: shelf.id, stockActual: 0 }], clientes: [] });
  const stock = async () => (await dest.request('/api/respaldo/exportar')).productos.find(p => p.id === product.id);
  assert.equal((await stock()).stockActual, 0, 'precondition: the checkpoint left it at 0');
  return { dest, stock, shelf, product };
}
const llega = (dest, shelf, product, cambios) => dest.OCSync.aplicarCatalogo({ ubicaciones: [shelf], productos: [{ ...product, ...cambios }], actividad: [] }, null);

test('a product that came at 0 from the checkpoint takes the shared stock on a stamp tie', async () => {
  const { dest, stock, shelf, product } = await montar();
  llega(dest, shelf, product);
  assert.equal((await stock()).stockActual, 5);
});

test('a real count of 0 here is kept: it created a base, so it is a fact', async () => {
  const { dest, stock, shelf, product } = await montar();
  const p = await stock();
  await dest.request(`/api/productos/${p.id}/stock`, 'PATCH', { stockActual: 0 }).catch(() => {});
  dest.OCSync.aplicarCatalogo({ ubicaciones: [shelf], productos: [{ ...product, stockBase: 5, stockPN: { other: { add: 0, sub: 5 } }, stockActual: 0, stockTs: 1 }], actividad: [] }, null);
  assert.equal((await stock()).stockActual, 0);
});

test('a remote stamp older than the local one does not win', async () => {
  const { dest, stock, shelf, product } = await montar();
  llega(dest, shelf, product, { stockEpochId: '', stockActual: 0, stockTs: 2000 });
  assert.equal(Number((await stock()).stockTs), 2000, 'precondition: the local stamp is now 2000');
  llega(dest, shelf, product, { stockEpochId: '', stockActual: 5, stockTs: 1000 });
  assert.equal((await stock()).stockActual, 0);
});

test('a positive local stock is not touched by this path', async () => {
  const { dest, stock, shelf, product } = await montar();
  llega(dest, shelf, product);
  llega(dest, shelf, product, { stockActual: 9 });
  assert.equal((await stock()).stockActual, 5);
});
