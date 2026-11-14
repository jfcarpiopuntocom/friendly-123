'use strict';
// v779 («Resumen al día», JFC 13 nov 2026): a sale marks window.__f123UltimaVentaMs so sync-yjs.js does not rebuild the
// store summary (checkpoint) during the next 30 s. Synthetic data only; real mock-backend in the vm browser helper.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { browser } = require('./helpers/browser.cjs');

test('a sale marks the time of the last sale', async () => {
  const w = browser(); w.OCAuth = { rolActual: () => 'dueno' };
  const p = await w.request('/api/productos', 'POST', { nombre: 'Libro pausa', barcode: 'SYN-779', stockInicial: 5, precio: 12, costo: 4 });
  const pid = p.id || (p.producto && p.producto.id);
  assert.equal(w.__f123UltimaVentaMs, undefined, 'no sale yet');
  const antes = Date.now();
  const v = await w.request('/api/productos/' + pid + '/venta', 'POST', { cantidad: 1, modoComision: 'counter', opId: 'op-syn-7790' });
  assert.ok(v.ventaId, 'sale recorded');
  assert.ok(w.__f123UltimaVentaMs >= antes && w.__f123UltimaVentaMs <= Date.now(), 'marked at sale time');
});
