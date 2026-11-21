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


for (const engine of ['chromium', 'webkit']) test(`${engine}: distinct history blocks with identical FNV32 fingerprints must persist the later bytes`, { timeout: 120000 }, async () => {
  const srv = http.createServer((q, r) => {
    r.writeHead(200, { 'Content-Type': q.url.endsWith('.js') ? 'application/javascript' : 'text/html' });
    r.end(q.url.endsWith('.js') ? SRC : '<!doctype html><script src="/estado-idb.js"></script>');
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const web = await pw[engine].launch();
  try {
    const page = await web.newPage();
    await page.goto('http://127.0.0.1:' + srv.address().port + '/');
    const result = await page.evaluate(async () => {
      const idb = window.OCEstadoIDB;
      const movimientos = Array.from({ length: 501 }, (_, i) =>
        i === 0 ? { id: 'm0', note: '00iikdb0' } : { id: 'm' + i, tipo: 'venta' });
      const cambiado = movimientos.map((x, i) =>
        i === 0 ? { id: 'm0', note: '01jsqfb2' } : x);
      function fingerprint(items) {
        const s = JSON.stringify(items); let h = 2166136261;
        for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
        return s.length + ':' + (h >>> 0);
      }
      const collides = fingerprint(movimientos.slice(0, 500)) === fingerprint(cambiado.slice(0, 500));
      const first = await idb.guardarConRevision({ _rev: 1, movimientos, actividadCompartida: [], productos: [] }, 0);
      const second = await idb.guardarConRevision({ _rev: 2, movimientos: cambiado, actividadCompartida: [], productos: [] }, 1);
      const back = await idb.leer();
      return { collides, first, second, note: back && back.movimientos[0].note, length: back && back.movimientos.length };
    });
    assert.equal(result.collides, true, 'adversarial fixture must genuinely collide under source FNV32');
    assert.equal(result.first, true); assert.equal(result.second, true);
    assert.equal(result.note, '01jsqfb2', 'a successful CAS must never omit changed history due to hash collision');
    assert.equal(result.length, 501);
  } finally { await web.close(); await new Promise(r => srv.close(r)); }
});

for (const engine of ['chromium', 'webkit']) test(`${engine}: missing durable history chunk must not read as a complete empty block`, { timeout: 120000 }, async () => {
  const srv = http.createServer((q, r) => {
    r.writeHead(200, { 'Content-Type': q.url.endsWith('.js') ? 'application/javascript' : 'text/html' });
    r.end(q.url.endsWith('.js') ? SRC : '<!doctype html><script src="/estado-idb.js"></script>');
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const web = await pw[engine].launch();
  try {
    const page = await web.newPage(); await page.goto('http://127.0.0.1:' + srv.address().port + '/');
    const result = await page.evaluate(async () => {
      const idb = window.OCEstadoIDB;
      const st = { _rev: 1, productos: [], movimientos: Array.from({ length: 501 }, (_, i) => ({ id: 'm' + i })), actividadCompartida: [] };
      if (!await idb.guardarConRevision(st, 0)) return 'initial-save-failed';
      const db = await new Promise((resolve, reject) => {
        const q = indexedDB.open('f123_estado', 1); q.onsuccess = () => resolve(q.result); q.onerror = () => reject(q.error);
      });
      await new Promise((resolve, reject) => {
        const tx = db.transaction('estado', 'readwrite'); tx.objectStore('estado').delete('h:movimientos:0');
        tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
      }); db.close();
      const back = await idb.leer();
      return back === null ? 'failed-closed' : 'silent-truncation:' + back.movimientos.length;
    });
    assert.equal(result, 'failed-closed', 'missing history is a damaged snapshot, never a valid shortened notebook');
  } finally { await web.close(); await new Promise(r => srv.close(r)); }
});


for (const engine of ['chromium', 'webkit']) test(engine + ': C116 malformed zero-block metadata must not erase 501 durable entries', { timeout: 120000 }, async () => {
  const srv = http.createServer((q, r) => {
    r.writeHead(200, { 'Content-Type': q.url.endsWith('.js') ? 'application/javascript' : 'text/html' });
    r.end(q.url.endsWith('.js') ? SRC : '<!doctype html><script src="/estado-idb.js"></script>');
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const web = await pw[engine].launch();
  try {
    const page = await web.newPage(); await page.goto('http://127.0.0.1:' + srv.address().port + '/');
    const status = await page.evaluate(async () => {
      const st = { _rev: 1, movimientos: Array.from({ length: 501 }, (_, i) => ({ id: 'm' + i })), actividadCompartida: [], productos: [] };
      if (!await window.OCEstadoIDB.guardarConRevision(st, 0)) return 'initial-save-failed';
      const db = await new Promise((resolve, reject) => {
        const q = indexedDB.open('f123_estado', 1); q.onsuccess = () => resolve(q.result); q.onerror = () => reject(q.error);
      });
      await new Promise((resolve, reject) => {
        const tx = db.transaction('estado', 'readwrite'), store = tx.objectStore('estado');
        const req = store.get('actual');
        req.onsuccess = () => {
          const val = req.result;
          val._hist.movimientos = { n: 0, len: 501 };
          store.put(val, 'actual');
        };
        tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
      }); db.close();
      const recovered = await window.OCEstadoIDB.leer();
      return recovered === null ? 'failed-closed' : 'silently-truncated:' + recovered.movimientos.length;
    });
    assert.equal(status, 'failed-closed', 'invalid chunk metadata cannot silently discard stock/financial history');
  } finally { await web.close(); await new Promise(r => srv.close(r)); }
});

for (const engine of ['chromium', 'webkit']) test(engine + ': C116 six-megabyte history retains bounded CAS latency and tiny writes', { timeout: 120000 }, async t => {
  const srv = http.createServer((q, r) => {
    r.writeHead(200, { 'Content-Type': q.url.endsWith('.js') ? 'application/javascript' : 'text/html' });
    r.end(q.url.endsWith('.js') ? SRC : '<!doctype html><script src="/estado-idb.js"></script>');
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const web = await pw[engine].launch();
  try {
    const page = await web.newPage(); await page.goto('http://127.0.0.1:' + srv.address().port + '/');
    const stats = await page.evaluate(async () => {
      const idb = window.OCEstadoIDB, mark = 'X'.repeat(1800);
      const mk = (n, prefix) => Array.from({ length: n }, (_, i) => ({ id: prefix + i, details: mark }));
      const st = { _rev: 1, movimientos: mk(2401, 'm'), actividadCompartida: mk(1301, 'a').sort((x, y) => x.id.localeCompare(y.id)), productos: [] };
      if (!await idb.guardarConRevision(st, 0)) return { err: 'initial-save-failed' };
      const P = IDBObjectStore.prototype, original = P.put;
      let written = 0;
      P.put = function (value) { written += JSON.stringify(value).length; return original.apply(this, arguments); };
      const st2 = Object.assign({}, st, { _rev: 2, movimientos: st.movimientos.concat([{ id: 'm-new', details: 'stock-adjust' }]) });
      const start = performance.now();
      const committed = await idb.guardarConRevision(st2, 1);
      const elapsed = performance.now() - start;
      P.put = original;
      return { committed, elapsed, written, fullBytes: JSON.stringify(st2).length };
    });
    assert.equal(stats.err, undefined, stats.err);
    assert.equal(stats.committed, true);
    assert.ok(stats.written < stats.fullBytes / 10, 'must preserve v839 small WRITE volume: ' + JSON.stringify(stats));
    t.diagnostic('C116 ' + engine + ' synthetic ~6MB elapsed-ms=' + Math.round(stats.elapsed) + ' written=' + stats.written + '/' + stats.fullBytes);
    assert.ok(stats.elapsed < 2000, 'desktop-browser synthetic save exceeded 2s latency ceiling: ' + JSON.stringify(stats));
  } finally { await web.close(); await new Promise(r => srv.close(r)); }
});
