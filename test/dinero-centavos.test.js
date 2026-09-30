// DINERO EN CENTAVOS ENTEROS (JFC 2026-09-29, DDIA 4: "auditar y corregir").
// Auditoria con el arnes: gastos ya redondeaban (19.999 -> 20), pero precio, costo y
// precio de casa del producto se guardaban CRUDOS (10.005, 3.3333), asi que una venta
// de 3 unidades daba un bruto de 30.015 y el split/reportes arrastraban fracciones.
// Pruebas escritas antes del arreglo: 1-4 rojas en v424; 5 es de FIJACION (ya era asi).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { browser } = require('./helpers/browser.cjs');

const esCentavo = (n) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-9;
const exportar = (w) => w.request('/api/respaldo/exportar');

test('1. crear producto: precio, costo y precio de casa se guardan en centavos (half-up)', async () => {
  const w = browser();
  await w.request('/api/productos', 'POST', { nombre: 'Aud', barcode: 'AUD1', precio: 10.005, costo: 3.3333, precioCasa: 7.994, stockInicial: 20, umbralRojo: 2, umbralAmarillo: 5 });
  const p = (await exportar(w)).productos.find((x) => x.barcode === 'AUD1');
  assert.equal(p.precio, 10.01, '10.005 sube a 10.01 (mitad hacia arriba)');
  assert.equal(p.costo, 3.33);
  assert.equal(p.precioCasa, 7.99);
});

test('2. editar producto: mismos redondeos al cambiar precio/costo/precio de casa', async () => {
  const w = browser();
  await w.request('/api/productos', 'POST', { nombre: 'Aud2', barcode: 'AUD2', precio: 5, costo: 2, stockInicial: 10, umbralRojo: 2, umbralAmarillo: 5 });
  let p = (await exportar(w)).productos.find((x) => x.barcode === 'AUD2');
  await w.request('/api/productos/' + p.id, 'PATCH', { precio: 12.345, costo: 0.1 + 0.2, precioCasa: 9.999 });
  p = (await exportar(w)).productos.find((x) => x.barcode === 'AUD2');
  assert.equal(p.precio, 12.35);
  assert.equal(p.costo, 0.3, '0.1+0.2 no puede quedar como 0.30000000000000004');
  assert.equal(p.precioCasa, 10);
});

test('3. venta con precio ajustado: el precio de la venta queda en centavos y el bruto tambien', async () => {
  const w = browser();
  await w.request('/api/productos', 'POST', { nombre: 'Aud3', barcode: 'AUD3', precio: 5, costo: 2, stockInicial: 10, umbralRojo: 2, umbralAmarillo: 5 });
  const p = (await exportar(w)).productos.find((x) => x.barcode === 'AUD3');
  await w.request('/api/productos/' + p.id + '/venta', 'POST', { cantidad: 3, info: { precioOverride: 4.3333 } });
  const v = (await exportar(w)).ventas.filter((x) => x.productoId === p.id).pop();
  assert.equal(v.precioUnit, 4.33);
  assert.ok(esCentavo(v.precioUnit * v.cantidad), 'bruto de la venta en centavos: ' + v.precioUnit * v.cantidad);
});

test('4. ningun campo de dinero de producto/venta/gasto queda con fracciones de centavo', async () => {
  const w = browser();
  await w.request('/api/productos', 'POST', { nombre: 'Aud4', barcode: 'AUD4', precio: 19.999, costo: 1.0049, stockInicial: 5, umbralRojo: 1, umbralAmarillo: 2 });
  const p = (await exportar(w)).productos.find((x) => x.barcode === 'AUD4');
  await w.request('/api/productos/' + p.id + '/venta', 'POST', { cantidad: 3 });
  await w.request('/api/gastos', 'POST', { concepto: 'x', monto: 19.999, categoria: 'other' });
  const ex = await exportar(w);
  const pp = ex.productos.find((x) => x.barcode === 'AUD4');
  const vv = ex.ventas.filter((x) => x.productoId === pp.id).pop();
  for (const [k, n] of [['precio', pp.precio], ['costo', pp.costo], ['precioUnit', vv.precioUnit], ['costoUnit', vv.costoUnit], ['gasto', ex.gastos.pop().monto]]) {
    assert.ok(esCentavo(n), k + ' = ' + n + ' no esta en centavos');
  }
});

test('5. FIJACION: montos ya redondos no cambian (el redondeo no toca datos limpios)', async () => {
  const w = browser();
  await w.request('/api/productos', 'POST', { nombre: 'Aud5', barcode: 'AUD5', precio: 12.5, costo: 4, precioCasa: 9.99, stockInicial: 5, umbralRojo: 1, umbralAmarillo: 2 });
  const p = (await exportar(w)).productos.find((x) => x.barcode === 'AUD5');
  assert.equal(p.precio, 12.5); assert.equal(p.costo, 4); assert.equal(p.precioCasa, 9.99);
});
