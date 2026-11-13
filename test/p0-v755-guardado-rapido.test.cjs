'use strict';
// v755: a strict sale serializes the full state once; the A/B backup is still
// committed before answering; a hung IndexedDB falls back to the A/B journal.
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

test('strict sale with IDB ACK: state serialized once, A/B backup committed before answering', async () => {
  const { w } = app();
  const product = await conStock(w);
  w.OCEstadoIDB = { soportado: true, guardarConRevision: async () => true, guardar: async () => true, ultimoError: () => null };
  const rev = abConfirmado(w);
  const original = JSON.stringify, parse = JSON.parse;
  let estados = 0, journals = 0;
  JSON.stringify = function (...a) { if (a[0] && typeof a[0] === 'object' && Array.isArray(a[0].productos)) estados++; return original.apply(JSON, a); };
  JSON.parse = function (...a) { const v = parse.apply(JSON, a); if (v && v.candidateRaw) journals++; return v; };
  let response;
  try { response = await vender(w, product.id); } finally { JSON.stringify = original; JSON.parse = parse; }
  assert.equal(response.status, 200);
  assert.equal(estados, 1, 'full-state serializations per sale: ' + estados);
  assert.ok(abConfirmado(w) > rev, 'A/B backup is committed before the sale answers');
  assert.ok(journals <= 1, 'journal parsed at most once per sale (cached by exact text): ' + journals);
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
