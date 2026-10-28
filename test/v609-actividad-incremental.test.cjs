'use strict';
// v609: el camino incremental de _actividadUnir debe dar EXACTAMENTE lo mismo que la reconstruccion completa.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const src = fs.readFileSync(path.join(__dirname, '..', 'docs', 'mock-backend.js'), 'utf8').replace(/\r\n/g, '\n');
const i = src.indexOf('  function _actividadClave'), j = src.indexOf('  function _actividadExportable');
assert.ok(i > 0 && j > i, 'bloque _actividadUnir encontrado');
const { unir, clave } = new Function('clonar', src.slice(i, j) + '\nreturn {unir:_actividadUnir,clave:_actividadClave};')(o => JSON.parse(JSON.stringify(o)));
let seed = 11; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const hex = () => Array.from({ length: 8 }, () => '0123456789abcdef'[(rnd() * 16) | 0]).join('');
const origenes = ['inst-a', 'inst-b', 'Inst-C'];
const env = (o, n, mut) => { const id = 'ev' + n; return { id: clave(o, 'evento', id), origen: o, clase: 'evento', versiones: [{ id, tipo: 'venta', fecha: '2026-10-28T10:00:0' + (mut ? 1 : 0) + 'Z', sello: hex(), prevSello: hex() }] }; };
const copia = x => JSON.parse(JSON.stringify(x));
test('incremental == reconstruccion completa, con versiones en conflicto y ids nuevos intercalados', () => {
  let acc = [];
  for (let r = 0; r < 25; r++) {
    const lote = Array.from({ length: 15 }, (_, k) => env(origenes[k % 3], r * 9 + k, rnd() < 0.25));
    const inc = unir(acc, copia(lote));
    const completo = unir([], copia(acc).concat(copia(lote)));
    assert.deepStrictEqual(inc, completo, 'paso ' + r);
    acc = inc;
  }
  assert.deepStrictEqual(unir(acc, copia(acc)), unir([], copia(acc)), 'unirse consigo mismo no cambia nada');
});
test('entrada invalida sigue lanzando', () => {
  assert.throws(() => unir([], [{ id: 'x', origen: '', clase: 'evento', versiones: [{}] }]), /Invalid shared activity envelope/);
});
