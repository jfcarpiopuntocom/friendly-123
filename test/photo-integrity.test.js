const { test } = require('node:test');
const assert = require('node:assert/strict');
const { browser } = require('./helpers/browser.cjs');

async function fixture() {
  const w = browser();
  const state = await w.request('/api/respaldo/exportar');
  const p = state.productos[0];
  p.id = 'p-fixture-photo'; p.foto = 'data:image/png;base64,old'; p.fotoHash = 'old-hash';
  state.productos = [p];
  await w.request('/api/respaldo/importar', 'POST', state);
  w.OCFotos = { hashDeDataUrl: async data => `hash:${data}`, guardarPorHash: async () => {}, leerPorHash: async () => null };
  w.product = async () => (await w.request('/api/respaldo/exportar')).productos[0];
  return w;
}

test('replacing a product photo replaces its content hash', async () => {
  const w = await fixture();
  await w.request('/api/productos/p-fixture-photo', 'PATCH', { foto: 'data:image/png;base64,new' });
  await w.OCSync.hashearFotosProductos();
  assert.equal((await w.product()).fotoHash, 'hash:data:image/png;base64,new');
});

test('removing a photo removes the hash and cannot hydrate the old image', async () => {
  const w = await fixture();
  w.OCFotos.leerPorHash = async () => 'data:image/png;base64,old';
  await w.request('/api/productos/p-fixture-photo', 'PATCH', { foto: null });
  await w.OCSync.hidratarFotosProductos();
  const p = await w.product();
  assert.equal(p.foto, null);
  assert.equal(p.fotoHash, null);
});

test('a delayed hash operation cannot attach an old hash to a newer photo', async () => {
  const w = await fixture();
  await w.request('/api/productos/p-fixture-photo', 'PATCH', { foto: 'data:image/png;base64,one' });
  let resolve;
  w.OCFotos.hashDeDataUrl = () => new Promise(done => { resolve = done; });
  const hashing = w.OCSync.hashearFotosProductos();
  assert.equal(typeof resolve, 'function', 'replacement must invalidate the previous hash');
  await w.request('/api/productos/p-fixture-photo', 'PATCH', { foto: 'data:image/png;base64,two' });
  resolve('hash-one');
  await hashing;
  const p = await w.product();
  assert.equal(p.foto, 'data:image/png;base64,two');
  assert.equal(p.fotoHash, null);
});

test('a delayed hydration cannot overwrite a photo edited while it was loading', async () => {
  const w = await fixture();
  const state = await w.request('/api/respaldo/exportar');
  state.productos[0].foto = null;
  await w.request('/api/respaldo/importar', 'POST', state);
  let resolve;
  w.OCFotos.leerPorHash = () => new Promise(done => { resolve = done; });
  const hydration = w.OCSync.hidratarFotosProductos();
  await w.request('/api/productos/p-fixture-photo', 'PATCH', { foto: 'data:image/png;base64,new' });
  resolve('data:image/png;base64,old');
  await hydration;
  assert.equal((await w.product()).foto, 'data:image/png;base64,new');
});
