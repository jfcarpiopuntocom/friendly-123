'use strict';
// v667 stock-converge. Synthetic data only (no relay, no licence, no customer data).
// PRIME DIRECTIVE 1AAA: every device holding the same add-only facts shows the same stock; no movement is dropped
// or counted twice; the latest physical count wins and movements made after it still apply.
const {test} = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const {browser} = require('./helpers/browser.cjs');

const sync = fs.readFileSync(path.join(__dirname, '../docs/sync-yjs.js'), 'utf8');
function cargarVista(ahora = null) {
  const a = sync.indexOf('  function publicarTestigosStock(r, mapa) {');
  const b = sync.indexOf('  function conectarStore(Y) {');
  assert.ok(a > 0 && b > a, 'production witness + view code found');
  const ctx = {window: {OCLatencia: {ahoraRelay: () => ahora}}, WeakMap, Object, Number, JSON, Array, Math, Infinity, String};
  vm.createContext(ctx);
  return vm.runInContext(`(function(){${sync.slice(a, b)};return {publicarTestigosStock,incorporarTestigosStock,calcularVistaStock};})()`, ctx);
}
// Minimal Y.Map: add-only set + observers, same surface the index uses.
class MapaFalso {
  constructor() { this.m = new Map(); this.obs = []; }
  get size() { return this.m.size; }
  has(k) { return this.m.has(k); } get(k) { return this.m.get(k); }
  forEach(f) { this.m.forEach(f); } observe(f) { this.obs.push(f); }
  set(k, v) { const nuevo = !this.m.has(k); this.m.set(k, v); const ev = {keysChanged: new Set([k]), changes: {keys: new Map([[k, {action: nuevo ? 'add' : 'update'}]])}}; this.obs.forEach(f => f(ev)); }
}
const W = (p, b, e, d, a, s, t) => ({p, b, e, d, a, s, t});
function mapaCon(hechos, orden) {
  const m = new MapaFalso();
  (orden ? orden(hechos) : hechos).forEach((w, i) => m.set(JSON.stringify([w.p, w.b, w.e, w.d, w.a, w.s, i]), w));
  return m;
}
const E0 = 'stock-epoch-0000', E1 = 'stock-epoch-1111';
const vista = (V, mapa, rec) => V.incorporarTestigosStock([Object.assign({id: 'P'}, rec)], mapa)[0];

test('count wins, a movement made AFTER it on the older ledger still applies (offline device)', () => {
  const V = cargarVista();
  const hechos = [
    W('P', 20, E0, '@conteo', 0, 0, 100), W('P', 13, E1, '@conteo', 0, 0, 200),
    W('P', 20, E0, 'C', 0, 3, 300),   // C, offline, sold 3 after the count
    W('P', 13, E1, 'B', 6, 0, 400)];  // B added 6 on top of the count
  const r = vista(V, mapaCon(hechos), {stockBase: 20, stockEpochId: E0, stockPN: {}, stockActual: 20, stockTs: 100});
  assert.equal(r.stockActual, 13 + 6 - 3);
  assert.equal(r.stockEpochId, E1);
});

test('a movement made BEFORE the count is superseded by the count', () => {
  const V = cargarVista();
  const hechos = [
    W('P', 20, E0, '@conteo', 0, 0, 100), W('P', 13, E1, '@conteo', 0, 0, 200),
    W('P', 20, E0, 'C', 0, 3, 150), W('P', 13, E1, 'B', 6, 0, 400)];
  assert.equal(vista(V, mapaCon(hechos), {stockBase: 13, stockEpochId: E1, stockPN: {}, stockActual: 13, stockTs: 200}).stockActual, 19);
});

test('same facts in ANY order give the same view; replaying a witness never counts twice', () => {
  const V = cargarVista();
  const hechos = [
    W('P', 20, E0, '@conteo', 0, 0, 100), W('P', 13, E1, '@conteo', 0, 0, 200),
    W('P', 20, E0, 'C', 0, 2, 250), W('P', 20, E0, 'C', 0, 3, 300), W('P', 13, E1, 'B', 6, 0, 400), W('P', 13, E1, 'B', 6, 1, 500)];
  const vistos = new Set();
  const perms = [h => h, h => h.slice().reverse(), h => h.slice(3).concat(h.slice(0, 3)), h => h.concat(h)];
  for (const orden of perms) {
    const r = vista(V, mapaCon(hechos, orden), {stockBase: 20, stockEpochId: E0, stockPN: {C: {add: 0, sub: 3}}, stockActual: 17, stockTs: 300});
    vistos.add(JSON.stringify([r.stockActual, r.stockEpochId, r.stockBase]));
    assert.equal(r.stockActual, 13 + 6 - 1 - 3);
  }
  assert.equal(vistos.size, 1);
});

