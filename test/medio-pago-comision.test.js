/* Medio de pago al liquidar comisiones (JFC 2026-09-24, benchmark #4).
   Aditivo: marcar-pagado acepta medioPago opcional y lo sella en cada venta
   pagada (medioPagoComision), en los ajustes y en la bitacora. Sin medioPago
   se comporta como antes. Viaja por sync con la venta sellada. Rojo contra v390. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { browser } = require('./helpers/browser.cjs');

async function tienda(app) {
  app.OCAuth = { rolActual: () => 'dueno' };
  const shelf = await app.request('/api/ubicaciones', 'POST', { nombre: 'Pay shelf', tipo: 'socio', comisionSocio: 40 });
  const product = await app.request('/api/productos', 'POST', { nombre: 'Pay print', sku: 'PAY-1', barcode: 'PAY-1', precio: 50, costo: 10, stockInicial: 10, ubicacionId: shelf.id });
  return { shelf, product };
}
const ventas = async (app, product) => (await app.request('/api/respaldo/exportar')).ventas.filter(v => v.productoId === product.id);

test('marcar pagado con medio: queda sellado en cada venta pagada y en la respuesta', async () => {
  const app = browser(); const { shelf, product } = await tienda(app);
  await app.request(`/api/productos/${product.id}/venta`, 'POST', { cantidad: 1 });
  await app.request(`/api/productos/${product.id}/venta`, 'POST', { cantidad: 2 });
  const r = await app.request(`/api/liquidaciones/${shelf.id}/marcar-pagado`, 'POST', { medioPago: 'transferencia' });
  assert.equal(r.medioPago, 'transferencia');
  for (const v of await ventas(app, product)) { assert.equal(v.liquidada, true); assert.equal(v.medioPagoComision, 'transferencia'); }
});

test('sin medio: igual que antes (null); medio desconocido cae a "otro"', async () => {
  const app = browser(); const { shelf, product } = await tienda(app);
  await app.request(`/api/productos/${product.id}/venta`, 'POST', { cantidad: 1 });
  await app.request(`/api/liquidaciones/${shelf.id}/marcar-pagado`, 'POST', {});
  assert.equal((await ventas(app, product))[0].medioPagoComision ?? null, null);
  await app.request(`/api/productos/${product.id}/venta`, 'POST', { cantidad: 1 });
  await app.request(`/api/liquidaciones/${shelf.id}/marcar-pagado`, 'POST', { medioPago: '<script>' });
  assert.equal((await ventas(app, product)).pop().medioPagoComision, 'otro');
});

test('el medio viaja por sync y un pago posterior no pisa el medio de ventas ya pagadas', async () => {
  const A = browser(); const { shelf, product } = await tienda(A);
  await A.request(`/api/productos/${product.id}/venta`, 'POST', { cantidad: 1 });
  await A.request(`/api/liquidaciones/${shelf.id}/marcar-pagado`, 'POST', { medioPago: 'efectivo' });
  const B = browser(); B.OCAuth = { rolActual: () => 'dueno' }; B.receive(A);
  assert.equal((await ventas(B, product))[0].medioPagoComision, 'efectivo');
  await B.request(`/api/productos/${product.id}/venta`, 'POST', { cantidad: 1 });
  await B.request(`/api/liquidaciones/${shelf.id}/marcar-pagado`, 'POST', { medioPago: 'credito-tienda' });
  A.receive(B); B.receive(A);
  for (const X of [A, B]) {
    const vs = await ventas(X, product);
    assert.equal(vs[0].medioPagoComision, 'efectivo', 'la primera sigue en efectivo');
    assert.equal(vs[1].medioPagoComision, 'credito-tienda');
  }
});
