// SELLO DE RELOJ EN CADA VENTA (JFC 2026-10-01: "worlds best practices, datos de miles de tiendas").
// Cada venta nueva guarda cuanto iba corrido el reloj del aparato (relojDesfaseMs/relojMargenMs),
// sin reescribir nada; el campo sobrevive a exportar/importar el respaldo; sin medicion no se inventa.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { browser } = require('./helpers/browser.cjs');

async function venta(w) {
  const r = await w.request('/api/ubicaciones', 'POST', { nombre: 'Rack Reloj', tipo: 'propia' });
  const p = await w.request('/api/productos', 'POST', { nombre: 'Taza', barcode: 'TZ-' + Math.random().toString(36).slice(2, 7), precio: 10, costo: 4, stockInicial: 5, ubicacionId: r.id });
  const v = await w.request(`/api/productos/${p.id}/venta`, 'POST', { cantidad: 1 });
  const exp = await w.request('/api/respaldo/exportar');
  return { v, exp, guardada: exp.ventas.find((x) => x.id === v.ventaId) };
}

test('1. con medicion fresca, la venta guarda el desfase y su margen', async () => {
  const w = browser(); w.OCAuth = { rolActual: () => 'dueno' };
  w.OCLatencia = { sello: () => ({ relojDesfaseMs: 90000, relojMargenMs: 40 }) };
  const { guardada } = await venta(w);
  assert.equal(guardada.relojDesfaseMs, 90000);
  assert.equal(guardada.relojMargenMs, 40);
});

test('2. sin medicion, no se inventa: la venta no trae el campo', async () => {
  const w = browser(); w.OCAuth = { rolActual: () => 'dueno' };
  const { guardada } = await venta(w);
  assert.ok(guardada, 'la venta se guardo igual (nunca se bloquea)');
  assert.equal('relojDesfaseMs' in guardada, false);
});

test('3. exportar e importar el respaldo conserva el sello', async () => {
  const w = browser(); w.OCAuth = { rolActual: () => 'dueno' };
  w.OCLatencia = { sello: () => ({ relojDesfaseMs: -120000, relojMargenMs: 15 }) };
  const { v, exp } = await venta(w);
  const w2 = browser(); w2.OCAuth = { rolActual: () => 'dueno' };
  await w2.request('/api/respaldo/importar', 'POST', exp);
  const otra = (await w2.request('/api/respaldo/exportar')).ventas.find((x) => x.id === v.ventaId);
  assert.equal(otra.relojDesfaseMs, -120000);
  assert.equal(otra.relojMargenMs, 15);
});

test('4. OCLatencia.sello real: {} sin ping; desfase y margen con ping', () => {
  const ctx = { window: {}, Date, Math, console };
  vm.runInNewContext(fs.readFileSync(__dirname + '/../docs/sync-latencia.js', 'utf8'), ctx);
  const L = ctx.window.OCLatencia;
  assert.deepEqual({ ...L.sello() }, {});
  const t = Date.now(); L.anotarPing(t, t + 10 + 90000, t + 20);
  assert.deepEqual({ ...L.sello() }, { relojDesfaseMs: 90000, relojMargenMs: 10 });
});
