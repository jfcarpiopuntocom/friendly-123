const { test } = require('node:test');
const assert = require('node:assert/strict');
const { browser } = require('./helpers/browser.cjs');

test('variant gets its own identity, zero stock, stable family and sync metadata', async () => {
  const a = browser(), b = browser();
  const base = (await a.request('/api/productos'))[0];
  const variant = await a.request('/api/productos', 'POST', {
    nombre: `${base.nombre} — Azul`, barcode: 'fixture-variant-blue', sku: 'FIXTURE-FAMILY-BLUE',
    categoria: base.categoria, precio: base.precio, costo: base.costo, stockInicial: 99,
    ubicacionId: base.ubicacionId, familiaId: 'FIXTURE-FAMILY', productoBaseId: base.id,
    varianteAtributo: 'color', varianteValor: 'Azul'
  });

  assert.equal(variant.stockActual, 0, 'a variant never inherits or accepts copied stock');
  assert.equal(variant.barcode, 'fixture-variant-blue');
  assert.equal(variant.familiaId, 'FIXTURE-FAMILY');
  assert.equal((await a.request(`/api/productos/${base.id}`)).familiaId, 'FIXTURE-FAMILY');

  b.receive(a);
  const synced = (await b.request('/api/productos')).find(p => p.id === variant.id);
  assert.equal(synced.varianteAtributo, 'color');
  assert.equal(synced.varianteValor, 'Azul');
  assert.equal(synced.stockActual, 0);
});

test('variant creation rejects duplicate value, barcode and SKU', async () => {
  const w = browser();
  const base = (await w.request('/api/productos'))[0];
  const common = { nombre: 'Fixture variant', categoria: base.categoria, precio: 3, costo: 1,
    familiaId: 'SAFE-FAMILY', productoBaseId: base.id, varianteAtributo: 'size' };
  await w.request('/api/productos', 'POST', { ...common, varianteValor: 'Large', barcode: 'safe-large', sku: 'SAFE-FAMILY-LARGE' });

  await assert.rejects(() => w.request('/api/productos', 'POST', { ...common, varianteValor: 'large', barcode: 'safe-large-2', sku: 'SAFE-FAMILY-LARGE-2' }), /already exists/);
  await assert.rejects(() => w.request('/api/productos', 'POST', { ...common, varianteValor: 'Small', barcode: 'safe-large', sku: 'SAFE-FAMILY-SMALL' }), /already used/);
  await assert.rejects(() => w.request('/api/productos', 'POST', { ...common, varianteValor: 'Medium', barcode: 'safe-medium', sku: 'SAFE-FAMILY-LARGE' }), /already used/);
});

test('the same offline variant gets the same identity on two devices', async () => {
  const a = browser(), b = browser();
  const baseA = (await a.request('/api/productos'))[0];
  const baseB = (await b.request('/api/productos'))[0];
  const logical = { nombre: 'Offline blue', categoria: 'Fixture', precio: 3, costo: 1,
    familiaId: 'OFFLINE-FAMILY', varianteAtributo: 'color', varianteValor: 'Blue' };
  const av = await a.request('/api/productos', 'POST', { ...logical, productoBaseId: baseA.id, barcode: 'offline-blue-a', sku: 'OFFLINE-FAMILY-BLUE' });
  const bv = await b.request('/api/productos', 'POST', { ...logical, productoBaseId: baseB.id, barcode: 'offline-blue-b', sku: 'OFFLINE-FAMILY-BLUE' });
  assert.equal(av.id, bv.id);
});