test('a late movement on a stale ledger does not overturn a newer count (stockTs no longer decides)', () => {
  const V = cargarVista();
  const hechos = [W('P', 20, E0, '@conteo', 0, 0, 100), W('P', 13, E1, '@conteo', 0, 0, 200), W('P', 20, E0, 'C', 0, 1, 9000)];
  const r = vista(V, mapaCon(hechos), {stockBase: 20, stockEpochId: E0, stockPN: {C: {add: 0, sub: 1}}, stockActual: 19, stockTs: 9000});
  assert.equal(r.stockEpochId, E1);
  assert.equal(r.stockActual, 13 - 1);
});

test('legacy ledger (no epoch) with many actors + an explicit count: nothing lost, all devices agree', () => {
  const V = cargarVista();
  const legacy = [W('P', 6, '', '@conteo', 0, 0, 10), W('P', 6, '', 'a', 8, 13, 60), W('P', 6, '', 'b', 20, 0, 70), W('P', 6, '', 'c', 0, 2, 80)];
  const cuenta = [W('P', 7, E1, '@conteo', 0, 0, 500), W('P', 7, E1, 'a', 6, 0, 600), W('P', 6, '', 'c', 0, 4, 700) /* legacy device sold 2 more after the count */];
  const todos = legacy.concat(cuenta);
  const r1 = vista(V, mapaCon(todos), {stockBase: 6, stockEpochId: '', stockPN: {a: {add: 8, sub: 13}}, stockActual: 1});
  const r2 = vista(V, mapaCon(todos, h => h.slice().reverse()), {stockBase: 7, stockEpochId: E1, stockPN: {}, stockActual: 7});
  assert.equal(r1.stockActual, 7 + 6 - 2);
  assert.equal(r2.stockActual, r1.stockActual);
  assert.equal(r1.stockEpochId, E1);
  assert.ok(r1.stockEvidencias[String(6)] && r1.stockEvidencias[String(6)].pn.b.add === 20, 'the losing ledger stays as evidence');
});

test('a legacy group with the SAME base as an explicit group is its movements, never a count', () => {
  const V = cargarVista();
  const hechos = [W('P', 20, E0, '@conteo', 0, 0, 100), W('P', 20, E0, 'B', 5, 0, 200), W('P', 20, '', 'old', 0, 4, 900)];
  const r = vista(V, mapaCon(hechos), {stockBase: 20, stockEpochId: E0, stockPN: {}, stockActual: 20, stockTs: 100});
  assert.equal(r.stockEpochId, E0);
  assert.equal(r.stockActual, 20 + 5 - 4);
});

test('derived carry lines are never published as facts', () => {
  const V = cargarVista();
  const mapa = new MapaFalso();
  V.publicarTestigosStock({id: 'P', stockBase: 13, stockEpochId: E1, stockTs: 400, stockPN: {B: {add: 6, sub: 0}, '~x~C': {add: 0, sub: 3}}}, mapa);
  const claves = [...mapa.m.values()].map(w => w.d).sort();
  assert.deepEqual(claves, ['@conteo', 'B']);
});

test('a product with no ledger anywhere is left untouched (legacy rules apply)', () => {
  const V = cargarVista();
  const p = {id: 'P', stockActual: 4, stockTs: 5};
  assert.equal(V.incorporarTestigosStock([p], new MapaFalso())[0], p);
});

test('a stamp far in the future of the common clock cannot win while another group exists', () => {
  const ahora = 1900000000000;
  const V = cargarVista(ahora);
  const hechos = [W('P', 20, E0, '@conteo', 0, 0, ahora - 1000), W('P', 99, E1, '@conteo', 0, 0, ahora + 3600000)];
  assert.equal(vista(V, mapaCon(hechos), {stockBase: 20, stockEpochId: E0, stockPN: {}, stockActual: 20, stockTs: ahora - 1000}).stockActual, 20);
});

// ---- adoption in the store (mock-backend aplicarCatalogo) -------------------------------------------------
async function sembrar(w, rec) {
  const f = await w.request('/api/respaldo/exportar');
  const p = f.productos.find(x => Number(x.stockActual) >= 1);
  const net = rec.stockBase + Object.values(rec.stockPN || {}).reduce((n, x) => n + x.add - x.sub, 0);
  f.productos = [{...p, id: 'conv', nombre: 'Synthetic converge', barcode: 'SYN-CONV', stockDeficit: 0,
    stockActual: Math.max(0, net), rev: {c: 1, d: 'fixture'}, ...rec}];
  f.ventas = []; f.movimientos = [];
  assert.ok(await w.request('/api/respaldo/importar', 'POST', f));
}
const item = async w => (await w.request('/api/respaldo/exportar')).productos.find(p => p.id === 'conv');

