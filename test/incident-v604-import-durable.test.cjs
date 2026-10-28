'use strict';
// (JFC 2026-10-28) /api/respaldo/importar debe responder ok SOLO cuando el guardado ya esta en disco.
// Antes: guardarEstadoLocal() sin await -> "listo" mientras el candado Web Locks aun tenia el guardado en cola.
// Dos candados: 'f123-escrituras' (envoltorio de fetch, pasa directo) y 'f123-estado-ab:*' (guardado, el que se retrasa/falla).
// Harness sintetico: sin red ni datos reales; navigator.locks falso, controlado por la prueba.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { browser } = require('./helpers/browser.cjs');
const tick = () => new Promise((r) => setImmediate(r));

async function aparato() {
  const w = browser();
  const exp = await w.request('/api/respaldo/exportar');
  return { w, exp };
}
const importar = (w, exp) => w.fetch('/api/respaldo/importar', { method: 'POST', body: JSON.stringify(exp) });

test('importar: no responde ok hasta que el guardado duradero (candado) termino', async () => {
  const { w, exp } = await aparato();
  const eventos = []; let soltar;
  const puerta = new Promise((r) => { soltar = r; });
  w.navigator.locks = { request: async (n, _o, cb) => { if (!/estado-ab/.test(n)) return cb(); eventos.push('candado-pedido'); await puerta; const r = await cb(); eventos.push('guardado-hecho'); return r; } };
  const p = importar(w, exp).then((r) => { eventos.push('respuesta'); return r; });
  for (let i = 0; i < 20; i++) await tick();
  assert.ok(eventos.includes('candado-pedido'), 'el guardado esta esperando el candado');
  assert.ok(!eventos.includes('respuesta'), 'no hay respuesta mientras el guardado sigue en cola: ' + eventos);
  soltar();
  const r = await p;
  assert.equal(r.status, 200);
  assert.equal((await r.json()).ok, true);
  assert.deepEqual(eventos.slice(-2), ['guardado-hecho', 'respuesta']);
});

test('importar: si el guardado falla, responde error y no ok', async () => {
  const { w, exp } = await aparato();
  w.navigator.locks = { request: async (n, _o, cb) => { if (!/estado-ab/.test(n)) return cb(); throw new Error('lock caido'); } };
  const r = await importar(w, exp);
  const j = await r.json();
  assert.equal(r.status, 503);
  assert.notEqual(j.ok, true);
  assert.match(j.error, /could not be saved/);
});

// ---- Ruta central: toda mutacion espera su guardado (finally de _fetchInterno) ----
const alta = (w, n) => w.fetch('/api/ubicaciones', { method: 'POST', body: JSON.stringify({ nombre: n }) });

test('mutacion normal (crear percha): la respuesta espera al guardado en cola', async () => {
  const { w } = await aparato();
  const eventos = []; let soltar; const puerta = new Promise((r) => { soltar = r; });
  w.navigator.locks = { request: async (n, _o, cb) => { if (!/estado-ab/.test(n)) return cb(); eventos.push('pedido'); await puerta; const r = await cb(); eventos.push('guardado'); return r; } };
  const p = alta(w, 'Shelf D').then((r) => { eventos.push('respuesta'); return r; });
  for (let i = 0; i < 20; i++) await tick();
  assert.ok(eventos.includes('pedido') && !eventos.includes('respuesta'), 'sin respuesta con el guardado en cola: ' + eventos);
  soltar();
  const r = await p;
  assert.equal(r.status, 200);
  assert.deepEqual(eventos.slice(-2), ['guardado', 'respuesta']);
});

test('mutacion normal: si el guardado falla, conserva la respuesta original y avisa oc-guardado-fallo', async () => {
  const { w } = await aparato();
  let avisos = 0; w.addEventListener('oc-guardado-fallo', () => { avisos++; });
  w.navigator.locks = { request: async (n, _o, cb) => { if (!/estado-ab/.test(n)) return cb(); throw new Error('lock caido'); } };
  const r = await alta(w, 'Shelf F');
  assert.equal(r.status, 200, 'no se convierte en error (reintentar duplicaria)');
  assert.equal((await r.json()).nombre, 'Shelf F');
  assert.equal(avisos, 1);
});

test('sin deadlock: 20 mutaciones en serie y 5 en paralelo con candados reales (nombres distintos)', async () => {
  const { w } = await aparato();
  // Candado simulado con exclusion por nombre, como Web Locks: mismo nombre = cola.
  const colas = new Map();
  w.navigator.locks = { request: (n, _o, cb) => { const prev = colas.get(n) || Promise.resolve(); const run = prev.then(() => cb()); colas.set(n, run.catch(() => {})); return run; } };
  for (let i = 0; i < 20; i++) assert.equal((await alta(w, 'S' + i)).status, 200);
  const res = await Promise.all([0, 1, 2, 3, 4].map((i) => alta(w, 'P' + i)));
  assert.deepEqual(res.map((r) => r.status), [200, 200, 200, 200, 200]);
});

test('costo por mutacion (ms, fixture de 1000 productos)', async () => {
  const { w, exp } = await aparato();
  const base = exp.productos[0] || { nombre: 'x', precio: 1, costo: 1, stockActual: 1 };
  exp.productos = Array.from({ length: 1000 }, (_, i) => Object.assign({}, base, { id: 'pm' + i, nombre: 'Prod ' + i }));
  exp.ventas = []; exp.movimientos = [];
  await w.request('/api/respaldo/importar', 'POST', exp);
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < 20; i++) await alta(w, 'M' + i);
  console.log('MS_POR_MUTACION', (Number(process.hrtime.bigint() - t0) / 1e6 / 20).toFixed(1));
});
