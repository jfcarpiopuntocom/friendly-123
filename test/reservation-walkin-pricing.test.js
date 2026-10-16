const { test } = require('node:test');
const assert = require('node:assert/strict');
const { browser } = require('./helpers/browser.cjs');
async function setup(extra = {}) {
  const app = browser(); app.OCAuth = { rolActual: () => 'dueno' };
  const rack = await app.request('/api/ubicaciones', 'POST', { nombre: 'Synthetic class', tipo: 'socio', comisionSocio: 40 });
  const product = await app.request('/api/productos', 'POST', { nombre: 'Synthetic class ticket', barcode: 'SYNTHETIC-PRICE', precio: 18, precioReserva: 15, precioWalkIn: 18, costo: 2, stockInicial: 20, ubicacionId: rack.id, tipoProducto: 'ticket', ...extra });
  return { app, product };
}
const sell = (s, body) => s.app.request('/api/productos/' + s.product.id + '/venta', 'POST', body);

test('reservation and walk-in use their chosen price for frozen commission, tax and shared stock', async () => {
  const s = await setup();
  assert.equal(s.product.precioReserva, 15); assert.equal(s.product.precioWalkIn, 18);
  await s.app.request('/api/config/impuesto', 'PUT', { activo: true, tasa: 15, modo: 'agregado', nombre: 'Synthetic tax' });
  await assert.rejects(() => sell(s, { cantidad: 1 }), /400/);
  await assert.rejects(() => sell(s, { cantidad: 1, modalidadVenta: 'invalid' }), /400/);
  const a = await sell(s, { cantidad: 2, modalidadVenta: 'reservation' });
  const b = await sell(s, { cantidad: 1, modalidadVenta: 'walk-in' });
  let catalog = s.app.catalog();
  const reserve = catalog.ventas.find(v => v.id === a.ventaId), walk = catalog.ventas.find(v => v.id === b.ventaId);
  assert.equal(reserve.precioUnit, 15); assert.equal(reserve.modalidadVenta, 'reservation');
  assert.equal(reserve.split.montoComisionSocio, 12); assert.equal(reserve.impuesto.monto, 4.5);
  assert.equal(walk.precioUnit, 18); assert.equal(walk.split.montoComisionSocio, 7.2);
  assert.equal(catalog.productos.find(p => p.id === s.product.id).stockActual, 17);
  await s.app.request('/api/productos/' + s.product.id, 'PATCH', { precioReserva: 17, precioWalkIn: 22 });
  const peer = browser(); peer.receive(s.app); catalog = peer.catalog();
  assert.equal(catalog.productos.find(p => p.id === s.product.id).precioReserva, 17);
  assert.equal(catalog.ventas.find(v => v.id === a.ventaId).precioUnit, 15);
  assert.equal(catalog.ventas.find(v => v.id === a.ventaId).modalidadVenta, 'reservation');
});

test('old single-price products keep their sale contract, optional rates validate atomically', async () => {
  const s = await setup({ precioReserva: null, precioWalkIn: null });
  await sell(s, { cantidad: 1 });
  assert.equal(s.app.catalog().ventas.find(v => v.productoId === s.product.id).precioUnit, 18);
  for (const price of [-1, 'invalid', false]) {
    await assert.rejects(() => s.app.request('/api/productos/' + s.product.id, 'PATCH', { nombre: 'Must not change', precioReserva: price }), /400/);
  }
  assert.equal((await s.app.request('/api/productos/' + s.product.id)).nombre, s.product.nombre);
  await s.app.request('/api/productos/' + s.product.id, 'PATCH', { precioReserva: 0, precioWalkIn: '' });
  const receipt = await sell(s, { cantidad: 1, modalidadVenta: 'reservation' });
  assert.equal(s.app.catalog().ventas.find(v => v.id === receipt.ventaId).precioUnit, 0);
  await assert.rejects(() => sell(s, { modalidadVenta: 'walk-in' }), /400/);
});

test('Events canonical alias preserves historical categories and safely handles later rename', async () => {
  const s = await setup({ categoria: 'Tickets and events' });
  assert.equal(s.product.categoria, 'Events');
  const backup = await s.app.request('/api/respaldo/exportar');
  backup.productos.find(p => p.id === s.product.id).categoria = 'Tickets & events';
  await s.app.request('/api/respaldo/importar', 'POST', backup);
  assert.equal((await s.app.request('/api/respaldo/exportar')).productos.find(p => p.id === s.product.id).categoria, 'Tickets & events', 'reading old data never rewrites history');
  const expected = backup.productos.filter(p => /^(tickets\s*(?:&|and)\s*events|events)$/i.test(p.categoria || '')).length;
  const result = await s.app.request('/api/categorias/cambiar', 'POST', { vieja: 'Events', nueva: 'Workshops' });
  assert.equal(result.actualizados, expected);
  assert.equal((await s.app.request('/api/productos/' + s.product.id)).categoria, 'Workshops');
});
