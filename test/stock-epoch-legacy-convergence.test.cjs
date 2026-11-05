// v668: physical count history remains recoverable; old no-epoch readers cannot
// erase the most recent count. The production store is exercised in isolated memory.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { browser } = require('./helpers/browser.cjs');

async function fixture({ base, epoch, ts, pn, actual }) {
  const w = browser();
  const fx = await w.request('/api/respaldo/exportar');
  const p = fx.productos.find(p => Number(p.stockActual) >= 1);
  assert.ok(p);
  Object.assign(p, { id: 'v668-fixture', nombre: 'Convergent count', stockBase: base,
    stockEpochId: epoch, stockPN: pn, stockTs: ts, stockActual: actual });
  fx.productos = [p]; fx.ventas = []; fx.movimientos = [];
  await w.request('/api/respaldo/importar', 'POST', fx);
  w.OCAuth = { rolActual: () => 'dueno' };
  return w;
}
const read = async w => (await w.request('/api/respaldo/exportar')).productos.find(p => p.id === 'v668-fixture');
function incoming(w, changes) {
  const cat = w.catalog();
  Object.assign(cat.productos.find(p => p.id === 'v668-fixture'), changes);
  w.OCSync.aplicarCatalogo(cat, 'dueno');
}
test('a later legacy count with a different base supersedes an older epoch without erasing witnesses', async () => {
  const w = await fixture({ base: 9, epoch: 'old-epoch', pn: {pc:{add:0,sub:2}}, actual:7, ts:1000 });
  incoming(w, { stockBase: 5, stockEpochId: '', stockPN:{phone:{add:0,sub:1}},
    stockActual:4, stockTs:2000 });
  const p = await read(w);
  assert.equal(p.stockActual, 4); assert.equal(p.stockBase, 5);
  assert.equal(p.stockEvidencias[JSON.stringify([9,'old-epoch'])].pn.pc.sub, 2);
  assert.equal(p.stockEvidencias['5'].pn.phone.sub, 1);
});
test('a legacy movement at the same base is not a fresh physical recount', async () => {
  const w = await fixture({ base: 9, epoch: 'current-epoch', pn: {pc:{add:0,sub:2}}, actual:7, ts:1000 });
  incoming(w, { stockBase: 9, stockEpochId: '', stockPN:{old:{add:0,sub:4}},
    stockActual:5, stockTs:2000 });
  const p = await read(w);
  assert.equal(p.stockActual, 7);
  assert.equal(p.stockEpochId, 'current-epoch');
});
test('new physical count retains the previous PN ledger in exported backup', async () => {
  const w = await fixture({ base: 9, epoch: 'old-epoch', pn: {pc:{add:0,sub:2}}, actual:7, ts:Date.now()-1000 });
  const old = await read(w);
  await w.request('/api/productos/v668-fixture/ajustar', 'POST',
    { stockFisico: 12, motivo: 'QA new physical count' });
  const p = await read(w);
  assert.equal(p.stockActual, 12);
  assert.notEqual(p.stockEpochId, old.stockEpochId);
  assert.deepEqual(JSON.parse(JSON.stringify(p.stockPN)), {});
  assert.equal(p.stockEvidencias[JSON.stringify([9,'old-epoch'])].pn.pc.sub, 2);
  assert.equal(p.stockEvidencias[JSON.stringify([9,'old-epoch'])].base, 9);
});

test('three real Yjs replicas converge on the newer different-base legacy count and retain old witnesses', async () => {
  const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
  const { webcrypto } = require('node:crypto');
  const { setTimeout: delay } = require('node:timers/promises');
  async function peer() {
    const w = browser(); delete w.JSON;
    Object.assign(w, {
      crypto: webcrypto, TextEncoder, TextDecoder,
      WebSocket: class { constructor() { throw new Error('No real relay allowed in fixture'); } },
      BroadcastChannel: class { constructor() { throw new Error('No cross-test channels'); } }
    });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../docs/vendor/yjs-bundle.min.js'), 'utf8'), w);
    w.IndexeddbPersistence = class { once() {} };
    w.localStorage.setItem('f123_owned', JSON.stringify({ licenseCode: 'SYNTHETIC-ISOLATED-FIXTURE' }));
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../docs/sync-yjs.js'), 'utf8'), w);
    for (let i = 0; i < 100 && w.OCYjs.estado !== 'activo'; i++) await delay(10);
    assert.equal(w.OCYjs.estado, 'activo', 'Yjs local fixture must initialize');
    return w;
  }
  const peers = [await peer(), await peer(), await peer()];
  async function setProduct(w, baseline, epoch, actor, count, actual, ts) {
    const fx = await w.request('/api/respaldo/exportar');
    const p = fx.productos.find(p => Number(p.stockActual) >= 1);
    Object.assign(p, {
      id: 'v668-fixture', nombre: 'Convergent count',
      stockBase: baseline, stockEpochId: epoch,
      stockPN: { [actor]: { add: 0, sub: count } },
      stockActual: actual, stockTs: ts
    });
    fx.productos = [p]; fx.ventas = []; fx.movimientos = [];
    await w.request('/api/respaldo/importar', 'POST', fx);
  }
  await setProduct(peers[0], 9, 'old-epoch', 'pc', 2, 7, 1000);
  await setProduct(peers[1], 5, '', 'phone', 1, 4, 2000);
  await setProduct(peers[2], 9, 'old-epoch', 'tablet', 2, 7, 1000);
  for (let round = 0; round < 5; round++) {
    peers.forEach(w => w.OCYjs._store.sembrar());
    for (let i = 0; i < peers.length; i++) for (let j = 0; j < peers.length; j++) {
      if (i === j) continue;
      const from = peers[i], to = peers[j];
      to.Y.applyUpdate(to.OCYjs.doc, from.Y.encodeStateAsUpdate(from.OCYjs.doc), 'red');
    }
    peers.forEach(w => w.OCYjs._store.aplicar());
  }
  for (const w of peers) {
    const p = await read(w);
    assert.equal(p.stockActual, 4, 'all three replicas must show latest confirmed legacy count');
    assert.equal(p.stockBase, 5);
    assert.equal(p.stockEvidencias[JSON.stringify([9, 'old-epoch'])].pn.pc.sub, 2,
      'previous PC movement retained for recovery');
    assert.equal(p.stockEvidencias['5'].pn.phone.sub, 1,
      'newer count evidence retained');
  }
});
