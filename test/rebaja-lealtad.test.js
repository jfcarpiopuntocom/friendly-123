/* Rebaja por antiguedad (benchmark #3) y lealtad simple (benchmark #5). JFC 2026-09-25.
   Pasada Hugo/Paco/Luis por el camino real (mock-backend + merge de dos aparatos).
   Reglas: apagado por defecto; el precio de lista nunca cambia; cada venta congela su
   precio; la comision se calcula sobre lo cobrado; el override manual y la cortesia
   mandan; converge entre aparatos. Rojo contra v393. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { browser } = require('./helpers/browser.cjs');
const DIA = 86400000;
const cents = (n) => Math.round(Number(n) * 100);

async function tienda(app, dias) {
  app.OCAuth = { rolActual: () => 'dueno' };
  const shelf = await app.request('/api/ubicaciones', 'POST', { nombre: 'Aged shelf', tipo: 'socio', comisionSocio: 40 });
  const product = await app.request('/api/productos', 'POST', { nombre: 'Aged print', sku: 'AG-1', barcode: 'AG-1', precio: 50, costo: 10, stockInicial: 30, ubicacionId: shelf.id });
  if (dias) await envejecer(app, product.id, dias);
  return { shelf, product };
}
async function envejecer(app, id, dias) {
  const b = await app.request('/api/respaldo/exportar');
  b.productos.find((p) => p.id === id).creadoEn = new Date(Date.now() - dias * DIA).toISOString();
  await app.request('/api/respaldo/importar', 'POST', b);
}
const regla = { activa: true, pasos: [{ dias: 30, pct: 10 }, { dias: 60, pct: 25 }] };
const ultima = async (app, product) => (await app.request('/api/respaldo/exportar')).ventas.filter((v) => v.productoId === product.id).pop();

test('rebaja apagada por defecto: 45 dias en percha y se cobra el precio de lista', async () => {
  const app = browser(); const { product } = await tienda(app, 45);
  await app.request(`/api/productos/${product.id}/venta`, 'POST', { cantidad: 1 });
  assert.equal((await ultima(app, product)).precioUnit, 50);
});

test('rebaja activa: 45 dias -> 10 %, 65 dias -> 25 %; comision sobre lo cobrado; lista intacta', async () => {
  const app = browser(); const { shelf, product } = await tienda(app, 45);
  const u = await app.request(`/api/ubicaciones/${shelf.id}`, 'PUT', { rebajaEdad: regla });
  assert.equal(u.rebajaEdad.activa, true);
  const f = await app.request(`/api/productos/${product.id}`);
  assert.equal(f.rebajaPct, 10); assert.equal(f.precioRebajado, 45); assert.equal(f.precio, 50, 'la lista no cambia');
  await app.request(`/api/productos/${product.id}/venta`, 'POST', { cantidad: 2 });
  const v = await ultima(app, product);
  assert.equal(v.precioUnit, 45);
  assert.equal(cents(v.split.montoBruto), 9000);
  assert.equal(cents(v.split.montoComisionSocio), 3600, '40 % de 90');
  assert.equal(cents(v.split.montoComisionSocio) + cents(v.split.montoNetoDueno), cents(v.split.montoBruto));
  await envejecer(app, product.id, 65);
  await app.request(`/api/productos/${product.id}/venta`, 'POST', { cantidad: 1 });
  assert.equal((await ultima(app, product)).precioUnit, 37.5);
});

test('Hugo/Paco: override manual y cortesia mandan; cambiar la regla no toca ventas hechas', async () => {
  const app = browser(); const { shelf, product } = await tienda(app, 45);
  await app.request(`/api/ubicaciones/${shelf.id}`, 'PUT', { rebajaEdad: regla });
  await app.request(`/api/productos/${product.id}/venta`, 'POST', { cantidad: 1, info: { precioOverride: 48 } });
  assert.equal((await ultima(app, product)).precioUnit, 48, 'override manual manda');
  await app.request(`/api/productos/${product.id}/venta`, 'POST', { cantidad: 1, info: { cortesia: true } });
  assert.equal((await ultima(app, product)).precioUnit, 0, 'cortesia manda');
  await app.request(`/api/productos/${product.id}/venta`, 'POST', { cantidad: 1 });
  const hecha = await ultima(app, product);
  await app.request(`/api/ubicaciones/${shelf.id}`, 'PUT', { rebajaEdad: { activa: false, pasos: [] } });
  const b = await app.request('/api/respaldo/exportar');
  assert.equal(b.ventas.find((v) => v.id === hecha.id).precioUnit, 45, 'la venta hecha congela su precio');
});

test('Luis: reglas raras se sanean (pct 150, dias negativos, texto, 10 pasos)', async () => {
  const app = browser(); const { shelf } = await tienda(app, 1);
  const u = await app.request(`/api/ubicaciones/${shelf.id}`, 'PUT', { rebajaEdad: { activa: true, pasos: [{ dias: -5, pct: 150 }, { dias: 'x', pct: 10 }, ...Array.from({ length: 10 }, (_, i) => ({ dias: 10 + i, pct: 5 }))] } });
  assert.ok(u.rebajaEdad.pasos.length <= 3, 'maximo 3 pasos');
  for (const p of u.rebajaEdad.pasos) { assert.ok(p.dias >= 1 && p.pct >= 1 && p.pct <= 90, JSON.stringify(p)); }
});

test('dos aparatos: la regla y la fecha de alta viajan; B cobra lo mismo que A', async () => {
  const A = browser(); const { shelf, product } = await tienda(A, 45);
  await A.request(`/api/ubicaciones/${shelf.id}`, 'PUT', { rebajaEdad: regla });
  const B = browser(); B.OCAuth = { rolActual: () => 'dueno' }; B.receive(A);
  const fB = await B.request(`/api/productos/${product.id}`);
  assert.equal(fB.rebajaPct, 10, 'B ve la misma antiguedad y la misma regla');
  await B.request(`/api/productos/${product.id}/venta`, 'POST', { cantidad: 1 });
  assert.equal((await ultima(B, product)).precioUnit, 45);
});

test('fecha de alta converge a la mas antigua aunque un aparato la tenga mas nueva', async () => {
  const A = browser(); const { product } = await tienda(A, 45);
  const B = browser(); B.OCAuth = { rolActual: () => 'dueno' }; B.receive(A);
  await envejecer(B, product.id, 2); // B cree que es nuevo
  B.receive(A);
  const cB = (await B.request('/api/respaldo/exportar')).productos.find((p) => p.id === product.id).creadoEn;
  assert.ok(Date.now() - Date.parse(cB) > 40 * DIA, 'B adopta la fecha mas antigua');
});

test('lealtad apagada por defecto; activa cada 3 compras al 10 %; derivada de las ventas; viaja al otro aparato', async () => {
  const A = browser(); const { product } = await tienda(A, 1);
  const cli = await A.request('/api/clientes', 'POST', { nombre: 'Loyal Customer' });
  assert.equal((await A.request(`/api/clientes/${cli.id}/lealtad`)).activa, false);
  const cfg = await A.request('/api/lealtad', 'PUT', { activa: true, cada: 3, pct: 10 });
  assert.equal(cfg.cada, 3);
  await A.request(`/api/productos/${product.id}/venta`, 'POST', { cantidad: 1, clienteId: cli.id });
  let l = await A.request(`/api/clientes/${cli.id}/lealtad`);
  assert.equal(l.compras, 1); assert.equal(l.tocaDescuento, false); assert.equal(l.faltan, 1, 'una compra normal mas y la siguiente (3.a) lleva descuento');
  await A.request(`/api/productos/${product.id}/venta`, 'POST', { cantidad: 1, clienteId: cli.id });
  l = await A.request(`/api/clientes/${cli.id}/lealtad`);
  assert.equal(l.compras, 2); assert.equal(l.tocaDescuento, true, 'la 3.a compra lleva descuento');
  const B = browser(); B.OCAuth = { rolActual: () => 'dueno' }; B.receive(A);
  const lB = await B.request(`/api/clientes/${cli.id}/lealtad`);
  assert.equal(lB.activa, true); assert.equal(lB.compras, 2); assert.equal(lB.tocaDescuento, true, 'B cuenta lo mismo: sale de las ventas');
});

test('lealtad: ventas anuladas, devueltas y de cortesia no cuentan; cada/pct raros se sanean', async () => {
  const A = browser(); const { product } = await tienda(A, 1);
  const cli = await A.request('/api/clientes', 'POST', { nombre: 'Edge Customer' });
  const cfg = await A.request('/api/lealtad', 'PUT', { activa: true, cada: 1, pct: 500 });
  assert.ok(cfg.cada >= 2 && cfg.pct <= 50, JSON.stringify(cfg));
  await A.request(`/api/productos/${product.id}/venta`, 'POST', { cantidad: 1, clienteId: cli.id, info: { cortesia: true } });
  const r = await A.request(`/api/productos/${product.id}/venta`, 'POST', { cantidad: 1, clienteId: cli.id });
  await A.request(`/api/ventas/${r.ventaId}/anular`, 'POST', {});
  assert.equal((await A.request(`/api/clientes/${cli.id}/lealtad`)).compras, 0);
});
