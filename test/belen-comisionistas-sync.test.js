// Caso Belen / idiomARTE (JFC 2026-09-25): en un telefono de su licencia Commissions solo
// muestra a Casey Nguyen y Jamie Ortiz (pr01/pr02, semilla VIEJA de julio-agosto, campo
// "comision" en vez de "comisionBase"); sus comisionistas reales viven en OTRO aparato de la
// misma licencia. Aqui: A tiene semilla vieja + reales, B solo la semilla vieja. Tras el
// sync, B debe ver a los reales. Datos sinteticos; ningun dato real de la clienta.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { browser } = require('./helpers/browser.cjs');

async function aparatoConSemillaVieja() {
  const w = browser();
  w.OCAuth = { rolActual: () => 'dueno' };
  const bk = await w.request('/api/respaldo/exportar');
  bk.promotoras = [{ id: 'pr01', nombre: 'Jamie Ortiz', comision: 10 }, { id: 'pr02', nombre: 'Casey Nguyen', comision: 8 }];
  await w.request('/api/respaldo/importar', 'POST', bk);
  return w;
}

test('B (solo semilla vieja) recibe por sync los comisionistas reales creados en A', async () => {
  const a = await aparatoConSemillaVieja();
  const b = await aparatoConSemillaVieja();
  b.receive(a);
  await a.request('/api/promotoras', 'POST', { nombre: 'Real Uno', comisionBase: 30 });
  await a.request('/api/promotoras', 'POST', { nombre: 'Real Dos', comisionBase: 25 });
  b.receive(a);
  const nombres = (await b.request('/api/promotoras')).map((p) => p.nombre).sort();
  assert.deepEqual(nombres, ['Casey Nguyen', 'Jamie Ortiz', 'Real Dos', 'Real Uno']);
});

test('reales creados en A ANTES de que B existiera tambien llegan (primer enganche)', async () => {
  const a = await aparatoConSemillaVieja();
  await a.request('/api/promotoras', 'POST', { nombre: 'Real Uno', comisionBase: 30 });
  const b = await aparatoConSemillaVieja();
  b.receive(a);
  const nombres = (await b.request('/api/promotoras')).map((p) => p.nombre);
  assert.ok(nombres.includes('Real Uno'), 'llegaron: ' + nombres.join(', '));
});
