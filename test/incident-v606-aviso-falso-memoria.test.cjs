'use strict';
// (JFC 2026-10-28) v606: el cartel "memoria llena" solo sale con un error REAL de cuota.
// AbortError (candado "f123-estado-ab" vencido) o cualquier otro error: sin cartel, un solo reintento silencioso.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { browser } = require('./helpers/browser.cjs');

function app(errorFactory) {
  const w = browser();
  const timers = [];
  w.setTimeout = (fn, ms) => { timers.push({ fn, ms }); return timers.length; };
  // Web Locks que rechaza como lo haria el candado vencido (AbortError) o una cuota real.
  // El candado "f123-escrituras" funciona normal; solo "f123-estado-ab" falla.
  w.navigator.locks = { request: (nombre, o, cb) => String(nombre).startsWith('f123-estado-ab') ? Promise.reject(errorFactory()) : Promise.resolve((cb || o)()) };
  const llenas = () => (w.__ocFallos || []).filter((f) => f[1] === 'memoria-llena').length;
  return { w, timers, llenas };
}
const dom = (name, code) => { const e = new Error(name); e.name = name; if (code) e.code = code; return e; };

test('AbortError en el candado: NO cartel de memoria llena, devuelve false y programa UN reintento', async () => {
  const { w, timers, llenas } = app(() => dom('AbortError'));
  // fuerza dos guardados fallidos seguidos: el reintento no se apila
  await w.fetch('/api/productos', { method: 'POST', body: JSON.stringify({ nombre: 'S1', barcode: 'A1', precio: 1, costo: 1, stockInicial: 1 }) });
  await w.fetch('/api/productos', { method: 'POST', body: JSON.stringify({ nombre: 'S2', barcode: 'A2', precio: 1, costo: 1, stockInicial: 1 }) });
  await new Promise((r) => setImmediate(r));
  assert.equal(llenas(), 0, 'sin aviso falso de memoria llena');
  const reint = timers.filter((t) => t.ms === 3000);
  assert.equal(reint.length, 1, 'exactamente un reintento programado (no apilado)');

});

for (const [nombre, code] of [['QuotaExceededError', 22], ['NS_ERROR_DOM_QUOTA_REACHED', 1014], ['DOMException', 22]]) {
  test('error de cuota real (' + nombre + '/' + code + ') SI muestra el aviso', async () => {
    const { w, timers, llenas } = app(() => dom(nombre, code));
    await w.fetch('/api/productos', { method: 'POST', body: JSON.stringify({ nombre: 'S1', barcode: 'Q1', precio: 1, costo: 1, stockInicial: 1 }) });
    await new Promise((r) => setImmediate(r));
    assert.ok(llenas() >= 1, 'aviso de cuota real');
    assert.equal(timers.filter((t) => t.ms === 3000).length, 0, 'sin reintento silencioso por cuota');
  });
}
