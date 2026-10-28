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

// ---- v605 tope anti-cuelgue (JFC 2026-10-28): guardado que nunca resuelve no debe colgar respuesta ni escrituras siguientes ----
// Candado de guardado que jamas resuelve; el de escrituras pasa directo. Reloj falso: el harness trae setTimeout inerte.
const stReal = global.setTimeout;
function relojFalso(w) {
  const pend = []; let id = 0;
  w.setTimeout = (cb, ms) => { pend.push({ id: ++id, cb, ms, vivo: true }); return id; };
  w.clearTimeout = (i) => { const t = pend.find((x) => x.id === i); if (t) t.vivo = false; };
  return { tope: () => pend.filter((t) => t.vivo && t.ms >= 10000).length, avanzar: () => { for (const t of pend.filter((x) => x.vivo && x.ms >= 10000)) { t.vivo = false; t.cb(); } } };
}
const conTope = (p, ms) => Promise.race([p, new Promise((_, rej) => stReal(() => rej(new Error('COLGADO')), ms))]);
const colgado = (w) => { w.navigator.locks = { request: (n, _o, cb) => /estado-ab/.test(n) ? new Promise(() => {}) : Promise.resolve().then(cb) }; };

test('v605 tope: guardado que nunca resuelve -> la respuesta vuelve y avisa motivo timeout; la siguiente escritura no se cuelga', async () => {
  const { w } = await aparato();
  const motivos = []; w.addEventListener('oc-guardado-fallo', (e) => motivos.push(e && e.detail && e.detail.motivo));
  colgado(w); const rel = relojFalso(w);
  const p1 = alta(w, 'Hang1'); let listo = false; p1.then(() => { listo = true; });
  for (let i = 0; i < 30; i++) await tick();
  assert.equal(listo, false, 'antes del tope sigue esperando el guardado');
  rel.avanzar();
  const r1 = await conTope(p1, 3000);
  assert.equal(r1.status, 200);
  assert.equal((await r1.json()).nombre, 'Hang1');
  assert.deepEqual(motivos, ['timeout']);
  const p2 = alta(w, 'Hang2');
  for (let i = 0; i < 30; i++) await tick();
  rel.avanzar();
  const r2 = await conTope(p2, 3000);
  assert.equal(r2.status, 200);
});

test('v605 tope: guardado que gana limpia el timer (no queda tope vivo)', async () => {
  const { w } = await aparato();
  w.navigator.locks = { request: (n, _o, cb) => Promise.resolve().then(cb) };
  const rel = relojFalso(w);
  const r = await conTope(alta(w, 'Rapido'), 3000);
  assert.equal(r.status, 200);
  assert.equal(rel.tope(), 0);
});

test('v605 tope: importar con guardado colgado -> 503 tras el tope', async () => {
  const { w, exp } = await aparato();
  colgado(w); const rel = relojFalso(w);
  const p = importar(w, exp); let r = null; p.then((x) => { r = x; });
  // el tope se arma tras aplicar el respaldo (varias vueltas): avanzar el reloj hasta que haya respuesta
  for (let i = 0; i < 200 && !r; i++) { await tick(); rel.avanzar(); }
  r = await conTope(p, 3000);
  assert.equal(r.status, 503);
});
