const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { browser } = require('./helpers/browser.cjs');
const model = require('../docs/core/business-read-model.js');
const source = fs.readFileSync(require.resolve('../docs/vista-perchas.js'), 'utf8');
const start = source.indexOf('  function finanzasPorPercha(');
const end = source.indexOf('  // Ordenar por columna', start);
const project = Function('window', source.slice(start, end) + '\nreturn finanzasPorPercha;')({ OCBusinessReadModel: model });

test('shelf monthly total includes both commissioned and house sales from one coherent cut', async () => {
  const app = browser(); app.OCAuth = { rolActual: () => 'dueno' };
  const shelf = await app.request('/api/ubicaciones', 'POST', { nombre: 'Synthetic mixed shelf', tipo: 'propio' });
  for (const [i, extra] of [[1, { pctAsociado: 20 }], [2, {}]]) {
    const product = await app.request('/api/productos', 'POST', { nombre: 'Synthetic ' + i, barcode: 'SYN-' + i, precio: 10, costo: 2, stockInicial: 2, ubicacionId: shelf.id, ...extra });
    await app.request('/api/productos/' + product.id + '/venta', 'POST', { cantidad: 1 });
  }
  const month = model.day(new Date().toISOString(), 'America/Guayaquil').slice(0, 7);
  const result = project([shelf], await app.request('/api/reporting/corte'), month, 'America/Guayaquil').get(shelf.id);
  assert.equal(result.ventasMes, 20);
  assert.equal(result.comision, 2);
});

test('shelf cut handles refunds in their month, conflicting IDs and unavailable reads honestly', () => {
  const shelves = [{ id: 'a' }, { id: 'b' }];
  const sale = { id: 'sale', ubicacionId: 'a', fecha: '2026-09-10', cantidad: 1, precioUnit: 20, costoUnit: 5, comisionAsociado: 4, netoCasa: 16, devuelta: true, fechaDevolucion: '2026-10-10' };
  const cut = { schema: 1, ventas: [sale], ajustesComision: [] };
  assert.deepEqual(project(shelves, cut, '2026-10', 'America/Guayaquil').get('a'), { ventasMes: -20, comision: -4 });
  cut.ventas.push({ ...sale, ubicacionId: 'b' });
  const conflicts = project(shelves, cut, '2026-10', 'America/Guayaquil');
  assert.equal(conflicts.get('a').ventasMes, null);
  assert.equal(conflicts.get('b').ventasMes, null);
  assert.equal(project(shelves, null, '2026-10', 'America/Guayaquil').size, 0);
  assert.doesNotMatch(source, /fetch\(`\$\{API\}\/ventas\/todas`\)/);
});
