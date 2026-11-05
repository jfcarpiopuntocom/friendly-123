/* v667: a device damaged before v665 has an EMPTY local photo pointer while the shared Yjs catalog still carries it.
   Rehydration adopts it (additive): never replaces a present pointer, never clears. Synthetic fixtures, no network. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { browser } = require('./helpers/browser.cjs');

async function mundo() {
  const a = browser();
  await a.request('/api/productos', 'POST', { nombre: 'QA rehidratar', barcode: 'QAREH1', precio: 1, costo: 0.5, stockInicial: 1, categoria: 'QA' });
  const id = a.catalog().productos.find(p => p.nombre === 'QA rehidratar').id;
  const mapa = (datos) => ({ get: (k) => datos[k] || null });
  const yjs = (prod, ubic) => { a.OCYjs = { mapas: { productos: mapa(prod), ubicaciones: mapa(ubic) } }; };
  const hashLocal = () => a.catalog().productos.find(p => p.id === id).fotoHash;
  return { a, id, yjs, hashLocal };
}

test('empty local pointer + shared pointer: adopted', async () => {
  const { a, id, yjs, hashLocal } = await mundo();
  assert.ok(!hashLocal());
  yjs({ [id]: { fotoHash: 'h-compartido' } }, {});
  assert.equal(a.OCSync.adoptarPunterosFotoCompartidos() >= 1, true);
  assert.equal(hashLocal(), 'h-compartido');
});

test('present local pointer is never replaced; empty shared pointer never clears', async () => {
  const { a, id, yjs, hashLocal } = await mundo();
  yjs({ [id]: { fotoHash: 'h1' } }, {}); a.OCSync.adoptarPunterosFotoCompartidos();
  yjs({ [id]: { fotoHash: 'h2' } }, {}); a.OCSync.adoptarPunterosFotoCompartidos();
  assert.equal(hashLocal(), 'h1');
  yjs({ [id]: { fotoHash: null } }, {}); a.OCSync.adoptarPunterosFotoCompartidos();
  assert.equal(hashLocal(), 'h1');
});

test('idempotent and safe without Yjs', async () => {
  const { a, id, yjs } = await mundo();
  delete a.OCYjs; assert.equal(a.OCSync.adoptarPunterosFotoCompartidos(), 0);
  yjs({ [id]: { fotoHash: 'h' } }, {});
  a.OCSync.adoptarPunterosFotoCompartidos();
  assert.equal(a.OCSync.adoptarPunterosFotoCompartidos(), 0);
});
