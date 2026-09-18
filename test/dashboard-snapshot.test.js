const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

test('dashboard commits a complete finance snapshot without mixing responders', () => {
  const html = fs.readFileSync(path.join(__dirname, '../docs/dashboard.html'), 'utf8');
  const code = html.slice(html.indexOf('  function recibirTrozo(p) {'), html.indexOf('  /* ---------------------------------------------------------------- VISTAS */'));
  const shown = [];
  const node = { textContent: '' };
  const c = { datos: { productos: [{ id: 'old' }] }, fotoEnCurso: '', fotoFecha: '',
    esperados: {}, recibidos: {}, fotoTemporal: {}, totalTrozos: 0, clavesTrozos: {},
    ultimoDato: 0, $: () => node, pulso() {}, mostrar() { shown.push(this.datos); },
    Date, Number, Object, String };
  vm.createContext(c);
  vm.runInContext(code + '\nthis.receive = recibirTrozo;', c);
  const part = (fotoId, time, k, tabla, filas) => ({ fotoId, generadaEn: time, k, deTotal: 3,
    tabla, i: 0, total: 1, filas, negocio: 'Fixture store' });
  c.receive(part('a', '2026-09-18T12:00:00Z', 0, 'productos', [{ id: 'stale' }]));
  c.receive(part('b', '2026-09-18T12:01:00Z', 0, 'productos', [{ id: 'new' }]));
  c.receive(part('a', '2026-09-18T12:00:00Z', 1, 'gastos', [{ id: 'stale-expense' }]));
  assert.equal(shown.length, 0);
  assert.equal(c.datos.productos[0].id, 'old');
  c.receive(part('b', '2026-09-18T12:01:00Z', 2, 'hechosFinancieros', [{ id: 'fact' }]));
  assert.equal(shown.length, 0);
  c.receive(part('b', '2026-09-18T12:01:00Z', 1, 'gastos', [{ id: 'expense' }]));
  assert.equal(shown.length, 1);
  assert.equal(c.datos.productos[0].id, 'new');
  assert.equal(c.datos.gastos[0].id, 'expense');
  assert.equal(c.datos.hechosFinancieros[0].id, 'fact');
});
