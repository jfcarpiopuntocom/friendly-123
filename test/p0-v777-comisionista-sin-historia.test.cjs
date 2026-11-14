'use strict';
// v777 (JFC 13 nov 2026: «me deja vender siempre y cuando no asigne comisionista»; Safari «A problem repeatedly occurred»).
// After a sale with an associate, the WhatsApp notice used to fetch /api/ventas/todas (commission ledger of the WHOLE
// history). The sale now returns this sale's notice figures, and the notice never asks for the whole history.
// Synthetic data only; real mock-backend in the vm browser helper.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { browser } = require('./helpers/browser.cjs');

test('a sale with an associate returns the notice figures of THIS sale', async () => {
  const w = browser();
  w.OCAuth = { rolActual: () => 'dueno' };
  const pr = await w.request('/api/promotoras', 'POST', { nombre: 'Asociada Prueba', comisionBase: 30, telefono: '0999999999' });
  const prId = pr.id || (pr.promotora && pr.promotora.id);
  assert.ok(prId, 'associate created: ' + JSON.stringify(pr).slice(0, 120));
  const u = await w.request('/api/ubicaciones', 'POST', { nombre: 'Percha prueba' });
  const uid = u.id || (u.ubicacion && u.ubicacion.id);
  assert.ok(uid, 'shelf created: ' + JSON.stringify(u).slice(0, 120));
  const p = await w.request('/api/productos', 'POST', { nombre: 'Libro prueba', barcode: 'SYN-777', stockInicial: 5, precio: 12, costo: 4, ubicacionId: uid });
  const pid = p.id || (p.producto && p.producto.id);
  const v = await w.request('/api/productos/' + pid + '/venta', 'POST', { cantidad: 1, modoComision: 'associate', promotoraId: prId, opId: 'op-syn-777' });
  assert.ok(v.ventaId, 'sale recorded: ' + JSON.stringify(v).slice(0, 160));
  assert.ok(v.avisoComisionista, 'notice figures returned');
  assert.equal(v.avisoComisionista.promotoraId, prId);
  assert.ok(Number(v.avisoComisionista.comision) > 0);
  assert.equal(v.avisoComisionista.cantidad, 1);
  assert.equal(v.avisoComisionista.productoNombre, 'Libro prueba');
});

test('a counter sale returns no notice', async () => {
  const w = browser();
  w.OCAuth = { rolActual: () => 'dueno' };
  const p = await w.request('/api/productos', 'POST', { nombre: 'Libro mostrador', barcode: 'SYN-778', stockInicial: 5, precio: 12, costo: 4 });
  const pid = p.id || (p.producto && p.producto.id);
  const v = await w.request('/api/productos/' + pid + '/venta', 'POST', { cantidad: 1, modoComision: 'counter', opId: 'op-syn-778' });
  assert.ok(v.ventaId);
  assert.equal(v.avisoComisionista, null);
});

test('the associate notice never fetches the whole sales history', () => {
  const src = fs.readFileSync(path.join(__dirname, '../src/app/app-inline-01.js'), 'utf8');
  const i = src.indexOf('async function ofrecerAvisoComisionista('), j = src.indexOf('\n}', i);
  assert.ok(i > 0 && j > i);
  const cuerpo = src.slice(i, j).replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(cuerpo, /ventas\/todas/, 'no /api/ventas/todas in the notice');
  assert.match(src, /ofrecerAvisoComisionista\(data\.ventaId, [^)]*data\.avisoComisionista\)/, 'the sale passes its own figures');
});
