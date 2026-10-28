'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const src = fs.readFileSync(path.join(__dirname, '../src/app/app-inline-01.js'), 'utf8');

test('successful stock adjustment invalidates both Inventory and Today, without issuing another mutation', async () => {
  const start = src.indexOf('      if (!res8.ok){ await ocAlert(r8.error); return; }');
  assert.ok(start >= 0, 'stock adjustment success guard must exist');
  const end = src.indexOf('\n    });', start);
  assert.ok(end > start, 'adjustment handler must close');
  const snippet = src.slice(start, end);
  assert.match(snippet, /Promise\.all\(\[cargarInventario\(\), cargarHoy\(\)\]\)/);
  assert.doesNotMatch(snippet, /fetch\(|\/ajustar|emitirOpStock|POST|registrarVenta/);
  const calls = [];
  const execute = new Function('res8', 'r8', 'ocAlert', 'cargarInventario', 'cargarHoy',
    'return (async () => {\n' + snippet + '\n})();');
  await execute({ok:true}, {}, async()=>calls.push('alert'),
    async()=>calls.push('inventory'), async()=>calls.push('today'));
  assert.deepEqual(calls, ['inventory','today']);
  calls.length=0;
  await execute({ok:false}, {error:'synthetic error'}, async()=>calls.push('alert'),
    async()=>calls.push('inventory'), async()=>calls.push('today'));
  assert.deepEqual(calls, ['alert'], 'failed stock adjustment must not refresh as a successful write');
});
