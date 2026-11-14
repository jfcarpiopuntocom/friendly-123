'use strict';
// v778 (JFC 13 nov 2026: «se crasheo al ir a revisar en Commissions»; Safari «A problem repeatedly occurred»).
// Commissions reads (/api/liquidaciones, /api/ventas/todas) looked up each sale, product, adjustment and person by
// scanning the WHOLE list for every commission line (.find inside .map): cost sales x obligations, measured 16 s on a
// PC with 12,000 synthetic sales. Now they use indexes built once per read, with .find's first-match rule.
// Synthetic data only; real mock-backend in the vm browser helper.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { browser } = require('./helpers/browser.cjs');

const SRC = fs.readFileSync(path.join(__dirname, '../docs/mock-backend.js'), 'utf8');
function cuerpo(inicio, fin) {
  const i = SRC.indexOf(inicio), j = SRC.indexOf(fin, i + inicio.length);
  assert.ok(i > 0 && j > i, 'block found: ' + inicio);
  return SRC.slice(i, j).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

test('Commissions reads never scan whole lists per commission line', () => {
  const liq = cuerpo('function getLiquidaciones(mes)', '\n  function ');
  const rep = cuerpo('function ventasParaReportes(uid)', 'const realFetch');
  for (const [nombre, src] of [['getLiquidaciones', liq], ['ventasParaReportes', rep]]) {
    assert.doesNotMatch(src, /\bventas\.find\(/, nombre + ': no ventas.find');
    assert.doesNotMatch(src, /\bproductos\.find\(/, nombre + ': no productos.find');
    assert.doesNotMatch(src, /\bajustesComision\.find\(/, nombre + ': no ajustesComision.find');
  }
  assert.doesNotMatch(rep, /\b(clientes|promotoras|ubicaciones)\.find\(/, 'ventasParaReportes: no per-sale person/shelf/client scan');
});

test('a big store keeps exact names and amounts in Commissions and Sold', async () => {
  const w = browser(); w.OCAuth = { rolActual: () => 'dueno' };
  const pr = await w.request('/api/promotoras', 'POST', { nombre: 'Asociada', comisionBase: 30, telefono: '0999999999' });
  const prId = pr.id || pr.promotora.id;
  const u = await w.request('/api/ubicaciones', 'POST', { nombre: 'Percha' }); const uid = u.id || u.ubicacion.id;
  const p = await w.request('/api/productos', 'POST', { nombre: 'Libro base', barcode: 'SYN-778', stockInicial: 99999, precio: 12, costo: 4, ubicacionId: uid });
  const pid = p.id || p.producto.id;
  await w.request('/api/productos/' + pid + '/venta', 'POST', { cantidad: 1, modoComision: 'associate', promotoraId: prId, opId: 'op-syn-7780' });
  const ls = w.localStorage, st = JSON.parse(ls.getItem('f123_estado_v4_' + ls.getItem('f123_estado_v4_ptr')));
  const v0 = st.ventas.find(v => v.productoId === pid), prod0 = st.productos.find(x => x.id === pid);
  const N = 1500, P = 150, ahora = Date.now();
  for (let i = 1; i < P; i++) st.productos.push({ ...prod0, id: 'synp' + i, nombre: 'Libro ' + i, sku: 'S' + i, barcode: 'SYN-B' + i });
  st.ventas = [];
  for (let i = 0; i < N; i++) st.ventas.push({ ...v0, id: 'synv' + i, opId: 'op-syn-x' + i, productoId: 'synp' + (1 + i % (P - 1)),
    fecha: new Date(ahora - (i % 20) * 3600000).toISOString() });
  delete st._abCommit; delete st._rev;
  const w2 = browser(); w2.OCAuth = { rolActual: () => 'dueno' };
  const imp = await w2.fetch('/api/respaldo/importar', { method: 'POST', body: JSON.stringify(st) });
  assert.equal(imp.status, 200, 'synthetic store imported');

  const filas = await w2.request('/api/ventas/todas?ubicacionId=todas');
  assert.equal(filas.length, N);
  assert.ok(filas.every(f => /^Libro \d+$/.test(f.productoNombre)), 'every sale keeps its product name');
  assert.ok(filas.every(f => f.ubicacionTipo !== ''), 'every sale keeps its shelf');

  const liq = await w2.request('/api/liquidaciones?mes=');
  const percha = liq.find(l => l.ubicacionId === uid);
  assert.ok(percha, 'shelf settlement present');
  assert.ok(percha.payoutStatementLines.length > 0, 'statement lines present');
  assert.ok(percha.payoutStatementLines.every(l => /^Libro \d+$/.test(l.producto)), 'statement lines keep product names');
  assert.ok(percha.detallePendientes.every(d => /^Libro \d+$/.test(d.producto)), 'pending detail keeps product names');
  const sumaVentas = filas.filter(f => f.delMesActual).reduce((s, f) => s + (Number(f.comisionAsociado) || 0), 0);
  assert.ok(Math.abs(sumaVentas - percha.comisionSocio) < 0.01, 'associate total matches Sold rows: ' + sumaVentas + ' vs ' + percha.comisionSocio);
});
