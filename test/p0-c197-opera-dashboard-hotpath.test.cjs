'use strict';
// C197: execute the real production source; no benchmark-only replacement logic.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');

test('Opera Air Today: one Intl.DateTimeFormat per zone, not per historical sale', () => {
  const code = fs.readFileSync(path.join(root, 'docs/core/business-read-model.js'), 'utf8');
  let constructions = 0;
  class CountFormat extends Intl.DateTimeFormat {
    constructor(...args) { super(...args); constructions++; }
  }
  const ctx = { module: { exports: {} }, Intl: { DateTimeFormat: CountFormat }, Date };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(code, ctx, { filename: 'docs/core/business-read-model.js' });
  const reader = ctx.module.exports;
  for (let i = 0; i < 2500; i++) {
    assert.equal(reader.day('2026-11-22T14:03:00.000Z', 'America/Guayaquil'), '2026-11-22');
  }
  assert.equal(constructions, 1, 'date formatter must be reused across the full ledger');
  assert.equal(reader.day('2026-11-22T02:00:00.000Z', 'America/New_York'), '2026-11-21');
  assert.equal(constructions, 2, 'a distinct zone gets its own formatter');
  for (let i = 0; i < 50; i++) reader.day('2026-11-22T14:03:00.000Z', 'America/Guayaquil');
  assert.equal(constructions, 2, 'switching zones does not invalidate the bounded cache');
});

test('Opera Air dashboard: indexed return lookups preserve historical first-match semantics', () => {
  const src = fs.readFileSync(path.join(root, 'docs/mock-backend.js'), 'utf8');
  const from = src.indexOf('const ajustesPorId = new Map(), devolucionesPorVenta = new Map();');
  const to = src.indexOf('const dailyProjection = dailyReader ?', from);
  assert.ok(from >= 0 && to > from, 'actual Today production path must use indexes');
  const segment = src.slice(from, to);
  assert.ok(!segment.includes('ajustesComision.find('), 'no quadratic adjustment search inside sales map');
  const make = new Function('ajustesComision', 'dailyReader', segment + '\nreturn fechaDevolucionIndexed;');
  const fixtures = [
    { id: 'a', tipo: 'devolucion', ventaId: 'sale1', fecha: '2026-11-01' },
    { id: 'b', tipo: 'otro', fecha: '2026-11-02' },
    { id: 'c', tipo: 'devolucion', ventaId: 'sale1', fecha: '2026-11-03' },
    { id: 'd', tipo: 'devolucion', ventaId: 'sale2', fecha: '2026-11-04' },
    { tipo: 'otro', fecha: '2026-11-05' },
    { id: 'last', tipo: 'devolucion', ventaId: 'sale3', fecha: '2026-11-06' }
  ];
  const cases = [
    { id: 'sale1' }, { id: 'sale1', devolucionId: 'c' },
    { id: 'sale2', devolucionId: 'b' }, { id: 'sale3' },
    { id: 'unknown' }, { id: 'unknown', devolucionId: 'none' },
    { id: 'sale3', fechaDevolucion: '2026-11-22' }
  ];
  for (const v of cases) {
    const old = v.fechaDevolucion || (fixtures.find(a => a && (a.id === v.devolucionId ||
      (a.tipo === 'devolucion' && a.ventaId === v.id))) || {}).fecha;
    assert.equal(make(fixtures, true)(v), old, JSON.stringify(v));
  }
  const many = Array.from({ length: 3000 }, (_, i) => ({
    id: 'aj-' + i, tipo: i % 3 ? 'other' : 'devolucion',
    ventaId: 'sale-' + (i % 101), fecha: '2026-11-' + String(i % 28 + 1).padStart(2, '0')
  }));
  const read = make(many, true);
  for (let i = 0; i < 2000; i += 17) {
    const v = { id: 'sale-' + (i % 101), devolucionId: i % 2 ? 'aj-' + (i % 3000) : undefined };
    assert.equal(read(v), (many.find(a => a && (a.id === v.devolucionId ||
      (a.tipo === 'devolucion' && a.ventaId === v.id))) || {}).fecha);
  }
});

test('Opera Air Today and week: the two real hot paths do not use nested linear sale lookups', () => {
  const src = fs.readFileSync(path.join(root, 'docs/mock-backend.js'), 'utf8');
  const from = src.indexOf('if (path === "/api/dashboard")');
  const to = src.indexOf('if (path === "/api/productos"', from);
  assert.ok(from >= 0 && to > from);
  const dashboard = src.slice(from, to);
  assert.ok(!dashboard.includes('ajustesComision.find('));
  assert.ok(!dashboard.includes('ventas.find('));
  assert.match(dashboard, /ventasPorIdSemana\.get\(a\.ventaId\)/);
  const daily = src.slice(src.indexOf('function devolucionesHoyDe(uid)'), src.indexOf('function ventasHoyDe(uid)'));
  assert.ok(!daily.includes('ventas.find('));
});
