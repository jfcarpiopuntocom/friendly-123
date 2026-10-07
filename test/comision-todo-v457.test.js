/* v457 (owner LAW, JFC 2026-10-07): "TODO debe generar comision". El % del producto manda sin importar a quien se
   vendio ni si hubo cliente. "counter sale es quien vendio, customer es a quien se vendio". Rojas contra v456:
   un producto con su propio % en una percha PROPIA sin comisionista salia 100% casa (split null).
   Las ventas ya guardadas NO se reescriben. Un producto sin % y sin trato de percha sigue sin comision. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { browser } = require('./helpers/browser.cjs');
const { marcarCasaVieja } = require('./helpers/venta-casa-vieja.cjs');

async function setup(prodExtra = {}, rackExtra = {}) {
  const app = browser();
  app.OCAuth = { rolActual: () => 'dueno' };
  const rack = await app.request('/api/ubicaciones', 'POST', Object.assign({ nombre: 'Propia v457', tipo: 'propio' }, rackExtra));
  const mk = (n) => app.request('/api/productos', 'POST', Object.assign({ nombre: 'Taza ' + n, barcode: 'V457-' + n, sku: 'V457-' + n, precio: 100, costo: 30, stockInicial: 9, ubicacionId: rack.id }, prodExtra));
  const p = await mk('A');
  return { app, rack, p };
}
const ultima = async (app, pid) => (await app.request('/api/respaldo/exportar')).ventas.filter((v) => v.productoId === pid).pop();
const huella = (v) => v && v.split ? { pct: v.split.comisionPct, socio: v.split.montoComisionSocio, neto: v.split.montoNetoDueno, origen: v.split.origenComision } : null;

test('product % in an own rack with no associate: sale WITHOUT customer commissions at the product %', async () => {
  const { app, p } = await setup({ pctAsociado: 30 });
  await app.request(`/api/productos/${p.id}/venta`, 'POST', { cantidad: 1 });
  const v = await ultima(app, p.id);
  assert.ok(v.split, 'toda venta genera comision: el producto trae su %');
  assert.equal(v.split.comisionPct, 30);
  assert.equal(v.split.montoComisionSocio, 30);
  assert.equal(v.split.montoNetoDueno, 70);
});

test('sale with customer and sale without customer of the same product compute the identical commission', async () => {
  const { app, p } = await setup({ pctAsociado: 30 });
  const cli = await app.request('/api/clientes', 'POST', { nombre: 'Cliente v457' });
  await app.request(`/api/productos/${p.id}/venta`, 'POST', { cantidad: 1 });
  const sin = huella(await ultima(app, p.id));
  await app.request(`/api/productos/${p.id}/venta`, 'POST', { cantidad: 1, clienteId: cli.id });
  const con = huella(await ultima(app, p.id));
  assert.ok(sin && con, 'las dos generan comision');
  assert.deepEqual(con, sin);
});

test('explicit counter sale commissions the same as any other sale', async () => {
  const { app, p } = await setup({ pctAsociado: 30 });
  await app.request(`/api/productos/${p.id}/venta`, 'POST', { cantidad: 1, modoComision: 'counter' });
  const c = huella(await ultima(app, p.id));
  await app.request(`/api/productos/${p.id}/venta`, 'POST', { cantidad: 1 });
  assert.ok(c, 'counter sale tambien comisiona');
  assert.deepEqual(huella(await ultima(app, p.id)), c);
});

test('product % wins over the associate base % regardless of buyer', async () => {
  const { app, rack } = await setup({});
  const ana = await app.request('/api/promotoras', 'POST', { nombre: 'Ana v457', comisionBase: 60 });
  const p = await app.request('/api/productos', 'POST', { nombre: 'Taza B', barcode: 'V457-B', sku: 'V457-B', precio: 100, costo: 30, stockInicial: 9, ubicacionId: rack.id, pctAsociado: 25, comisionistaId: ana.id });
  const cli = await app.request('/api/clientes', 'POST', { nombre: 'Cliente2 v457' });
  await app.request(`/api/productos/${p.id}/venta`, 'POST', { cantidad: 1 });
  const a = huella(await ultima(app, p.id));
  await app.request(`/api/productos/${p.id}/venta`, 'POST', { cantidad: 1, clienteId: cli.id });
  const b = huella(await ultima(app, p.id));
  assert.equal(a && a.pct, 25);
  assert.deepEqual(b, a);
});

test('a product with no % and no rack deal keeps its current behaviour (no invented default)', async () => {
  const { app, p } = await setup({});
  await app.request(`/api/productos/${p.id}/venta`, 'POST', { cantidad: 1 });
  assert.equal((await ultima(app, p.id)).split, null);
});

test('historical stored sales are never rewritten by the new rule', async () => {
  const { app, p } = await setup({ pctAsociado: 30 });
  await app.request(`/api/productos/${p.id}/venta`, 'POST', { cantidad: 1 });
  const v = await ultima(app, p.id);
  await marcarCasaVieja(app, v.id);
  const despues = await ultima(app, p.id);
  assert.equal(despues.split, null, 'la venta vieja conserva su split guardado (null)');
  assert.equal(despues.modoComision, 'counter');
});

test('Commissions grouping: sales of a product with a % are counted with commission, not as counter/own', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '../docs/index.html'), 'utf8');
  const ini = src.indexOf('function agruparVentasPorProducto');
  const fin = src.indexOf('function selectorVistaComisionesHtml');
  assert.ok(ini > 0 && fin > ini);
  const agrupar = new Function(src.slice(ini, fin) + '; return agruparVentasPorProducto;')();
  const base = { productoId: 'p1', productoNombre: 'Taza', cantidad: 1, precioUnit: 100, delMesActual: true, mes: '2026-10', liquidada: false };
  const filas = [
    Object.assign({}, base, { id: 'a', ubicacionTipo: 'propio', comisionPct: null, pctAsociadoProducto: 30 }),
    Object.assign({}, base, { id: 'b', ubicacionTipo: 'socio', comisionPct: null, pctAsociadoProducto: 30 }),
  ];
  const [g] = agrupar(filas, true, null, true);
  assert.equal(g.propiasUnid, 0, 'no es de percha propia sin comision');
  assert.equal(g.counterUnid, 0, 'no es counter de la casa');
  assert.equal(g.unid, 2, 'cuenta como venta con comision');
});
