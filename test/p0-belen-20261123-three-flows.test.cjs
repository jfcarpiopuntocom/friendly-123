'use strict';
// Belén / idiomARTE support contract, 2026-11-23.
// Synthetic and read-only: no browser profiles, licenses, receipts or production data.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const cp = require('node:child_process');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const ui = read('docs/plan-pagos-ui.js');
const servedPaymentUI = read('docs/plan-pagos-ui.min.js');
const app = read('src/app/app-inline-01.js');
const bundle = read('docs/app-inline-01.min.js');
const backend = read('docs/mock-backend.js');

test('all edited runtime scripts parse (both source and served bundle)', () => {
  for (const file of ['docs/plan-pagos-ui.js', 'src/app/app-inline-01.js',
                      'docs/app-inline-01.min.js', 'docs/mock-backend.js']) {
    cp.execFileSync(process.execPath, ['--check', path.join(root, file)]);
  }
});

test('the HTML serves the exact payment UI carrying the partial-payment rescue button', () => {
  const html = read('docs/index.html');
  assert.match(html, /src="\.\/plan-pagos-ui\.min\.js"/);
  assert.match(servedPaymentUI, /pp-ab-change/, 'RESUME action must exist in served script');
  assert.match(servedPaymentUI, /pp-ab-partial-hint/, 'partial payment guidance must reach Safari');
  assert.match(servedPaymentUI, /montoEditadoPorOperador/, 'the served code must preserve manual amount');
});

test('new product Category is removed from both entry forms, while edit keeps category', () => {
  for (const script of [app, bundle]) {
    const field = /<input id="np-categoria"[^>]*>/g;
    assert.equal((script.match(field) || []).length, 0);
    assert.match(script, /categoria:\s*val\("np-categoria"\)/);
    assert.match(script, /id="ed-categoria"/);
    assert.match(script, /id="np-nombre"/);
  }
});

test('selected consumption offers its full amount but manual partial amount remains authoritative', () => {
  assert.match(ui, /montoEditadoPorOperador/);
  assert.match(ui, /if \(elegidos\.length && !montoEditadoPorOperador\)/);
  const start = ui.indexOf('function partesElegidas(monto) {');
  const end = ui.indexOf('\n    /* Contexto ANTES', start);
  assert.ok(start > 0 && end > start);
  const functionSource = ui.slice(start, end);
  const node = {
    getAttribute: name => name === 'data-k' ? 'venta:synthetic-001' : '35'
  };
  const panel = { querySelectorAll: () => [node] };
  const q = () => panel;
  const calcular = new Function('q', 'elegidos', functionSource +
    '\nreturn partesElegidas;')(q, ['venta:synthetic-001']);
  assert.deepEqual(calcular(10), [{ cargoKey: 'venta:synthetic-001', monto: 10 }]);
  assert.deepEqual(calcular(35), [{ cargoKey: 'venta:synthetic-001', monto: 35 }]);
  assert.deepEqual(calcular(40), [{ cargoKey: 'venta:synthetic-001', monto: 35 }]);
  assert.match(ui, /asignadoCentavos !== centavos/); // $40 cannot be credited to a $35 selection.
});

test('pending $35 reference may be changed only before the original payment write-ahead exists', () => {
  assert.match(ui, /pendienteAsignacion && !anterior && !pendienteAsignacion\.abonoId/);
  assert.match(ui, /if \(!pendienteAsignacion \|\| pendienteAsignacion\.abonoId \|\|[\s\S]*?await leerReferenciaDurable\(clienteId, "payment"\)\)/);
  assert.match(ui, /await _pagoLiberarReferencia\(claveAsignacion/);
  assert.match(ui, /if \(await leerReferenciaDurable\(clienteId, "allocation"\)\)/);
  assert.match(ui, /payload\.opId = intencionId/);
  assert.match(ui, /previo\.monto !== payload\.monto/);
});

test('Sold UI sends historical sale date with the original event date independent (both bundles)', () => {
  for (const script of [app, bundle]) {
    assert.match(script, /id="vi-fecha-venta" type="date"/);
    assert.match(script, /fechaVenta:\s*g\("vi-fecha-venta"\)/);
    assert.match(script, /fechaEvento:\s*g\("vi-fecha"\)/);
  }
});

test('historical date validation rejects malformed and impossible days before any sale write', () => {
  const start = backend.indexOf('const _fechaVentaTexto = String(_infoPago.fechaVenta');
  const end = backend.indexOf('const _esTicket = ', start);
  assert.ok(start > 0 && end > start);
  const validate = new Function('_infoPago', 'J', backend.slice(start, end) +
    '\nreturn { iso: _fechaVentaIso, dia: _fechaVentaTexto };');
  const J = (value, status) => ({ ...value, status });
  assert.equal(validate({fechaVenta:'2026-06-23'}, J).iso, '2026-06-23T12:00:00.000Z');
  assert.equal(validate({fechaVenta:'2024-02-29'}, J).iso, '2024-02-29T12:00:00.000Z');
  assert.equal(validate({fechaVenta:''}, J).iso, null);
  for (const bad of ['2026-02-30', '2026-13-01', '2026-11-31', 'not-a-date', '2026-11-01T00:00']) {
    assert.equal(validate({fechaVenta:bad}, J).status, 400, bad);
  }
});

test('sale date is projected into historical commission month without falsifying registration timestamp', () => {
  assert.match(backend, /const _mesVenta = fechaLocalDe\(_fechaVentaIso \|\| new Date\(\)\.toISOString\(\)\)\.slice\(0, 7\)/);
  assert.match(backend, /esDelMes\(v\.fecha, _mesVenta, v\.relojDesfaseMs\)/);
  assert.match(backend, /fecha: _fechaVentaIso \|\| new Date\(\)\.toISOString\(\), \.\.\.\(_fechaVentaIso \? \{ registradaEn: new Date\(\)\.toISOString\(\) \} : \{\}\)/);
  assert.match(backend, /fechaEnReintento !== String\(\(ya\.info && ya\.info\.fechaVenta\) \|\| ""\)/);
  assert.match(backend, /fechaVenta: _fechaVentaTexto/);
});

test('historic Sale date Spanish label uses real es-US locale in source and served bundle', () => {
  assert.match(read('docs/i18n.js'), /return lang === "en" \? "en-US" : "es-US"/);
  for (const script of [app, bundle]) {
    assert.match(script, /OCI18n\.locale\(\)\.startsWith\("es"\)[\s\S]{0,150}Fecha de venta/);
    assert.match(script, /id="vi-fecha-venta" type="date"/);
  }
});
