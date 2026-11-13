'use strict';
// v755: a strict sale serializes the full state once before answering; the A/B
// backup goes after the answer; a hung IndexedDB falls back to the A/B journal.
const test = require('node:test');
const assert = require('node:assert/strict');
const { browser } = require('./helpers/browser.cjs');

function app() {
  const w = browser();
  w.localStorage.setItem('f123_device_id', 'synthetic-v755-device');
  w.OCSyncEmit = () => true;
  const timers = [];
  w.setTimeout = (fn, ms) => { timers.push({ fn, ms }); return timers.length; };
  return { w, timers };
}
const vender = (w, id) => w.fetch('/api/productos/' + id + '/venta', { method: 'POST', body: JSON.stringify({ cantidad: 1 }) });
const conStock = async w => (await w.request('/api/respaldo/exportar')).productos.find(p => p.stockActual > 2);
const abConfirmado = w => {
  const k = [...Array(w.localStorage.length)].map((_, i) => w.localStorage.key(i)).find(x => /_journal$/.test(x));
  const j = k ? JSON.parse(w.localStorage.getItem(k)) : null;
  return j && j.phase === 'COMMITTED' ? j.revision : 0;
};

test('strict sale with IDB ACK: one full serialization before answering, A/B backup after', async () => {
  const { w, timers } = app();
  const product = await conStock(w);
  const tam = JSON.stringify(await w.request('/api/respaldo/exportar')).length;
  w.OCEstadoIDB = { soportado: true, guardarConRevision: async () => true, guardar: async () => true, ultimoError: () => null };
  const original = JSON.stringify;
  let grandes = 0;
  JSON.stringify = function (...a) { const s = original.apply(JSON, a); if (s && s.length > tam / 2) grandes++; return s; };
  let response;
  try { response = await vender(w, product.id); } finally { JSON.stringify = original; }
  assert.equal(response.status, 200);
  assert.equal(grandes, 1, 'full-state serializations before the sale answers: ' + grandes);
  const rev = abConfirmado(w);
  for (const t of timers.splice(0)) if (t.ms === 0) t.fn();
  assert.ok(abConfirmado(w) > rev, 'A/B backup is still written after the answer');
});

test('strict sale with hung IndexedDB: A/B journal confirms it after the time limit', async () => {
  const { w, timers } = app();
  const product = await conStock(w);
  w.OCEstadoIDB = { soportado: true, guardarConRevision: () => new Promise(() => {}), guardar: async () => true, ultimoError: () => null };
  const pending = vender(w, product.id);
  for (let i = 0; i < 20; i++) await Promise.resolve();
  const limite = timers.find(t => t.ms >= 8000 && t.ms <= 10000);
  assert.ok(limite, 'a hung IndexedDB save must have an 8-10 s limit');
  limite.fn();
  const response = await pending;
  assert.equal(response.status, 200);
  assert.ok(abConfirmado(w) > 0, 'sale is durable in the A/B journal before answering');
  const after = await w.request('/api/respaldo/exportar');
  assert.equal(after.productos.find(p => p.id === product.id).stockActual, product.stockActual - 1);
});
