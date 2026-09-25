// JFC 2026-09-25 (shell v398, "el Spray de la verdad"): en Sold elige un comisionista para una
// pieza de una percha PROPIA y la comision no aparece en Commissions. Causa: la venta solo
// repartia con el trato de la PERCHA, y una percha propia no reparte con nadie. La pantalla
// dejaba elegir a la persona; el dinero la ignoraba. Rojo en v398.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { browser } = require('./helpers/browser.cjs');
const { cuadre } = require('./helpers/cuadre.cjs');

async function tienda() {
  const w = browser();
  w.OCAuth = { rolActual: () => 'dueno' };
  const pepoe = await w.request('/api/promotoras', 'POST', { nombre: 'PEpoe', comisionBase: 20 });
  const otra = await w.request('/api/promotoras', 'POST', { nombre: 'Otra', comisionBase: 50 });
  const propia = await w.request('/api/ubicaciones', 'POST', { nombre: 'Mostrador propio', tipo: 'propio' });
  const spray = await w.request('/api/productos', 'POST', { nombre: 'Spray de la verdad', barcode: 'SPRAY-1', precio: 10, costo: 4, stockInicial: 5, ubicacionId: propia.id, umbralRojo: 1, umbralAmarillo: 2 });
  return { w, pepoe, otra, propia, spray };
}

test('elegir un comisionista en una percha PROPIA genera su comision', async () => {
  const t = await tienda();
  const { ventaId } = await t.w.request(`/api/productos/${t.spray.id}/venta`, 'POST', { cantidad: 1, modoComision: 'associate', promotoraId: t.pepoe.id });
  const v = (await t.w.request('/api/ventas/todas')).find((x) => x.id === ventaId);
  assert.equal(v.comisionAsociado, 2, '20 % de 10');
  assert.equal(v.asociadoNombre, 'PEpoe');
});

test('Commissions muestra la percha propia con esa comision, y el ranking la cuenta', async () => {
  const t = await tienda();
  await t.w.request(`/api/productos/${t.spray.id}/venta`, 'POST', { cantidad: 2, modoComision: 'associate', promotoraId: t.pepoe.id });
  const l = (await t.w.request('/api/liquidaciones')).find((x) => x.ubicacionId === t.propia.id);
  assert.ok(l, 'la percha propia con ventas comisionadas tiene tarjeta');
  assert.equal(l.comisionSocio, 4);
  const r = (await t.w.request('/api/promotores/desempeno')).find((x) => x.id === t.pepoe.id);
  assert.ok(r && r.comision === 4 && r.ventasCount === 2, 'ranking: PEpoe vendio 2');
  assert.deepEqual(await cuadre(t.w), []);
});

test('el ranking y Sold atribuyen la venta a quien la hizo, aunque despues cambie la percha', async () => {
  const t = await tienda();
  const rack = await t.w.request('/api/ubicaciones', 'POST', { nombre: 'Compartida', tipo: 'socio' });
  await t.w.request(`/api/ubicaciones/${rack.id}`, 'PUT', { promotoraId: t.pepoe.id });
  const p = await t.w.request('/api/productos', 'POST', { nombre: 'Taza', barcode: 'T-1', precio: 10, stockInicial: 5, ubicacionId: rack.id, umbralRojo: 1, umbralAmarillo: 2 });
  const { ventaId } = await t.w.request(`/api/productos/${p.id}/venta`, 'POST', { cantidad: 1, modoComision: 'associate', promotoraId: t.pepoe.id });
  await t.w.request(`/api/ubicaciones/${rack.id}`, 'PUT', { promotoraId: t.otra.id }); // reasignan la percha
  assert.equal((await t.w.request('/api/ventas/todas')).find((x) => x.id === ventaId).asociadoNombre, 'PEpoe');
  const rk = await t.w.request('/api/promotores/desempeno');
  assert.equal((rk.find((x) => x.id === t.pepoe.id) || {}).ventasCount, 1);
  assert.equal((rk.find((x) => x.id === t.otra.id) || { ventasCount: 0 }).ventasCount, 0);
});

test('COUNTER SALE en percha propia sigue sin comision (FIJACION)', async () => {
  const t = await tienda();
  const { ventaId } = await t.w.request(`/api/productos/${t.spray.id}/venta`, 'POST', { cantidad: 1, modoComision: 'counter' });
  assert.equal((await t.w.request('/api/ventas/todas')).find((x) => x.id === ventaId).comisionAsociado, 0);
});

test('dos aparatos: la persona de la venta viaja por el sync', async () => {
  const t = await tienda();
  const b = browser(); b.OCAuth = { rolActual: () => 'dueno' };
  b.receive(t.w);
  const { ventaId } = await t.w.request(`/api/productos/${t.spray.id}/venta`, 'POST', { cantidad: 1, modoComision: 'associate', promotoraId: t.pepoe.id });
  b.receive(t.w);
  const v = (await b.request('/api/ventas/todas')).find((x) => x.id === ventaId);
  assert.ok(v, 'la venta llego al otro aparato');
  assert.equal(v.asociadoNombre, 'PEpoe');
  assert.equal(v.comisionAsociado, 2);
  assert.ok((await b.request('/api/liquidaciones')).some((x) => x.ubicacionId === t.propia.id), 'el otro aparato tambien ve la tarjeta');
});