test('store adopts the converged view when it already contains every local movement', async () => {
  const w = browser();
  await sembrar(w, {stockBase: 20, stockEpochId: E0, stockPN: {C: {add: 0, sub: 3}}, stockTs: 300});
  const remoto = w.catalog();
  Object.assign(remoto.productos.find(p => p.id === 'conv'), {
    stockVista: true, stockBase: 13, stockEpochId: E1, stockPN: {B: {add: 6, sub: 0}, '~stock-epoch-0000~C': {add: 0, sub: 3}},
    stockActual: 16, stockDeficit: 0, stockTs: 400,
    stockEvidencias: {[JSON.stringify([20, E0])]: {base: 20, epoch: E0, pn: {C: {add: 0, sub: 3}}, ts: 300}}});
  w.OCSync.aplicarCatalogo(remoto, null);
  const p = await item(w);
  assert.equal(p.stockActual, 16);
  assert.equal(p.stockEpochId, E1);
  assert.equal(p.stockVista, undefined);
});

test('store keeps a local movement the view does not contain yet (never drops), and adopts later', async () => {
  const w = browser();
  await sembrar(w, {stockBase: 20, stockEpochId: E0, stockPN: {C: {add: 0, sub: 5}}, stockTs: 300});
  const remoto = w.catalog();
  const viewSinC = {stockVista: true, stockBase: 13, stockEpochId: E1, stockPN: {B: {add: 6, sub: 0}}, stockActual: 19, stockDeficit: 0, stockTs: 400,
    stockEvidencias: {[JSON.stringify([20, E0])]: {base: 20, epoch: E0, pn: {C: {add: 0, sub: 3}}, ts: 300}}};
  Object.assign(remoto.productos.find(p => p.id === 'conv'), viewSinC);
  w.OCSync.aplicarCatalogo(remoto, null);
  let p = await item(w);
  assert.equal(p.stockActual, 15, 'local C -5 (20-5) kept: the view only knew C -3');
  assert.equal(p.stockEpochId, E0);
  viewSinC.stockEvidencias[JSON.stringify([20, E0])].pn.C.sub = 5;
  viewSinC.stockPN['~stock-epoch-0000~C'] = {add: 0, sub: 5}; viewSinC.stockActual = 14;
  Object.assign(remoto.productos.find(p => p.id === 'conv'), viewSinC);
  w.OCSync.aplicarCatalogo(remoto, null);
  p = await item(w);
  assert.equal(p.stockActual, 14);
  assert.equal(p.stockEpochId, E1);
});

test('owner-observed state: legacy device at 19 and shared record at 7 converge to the latest count plus its movements (13)', async () => {
  const V = cargarVista();
  const hechos = [
    W('P', 6, '', '@conteo', 0, 0, 100), W('P', 6, '', 'a', 8, 13, 400), W('P', 6, '', 'b', 20, 2, 700),  // legacy history: 6 + (-5) + 18 = 19
    W('P', 7, E1, '@conteo', 0, 0, 800), W('P', 7, E1, 'x', 6, 0, 900)];                                    // count 7, then +6
  const compartido = vista(V, mapaCon(hechos), {stockBase: 7, stockEpochId: E1, stockPN: {}, stockActual: 7, stockTs: 800});
  assert.equal(compartido.stockActual, 13, 'the shared record shows 13, not the stripped 7');
  // the long-lived legacy device: epoch "" ledger worth 19, stamp newer than the count in its own clock
  const w = browser();
  await sembrar(w, {stockBase: 6, stockEpochId: '', stockPN: {a: {add: 8, sub: 13}, b: {add: 20, sub: 2}}, stockTs: 5000});
  assert.equal((await item(w)).stockActual, 19);
  const remoto = w.catalog();
  Object.assign(remoto.productos.find(p => p.id === 'conv'), compartido, {id: 'conv'});
  w.OCSync.aplicarCatalogo(remoto, null);
  const p = await item(w);
  assert.equal(p.stockActual, 13);
  assert.equal(p.stockEpochId, E1);
  assert.equal(p.stockEvidencias[String(6)].pn.b.add, 20, 'legacy ledger kept as evidence');
});
