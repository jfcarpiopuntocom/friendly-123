// JFC 2026-11-12 (PR 2 de 5): anular con guardado confirmado y marcha atras, y una sola
// funcion para "percha en 0 y faltante". No cambia lo que ve nadie cuando todo va bien.
// Roja en v744: la anulacion respondia 200 con el guardado caido, el stock quedaba sumado
// y la operacion ya habia salido a los otros aparatos.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { browser } = require('./helpers/browser.cjs');

async function conStock(w, id, n) {
  const fx = await w.request('/api/respaldo/exportar');
  const p = fx.productos.find((x) => x.stockActual >= 1);
  p.id = id; p.stockActual = n; delete p.stockBase; delete p.stockPN; delete p.stockDeficit;
  fx.productos = [p]; fx.ventas = []; fx.movimientos = [];
  await w.request('/api/respaldo/importar', 'POST', fx);
}
const estado = (w) => w.request('/api/respaldo/exportar');

test('void: the save fails halfway -> error, stock goes back, the sale stays alive and nothing leaves the device', async () => {
  const w = browser();
  await conStock(w, 'p-anula', 5);
  const v = await w.request('/api/productos/p-anula/venta', 'POST', { cantidad: 2 });
  const antes = await estado(w);
  const pAntes = antes.productos.find((p) => p.id === 'p-anula');
  assert.equal(pAntes.stockActual, 3);
  let emitidas = 0;
  w.OCSyncEmit = () => { emitidas++; };
  const setItem = w.localStorage.setItem.bind(w.localStorage);
  w.localStorage.setItem = () => { throw new Error('QuotaExceededError'); };
  w.OCEstadoIDB = { guardar: async () => { throw new Error('IDB down'); } };
  const r = await w.fetch('/api/ventas/' + v.ventaId + '/anular', { method: 'POST', body: '{}' });
  w.localStorage.setItem = setItem; delete w.OCEstadoIDB;
  assert.ok(r.status >= 500, 'the void must not claim success, got ' + r.status);
  const despues = await estado(w);
  const p = despues.productos.find((x) => x.id === 'p-anula');
  assert.equal(p.stockActual, 3, 'stock rolled back: no unit created');
  assert.deepEqual(p.stockPN, pAntes.stockPN, 'shared counter untouched');
  assert.equal(p.stockDeficit || 0, pAntes.stockDeficit || 0);
  const venta = despues.ventas.find((x) => x.id === v.ventaId);
  assert.ok(venta && !venta.anulada, 'the sale is still alive (money not removed)');
  assert.deepEqual(venta, antes.ventas.find((x) => x.id === v.ventaId), 'sale record byte-identical');
  assert.equal(despues.movimientos.length, antes.movimientos.length, 'no ghost log entry');
  assert.equal(emitidas, 0, 'no stock op leaves the device');

  // The same void works once storage is back, exactly once (idempotent on retry).
  const ok = await w.fetch('/api/ventas/' + v.ventaId + '/anular', { method: 'POST', body: '{}' });
  assert.equal(ok.status, 200);
  assert.equal(emitidas, 1, 'one stock op after the durable save');
  const fin = await estado(w);
  assert.equal(fin.productos.find((x) => x.id === 'p-anula').stockActual, 5);
  assert.equal(fin.ventas.find((x) => x.id === v.ventaId).anulada, true);
  const otra = await w.fetch('/api/ventas/' + v.ventaId + '/anular', { method: 'POST', body: '{}' });
  assert.equal(otra.status, 400, 'a second void of the same sale is refused');
  assert.equal((await estado(w)).productos.find((x) => x.id === 'p-anula').stockActual, 5, 'stock not added twice');
  assert.equal(emitidas, 1);
});

test('shelf-at-0-and-shortfall lives in ONE function used by sale, undo-cancel, sale edit and day close', () => {
  const src = fs.readFileSync(path.join(__dirname, '../docs/mock-backend.js'), 'utf8');
  const copia = 'p.stockDeficit = (Number(p.stockDeficit) || 0) - p.stockActual; p.stockActual = 0;';
  assert.equal(src.split(copia).length - 1, 1, 'the rule is written once');
  assert.equal(src.split('_perchaEnCeroYFaltante(p);').length - 1, 4, 'four callers');
});

test('pinning: selling more than the shelf has still shows 0 on the shelf and the shortfall apart', async () => {
  const w = browser();
  await conStock(w, 'p-falta', 1);
  const r = await w.fetch('/api/productos/p-falta/venta', { method: 'POST', body: JSON.stringify({ cantidad: 3 }) });
  assert.equal(r.status, 200);
  const p = (await estado(w)).productos.find((x) => x.id === 'p-falta');
  assert.equal(p.stockActual, 0); assert.equal(p.stockDeficit, 2);
});
