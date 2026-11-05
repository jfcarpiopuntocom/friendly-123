/* render-fotos: a remote product edit that wins the revision but carries no hash (peer that has not hashed the photo,
   or an older shell) must neither clear the local pointer nor the local photo bytes. Synthetic fixtures, no network. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { browser } = require('./helpers/browser.cjs');

test('a winning remote revision with an empty hash keeps the local pointer and photo', async () => {
  const a = browser(), b = browser();
  await a.request('/api/productos', 'POST', { nombre: 'QA render foto', barcode: 'QARF1', precio: 1, costo: 0.5, stockInicial: 1, categoria: 'QA' });
  b.receive(a);
  const get = (w) => w.catalog().productos.find((p) => p.nombre === 'QA render foto');
  const c1 = a.catalog(); const p1 = c1.productos.find((p) => p.nombre === 'QA render foto'); p1.fotoHash = 'h1';
  b.OCSync.aplicarCatalogo(c1, null);
  assert.equal(get(b).fotoHash, 'h1');
  const c2 = a.catalog(); const p2 = c2.productos.find((p) => p.nombre === 'QA render foto');
  p2.fotoHash = null; p2.precio = 7; p2.rev = { c: Number(p2.rev && p2.rev.c || 1) + 50, d: 'otro-aparato' };
  b.OCSync.aplicarCatalogo(c2, null);
  assert.equal(get(b).precio, 7, 'the remote edit won the revision');
  assert.equal(get(b).fotoHash, 'h1', 'the local pointer survives');
});
