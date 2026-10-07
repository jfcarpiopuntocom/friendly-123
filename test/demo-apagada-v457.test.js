/* v457 (owner LAW, JFC 2026-10-07, decision (d) "Apagarla, solo filtrar"): la limpieza de arranque que retiraba el demo sobrante
   del almacenamiento de un negocio con licencia queda APAGADA (dormant). El demo solo se filtra a la lectura. Datos sinteticos, sin red. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { browser } = require('./helpers/browser.cjs');

const SKUS_REALES = ['1010000', '2010003', '8010005'];
const conteos = async (w) => { const e = await w.request('/api/respaldo/exportar'); return { productos: e.productos.length, clientes: e.clientes.length, ventas: e.ventas.length, ubicaciones: e.ubicaciones.length, promotoras: e.promotoras.length }; };

test('licensed business with leftover demo: after STARTUP the stored records are identical and the demo is not visible', async () => {
  const a0 = browser(); a0.OCAuth = { rolActual: () => 'dueno' };
  const real = await a0.request('/api/promotoras', 'POST', { nombre: 'Artista Real', comisionBase: 50 });
  const rack = await a0.request('/api/ubicaciones', 'POST', { nombre: 'Percha Real', tipo: 'socio', comisionSocio: 50 });
  await a0.request('/api/ubicaciones/' + rack.id, 'PUT', { promotoraId: real.id });
  const reales = [];
  for (const sku of SKUS_REALES) reales.push(await a0.request('/api/productos', 'POST', { nombre: 'Real ' + sku, sku, barcode: sku, precio: 100, costo: 40, stockInicial: 10, ubicacionId: rack.id }));
  await a0.request('/api/clientes', 'POST', { nombre: 'Clienta Real' });
  for (const p of reales) await a0.request(`/api/productos/${p.id}/venta`, 'POST', { cantidad: 1 });
  const ls = a0.localStorage;
  ls.setItem('f123_owned', JSON.stringify({ instanceId: 'fixture-demo-apagada', licenseCode: 'F123-TEST-0000-0000-00000', nombreNegocio: 'Negocio Sintetico' }));
  /* el almacenamiento trae el demo mezclado con lo real */
  const crudo = () => { const e = JSON.parse(ls.getItem('f123_estado_v4_' + (ls.getItem('f123_estado_v4_ptr') || 'B'))); return { productos: e.productos.length, clientes: e.clientes.length, ventas: e.ventas.length, ubicaciones: e.ubicaciones.length, promotoras: e.promotoras.length }; };
  const guardado = crudo(); // lo guardado en disco ANTES del arranque (sin pasar por la app)
  assert.ok(guardado.productos > 30 && guardado.promotoras >= 3, 'fixture con demo sobrante: ' + JSON.stringify(guardado));

  const app = browser(ls);                       // ARRANQUE del aparato con licencia
  app.OCAuth = { rolActual: () => 'dueno' };
  assert.deepEqual(await conteos(app), guardado, 'el arranque no borro ni un registro');
  assert.equal(ls.getItem('f123_cuarentena_demo_exacta_v448'), null, 'ni siquiera se abrio cuarentena: la limpieza esta apagada');
  const prods = await app.request('/api/productos');
  assert.deepEqual(prods.map((p) => p.sku).sort(), SKUS_REALES.slice().sort(), 'el demo no se ve (filtro de lectura)');
  assert.deepEqual((await app.request('/api/promotoras')).map((p) => p.nombre), ['Artista Real']);
  /* y despues de otro arranque sigue igual */
  assert.deepEqual(crudo(), guardado, 'lo guardado en disco tampoco cambio');
  assert.deepEqual(await conteos(browser(ls)), guardado);
});
