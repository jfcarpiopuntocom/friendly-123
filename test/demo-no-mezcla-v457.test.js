/* v457 (owner LAW, JFC 2026-10-07): el demo NUNCA se mezcla con un negocio con licencia. "toda la info, no solo
   inventario sino clientes y comisionistas y todo del demo". A LA LECTURA (nunca se borra nada) se excluyen los registros
   que calzan con las huellas EXACTAS de la semilla demo, SIN el requisito de "evidencia", para cualquier negocio con
   licencia. Excepcion: un registro demo con ventas REALES que lo referencian sigue visible.
   Fixture modelado en la clienta real: SKUs numericos de 7 digitos (1010000, 2010003, 8010005, 9010012, 1110004, 2110000),
   asociados demo sobrantes, 4 perchas demo, productos/clientes/ventas demo. Datos sinteticos, licencia sintetica. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { browser } = require('./helpers/browser.cjs');

const LIC_SINTETICA = 'F123-TEST-0000-0000-00000';
const SKUS_REALES = ['1010000', '2010003', '8010005', '9010012', '1110004', '2110000'];
const DEMO_ASOCIADOS = ['Consignment Artist (sample)', 'Event Partner (sample)'];

/* Arma el cuaderno por la puerta honesta: demo + registros reales -> respaldo -> importado en un aparato CON licencia. */
async function negocioConDemoSobrante({ ventaRealSobreDemo = false } = {}) {
  const a0 = browser();
  a0.OCAuth = { rolActual: () => 'dueno' };
  const real = await a0.request('/api/promotoras', 'POST', { nombre: 'Artista Real', comisionBase: 50 });
  const rack = await a0.request('/api/ubicaciones', 'POST', { nombre: 'Percha Real', tipo: 'socio', comisionSocio: 50 });
  await a0.request('/api/ubicaciones/' + rack.id, 'PUT', { promotoraId: real.id });
  const reales = [];
  for (const sku of SKUS_REALES) reales.push(await a0.request('/api/productos', 'POST', { nombre: 'Real ' + sku, sku, barcode: sku, precio: 100, costo: 40, stockInicial: 10, ubicacionId: rack.id }));
  await a0.request('/api/clientes', 'POST', { nombre: 'Clienta Real' });
  for (const p of reales.slice(0, 3)) await a0.request(`/api/productos/${p.id}/venta`, 'POST', { cantidad: 1 });
  if (ventaRealSobreDemo) await a0.request('/api/productos/p07/venta', 'POST', { cantidad: 1 });
  const respaldo = await a0.request('/api/respaldo/exportar');
  const ls = (() => { const m = new Map(); return { get length() { return m.size; }, key: (i) => [...m.keys()][i], getItem: (k) => m.has(k) ? m.get(k) : null, setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); } }; })();
  ls.setItem('f123_owned', JSON.stringify({ licenseCode: LIC_SINTETICA, nombreNegocio: 'Negocio Sintetico' }));
  const app = browser(ls);
  app.OCAuth = { rolActual: () => 'dueno' };
  const r = await app.request('/api/respaldo/importar', 'POST', respaldo);
  assert.ok(!r.error, 'importar: ' + JSON.stringify(r));
  return { app, ls, real, rack, reales };
}
const conteos = async (app) => {
  const e = await app.request('/api/respaldo/exportar');
  return { productos: e.productos.length, clientes: e.clientes.length, ventas: e.ventas.length, ubicaciones: e.ubicaciones.length, promotoras: e.promotoras.length };
};

test('licensed business: app lists show ONLY real records; nothing is deleted from storage', async () => {
  const { app } = await negocioConDemoSobrante();
  const antes = await conteos(app);
  assert.ok(antes.productos > 40 && antes.promotoras >= 3 && antes.ubicaciones >= 5, 'el fixture trae el demo mezclado: ' + JSON.stringify(antes));

  const prods = await app.request('/api/productos');
  assert.deepEqual(prods.map((p) => p.sku).sort(), SKUS_REALES.slice().sort(), 'Products: solo los SKU reales');
  const cli = await app.request('/api/clientes');
  assert.deepEqual(cli.map((c) => c.nombre), ['Clienta Real'], 'Customers: solo la clienta real');
  const prom = await app.request('/api/promotoras');
  assert.deepEqual(prom.map((p) => p.nombre), ['Artista Real'], 'Commissions people: sin los asociados demo');
  DEMO_ASOCIADOS.forEach((n) => assert.ok(!prom.some((p) => p.nombre === n), n));
  const racks = await app.request('/api/ubicaciones?todas=1');
  assert.deepEqual(racks.map((u) => u.nombre), ['Percha Real'], 'Racks: sin las 4 perchas demo');
  const ventas = await app.request('/api/ventas/todas?ubicacionId=todas');
  assert.equal(ventas.length, 3, 'Sales: solo las 3 reales');
  assert.ok(ventas.every((v) => !/^vs-/.test(v.id)));
  const liq = await app.request('/api/liquidaciones');
  assert.deepEqual(liq.map((f) => f.ubicacion), ['Percha Real'], 'Commissions por percha: solo la real');
  const cuadre = await app.request('/api/comisiones/cuadre');
  const totalCuadre = JSON.stringify(cuadre);
  assert.ok(!/Consignment Artist|Event Partner/.test(totalCuadre));

  const despues = await conteos(app);
  assert.deepEqual(despues, antes, 'nada se borro del almacenamiento: conteos antes == despues');
});

