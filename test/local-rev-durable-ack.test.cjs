'use strict';
// Synthetic-only C1 regression. Runs exact saver/loader/listener bodies from this checkout.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {webcrypto} = require('node:crypto');
const helperSource = fs.readFileSync(path.join(__dirname, '../docs/estado-ab.js'), 'utf8');
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
  const disk = new Map([['legacy_ptr', 'B'], ['legacy_B', JSON.stringify(durable)]]);
  const state = { productos: structuredClone(durable.productos), ubicaciones: structuredClone(durable.ubicaciones) };
  let storageHandler, localStorageFails = failLocalStorage;
  const ctx = {
    _conflictoEstadoAB: null, _registrarConflictoAB: ()=>false, _huellaPublicable: estado=>JSON.stringify(estado), _estadoLecturaBloqueada: false, _guardadoCatalogoPendiente: null, _guardandoAB: false,
    // Production keeps these state fences in the same backend closure. The
    // extracted fixtures must include them even when every intent is idle.
    _ventaPendiente: null, _payoutPendiente: null, _retencionPendiente: null,
    _guardadoEstrictoPendiente: null, _ventaConfirmando: false, _payoutConfirmando: false,
    _retencionConfirmando: false, _ultimoErrorIDB: null,
    _localRev: 5, _localRevReservado: 0, _miSello: 'seed', _cargoBufferReal: false,
    OC_STATE_PTR: 'legacy_ptr', OC_STATE_SELLO: 'seal', OC_STATE_KEY: 'legacy', OC_STATE_SUFIJO: '',
    claveBuffer: x => `legacy_${x}`,
    localStorage: {
      getItem: k => disk.get(k) ?? null,
      setItem(k, v) { if (localStorageFails && k.startsWith('legacy_')) throw Error('synthetic quota'); disk.set(k, String(v)); },
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
  Object.assign(ctx.window,{localStorage:ctx.localStorage,crypto:webcrypto,navigator:{}});
  vm.runInNewContext(helperSource,{window:ctx.window});
  ctx._leerEstadoEstricto=k=>ctx.localStorage.getItem(k);
  const ab=ctx.window.OCEstadoAB.crear({storage:ctx.localStorage,claveBase:'legacy'});
  ctx._estadoAB=()=>ab;
  new Function('ctx', `with(ctx){${save}\n${load}\n${refresh}\n${listener}\nctx.saveNow=_guardarEstadoLocalAhora;}`)(ctx);
  return { ctx, disk, state, allowLocalStorageWrites: () => { localStorageFails = false; }, storageEvent: key => storageHandler({ key }) };
}

test('C1: two failed stores preserve durable rev 5 and do not reject a known peer edit at rev 6', async () => {
  const f = fixture();
  assert.equal(await f.ctx.saveNow(false, false), false);
  assert.equal(await f.ctx.saveNow(false, false), false);
  assert.equal(f.ctx._localRev, 5);
  assert.equal(f.ctx._localRevReservado, 7);
  assert.equal(JSON.parse(f.disk.get('legacy_B'))._rev, 5);
  const peer = { _rev: 6, productos: [{ id: 'p1', nombre: 'Widget editado en peer' }], ubicaciones: [{ id: 's1' }] };
  f.disk.set('legacy_A', JSON.stringify(peer)); f.disk.set('legacy_ptr', 'A'); f.storageEvent('legacy_ptr');
  assert.equal(f.state.productos[0].nombre, 'Widget editado en peer');
  assert.equal(f.ctx._localRev, 6);
  f.allowLocalStorageWrites();
  assert.equal(await f.ctx.saveNow(false, false), true);
  assert.equal(JSON.parse(f.disk.get('legacy_B'))._rev, 8);
  assert.equal(f.ctx._localRev, 8);
});

test('C1: late failed IDB attempt cannot lower the durable high-water adopted from a peer', async () => {
  const completions = [], snapshots = [];
  const f = fixture({ idbWrite: snapshot => { snapshots.push(snapshot._rev); return new Promise(resolve => completions.push(resolve)); } });
  const attempt = f.ctx.saveNow(false, false);
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(snapshots,[6]);
  const peer={_rev:7,productos:[{id:'p1',nombre:'Peer durable ACK'}],ubicaciones:[{id:'s1'}]};
  f.disk.set('legacy_A',JSON.stringify(peer));f.disk.set('legacy_ptr','A');f.storageEvent('legacy_ptr');
  assert.equal(f.ctx._localRev,7);assert.equal(f.state.productos[0].nombre,'Peer durable ACK');
  completions[0](false);assert.equal(await attempt,false);
  assert.equal(f.ctx._localRev,7,'late failure cannot lower a newer durable revision');
});

test('C1: two serialized IDB failures preserve durable revision and reserve distinct attempts', async () => {
  const completions = [], snapshots=[];
  const f = fixture({ idbWrite: snapshot => {snapshots.push(snapshot._rev);return new Promise(resolve => completions.push(resolve));} });
  const a = f.ctx.saveNow(false, false), b = f.ctx.saveNow(false, false);
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(snapshots,[6],'second same-key snapshot waits for the real helper lock');
  completions[0](false);assert.equal(await a,false);
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(snapshots,[6,7]);completions[1](false);assert.equal(await b,false);
  assert.equal(f.ctx._localRev, 5);
  assert.equal(f.ctx._localRevReservado, 7);
});
