/* Bloque 3 del PLAN-BLOQUES-2026-09-24 (JFC, aprobado): COMISION SOBRE EL MARGEN.
   Antes la comision SIEMPRE se calculaba sobre el bruto (precio x cantidad).
   Un negocio que reparte "el 40% de lo que se gana" (precio - costo) no tenia
   como decirlo y pagaba de mas. Ahora la percha (o la persona) puede declarar
   baseComision: "bruto" (default, nada cambia para nadie) | "margen".
   Invariante que NUNCA se rompe: comision + neto == bruto, al centavo.
   Aditivo: sin schemaVersion nuevo; una app vieja ignora el campo y sigue en bruto. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { browser } = require('./helpers/browser.cjs');

async function tienda(app, extraPercha) {
  const shelf = await app.request('/api/ubicaciones', 'POST', Object.assign({ nombre: 'Margin shelf', tipo: 'socio', comisionSocio: 40 }, extraPercha || {}));
  const product = await app.request('/api/productos', 'POST', {
    nombre: 'Margin product', sku: 'FIX-MARGEN', barcode: 'FIX-MARGEN',
    precio: 50, costo: 20, stockInicial: 10, ubicacionId: shelf.id
  });
  return { shelf, product };
}
function ventaDe(app, product) {
  return app.request('/api/respaldo/exportar').then(b => b.ventas.filter(v => v.productoId === product.id).pop());
}

test('default stays gross: nothing changes for existing shelves', async () => {
  const app = browser();
  const { product } = await tienda(app);
  await app.request(`/api/productos/${product.id}/venta`, 'POST', { cantidad: 2 });
  const v = await ventaDe(app, product);
  assert.equal(v.split.montoBruto, 100);
  assert.equal(v.split.montoComisionSocio, 40, '40% de 100 bruto');
  assert.equal(v.split.baseComision, 'bruto');
  assert.equal(v.split.montoBaseComision, 100);
  assert.equal(+(v.split.montoComisionSocio + v.split.montoNetoDueno).toFixed(2), v.split.montoBruto);
});

test('margin base: commission on (price - cost), invariant holds', async () => {
  const app = browser();
  const { shelf, product } = await tienda(app, { baseComision: 'margen' });
  assert.equal(shelf.baseComision, 'margen', 'POST guarda el campo');
  await app.request(`/api/productos/${product.id}/venta`, 'POST', { cantidad: 2 });
  const v = await ventaDe(app, product);
  assert.equal(v.split.montoBruto, 100);
  assert.equal(v.split.baseComision, 'margen');
  assert.equal(v.split.montoBaseComision, 60, '(50-20) x 2');
  assert.equal(v.split.montoComisionSocio, 24, '40% de 60');
  assert.equal(v.split.montoNetoDueno, 76);
  assert.equal(+(v.split.montoComisionSocio + v.split.montoNetoDueno).toFixed(2), 100);
});

test('margin requested but no cost: falls back to gross and says so', async () => {
  const app = browser();
  const shelf = await app.request('/api/ubicaciones', 'POST', { nombre: 'No cost shelf', tipo: 'socio', comisionSocio: 40, baseComision: 'margen' });
  const product = await app.request('/api/productos', 'POST', { nombre: 'No cost', sku: 'FIX-NOCOST', barcode: 'FIX-NOCOST', precio: 50, costo: 0, stockInicial: 3, ubicacionId: shelf.id });
  await app.request(`/api/productos/${product.id}/venta`, 'POST', { cantidad: 1 });
  const v = await ventaDe(app, product);
  assert.equal(v.split.baseComision, 'bruto');
  assert.equal(v.split.montoBaseComision, 50);
  assert.equal(v.split.montoComisionSocio, 20);
  assert.ok(v.split.avisoBase, 'dice por que uso bruto');
});

test('PUT switches the base; correcting a sale uses the stored base amount', async () => {
  const app = browser();
  const { shelf, product } = await tienda(app);
  const upd = await app.request(`/api/ubicaciones/${shelf.id}`, 'PUT', { baseComision: 'margen' });
  assert.equal(upd.baseComision, 'margen');
  await app.request(`/api/productos/${product.id}/venta`, 'POST', { cantidad: 1 });
  const v = await ventaDe(app, product);
  assert.equal(v.split.montoComisionSocio, 12, '40% de 30');
  const r = await app.request(`/api/ventas/${v.id}/comision`, 'PATCH', { comisionPct: 50, quien: 'test', motivo: 'fix' });
  assert.equal(r.venta.split.montoComisionSocio, 15, '50% de 30 (margen), no de 50');
  assert.equal(r.venta.split.montoNetoDueno, 35);
  const rechazo = await app.request(`/api/ubicaciones/${shelf.id}`, 'PUT', { baseComision: 'loquesea' });
  assert.equal(rechazo.baseComision, 'bruto', 'un valor desconocido cae a bruto, nunca rompe');
});

test('the base travels in both sync serializers and is applied by the other device', async () => {
  const a = browser();
  const { shelf } = await tienda(a, { baseComision: 'margen' });
  const cat = a.catalog();
  assert.equal(cat.ubicaciones.find(u => u.id === shelf.id).baseComision, 'margen', 'catalogoPropio');
  const cp = JSON.parse(JSON.stringify(a.OCSync.estadoParaCheckpoint()));
  assert.equal(cp.ubicaciones.find(u => u.id === shelf.id).baseComision, 'margen', 'estadoParaCheckpoint');
  const b = browser();
  b.receive(a);
  const enB = (await b.request('/api/ubicaciones?todas=1')).find(u => u.id === shelf.id);
  assert.equal(enB.baseComision, 'margen');
});

test('a person can define margin as their own base; the shelf can override it', async () => {
  const app = browser();
  const pr = await app.request('/api/promotoras', 'POST', { nombre: 'Margin seller', comisionBase: 40, baseComision: 'margen' });
  assert.equal(pr.baseComision, 'margen');
  const shelf = await app.request('/api/ubicaciones', 'POST', { nombre: 'Seller shelf', tipo: 'socio', comisionSocio: 0 });
  await app.request(`/api/ubicaciones/${shelf.id}`, 'PUT', { promotoraId: pr.id, usarComisionPropia: false });
  const product = await app.request('/api/productos', 'POST', { nombre: 'P', sku: 'FIX-PR', barcode: 'FIX-PR', precio: 50, costo: 20, stockInicial: 5, ubicacionId: shelf.id });
  await app.request(`/api/productos/${product.id}/venta`, 'POST', { cantidad: 1 });
  let v = await ventaDe(app, product);
  assert.equal(v.split.montoComisionSocio, 12, 'la persona define margen: 40% de 30');
  await app.request(`/api/ubicaciones/${shelf.id}`, 'PUT', { baseComision: 'bruto' });
  await app.request(`/api/productos/${product.id}/venta`, 'POST', { cantidad: 1 });
  v = await ventaDe(app, product);
  assert.equal(v.split.montoComisionSocio, 20, 'la percha lo explicita: bruto manda');
});
