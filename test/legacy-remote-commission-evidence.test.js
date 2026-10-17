const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const readReal = fs.readFileSync;
function newApp() {
  fs.readFileSync = function (file, ...args) {
    const source = readReal.call(fs, file, ...args);
    if (typeof file !== 'string' || !/mock-backend\.js$/.test(file)) return source;
    return source.replace(/\}\)\(\);\s*$/, 'window.__legacyFinanceTest = { get ventas(){return ventas}, get productos(){return productos}, get ubicaciones(){return ubicaciones} };\n})();');
  };
  try { return require('./helpers/browser.cjs').browser(); }
  finally { fs.readFileSync = readReal; }
}

test('legacy stock deltas do not turn missing sale-time commission evidence into zero', () => {
  const app = newApp();
  app.localStorage.setItem('f123_ops_delta_activo', '1');
  const state = app.__legacyFinanceTest;
  state.ubicaciones.push({ id: 'fixture-location', tipo: 'percha', pctAsociado: 30 });
  state.productos.push({ id: 'fixture-product', nombre: 'Synthetic item', ubicacionId: 'fixture-location', stockActual: 4, precio: 100, costo: 20, pctAsociado: 30 });

  const result = app.OCSync.aplicarOpRemota({ opId: 'fixture-legacy-sale', tipo: 'venta', payload: { productoId: 'fixture-product', delta: -1 } });

  assert.equal(result.ok, true);
  assert.equal(state.productos.find(product => product.id === 'fixture-product').stockActual, 3);
  const remoteSale = state.ventas.at(-1);
  assert.equal(remoteSale.split, null);
  assert.equal(Object.hasOwn(remoteSale, 'noCommission'), false);
  assert.equal(app.OCSync.aplicarOpRemota({ opId: 'fixture-legacy-sale', tipo: 'venta', payload: { productoId: 'fixture-product', delta: -1 } }).repetida, true);
  assert.equal(state.productos.find(product => product.id === 'fixture-product').stockActual, 3);
  assert.equal(state.ventas.filter(sale => sale.productoId === 'fixture-product').length, 1);
});

test('legacy delta without a shelf keeps commission unknown and persists that distinction', () => {
  const app = newApp();
  app.localStorage.setItem('f123_ops_delta_activo', '1');
  const state = app.__legacyFinanceTest;
  state.productos.push({ id: 'fixture-unassigned', nombre: 'Synthetic unassigned', stockActual: 2, precio: 100, costo: 20 });
  assert.equal(app.OCSync.aplicarOpRemota({ opId: 'fixture-unassigned-sale', tipo: 'venta', payload: { productoId: 'fixture-unassigned', delta: -1 } }).ok, true);
  const sale = state.ventas.at(-1);
  assert.equal(sale.split, null);
  assert.equal(Object.hasOwn(sale, 'noCommission'), false);
  const activeBuffer = app.localStorage.getItem('f123_estado_v4_ptr');
  const saved = JSON.parse(app.localStorage.getItem('f123_estado_v4_' + activeBuffer));
  const persisted = saved.ventas.find(item => item.id === sale.id);
  assert.equal(persisted.split, null);
  assert.equal(Object.hasOwn(persisted, 'noCommission'), false);
});

test('ordinary sync still neutralizes legacy deltas without creating sales or changing stock', () => {
  const app = newApp();
  const state = app.__legacyFinanceTest;
  state.productos.push({ id: 'fixture-neutralized', stockActual: 2 });
  const count = state.ventas.length;
  assert.equal(app.OCSync.aplicarOpRemota({ opId: 'fixture-neutralized-sale', tipo: 'venta', payload: { productoId: 'fixture-neutralized', delta: -1 } }).neutralizado, true);
  assert.equal(state.productos.find(product => product.id === 'fixture-neutralized').stockActual, 2);
  assert.equal(state.ventas.length, count);
});
