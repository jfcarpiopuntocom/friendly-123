const { test } = require('node:test');
const assert = require('node:assert/strict');
const { browser } = require('./helpers/browser.cjs');

async function seed(w, rows) {
  const fx = await w.request('/api/respaldo/exportar');
  const template = fx.productos.find((x) => Number(x.stockActual) >= 10) || fx.productos[0];
  fx.productos = rows.map((r, i) => ({
    ...template,
    id: r.id || 'v445-p-' + i,
    nombre: r.nombre || 'Fixture ' + i,
    stockActual: r.stock,
    stockTs: r.ts ?? 1000,
    ...(r.ledger ? { stockBase: r.ledger.base, stockPN: r.ledger.pn } : {}),
  }));
  fx.ventas = [];
  fx.movimientos = [];
  await w.request('/api/respaldo/importar', 'POST', fx);
  return fx.productos;
}

test('v445 matrix: several stale legacy zeros cannot wipe several positive counts', async () => {
  const w = browser();
  const local = await seed(w, [
    { id:'a', stock:3 }, { id:'b', stock:8 }, { id:'c', stock:17 }, { id:'d', stock:1 }
  ]);
  const remote = w.catalog();
  for (const p of remote.productos) {
    p.stockActual = 0;
    p.stockTs = Date.now() + 7 * 24 * 3600_000;
    delete p.stockBase; delete p.stockPN; delete p.stockDeficit;
  }
  w.OCSync.aplicarCatalogo(remote, null);
  const out = await w.request('/api/respaldo/exportar');
  assert.deepEqual(out.productos.map(p=>[p.id,p.stockActual]).sort(),
                   local.map(p=>[p.id,p.stockActual]).sort());
});

test('v445 matrix: newer positive legacy value can still update legacy local value', async () => {
  const w = browser();
  await seed(w, [{ id:'positive-update', stock:4, ts:1000 }]);
  const remote = w.catalog();
  const p = remote.productos.find(x=>x.id==='positive-update');
  p.stockActual = 9; p.stockTs = 2000;
  delete p.stockBase; delete p.stockPN; delete p.stockDeficit;
  w.OCSync.aplicarCatalogo(remote, null);
  const out=await w.request('/api/respaldo/exportar');
  assert.equal(out.productos.find(x=>x.id==='positive-update').stockActual,9);
});

test('v445 matrix: local zero is not artificially resurrected by stale remote zero', async () => {
  const w = browser();
  await seed(w, [{ id:'zero-zero', stock:0, ts:1000 }]);
  const remote=w.catalog();
  const p=remote.productos.find(x=>x.id==='zero-zero');
  p.stockActual=0; p.stockTs=9999999999999;
  delete p.stockBase; delete p.stockPN; delete p.stockDeficit;
  w.OCSync.aplicarCatalogo(remote,null);
  const out=await w.request('/api/respaldo/exportar');
  assert.equal(out.productos.find(x=>x.id==='zero-zero').stockActual,0);
});

test('v445 matrix: ledger-backed real zero wins even against positive local stock', async () => {
  const w = browser();
  await seed(w, [{ id:'real-zero', stock:5, ts:1000, ledger:{base:5,pn:{local:{add:0,sub:0}}} }]);
  const remote=w.catalog();
  const p=remote.productos.find(x=>x.id==='real-zero');
  p.stockActual=0; p.stockTs=2000; p.stockBase=5; p.stockPN={local:{add:0,sub:0},remote:{add:0,sub:5}};
  w.OCSync.aplicarCatalogo(remote,null);
  const out=await w.request('/api/respaldo/exportar');
  assert.equal(out.productos.find(x=>x.id==='real-zero').stockActual,0);
});

test('v445 matrix: ordinary adjustment persists and uses relay clock without touching other products', async () => {
  const w=browser();
  await seed(w,[{id:'target',stock:6},{id:'untouched',stock:11}]);
  w.OCLatencia={ahoraRelay:()=>1770000000123};
  await w.request('/api/productos/target/ajustar','POST',{delta:-2,motivo:'fixture'});
  const out=await w.request('/api/respaldo/exportar');
  assert.equal(out.productos.find(x=>x.id==='target').stockActual,4);
  assert.equal(out.productos.find(x=>x.id==='target').stockTs,1770000000123);
  assert.equal(out.productos.find(x=>x.id==='untouched').stockActual,11);
});

test('v445 matrix: sale decrements only sold product and does not zero siblings', async () => {
  const w=browser();
  await seed(w,[{id:'sold',stock:6},{id:'sibling',stock:12}]);
  const p=(await w.request('/api/respaldo/exportar')).productos.find(x=>x.id==='sold');
  await w.request('/api/productos/sold/venta','POST',{cantidad:1,precio:Number(p.precio||5),canalVenta:'counter'});
  const out=await w.request('/api/respaldo/exportar');
  assert.equal(out.productos.find(x=>x.id==='sold').stockActual,5);
  assert.equal(out.productos.find(x=>x.id==='sibling').stockActual,12);
});
