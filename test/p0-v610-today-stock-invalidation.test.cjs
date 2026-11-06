'use strict';
// v610 invariant retained in v677: a successful adjustment invalidates Today.
// v677 defers the expensive hidden repaint until normal navigation; never stale on entry.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const src = fs.readFileSync(path.join(__dirname, '../src/app/app-inline-01.js'), 'utf8');

test('adjustment success refreshes Inventory only; Today remains fresh through existing navigation loader', async () => {
  const start = src.indexOf('      if (!res8.ok){ await ocAlert(r8.error); return; }');
  assert.ok(start >= 0, 'stock adjustment success guard must exist');
  const end = src.indexOf('\n    });', start);
  assert.ok(end > start, 'adjustment handler must close');
  const snippet = src.slice(start, end);
  assert.doesNotMatch(snippet, /fetch\(|\/ajustar|emitirOpStock|POST|registrarVenta/,
    'a successful UI refresh cannot issue a second business mutation');
  const calls = [];
  const execute = new Function('res8', 'r8', 'ocAlert', 'cargarInventario', 'cargarHoy',
    'return (async () => {\n' + snippet + '\n})();');
  await execute({ok:true}, {}, async()=>calls.push('alert'),
    async()=>calls.push('inventory'), async()=>calls.push('today'));
  assert.deepEqual(calls, ['inventory'], 'no hidden Today work on the critical Inventory path');
  calls.length = 0;
  await execute({ok:false}, {error:'synthetic error'}, async()=>calls.push('alert'),
    async()=>calls.push('inventory'), async()=>calls.push('today'));
  assert.deepEqual(calls, ['alert'], 'failed stock adjustment must not refresh as a successful write');

  // This is the same real loader used by the nav-click handler; check that
  // deferring Today does not make its dashboard stale on the next visit.
  const a = src.indexOf('function refrescarVistaActiva(){');
  const b = src.indexOf('// --- Logo header:', a);
  assert.ok(a > 0 && b > a, 'actual navigation refresh handler exists');
  const nav = src.slice(a,b);
  let active = 'hoy';
  const stub = () => {};
  const context = {
    Promise, console, window:{VPerchas:{cargar:stub}},
    vistaActivaId: () => active,
    cargarHoy: () => { calls.push('today'); return Promise.resolve(); },
    cargarInventario: () => { calls.push('inventory'); return Promise.resolve(); },
    cargarBCG: stub, cargarEtiquetas: stub, cargarAvanzado: stub,
    cargarComisiones: stub, cargarClientes: stub, cargarGastos: stub,
    poblarSelectClientes: stub, poblarSelectEventos: stub, cargarGridVender: stub
  };
  vm.runInNewContext(nav + '\nthis.refresh = refrescarVistaActiva;', context);
  context.refresh();
  assert.deepEqual(calls, ['today'], 'entering Today after inventory adjustment must load fresh model');
  calls.length = 0;
  active = 'inventario';
  context.refresh();
  assert.deepEqual(calls, ['inventory'], 'returning to Inventory refreshes Inventory only');
});
