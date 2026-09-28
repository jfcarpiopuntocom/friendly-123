const { test } = require('node:test');
const assert = require('node:assert/strict');
const { browser } = require('./helpers/browser.cjs');

test('deleted empty racks disappear, but sales in the selected month remain visible', async () => {
  const w = browser();
  w.OCAuth = { rolActual: () => 'dueno' };
  const empty = await w.request('/api/ubicaciones', 'POST', { nombre: 'Deleted empty', tipo: 'socio' });
  const sold = await w.request('/api/ubicaciones', 'POST', { nombre: 'Deleted with sales', tipo: 'socio', comisionSocio: 30 });
  const item = await w.request('/api/productos', 'POST', { nombre: 'Art', barcode: 'IDIO-1', precio: 20, costo: 5, stockInicial: 2, ubicacionId: sold.id });
  await w.request(`/api/productos/${item.id}/venta`, 'POST', { cantidad: 1 });
  await w.request(`/api/ubicaciones/${empty.id}`, 'DELETE');
  await w.request(`/api/ubicaciones/${sold.id}`, 'DELETE');
  const rows = await w.request('/api/liquidaciones');
  assert.ok(!rows.some(x => x.ubicacionId === empty.id));
  const historical = rows.find(x => x.ubicacionId === sold.id);
  assert.equal(historical.ventasBrutas, 20);
  assert.equal(historical.comisionSocio, 6);
  assert.equal(historical.ventasPendientes, 1);
});

test('own rack with sales appears by rack without inventing a commission', async () => {
  const w = browser();
  w.OCAuth = { rolActual: () => 'dueno' };
  const rack = await w.request('/api/ubicaciones', 'POST', { nombre: 'My rack', tipo: 'propio' });
  const item = await w.request('/api/productos', 'POST', { nombre: 'Book', barcode: 'IDIO-2', precio: 25, costo: 8, stockInicial: 2, ubicacionId: rack.id });
  await w.request(`/api/productos/${item.id}/venta`, 'POST', { cantidad: 1 });
  const row = (await w.request('/api/liquidaciones')).find(x => x.ubicacionId === rack.id);
  assert.equal(row.ventasCasa.ventas, 1);
  assert.equal(row.ventasCasa.monto, 25);
  assert.equal(row.comisionSocio, 0);
  assert.equal(row.estado, 'sin ventas'); // UI labels this as house-only, not no sales.
});
