'use strict';
// Synthetic-only C1 regression. Runs exact saver/loader/listener bodies from this checkout.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../docs/mock-backend.js'), 'utf8').replace(/\r\n/g, '\n');
function fragment(start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, `source anchor: ${start}`);
  return source.slice(a, b);
}
const save = fragment('  function _guardarEstadoLocalAhora(', '  /* SOLO CONSOLA');
const load = fragment('  function cargarEstadoLocal() {', '  // Cuando otra pestaña guarda, recargar su estado');
const refresh = fragment('  function _refrescarDesdeOtraPestana() {', '  window.addEventListener("storage"');
const listener = fragment('  window.addEventListener("storage", (e) => {', '  try { window.AMG?.Aislamiento');

function fixture({ failLocalStorage = true, idbWrite } = {}) {
  const durable = { _rev: 5, productos: [{ id: 'p1', nombre: 'Widget original' }], ubicaciones: [{ id: 's1' }] };
  const disk = new Map([['ptr', 'B'], ['bufB', JSON.stringify(durable)]]);
  const state = { productos: structuredClone(durable.productos), ubicaciones: structuredClone(durable.ubicaciones) };
  let storageHandler, localStorageFails = failLocalStorage;
  const ctx = {
    _localRev: 5, _localRevReservado: 0, _miSello: 'seed', _cargoBufferReal: false,
    OC_STATE_PTR: 'ptr', OC_STATE_SELLO: 'seal', OC_STATE_KEY: 'legacy', OC_STATE_SUFIJO: '',
    claveBuffer: x => `buf${x}`,
    localStorage: {
      getItem: k => disk.get(k) ?? null,
      setItem(k, v) { if (localStorageFails && k.startsWith('buf')) throw Error('synthetic quota'); disk.set(k, String(v)); },
    },
    _espejarEnIDB: idbWrite || (() => Promise.resolve(false)),
    estadoActualExportable: () => ({ _rev: ctx._localRev, productos: structuredClone(state.productos), ubicaciones: structuredClone(state.ubicaciones) }),
    validarRespaldo: b => b && Array.isArray(b.productos) && Array.isArray(b.ubicaciones) ? null : 'invalid',
    aplicarRespaldo: b => { state.productos = structuredClone(b.productos); state.ubicaciones = structuredClone(b.ubicaciones); },
    _vaciarTiendaFresca() {}, repararRespaldo: () => null,
    ocultarAvisoRecorte() {}, despejarAvisoMemoriaLlena() {}, _publicarAdminPins() {},
    avisoMemoriaLlena() {}, avisoEspacioJusto() {}, avisarBufferRecuperado() {}, avisarEstadoReparado() {},
    setTimeout() {}, console: { warn() {} }, document: {}, CustomEvent: class {},
    window: { addEventListener(type, fn) { if (type === 'storage') storageHandler = fn; }, dispatchEvent() {} },
  };
  new Function('ctx', `with(ctx){${save}\n${load}\n${refresh}\n${listener}\nctx.saveNow=_guardarEstadoLocalAhora;}`)(ctx);
  return { ctx, disk, state, allowLocalStorageWrites: () => { localStorageFails = false; }, storageEvent: key => storageHandler({ key }) };
}

test('C1: two failed stores preserve durable rev 5 and do not reject a known peer edit at rev 6', async () => {
  const f = fixture();
  assert.equal(await f.ctx.saveNow(false, false), false);
  assert.equal(await f.ctx.saveNow(false, false), false);
  assert.equal(f.ctx._localRev, 5);
  assert.equal(f.ctx._localRevReservado, 7);
  assert.equal(JSON.parse(f.disk.get('bufB'))._rev, 5);
  const peer = { _rev: 6, productos: [{ id: 'p1', nombre: 'Widget editado en peer' }], ubicaciones: [{ id: 's1' }] };
  f.disk.set('bufA', JSON.stringify(peer)); f.disk.set('ptr', 'A'); f.storageEvent('ptr');
  assert.equal(f.state.productos[0].nombre, 'Widget editado en peer');
  assert.equal(f.ctx._localRev, 6);
  f.allowLocalStorageWrites();
  assert.equal(await f.ctx.saveNow(false, false), true);
  assert.equal(JSON.parse(f.disk.get('bufB'))._rev, 8);
  assert.equal(f.ctx._localRev, 8);
});

test('C1: older failed IDB attempt after newer ACK cannot lower durable high-water', async () => {
  const completions = [], snapshots = [];
  const f = fixture({ idbWrite: snapshot => { snapshots.push(snapshot._rev); return new Promise(resolve => completions.push(resolve)); } });
  const attemptA = f.ctx.saveNow(false, false), attemptB = f.ctx.saveNow(false, false);
  assert.deepEqual(snapshots, [6, 7]);
  completions[1](true); assert.equal(await attemptB, true); assert.equal(f.ctx._localRev, 7);
  completions[0](false); assert.equal(await attemptA, false); assert.equal(f.ctx._localRev, 7);
});

test('C1: if both IDB attempts fail, reservation is not mistaken for durable revision', async () => {
  const completions = [];
  const f = fixture({ idbWrite: () => new Promise(resolve => completions.push(resolve)) });
  const a = f.ctx.saveNow(false, false), b = f.ctx.saveNow(false, false);
  completions[0](false); completions[1](false);
  assert.deepEqual(await Promise.all([a, b]), [false, false]);
  assert.equal(f.ctx._localRev, 5);
  assert.equal(f.ctx._localRevReservado, 7);
});

