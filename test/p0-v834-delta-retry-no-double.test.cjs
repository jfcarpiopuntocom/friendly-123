'use strict';
// P0 v834 RED-first (real-data review 20 nov 2026): a manual -1 was applied TWICE (7 -> 5).
// Field case: the strict IndexedDB commit really landed but was reported unconfirmed (503);
// the CAS rebase re-read the newer notebook and executed the same delta again. Synthetic store only.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, openDevice, chromium } = require('./helpers/e2e-app.cjs');

test('a delta whose first strict save committed but reported failure is applied exactly once', { timeout: 90000 }, async () => {
  const { srv, base } = await startServer();
  let web;
  try {
    web = await chromium.launch();
    const { page, ctx } = await openDevice(web, base, { license: 'F123-SYNTHETIC-V834-NODOUBLE' });
    const r = await page.evaluate(async () => {
      const original = OCAuth;
      window.OCAuth = Object.assign({}, original, { rolActual: () => 'dueno' });
      try {
        localStorage.setItem('f123_owned', JSON.stringify({ instanceId: 'synthetic-v834-device' }));
        const c = await fetch('/api/productos', { method: 'POST', body: JSON.stringify({ nombre: 'Synthetic v834', barcode: 'SYN-V834', stockInicial: 7, precio: 10, costo: 4 }) });
        const id = (await c.json()).id;
        const idb = window.OCEstadoIDB, orig = idb.guardarConRevision.bind(idb); let armado = true;
        idb.guardarConRevision = async function () { const ok = await orig.apply(null, arguments); if (armado && ok === true) { armado = false; return false; } return ok; };
        const res = await fetch(`/api/productos/${id}/ajustar`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ delta: -1, motivo: 'synthetic' }) });
        idb.guardarConRevision = orig;
        const enMemoria = (await (await fetch('/api/productos?ubicacionId=todas')).json()).find(p => p.id === id).stockActual;
        const disco = (await idb.leer()).productos.find(p => p.id === id).stockActual;
        const ajustes = (await (await fetch('/api/actividad')).json()).filter(m => m.tipo === 'ajuste' && m.detalle?.producto === 'Synthetic v834').length;
        return { status: res.status, enMemoria, disco, ajustes, armado };
      } finally { window.OCAuth = original; }
    });
    assert.equal(r.armado, false, 'the synthetic "committed but reported failed" path was exercised');
    assert.equal(r.enMemoria, 6, 'stock in memory decreased exactly once: ' + JSON.stringify(r));
    assert.equal(r.disco, 6, 'durable stock decreased exactly once: ' + JSON.stringify(r));
    assert.equal(r.ajustes, 1, 'exactly one adjustment movement: ' + JSON.stringify(r));
    await ctx.close();
  } finally { if (web) await web.close(); await new Promise(resolve => srv.close(resolve)); }
});
