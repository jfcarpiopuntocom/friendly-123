/* Regresion de dinero (JFC 2026-09-24, shell 371): PERIODO en Commissions.
   Bug real que esto cierra: /api/liquidaciones y "marcar pagado" solo miraban el
   MES EN CURSO. Si el mes cambiaba con comisiones sin pagar, esas ventas se
   volvian invisibles e impagables desde la app. Ahora cada consulta acepta
   ?mes=YYYY-MM (por defecto, el mes actual: los llamadores viejos no cambian),
   /api/liquidaciones/meses lista los meses con comision y lo que falta pagar, y
   marcar-pagado liquida el mes que se le pide.
   Decision de JFC en DECISIONES-JFC.md, seccion "Commissions (JFC 2026-09-24)". */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { browser: fixtureBrowser } = require('./helpers/browser.cjs');

function mesAnterior() {
  const d = new Date();
  const y = d.getUTCMonth() === 0 ? d.getUTCFullYear() - 1 : d.getUTCFullYear();
  const m = d.getUTCMonth() === 0 ? 12 : d.getUTCMonth();
  return `${y}-${String(m).padStart(2, '0')}`;
}

async function ventaDelMesPasado() {
  const app = fixtureBrowser();
  const shelf = await app.request('/api/ubicaciones', 'POST', { nombre: 'Fixture period shelf', tipo: 'socio', comisionSocio: 40 });
  const product = await app.request('/api/productos', 'POST', {
    nombre: 'Fixture period product', sku: 'FIX-PERIOD', barcode: 'FIX-PERIOD',
    precio: 50, costo: 20, stockInicial: 5, ubicacionId: shelf.id
  });
  await app.request(`/api/productos/${product.id}/venta`, 'POST', { cantidad: 1 });
  // La venta pasa al mes anterior por la via real de un respaldo/sync, no por un atajo.
  const backup = await app.request('/api/respaldo/exportar');
  const prev = mesAnterior();
  backup.ventas.forEach(v => { if (v.productoId === product.id) v.fecha = `${prev}-15T17:00:00.000Z`; });
  await app.request('/api/respaldo/importar', 'POST', backup);
  return { app, shelf, prev };
}

test('liquidations of a past month stay visible and payable', async () => {
  const { app, shelf, prev } = await ventaDelMesPasado();

  const actual = (await app.request('/api/liquidaciones')).find(f => f.ubicacionId === shelf.id);
  assert.equal(actual.estado, 'sin ventas', 'sin ?mes sigue siendo el mes en curso (compatibilidad)');

  const pasado = (await app.request(`/api/liquidaciones?mes=${prev}`)).find(f => f.ubicacionId === shelf.id);
  assert.equal(pasado.mes, prev);
  assert.equal(pasado.estado, 'pendiente');
  assert.equal(pasado.comisionSocio, 20, '40% de 50');

  const meses = await app.request('/api/liquidaciones/meses');
  const fila = meses.find(x => x.mes === prev);
  assert.ok(fila, 'el mes pasado aparece en la lista de meses');
  assert.equal(fila.pendiente, 20, 'y dice cuanto falta pagar');
  assert.ok(meses.some(x => x.actual), 'el mes en curso siempre esta en la lista');

  const sinMes = await app.request(`/api/liquidaciones/${shelf.id}/marcar-pagado`, 'POST', {});
  assert.equal(sinMes.ventasLiquidadas, 0, 'sin mes, pagar sigue tocando solo el mes en curso');

  const pago = await app.request(`/api/liquidaciones/${shelf.id}/marcar-pagado`, 'POST', { mes: prev });
  assert.equal(pago.ventasLiquidadas, 1);
  const despues = (await app.request(`/api/liquidaciones?mes=${prev}`)).find(f => f.ubicacionId === shelf.id);
  assert.equal(despues.estado, 'pagado');
  assert.equal((await app.request('/api/liquidaciones/meses')).find(x => x.mes === prev).pendiente, 0);

  const filas = await app.request('/api/ventas/todas?ubicacionId=todas');
  assert.ok(filas.every(v => /^\d{4}-\d{2}$/.test(v.mes)), 'cada venta dice su mes local');
});

test('an invalid month falls back to the current month, never to "everything"', async () => {
  const { app, shelf } = await ventaDelMesPasado();
  for (const malo of ['2026-13', 'todo', '', '2026-1']) {
    const f = (await app.request(`/api/liquidaciones?mes=${encodeURIComponent(malo)}`)).find(x => x.ubicacionId === shelf.id);
    assert.equal(f.estado, 'sin ventas', `mes "${malo}" no debe abrir otro periodo`);
  }
});

test('Commissions UI has a month selector wired to every money read', () => {
  const html = fs.readFileSync(path.join(__dirname, '../docs/index.html'), 'utf8');
  assert.match(html, /data-commissions-month/, 'selector de mes presente');
  assert.match(html, /liquidaciones\?mes=\$\{/, 'la lectura de liquidaciones manda el mes elegido');
  assert.match(html, /marcar-pagado`,\s*\{[^}]*body: JSON\.stringify\(\{ mes/, 'pagar manda el mes elegido');
  assert.match(html, /agruparVentasPorProducto\(ventasTodas, true, _ocMesComisiones\)/, 'el resumen por producto usa el mes elegido');
});
