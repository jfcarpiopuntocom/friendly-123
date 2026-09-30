const { test } = require('node:test');
const assert = require('node:assert/strict');
const { browser } = require('./helpers/browser.cjs');
const { marcarCasaVieja } = require('./helpers/venta-casa-vieja.cjs');

async function setup(type = 'propio', conPieza = true) {
  const app = browser(); app.OCAuth = { rolActual: () => 'dueno' };
  const artist = await app.request('/api/promotoras', 'POST', { nombre: 'Artist A', comisionBase: 40 });
  const rackPerson = await app.request('/api/promotoras', 'POST', { nombre: 'Rack person', comisionBase: 15 });
  const rack = await app.request('/api/ubicaciones', 'POST', { nombre: 'Rack A', tipo: type, comisionSocio: 25 });
  if (type !== 'propio') await app.request(`/api/ubicaciones/${rack.id}`, 'PUT', { promotoraId: rackPerson.id });
  const product = await app.request('/api/productos', 'POST', {
    nombre: 'Assigned piece', barcode: 'ASSIGNED-1', precio: 100, costo: 30,
    stockInicial: 8, ubicacionId: rack.id, comisionistaId: conPieza ? artist.id : null, umbralRojo: 1, umbralAmarillo: 2
  });
  return { app, artist, rackPerson, rack, product };
}
// Venta de la casa VIEJA (anterior a v429): sale con la pieza sin comisionista y despues se le
// asigna uno. Desde v429 COUNTER SALE se comisiona: el dato viejo se fabrica con marcarCasaVieja.
async function ventaCasaVieja(app, product, artist, cantidad) {
  const r = await app.request(`/api/productos/${product.id}/venta`, 'POST', { cantidad, modoComision: 'counter' });
  await marcarCasaVieja(app, r.ventaId);
  await app.request(`/api/productos/${product.id}`, 'PATCH', { comisionistaId: artist.id });
  return r;
}

test('a product assignment produces a sealed split on an own rack without a manual selector', async () => {
  const { app, artist, product, rack } = await setup();
  const { ventaId } = await app.request(`/api/productos/${product.id}/venta`, 'POST', { cantidad: 1 });
  const v = (await app.request('/api/ventas/todas')).find(x => x.id === ventaId);
  assert.equal(v.comisionAsociado, 40);
  assert.equal(v.netoCasa, 60);
  assert.equal(v.asociadoNombre, artist.nombre);
  assert.equal((await app.request('/api/liquidaciones')).find(x => x.ubicacionId === rack.id).comisionSocio, 40);
});

// REGLA CAMBIADA (JFC + Belen 2026-09-30, v429): la pieza manda tambien sobre COUNTER SALE.
test('product assignment beats rack default and counter sale; an explicit person still wins', async () => {
  const { app, artist, rackPerson, product } = await setup('socio');
  const first = await app.request(`/api/productos/${product.id}/venta`, 'POST', { cantidad: 1 });
  const counter = await app.request(`/api/productos/${product.id}/venta`, 'POST', { cantidad: 1, modoComision: 'counter' });
  const override = await app.request(`/api/productos/${product.id}/venta`, 'POST', { cantidad: 1, modoComision: 'associate', promotoraId: rackPerson.id });
  const rows = await app.request('/api/ventas/todas');
  assert.equal(rows.find(x => x.id === first.ventaId).asociadoNombre, artist.nombre);
  assert.equal(rows.find(x => x.id === first.ventaId).comisionAsociado, 40);
  assert.equal(rows.find(x => x.id === counter.ventaId).comisionAsociado, 40);
  assert.equal(rows.find(x => x.id === counter.ventaId).asociadoNombre, artist.nombre);
  assert.equal(rows.find(x => x.id === override.ventaId).asociadoNombre, rackPerson.nombre);
  assert.equal(rows.find(x => x.id === override.ventaId).comisionAsociado, 15);
});

test('old counter sale can be previewed and explicitly corrected without touching stock or amount', async () => {
  const { app, artist, product, rack } = await setup('socio', false);
  const { ventaId } = await ventaCasaVieja(app, product, artist, 2);
  const before = (await app.request('/api/productos')).find(x => x.id === product.id);
  const preview = await app.request(`/api/ventas/${ventaId}/asignar-comision`, 'POST', { promotoraId: artist.id, preview: true });
  assert.equal(preview.split.montoComisionSocio, 80);
  assert.equal((await app.request('/api/ventas/todas')).find(x => x.id === ventaId).comisionAsociado, 0, 'preview never writes');
  const done = await app.request(`/api/ventas/${ventaId}/asignar-comision`, 'POST', { promotoraId: artist.id, quien: 'Owner', motivo: 'Correct association' });
  assert.equal(done.venta.split.montoComisionSocio, 80);
  assert.equal(done.venta.split.montoNetoDueno, 120);
  assert.equal(done.venta.split.correcciones.length, 1);
  assert.equal((await app.request('/api/liquidaciones')).find(x => x.ubicacionId === rack.id).comisionSocio, 80);
  assert.equal((await app.request('/api/productos')).find(x => x.id === product.id).stockActual, before.stockActual);
  await assert.rejects(app.request(`/api/ventas/${ventaId}/asignar-comision`, 'POST', { promotoraId: artist.id }), /already has a commission split/);
});

test('settled or returned sales are never silently reclassified', async () => {
  const { app, artist, product } = await setup('propio', false);
  const { ventaId } = await ventaCasaVieja(app, product, artist, 1);
  await assert.rejects(app.request(`/api/ventas/${ventaId}/asignar-comision`, 'POST', { promotoraId: 'missing', preview: true }), /Choose a current associate/);
  assert.equal((await app.request('/api/ventas/todas')).find(x => x.id === ventaId).comisionAsociado, 0);
});
