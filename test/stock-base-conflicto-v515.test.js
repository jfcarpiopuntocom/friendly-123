// Belen 2026-10-14 15:16: "Yo arregle manualmente. Y se mantuvo el arreglo. O sea no afecto a lo
// de mi compu" (Aya Huma #2: 0 en el telefono, 1 en la compu). Causa: si dos aparatos tienen
// distinta base de stock para el mismo producto, aplicarCatalogo solo avisaba
// "oc-stock-base-conflicto" y nadie convergia nunca; una correccion manual no cruzaba.
// Regla v515: gana el cambio de stock MAS RECIENTE (stockTs); empate = regla determinista.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { browser } = require('./helpers/browser.cjs');

async function aparato(id, base, pn, stock, ts) {
  const w = browser();
  const fx = await w.request('/api/respaldo/exportar');
  const p = fx.productos.find((x) => Number(x.stockActual) >= 1);
  Object.assign(p, { id, stockActual: stock, stockTs: ts, stockBase: base, stockPN: pn });
  delete p.stockDeficit;
  fx.productos = [p]; fx.ventas = []; fx.movimientos = [];
  await w.request('/api/respaldo/importar', 'POST', fx);
  return w;
}
const stockDe = async (w, id) => (await w.request('/api/respaldo/exportar')).productos.find((x) => x.id === id).stockActual;
function remotoCon(w, id, base, pn, stock, ts) {
  const cat = w.catalog(); const rp = cat.productos.find((x) => x.id === id);
  Object.assign(rp, { stockBase: base, stockPN: pn, stockActual: stock, stockTs: ts });
  return cat;
}

test('base distinta: la correccion mas reciente del otro aparato llega a este', async () => {
  const pc = await aparato('p-aya-2', 3, { pc: { add: 0, sub: 2 } }, 1, 1000);   // compu: 1
  pc.OCSync.aplicarCatalogo(remotoCon(pc, 'p-aya-2', 1, { cel: { add: 0, sub: 1 } }, 0, 5000), null); // celu corrigio a 0 despues
  assert.equal(await stockDe(pc, 'p-aya-2'), 0);
});
test('base distinta: un dato mas viejo del otro aparato no pisa la correccion local mas nueva', async () => {
  const cel = await aparato('p-aya-2', 1, { cel: { add: 0, sub: 1 } }, 0, 5000);
  cel.OCSync.aplicarCatalogo(remotoCon(cel, 'p-aya-2', 3, { pc: { add: 0, sub: 2 } }, 1, 1000), null);
  assert.equal(await stockDe(cel, 'p-aya-2'), 0);
});
test('base distinta con la misma hora: los dos aparatos eligen el mismo numero', async () => {
  const a = await aparato('p-x', 3, { a: { add: 0, sub: 2 } }, 1, 7000);
  a.OCSync.aplicarCatalogo(remotoCon(a, 'p-x', 1, { b: { add: 0, sub: 1 } }, 0, 7000), null);
  const b = await aparato('p-x', 1, { b: { add: 0, sub: 1 } }, 0, 7000);
  b.OCSync.aplicarCatalogo(remotoCon(b, 'p-x', 3, { a: { add: 0, sub: 2 } }, 1, 7000), null);
  assert.equal(await stockDe(a, 'p-x'), await stockDe(b, 'p-x'));
});
test('aparato viejo sin base y numero distinto: adopta el dato con base si es mas reciente', async () => {
  const pc = await aparato('p-leg', null, null, 4, 1000);
  pc.OCSync.aplicarCatalogo(remotoCon(pc, 'p-leg', 2, { cel: { add: 0, sub: 1 } }, 1, 9000), null);
  assert.equal(await stockDe(pc, 'p-leg'), 1);
});
test('despues de converger, una venta en cada aparato se suman (no se pisan)', async () => {
  const pc = await aparato('p-sum', 3, { pc: { add: 0, sub: 2 } }, 1, 1000);
  pc.OCSync.aplicarCatalogo(remotoCon(pc, 'p-sum', 5, { cel: { add: 0, sub: 1 } }, 4, 5000), null);
  assert.equal(await stockDe(pc, 'p-sum'), 4);
  // misma base ya: el celu vende 1 mas y la compu (con su propio contador) vende 1
  pc.OCSync.aplicarCatalogo(remotoCon(pc, 'p-sum', 5, { cel: { add: 0, sub: 2 } }, 3, 6000), null);
  assert.equal(await stockDe(pc, 'p-sum'), 3);
});

// Recorrido completo por el sync REAL (Yjs entre dos aparatos), como el de Belen.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
async function peer() {
  const w = browser(); delete w.JSON;
  Object.assign(w, { crypto: webcrypto, TextEncoder, TextDecoder,
    WebSocket: class { constructor() { throw new Error('No real relay allowed in tests'); } },
    BroadcastChannel: class { constructor() { throw new Error('No cross-test channels'); } } });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../docs/vendor/yjs-bundle.min.js'), 'utf8'), w);
  w.IndexeddbPersistence = class { once() {} };
  w.localStorage.setItem('f123_owned', JSON.stringify({ licenseCode: 'SYNTHETIC-ISOLATED-FIXTURE' }));
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../docs/sync-yjs.js'), 'utf8'), w);
  for (let i = 0; i < 100 && w.OCYjs.estado !== 'activo'; i++) await delay(10);
  return w;
}
const pasar = (de, a) => { a.Y.applyUpdate(a.OCYjs.doc, de.Y.encodeStateAsUpdate(de.OCYjs.doc), 'red'); a.OCYjs._store.aplicar(); };
async function sincronizar(a, b) { for (let i = 0; i < 3; i++) { a.OCYjs._store.sembrar(); b.OCYjs._store.sembrar(); pasar(a, b); pasar(b, a); } }
async function conBase(w, id, base, pn, stock, ts) {
  const fx = await w.request('/api/respaldo/exportar');
  const p = fx.productos.find((x) => x.stockActual >= 1);
  Object.assign(p, { id, nombre: 'Aya Huma #2', stockActual: stock, stockBase: base, stockPN: pn, stockTs: ts }); delete p.stockDeficit;
  fx.productos = [p]; fx.ventas = []; fx.movimientos = [];
  await w.request('/api/respaldo/importar', 'POST', fx);
}
test('Belen por el sync real: bases distintas convergen, y su correccion manual llega a la compu', async () => {
  const cel = await peer(), pc = await peer();
  await conBase(cel, 'p-aya', 1, { cel: { add: 0, sub: 1 } }, 0, 5000);   // telefono: 0
  await conBase(pc, 'p-aya', 3, { pc: { add: 0, sub: 2 } }, 1, 1000);     // compu: 1
  await sincronizar(cel, pc);
  assert.equal(await stockDe(cel, 'p-aya'), await stockDe(pc, 'p-aya'), 'tras sincronizar los dos dicen lo mismo');
  // Belen corrige a mano en el telefono: +2 (queda 2). La compu tiene que verlo.
  await cel.request('/api/productos/p-aya/ajustar', 'POST', { delta: 2, motivo: 'conteo fisico' });
  await sincronizar(cel, pc);
  assert.equal(await stockDe(cel, 'p-aya'), 2);
  assert.equal(await stockDe(pc, 'p-aya'), 2, 'la correccion manual del telefono llega a la compu');
  // Y una venta en la compu despues se ve en el telefono (ya comparten base).
  await pc.request('/api/productos/p-aya/venta', 'POST', { cantidad: 1 });
  await sincronizar(cel, pc);
  assert.equal(await stockDe(cel, 'p-aya'), 1); assert.equal(await stockDe(pc, 'p-aya'), 1);
});
