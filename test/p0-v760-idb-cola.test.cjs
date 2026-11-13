'use strict';
// v760 (WebKit bug 315804): after ONE IndexedDB hang the next sales answer at once from the
// read-back-verified A/B journal; if A/B cannot confirm either, the sale gets a truthful error
// after the limit instead of waiting forever; the hung IDB operation never blocks the queue.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { browser } = require('./helpers/browser.cjs');

function app(ls) {
  const w = browser(ls);
  w.localStorage.setItem('f123_device_id', 'synthetic-v760-device');
  w.OCSyncEmit = () => true;
  const timers = [];
  w.setTimeout = (fn, ms) => { timers.push({ fn, ms }); return timers.length; };
  return { w, timers };
}
const vender = (w, id) => w.fetch('/api/productos/' + id + '/venta', { method: 'POST', body: JSON.stringify({ cantidad: 1 }) });
const conStock = async w => (await w.request('/api/respaldo/exportar')).productos.find(p => p.stockActual > 5);
const stock = async (w, id) => (await w.request('/api/respaldo/exportar')).productos.find(p => p.id === id).stockActual;
const enMenosDe1s = p => Promise.race([p, new Promise(r => setTimeout(() => r('mas de 1 s'), 1000))]);
const colgado = () => ({ soportado: true, guardarConRevision: () => new Promise(() => {}), guardar: async () => true, ultimoError: () => null });

test('hung IndexedDB: only the first sale waits for the limit; the next two answer in < 1 s and survive reopening', { timeout: 15000 }, async () => {
  const { w, timers } = app();
  const product = await conStock(w);
  w.OCEstadoIDB = colgado();
  const primera = vender(w, product.id);
  for (let i = 0; i < 20; i++) await Promise.resolve();
  const limite = timers.find(t => t.ms >= 8000 && t.ms <= 10000);
  assert.ok(limite, 'first sale has the 8 s limit');
  limite.fn();
  assert.equal((await primera).status, 200);
  const t0 = Date.now();
  const segunda = await enMenosDe1s(vender(w, product.id));
  const tercera = await enMenosDe1s(vender(w, product.id));
  assert.notEqual(segunda, 'mas de 1 s', 'second sale must not wait another 8 s');
  assert.notEqual(tercera, 'mas de 1 s', 'third sale must not wait another 8 s');
  assert.equal(segunda.status, 200); assert.equal(tercera.status, 200);
  assert.ok(Date.now() - t0 < 1000);
  assert.equal(await stock(w, product.id), product.stockActual - 3);
  // Close and reopen on the same device storage: the three sales are still there.
  const reabierta = app(w.localStorage).w;
  assert.equal(await stock(reabierta, product.id), product.stockActual - 3);
});

test('hung IndexedDB and A/B cannot confirm: truthful error after the limit, never an endless wait or a false 200', { timeout: 15000 }, async () => {
  const { w, timers } = app();
  const product = await conStock(w);
  w.OCEstadoIDB = colgado();
  const setItem = w.localStorage.setItem;
  w.localStorage.setItem = (k, v) => { if (/_journal$/.test(k)) { const e = new Error('full'); e.name = 'QuotaExceededError'; throw e; } return setItem(k, v); };
  const venta = vender(w, product.id);
  for (let i = 0; i < 20; i++) await Promise.resolve();
  const limite = timers.find(t => t.ms >= 8000 && t.ms <= 10000);
  assert.ok(limite, 'sale has the 8 s limit');
  limite.fn();
  const r = await enMenosDe1s(venta);
  assert.notEqual(r, 'mas de 1 s', 'sale must answer after the limit, not wait for IndexedDB forever');
  assert.ok(r.status >= 400, 'never confirmed without durability: ' + r.status);
  assert.equal((await r.json()).code, 'SALE_DURABILITY_UNCONFIRMED', 'existing truthful error code');
});

test('estado-idb: a hung strict CAS releases the queue after the limit and never writes afterwards', { timeout: 15000 }, async () => {
  const requests = [], data = new Map(), timers = [];
  const indexedDB = { open() { const req = {}; requests.push(req); return req; } };
  const ctx = { window: { indexedDB }, indexedDB, localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, navigator: {},
    console: { error() {}, warn() {} }, setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimeout() {}, Promise, Map, Set, JSON, Error };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../docs/estado-idb.js'), 'utf8'), ctx);
  const api = ctx.window.OCEstadoIDB;
  const hung = [];
  const conectar = i => {
    const db = { objectStoreNames: { contains: () => true }, close() {}, transaction() {
      const pend = new Map(), tx = { objectStore() { return {
        put(v, k) { pend.set(k, v); },
        get(k) { const r = {}; if (i === 0) hung.push(() => { r.result = data.get(k); r.onsuccess?.(); queueMicrotask(() => { for (const [a, b] of pend) data.set(a, b); tx.oncomplete?.(); }); });
          else queueMicrotask(() => { r.result = data.get(k); r.onsuccess?.(); queueMicrotask(() => { for (const [a, b] of pend) data.set(a, b); tx.oncomplete?.(); }); }); return r; } }; } };
      return tx; } };
    requests[i].result = db; requests[i].onupgradeneeded?.(); requests[i].onsuccess?.();
  };
  const tick = async () => { for (let i = 0; i < 50; i++) await new Promise(setImmediate); };
  const p1 = api.guardarConRevision({ _rev: 1, productos: [] }, 0);
  await tick(); conectar(0); await tick();
  const p2 = api.guardarConRevision({ _rev: 2, productos: [] }, 0);
  await tick();
  assert.equal(requests.length, 1, 'second CAS is still queued behind the hung one');
  timers.find(t => t.ms === 8000).fn(); // only the hung CAS reaches its limit
  assert.equal(await p1, false, 'hung CAS settles false after the limit');
  assert.equal(api.ultimoError()?.name, 'TimeoutError');
  await tick();
  assert.ok(requests.length >= 2, 'queue released: the next CAS reopens IndexedDB');
  conectar(1);
  assert.equal(await p2, true, 'next CAS commits once IndexedDB answers again');
  assert.equal(data.get([...data.keys()][0])._rev, 2);
  hung.forEach(f => f()); await tick();
  assert.equal(data.get([...data.keys()][0])._rev, 2, 'the abandoned CAS never writes its older snapshot afterwards');
});
