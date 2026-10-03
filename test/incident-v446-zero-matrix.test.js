const { test } = require('node:test');
const assert = require('node:assert/strict');
const { browser } = require('./helpers/browser.cjs');

async function installProducts(w, defs) {
  const fx = await w.request('/api/respaldo/exportar');
  const templates = fx.productos.filter((x) => Number(x.stockActual) >= 10);
  fx.productos = defs.map((d, i) => {
    const p = JSON.parse(JSON.stringify(templates[i % templates.length]));
    p.id = d.id;
    p.nombre = d.id;
    p.stockActual = d.stock;
    p.stockTs = 1000 + i;
    delete p.stockBase;
    delete p.stockPN;
    delete p.stockDeficit;
    return p;
  });
  fx.ventas = [];
  fx.movimientos = [];
  await w.request('/api/respaldo/importar', 'POST', fx);
  return fx.productos;
}

function byId(state, id) {
  return state.productos.find((p) => p.id === id);
}

test('audit: FOUR stale legacy zeros cannot wipe FOUR positive products at once', async () => {
  const w = browser();
  const defs = [
    { id: 'bel-a', stock: 3 },
    { id: 'bel-b', stock: 7 },
    { id: 'bel-c', stock: 11 },
    { id: 'bel-d', stock: 25 }
  ];
  await installProducts(w, defs);
  const remote = w.catalog();
  remote.productos.forEach((p, i) => {
    p.stockActual = 0;
    p.stockTs = Date.now() + (i + 1) * 86400000;
    p.stockBase = null;
    p.stockPN = null;
  });
  w.OCSync.aplicarCatalogo(remote, null);
  const state = await w.request('/api/respaldo/exportar');
  for (const d of defs) assert.equal(byId(state, d.id).stockActual, d.stock, d.id);
});

test('audit: repeated stale-zero replay is idempotent and cannot erode stock later', async () => {
  const w = browser();
  await installProducts(w, [{ id: 'bel-repeat', stock: 8 }]);
  const remote = w.catalog();
  const rp = byId(remote, 'bel-repeat');
  rp.stockActual = 0;
  rp.stockTs = Date.now() + 365 * 86400000;
  rp.stockBase = null;
  rp.stockPN = null;
  for (let i = 0; i < 10; i++) w.OCSync.aplicarCatalogo(remote, null);
  const state = await w.request('/api/respaldo/exportar');
  assert.equal(byId(state, 'bel-repeat').stockActual, 8);
});

test('audit: legacy NONZERO newer stock still converges (guard is zero-only)', async () => {
  const w = browser();
  await installProducts(w, [{ id: 'bel-nonzero', stock: 4 }]);
  const remote = w.catalog();
  const rp = byId(remote, 'bel-nonzero');
  rp.stockActual = 9;
  rp.stockTs = Date.now() + 10000;
  rp.stockBase = null;
  rp.stockPN = null;
  w.OCSync.aplicarCatalogo(remote, null);
  const state = await w.request('/api/respaldo/exportar');
  assert.equal(byId(state, 'bel-nonzero').stockActual, 9);
});

test('audit: ledger-backed zero still wins for multiple products', async () => {
  const w = browser();
  await installProducts(w, [{ id: 'bel-real0-a', stock: 1 }, { id: 'bel-real0-b', stock: 2 }]);
  const remote = w.catalog();
  for (const [id, base] of [['bel-real0-a', 1], ['bel-real0-b', 2]]) {
    const rp = byId(remote, id);
    rp.stockActual = 0;
    rp.stockTs = Date.now() + 10000;
    rp.stockBase = base;
    rp.stockPN = { 'fixture-device': { add: 0, sub: base } };
  }
  w.OCSync.aplicarCatalogo(remote, null);
  const state = await w.request('/api/respaldo/exportar');
  assert.equal(byId(state, 'bel-real0-a').stockActual, 0);
  assert.equal(byId(state, 'bel-real0-b').stockActual, 0);
});

test('audit: after rejecting stale zero, a real local adjustment still works', async () => {
  const w = browser();
  await installProducts(w, [{ id: 'bel-adjust', stock: 6 }]);
  let remote = w.catalog();
  let rp = byId(remote, 'bel-adjust');
  rp.stockActual = 0;
  rp.stockTs = Date.now() + 86400000;
  rp.stockBase = null;
  rp.stockPN = null;
  w.OCSync.aplicarCatalogo(remote, null);
  await w.request('/api/productos/bel-adjust/ajustar', 'POST', { delta: 2, motivo: 'audit' });
  const state = await w.request('/api/respaldo/exportar');
  assert.equal(byId(state, 'bel-adjust').stockActual, 8);
});

test('audit: local zero is not magically inflated by the protection rule', async () => {
  const w = browser();
  await installProducts(w, [{ id: 'bel-local-zero', stock: 0 }]);
  const remote = w.catalog();
  const rp = byId(remote, 'bel-local-zero');
  rp.stockActual = 0;
  rp.stockTs = Date.now() + 86400000;
  rp.stockBase = null;
  rp.stockPN = null;
  w.OCSync.aplicarCatalogo(remote, null);
  const state = await w.request('/api/respaldo/exportar');
  assert.equal(byId(state, 'bel-local-zero').stockActual, 0);
});