test('a demo record that has REAL sales referencing it stays visible', async () => {
  const { app } = await negocioConDemoSobrante({ ventaRealSobreDemo: true });
  const prods = await app.request('/api/productos');
  assert.ok(prods.some((p) => p.id === 'p07'), 'p07 (demo) tiene una venta real: se queda');
  assert.ok(!prods.some((p) => p.id === 'p01'), 'p01 (demo, sin ventas reales) se oculta');
  const racks = await app.request('/api/ubicaciones?todas=1');
  assert.ok(racks.some((u) => u.id === 'consigna'), 'la percha de ese producto se queda');
  assert.ok(!racks.some((u) => u.id === 'bar'), 'la percha demo sin uso real se oculta');
});

test('the pure demo (no license) is untouched: it keeps its sample data', async () => {
  const app = browser();
  const prods = await app.request('/api/productos');
  assert.ok(prods.length >= 30, 'el demo sin licencia sigue mostrando su ejemplo');
  const prom = await app.request('/api/promotoras');
  assert.ok(prom.some((p) => DEMO_ASOCIADOS.includes(p.nombre)));
});

/* Deriva: el tablero no carga mock-backend.js y usa docs/core/demo-huellas.js. Tiene que decidir EXACTAMENTE lo mismo que la app. */
function huellas() {
  const vm = require('node:vm'), fs = require('node:fs'), path = require('node:path');
  const w = {}; vm.createContext(w);
  vm.runInContext(fs.readFileSync(path.resolve(__dirname, '../docs/core/demo-huellas.js'), 'utf8'), w);
  return w.OCDemoHuellas;
}
test('docs/core/demo-huellas.js (dashboard) decides exactly what the app decides', async () => {
  const H = huellas();
  const limpio = await browser().request('/api/respaldo/exportar');
  assert.ok(limpio.productos.every((p) => H.esProducto(p)), 'toda la semilla de productos esta en la tabla');
  assert.ok(limpio.clientes.every((c) => H.esCliente(c)), 'toda la semilla de clientes');
  assert.ok(limpio.ubicaciones.every((u) => H.esUbicacion(u)), 'toda la semilla de perchas');
  assert.ok(limpio.promotoras.every((p) => H.esPromotora(p)), 'toda la semilla de asociados');
  assert.ok(limpio.ventas.filter((v) => /^vs-/.test(v.id)).every((v) => H.esVenta(v)));
  for (const opts of [{}, { ventaRealSobreDemo: true }]) {
    const { app } = await negocioConDemoSobrante(opts);
    const est = await app.request('/api/respaldo/exportar');
    const v = H.sinDemo(est);
    const ids = (a) => a.map((x) => x.id).sort();
    assert.deepEqual(ids(v.productos.filter((p) => !p.borrado && !p.archivado)), ids(await app.request('/api/productos')), 'productos ' + JSON.stringify(opts));
    assert.deepEqual(ids(v.clientes.filter((c) => !c.borrado && !c.despedido)), ids(await app.request('/api/clientes')), 'clientes');
    assert.deepEqual(ids(v.promotoras.filter((p) => !p.borrado)), ids(await app.request('/api/promotoras')), 'promotoras');
    assert.deepEqual(ids(v.ubicaciones.filter((u) => !u.borrado && u.activa !== false)), ids(await app.request('/api/ubicaciones?todas=1')), 'ubicaciones');
    assert.equal(v.ventas.filter((x) => !x.anulada).length, (await app.request('/api/ventas/todas?ubicacionId=todas')).length, 'ventas');
    assert.ok(est.productos.length > v.productos.length, 'la copia sin demo no toca el original');
  }
});
