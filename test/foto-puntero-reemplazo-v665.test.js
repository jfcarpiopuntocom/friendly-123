/* v665: replacing a product photo must move the shared pointer (same revision, new hash), and a lagging
   revision must never move it back. Synthetic fixtures, no network. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { browser } = require('./helpers/browser.cjs');

async function conProducto() {
  const a = browser(), b = browser();
  await a.request('/api/productos', 'POST', { nombre: 'QA percha foto', barcode: 'QAFOTO1', precio: 1, costo: 0.5, stockInicial: 1, categoria: 'QA' });
  b.receive(a);
  return { a, b };
}
const hashDe = (w) => w.catalog().productos.find(p => p.nombre === 'QA percha foto').fotoHash;
const remoto = (w, fn) => { const c = w.catalog(); const p = c.productos.find(x => x.nombre === 'QA percha foto'); fn(p); return c; };

test('same revision with a new non-empty hash replaces the pointer (edited photo)', async () => {
  const { a, b } = await conProducto();
  b.OCSync.aplicarCatalogo(remoto(a, p => { p.fotoHash = 'h1'; }), null);
  assert.equal(hashDe(b), 'h1', 'first pointer is adopted (add-only)');
  b.OCSync.aplicarCatalogo(remoto(a, p => { p.fotoHash = 'h2'; }), null);
  assert.equal(hashDe(b), 'h2', 'same rev, new hash: the new photo crosses');
});

test('an older revision with another hash never moves the pointer back', async () => {
  const { a, b } = await conProducto();
  b.OCSync.aplicarCatalogo(remoto(a, p => { p.fotoHash = 'h2'; }), null);
  b.OCSync.aplicarCatalogo(remoto(a, p => { p.fotoHash = 'h1'; p.rev = { c: 0.5, d: 'viejo' }; }), null);
  assert.equal(hashDe(b), 'h2');
});

test('an empty remote pointer never clears a local one', async () => {
  const { a, b } = await conProducto();
  b.OCSync.aplicarCatalogo(remoto(a, p => { p.fotoHash = 'h2'; }), null);
  b.OCSync.aplicarCatalogo(remoto(a, p => { p.fotoHash = null; }), null);
  assert.equal(hashDe(b), 'h2');
});
