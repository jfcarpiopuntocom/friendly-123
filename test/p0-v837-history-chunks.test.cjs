'use strict';
// P0 v837 RED-first (JFC 21 nov): every save rewrote the WHOLE history (~6 MB on a real store) inside one
// IndexedDB record. Real browser engines, synthetic data only: history lives in 500-entry blocks in the
// same atomic CAS transaction; a save writes only changed blocks; leer() returns identical arrays; the
// legacy inline format still reads; an older app rewriting "actual" inline never loses block entries.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http'), fs = require('node:fs'), path = require('node:path');
const pw = require('playwright');
const SRC = fs.readFileSync(path.join(__dirname, '..', 'docs', 'estado-idb.js'), 'utf8');

for (const engine of ['chromium', 'webkit']) test(`${engine}: large history saves only the changed block and reads back identically`, { timeout: 120000 }, async () => {
  const srv = http.createServer((q, r) => { r.writeHead(200, { 'Content-Type': q.url.endsWith('.js') ? 'application/javascript' : 'text/html' }); r.end(q.url.endsWith('.js') ? SRC : '<!doctype html><script src="/estado-idb.js"></script>'); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const web = await pw[engine].launch();
  try {
    const page = await web.newPage(); await page.goto('http://127.0.0.1:' + srv.address().port + '/');
    const r = await page.evaluate(async () => {
      const idb = window.OCEstadoIDB; let puts = 0, bytes = 0; const P = IDBObjectStore.prototype, put = P.put;
      P.put = function (v, k) { puts++; try { bytes += JSON.stringify(v).length; } catch (_) {} return put.apply(this, arguments); };
      const mk = (n, tag) => Array.from({ length: n }, (_, i) => ({ id: tag + i, tipo: 'venta', detalle: { producto: 'p' + (i % 7), delta: -1 }, fecha: '2026-11-21T00:00:00Z' }));
      const st = { _rev: 1, productos: [{ id: 'p', stockActual: 9 }], ventas: [], movimientos: mk(1200, 'm'), actividadCompartida: mk(1300, 'a').sort((x, y) => new Intl.Collator().compare(x.id, y.id)) };
      if (await idb.guardarConRevision(st, 0) !== true) return { err: 'first save' };
      const st2 = Object.assign({}, st, { _rev: 2, movimientos: st.movimientos.concat([{ id: 'm-new', tipo: 'ajuste', detalle: { delta: 1 } }]) });
      puts = 0; bytes = 0;
      if (await idb.guardarConRevision(st2, 1) !== true) return { err: 'second save' };
      const second = { puts, bytes };
      const back = await idb.leer();
      const same = JSON.stringify(back.movimientos) === JSON.stringify(st2.movimientos) && JSON.stringify(back.actividadCompartida) === JSON.stringify(st2.actividadCompartida) && back.productos[0].stockActual === 9 && !('_hist' in back);
      // An OLDER app version rewrites "actual" inline with only what it knew (no block-held history).
      const db = await new Promise(ok => { const q = indexedDB.open('f123_estado', 1); q.onsuccess = () => ok(q.result); });
      await new Promise(ok => { const tx = db.transaction('estado', 'readwrite'); tx.objectStore('estado').put({ _rev: 3, productos: [{ id: 'p', stockActual: 8 }], ventas: [], movimientos: [{ id: 'm-old-app', tipo: 'venta' }], actividadCompartida: [] }, 'actual'); tx.oncomplete = ok; });
      db.close();
      const merged = await idb.leer();
      return { second, fullBytes: JSON.stringify(st2).length, same, mergedMov: merged.movimientos.length, hasOld: merged.movimientos.some(m => m.id === 'm-old-app'), hasNew: merged.movimientos.some(m => m.id === 'm-new'), mergedAct: merged.actividadCompartida.length, stock: merged.productos[0].stockActual };
    });
    assert.ok(!r.err, r.err);
    assert.equal(r.same, true, 'leer() returns the exact same history and state');
    assert.ok(r.second.bytes < r.fullBytes / 10, `second save wrote ${r.second.bytes} bytes vs ${r.fullBytes} full (puts=${r.second.puts})`);
    assert.equal(r.mergedMov, 1202, 'older inline rewrite: every block entry kept plus the old-app entry');
    assert.ok(r.hasOld && r.hasNew); assert.equal(r.mergedAct, 1300); assert.equal(r.stock, 8, 'newest light state wins');
  } finally { await web.close(); await new Promise(r => srv.close(r)); }
});
