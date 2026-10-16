const { test } = require('node:test');
const assert = require('node:assert/strict');
const { browser } = require('./helpers/browser.cjs');
const R = require('../docs/core/business-read-model.js');

async function shop(commission = false) {
  const w = browser(); w.OCAuth = { rolActual: () => 'dueno' };
  const u = await w.request('/api/ubicaciones', 'POST', { nombre: 'Synthetic rack', tipo: commission ? 'socio' : 'propio' });
  if (commission) {
    const person = await w.request('/api/promotoras', 'POST', { nombre: 'Synthetic associate', comisionBase: 80 });
    await w.request(`/api/ubicaciones/${u.id}`, 'PUT', { promotoraId: person.id });
  }
  const p = await w.request('/api/productos', 'POST', { nombre: 'Synthetic item', barcode: 'synthetic-money-item', precio: 100, costo: 10, stockInicial: 5, ubicacionId: u.id });
  return { w, u, p };
}

test('Advanced profit uses earned commissions and recorded expenses; budgets stay separate', async () => {
  const { w, u, p } = await shop(true);
  await w.request(`/api/productos/${p.id}/venta`, 'POST', { cantidad: 1 });
  await w.request('/api/gastos', 'POST', { concepto: 'Synthetic service', monto: 5, categoria: 'services', ubicacionId: u.id });
  const pl = await w.request(`/api/reportes/pl?ubicacionId=${u.id}`);
  assert.equal(pl.ingresos, 100); assert.equal(pl.costoVentas, 10);
  assert.equal(pl.comisiones, 80); assert.equal(pl.gastosOperativos, 5); assert.equal(pl.utilidadNeta, 5);
});

test('credit sale never increases asserted cash or total assets', async () => {
  const { w, u, p } = await shop();
  const c = await w.request('/api/clientes', 'POST', { nombre: 'Synthetic customer' });
  await w.request(`/api/productos/${p.id}/venta`, 'POST', { cantidad: 1, clienteId: c.id, info: { formaPago: 'fiado' } });
  const balance = await w.request(`/api/reportes/balance?ubicacionId=${u.id}`);
  assert.equal(balance.activos.efectivoEstimado, null); assert.equal(balance.activos.total, null);
  assert.equal(balance.activos.inventarioValorizado, 40);
});

test('new own-stock allocation and frozen tax survive reload, sync and report projection', async () => {
  const { w, u, p } = await shop();
  await w.request('/api/config/impuesto', 'PUT', { activo: true, tasa: 15, nombre: 'VAT', modo: 'incluido' });
  await w.request(`/api/productos/${p.id}/venta`, 'POST', { cantidad: 1, info: { precioOverride: 115 } });
  const id = (await w.request(`/api/ventas/todas?ubicacionId=${u.id}`))[0].id;
  for (const app of [w, browser(w.localStorage), (() => { const other = browser(); other.receive(w); return other; })()]) {
    const v = (await app.request('/api/ventas/todas')).find(v => v.id === id);
    assert.equal(v.noCommission, true); assert.equal(v.impuesto.monto, 15);
    const result = R.businessResult({ sales: [v] });
    assert.equal(result.houseAfterExpensesCents, 9000);
  }
});

test('unallocated general expense keeps scoped profit unknown', async () => {
  const { w, u, p } = await shop();
  await w.request(`/api/productos/${p.id}/venta`, 'POST', { cantidad: 1 });
  const before = (await w.request('/api/reportes/pl')).utilidadNeta;
  await w.request('/api/gastos', 'POST', { concepto: 'Synthetic general service', monto: 5, categoria: 'services' });
  assert.equal((await w.request(`/api/reportes/pl?ubicacionId=${u.id}`)).utilidadNeta, null);
  assert.equal((await w.request('/api/reportes/pl')).utilidadNeta, +(before - 5).toFixed(2));
});

test('frozen no-commission proof does not change when today product gains an associate', () => {
  const v = { cantidad: 1, precioUnit: 100, costoUnit: 20, noCommission: true, comisionAsociado: 0, netoCasa: null, comisionistaIdProducto: 'later', pctAsociadoProducto: 80 };
  assert.equal(R.saleAmounts(v).houseCents, 10000);
});
