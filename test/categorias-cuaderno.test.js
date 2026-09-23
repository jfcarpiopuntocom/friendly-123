/* v347 — auditoría de Codex #2: las categorías propias/ocultas NO se cuelan de
   un cuaderno a otro en el mismo navegador. Antes, un aparato unido a OTRA
   tienda leía las listas globales del cuaderno propio y las sembraba en el
   catálogo de esa tienda. Fixtures sintéticos, sin red. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { browser } = require('./helpers/browser.cjs');

function ls() {
  const m = new Map();
  return { get length() { return m.size; }, key: i => [...m.keys()][i], getItem: k => m.get(k) ?? null,
    setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), _m: m };
}
const tiene = (cat, n) => (cat.categorias || []).some(r => String(r.nombre).toLowerCase() === n.toLowerCase());

test("a store joined on this device does not inherit the own notebook's categories", () => {
  const s = ls();
  s.setItem('f123_owned', JSON.stringify({ licenseCode: 'F123-SYNTH-MINE' }));
  s.setItem('f123_categorias_custom', JSON.stringify(['Solo de A']));
  s.setItem('f123_tienda_activa', '::F123-SYNTH-OTHER');
  s.setItem('f123_notebook_unificado_v2', '1'); // aparato ya migrado al cuaderno único (como todos hoy)
  const w = browser(s);
  assert.equal(w.OCTienda.esUnida(), true, 'fixture: el aparato está en otra tienda');
  assert.equal(tiene(w.OCSync.catalogoPropio(), 'Solo de A'), false, 'la categoría del cuaderno propio no viaja a la otra tienda');
  assert.deepEqual(JSON.parse(s.getItem('f123_categorias_custom')), ['Solo de A'], 'y la lista propia queda intacta');
});

test('the own notebook keeps reading the same key as always (nothing moves)', () => {
  const s = ls();
  s.setItem('f123_owned', JSON.stringify({ licenseCode: 'F123-SYNTH-MINE' }));
  s.setItem('f123_categorias_custom', JSON.stringify(['De siempre']));
  const w = browser(s);
  assert.equal(w.OCSync.claveCategorias('f123_categorias_custom'), 'f123_categorias_custom');
  assert.equal(tiene(w.OCSync.catalogoPropio(), 'De siempre'), true);
});
