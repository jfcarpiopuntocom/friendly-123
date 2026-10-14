/* v507 (JFC 2026-10-14): los datos de la demo NO aparecen en cuadernos reales; solo con PIN 456 en un aparato sin activar.
   Bug real: v457 ya ocultaba productos, clientes, ventas, perchas y asociados demo en un negocio con licencia, pero los
   GASTOS FIJOS MENSUALES de las 4 perchas demo (galeria 900, bar 1500, eventos 350, consigna 0) seguian en la tabla
   gastosMensuales y se sumaban al total de gastos (/api/configuracion/gastos) y a gastosOperativos del P&L
   (/api/reportes/pl): un negocio real veia 2750 de gastos de un negocio de ejemplo. El tablero (core/demo-huellas.js
   sinDemo) dejaba pasar lo mismo. Arreglo: lectura filtrada; el almacenamiento no se toca.
   Datos sinteticos, licencia sintetica. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { browser } = require('./helpers/browser.cjs');

const LIC_SINTETICA = 'F123-TEST-0000-0000-00000';
const DEMO_RACKS = ['galeria', 'consigna', 'bar', 'eventos'];

function memoria() {
  const m = new Map();
  return { get length() { return m.size; }, key: (i) => [...m.keys()][i], getItem: (k) => m.has(k) ? m.get(k) : null, setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); } };
}
/* Cuaderno real con la demo sobrante adentro, armado por la puerta honesta (respaldo -> importar en aparato con licencia). */
async function negocioRealConDemo() {
  const a0 = browser();
  a0.OCAuth = { rolActual: () => 'dueno' };
  const rack = await a0.request('/api/ubicaciones', 'POST', { nombre: 'Percha Real', tipo: 'propio' });
  await a0.request('/api/productos', 'POST', { nombre: 'Real Uno', sku: '1010000', barcode: '1010000', precio: 100, costo: 40, stockInicial: 10, ubicacionId: rack.id });
  await a0.request('/api/configuracion/gastos', 'POST', { ubicacionId: rack.id, gastosMensuales: 200 });
  const respaldo = await a0.request('/api/respaldo/exportar');
  const ls = memoria();
  ls.setItem('f123_owned', JSON.stringify({ licenseCode: LIC_SINTETICA, nombreNegocio: 'Negocio Sintetico' }));
  const app = browser(ls);
  app.OCAuth = { rolActual: () => 'dueno' };
  const r = await app.request('/api/respaldo/importar', 'POST', respaldo);
  assert.ok(!r.error, 'importar: ' + JSON.stringify(r));
  return { app, rack };
}

test('licensed business: demo racks fixed monthly expenses are not counted (total and P&L)', async () => {
  const { app, rack } = await negocioRealConDemo();
  const g = await app.request('/api/configuracion/gastos?ubicacionId=todas');
  assert.equal(g.gastosMensuales, 200, 'total de gastos fijos = solo la percha real: ' + JSON.stringify(g));
  DEMO_RACKS.forEach((id) => assert.ok(!(id in g.porUbicacion), 'sin la percha demo ' + id));
  assert.equal(g.porUbicacion[rack.id], 200);
  const pl = await app.request('/api/reportes/pl?ubicacionId=todas');
  const dias = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
  assert.ok(Math.abs(pl.gastosOperativos - 200 / dias) < 0.02, 'P&L: gastos operativos solo de lo real: ' + pl.gastosOperativos);
  // Nada se borro del almacenamiento: el respaldo conserva la tabla completa.
  const e = await app.request('/api/respaldo/exportar');
  DEMO_RACKS.forEach((id) => assert.ok(id in e.configuracion.gastosMensuales, 'almacenamiento intacto: ' + id));
});

test('pure demo (no license, PIN 456) keeps its sample expenses', async () => {
  const app = browser();
  const g = await app.request('/api/configuracion/gastos?ubicacionId=todas');
  assert.equal(g.gastosMensuales, 2750, 'la demo sigue mostrando su ejemplo completo');
});

function huellas() {
  const vm = require('node:vm'), fs = require('node:fs'), path = require('node:path');
  const w = {}; vm.createContext(w);
  vm.runInContext(fs.readFileSync(path.resolve(__dirname, '../docs/core/demo-huellas.js'), 'utf8'), w);
  return w.OCDemoHuellas;
}
test('dashboard (core/demo-huellas.js sinDemo) drops demo racks expenses too, without touching the original', async () => {
  const H = huellas();
  const { app, rack } = await negocioRealConDemo();
  const e = await app.request('/api/respaldo/exportar');
  e.gastosMensuales = Object.assign({}, e.configuracion.gastosMensuales); // forma del relay del tablero
  const v = H.sinDemo(e);
  DEMO_RACKS.forEach((id) => {
    assert.ok(!(id in v.configuracion.gastosMensuales), 'configuracion sin ' + id);
    assert.ok(!(id in v.gastosMensuales), 'tabla suelta sin ' + id);
    assert.ok(id in e.configuracion.gastosMensuales, 'original intacto ' + id);
  });
  assert.equal(v.configuracion.gastosMensuales[rack.id], 200);
});
