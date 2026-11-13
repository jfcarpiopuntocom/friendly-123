// v767 (revision de codigo 13 nov 2026), hallazgo 1.
// Un 507 de cuota REAL en una venta (code SALE_STORAGE_QUOTA: el aparato no
// tiene espacio) NUNCA se reintenta: reintentar contra un disco lleno solo
// repite el mismo fallo y relee el cuaderno. Antes _rechazoReintentable
// arrancaba en `status === 507` y la venta se rebasaba y repetia.
// El caso NO-cuota (503 SALE_DURABILITY_UNCONFIRMED, cerca de revision CAS)
// sigue reintentandose como antes: se fija aqui para no romperlo.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { browser } = require('./helpers/browser.cjs');

async function conStock(w, id, n) {
  const fx = await w.request('/api/respaldo/exportar');
  const p = fx.productos.find((x) => x.stockActual >= 1);
  p.id = id; p.stockActual = n; p.stockBase = n; p.stockPN = {};
  p.stockEpochId = 'stock-epoch-fixture-' + id;
  p.stockCountTs = Date.parse('2026-11-12T00:00:00Z');
  p.stockCountWitness = { base: null, epoch: '', pn: {} };
  fx.productos = [p]; fx.ventas = []; fx.movimientos = [];
  await w.request('/api/respaldo/importar', 'POST', fx);
}

test('v767 RED: a genuine storage-quota 507 sale is answered once, never rebased or replayed', async () => {
  const w = browser();
  await conStock(w, 'p-cuota-real', 5);
  const before = await w.request('/api/respaldo/exportar');
  // A newer durable revision exists: with the old bug this invites a rebase+replay.
  const disk = JSON.parse(JSON.stringify(before));
  disk._rev = Number(before._rev || 0) + 1;
  const quota = Object.assign(new Error('quota'), { name: 'QuotaExceededError' });
  let strictCalls = 0, reads = 0, emitted = 0;
  w.OCSyncEmit = () => { emitted++; return true; };
  const originalSet = w.localStorage.setItem.bind(w.localStorage);
  // Both IDB and the A/B copy are full: a real "no space" device.
  w.localStorage.setItem = () => { throw new DOMException('synthetic quota', 'QuotaExceededError'); };
  w.OCEstadoIDB = {
    soportado: true,
    ultimoError: () => quota,
    leer: async () => { reads++; return JSON.parse(JSON.stringify(disk)); },
    guardarConRevision: async () => { strictCalls++; return false; },
    guardar: async () => false
  };
  const r = await w.fetch('/api/productos/p-cuota-real/venta', { method: 'POST', body: JSON.stringify({ cantidad: 1 }) });
  w.localStorage.setItem = originalSet;
  const payload = await r.json();
  assert.equal(r.status, 507);
  assert.equal(payload.code, 'SALE_STORAGE_QUOTA');
  assert.equal(reads, 0, 'a quota failure must not re-read the notebook to rebase');
  assert.equal(strictCalls, 1, 'a quota failure is attempted exactly once');
  assert.equal(emitted, 0, 'no stock op leaves the device');
  delete w.OCEstadoIDB;
  const after = await w.request('/api/respaldo/exportar');
  assert.equal(after.productos.find((p) => p.id === 'p-cuota-real').stockActual, 5, 'stock rolled back');
  assert.equal(after.ventas.length, 0, 'no ghost sale');
});

test('v767 pin: a non-quota 503 SALE_DURABILITY_UNCONFIRMED sale still rebases once and succeeds', async () => {
  const w = browser();
  await conStock(w, 'p-cas-retry', 5);
  const prior = await w.request('/api/respaldo/exportar');
  const disk = JSON.parse(JSON.stringify(prior));
  disk._rev = Number(prior._rev || 0) + 1; // another tab saved first
  let strictCalls = 0, reads = 0, emitted = 0;
  w.OCSyncEmit = (kind) => { if (kind === 'venta') emitted++; return true; };
  w.OCEstadoIDB = {
    soportado: true,
    ultimoError: () => null,
    leer: async () => { reads++; return JSON.parse(JSON.stringify(disk)); },
    guardarConRevision: async (candidate, expectedRev) => {
      strictCalls++;
      if (expectedRev !== disk._rev) return false; // exact CAS fence, not quota
      Object.assign(disk, JSON.parse(JSON.stringify(candidate)));
      return true;
    }
  };
  const r = await w.fetch('/api/productos/p-cas-retry/venta', { method: 'POST', body: JSON.stringify({ cantidad: 1 }) });
  assert.equal(r.status, 200, 'non-quota CAS refusal is rebased and retried');
  assert.equal(reads, 1);
  assert.equal(strictCalls, 2, 'one fenced attempt + one durable retry');
  assert.equal(emitted, 1, 'exactly one stock op');
  assert.equal(disk.ventas.length, 1, 'exactly one sale, never duplicated');
});
