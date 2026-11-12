const { test } = require('node:test');
const assert = require('node:assert/strict');
const { browser } = require('./helpers/browser.cjs');

test('deshacer una cancelación reciente restaura el asiento original aunque el producto haya vencido', async () => {
  const app = browser();
  app.OCAuth = { rolActual: () => 'dueno' };
  const futuro = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  const ayer = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10);
  const p = await app.request('/api/productos', 'POST', { nombre: 'Perecible de prueba', barcode: 'UNDO-EXP-1', ubicacionId: 'bar', precio: 25, costo: 9, stockInicial: 5, perecible: true, fechaCaducidad: futuro });
  const sold = await app.request(`/api/productos/${p.id}/venta`, 'POST', { cantidad: 2, info: { formaPago: 'cash', notas: 'original' } });
  const original = (await app.request('/api/respaldo/exportar')).ventas.find(v => v.id === sold.ventaId);
  await app.request(`/api/productos/${p.id}`, 'PATCH', { fechaCaducidad: ayer });
  await app.request(`/api/ventas/${original.id}/cancelar`, 'POST', { motivo: 'toque accidental' });
  await assert.rejects(app.request(`/api/productos/${p.id}/venta`, 'POST', { cantidad: 2 }), /expired/i);

  const restaurada = await app.request(`/api/ventas/${original.id}/deshacer-cancelacion`, 'POST', {});
  assert.equal(restaurada.ok, true);
  assert.equal(restaurada.producto.stockActual, 3);
  const ventas = (await app.request('/api/respaldo/exportar')).ventas;
  const nueva = ventas.find(v => v.id === restaurada.ventaId);
  assert.equal(ventas.find(v => v.id === original.id).anulada, true, 'la anulación es histórica y monotónica');
  assert.equal(nueva.restauracionDe, original.id);
  for (const k of ['fecha', 'precioUnit', 'costoUnit', 'cantidad', 'clienteId', 'impuesto', 'modoComision']) assert.deepEqual(nueva[k], original[k], k);
  assert.deepEqual(nueva.info, original.info);
  const otro = browser();
  otro.receive(app);
  const sincronizadas = (await otro.request('/api/respaldo/exportar')).ventas;
  assert.equal(sincronizadas.find(v => v.id === original.id).anulada, true);
  assert.equal(sincronizadas.filter(v => v.restauracionDe === original.id).length, 1);
  assert.equal(sincronizadas.find(v => v.id === restaurada.ventaId).precioUnit, original.precioUnit);
  otro.receive(app);
  assert.equal((await otro.request('/api/respaldo/exportar')).ventas.filter(v => v.restauracionDe === original.id).length, 1, 'sync repetido no duplica el ingreso');
  await assert.rejects(app.request(`/api/ventas/${original.id}/deshacer-cancelacion`, 'POST', {}), /already|restored/i);
  assert.equal((await app.request(`/api/productos/${p.id}`)).stockActual, 3, 'dos toques no descuentan stock dos veces');
});

test('no restaura una venta pagada ni una anulación que no fue cancelación ex-post', async () => {
  const app = browser();
  app.OCAuth = { rolActual: () => 'dueno' };
  const p = await app.request('/api/productos', 'POST', { nombre: 'Producto normal', barcode: 'UNDO-EXP-2', precio: 10, stockInicial: 3 });
  const sold = await app.request(`/api/productos/${p.id}/venta`, 'POST', { cantidad: 1 });
  await app.request(`/api/ventas/${sold.ventaId}/anular`, 'POST', {});
  await assert.rejects(app.request(`/api/ventas/${sold.ventaId}/deshacer-cancelacion`, 'POST', {}), /not eligible|recent/i);
});
