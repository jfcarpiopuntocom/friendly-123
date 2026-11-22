'use strict';
// C199: Source-executed regression for the ACTUAL cross-license 2.0 handoff.
// Proves an unrelated notebook cannot leave this notebook "Sync pending" forever.
// Does not mutate localStorage, release any original operation, or fake an ACK.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const src = fs.readFileSync(path.join(__dirname, '../docs/sync-realtime.js'), 'utf8');
const start = src.indexOf('  let _colaScopeCrudo = null');
const end = src.indexOf('\n  async function recargarConfirmados20(', start);
assert.ok(start >= 0 && end > start, 'real durable pending helper must be present');
const pendingSource = src.slice(start, end);
const pauseBegin = src.indexOf('    async pausarParaArquitectura20(licencia) {');
const pauseEnd = src.indexOf('\n    reanudarDesdeArquitectura20(', pauseBegin);
assert.ok(pauseBegin >= 0 && pauseEnd > pauseBegin, 'real cutover pause must be present');
const pauseSource = src.slice(pauseBegin, pauseEnd);

function fixture(queue, {license='A', confirmed=null, channelPending=0}={}) {
  let selectedLicense = license;
  const store = new Map([['f123_sync_cola', JSON.stringify(queue)], ['f123_sync_room', JSON.stringify({codigo:license})]]);
  const ctx = {
    document: {hidden:false},
    localStorage: {getItem: key => store.get(key) || null},
    _colaCrudo: null, _colaLargo: 0,
    codigoCuadernoActivo: () => selectedLicense,
    normalizarCodigo: x => String(x||'').trim().toUpperCase(),
    leerCola: () => JSON.parse(store.get('f123_sync_cola')||'[]'),
    colaLargo() {
      const raw = store.get('f123_sync_cola') || null;
      if (raw === ctx._colaCrudo) return ctx._colaLargo;
      const n = JSON.parse(raw||'[]').length;
      ctx._colaCrudo=raw; ctx._colaLargo=n; return n;
    },
    _ids20Licencia: confirmed ? license : '', _ids20Confirmados: confirmed ? new Set(confirmed) : null,
    pendientesCanales: {catalogo:channelPending},
    leerSala: () => JSON.parse(store.get('f123_sync_room')),
    _pausaArquitectura20: null, _conexionGeneracion:0,
    cerrarWsExistente() {}, notificarEstado() {},
    recargas:0,
    async recargarConfirmados20() {ctx.recargas++;return false;}
  };
  vm.createContext(ctx);
  vm.runInContext(pendingSource,ctx);
  const pause = vm.runInContext('({' + pauseSource + '}).pausarParaArquitectura20',ctx);
  return { ctx, pause, pending: () => vm.runInContext('tienePendientesDurables()',ctx),
    store, setLicense: value => { selectedLicense = value; } };
}

test('foreign scoped queue alone is not a pending operation of the selected license', async () => {
  const f=fixture([{opId:'B-op-1',_salaOrigen:'B'}]);
  assert.equal(f.pending(),false,'foreign durable data remain available in storage');
  const result=await f.pause('A');
  assert.equal(result.ok,true,'actual certified handoff is not blocked by another license');
  assert.equal(f.ctx.recargas,0,'must not demand an unnecessary tombstone read');
  assert.equal(f.store.get('f123_sync_cola'),JSON.stringify([{opId:'B-op-1',_salaOrigen:'B'}]));
});
test('pending current-license op still blocks the handoff without durable proof', async () => {
  const f=fixture([{opId:'A-op-1',_salaOrigen:'A'}]);
  assert.equal(f.pending(),true);
  assert.equal((await f.pause('A')).ok,false);
  assert.equal(f.ctx.recargas,1);
});
test('unknown legacy provenance remains fail-closed', async () => {
  const f=fixture([{opId:'unknown-1'}]);
  assert.equal(f.pending(),true);
  assert.equal((await f.pause('A')).ok,false);
});
test('mixed current and foreign queues still protect current-license writes', async () => {
  const f=fixture([{opId:'B-op-1',_salaOrigen:'B'},{opId:'A-op-1',_salaOrigen:'A'}]);
  assert.equal(f.pending(),true);
  assert.equal((await f.pause('A')).ok,false);
});
test('same-license committed opId may be released only by its IDB tombstone', async () => {
  const f=fixture([{opId:'B-op-1',_salaOrigen:'B'},{opId:'A-op-1',_salaOrigen:'A'}],{confirmed:['A-op-1']});
  assert.equal(f.pending(),false);
  assert.equal((await f.pause('A')).ok,true);
});
test('live Yjs channel pending remains blocking, even if legacy queue is foreign', async () => {
  const f=fixture([{opId:'B-op-1',_salaOrigen:'B'}],{channelPending:1});
  assert.equal(f.pending(),true);
  assert.equal((await f.pause('A')).ok,false);
});
test('cache invalidates on queue mutation, license switch and new committed IDB set', () => {
  const f=fixture([{opId:'B-op-1',_salaOrigen:'B'}]);
  assert.equal(f.pending(),false);
  f.setLicense('B');
  assert.equal(f.pending(),true,'the same outbox becomes current after a notebook switch');
  f.setLicense('A');
  assert.equal(f.pending(),false,'switching back reuses the correct scoped result');
  f.store.set('f123_sync_cola',JSON.stringify([{opId:'A-op-1',_salaOrigen:'A'}]));
  assert.equal(f.pending(),true);
  f.ctx._ids20Licencia='A';
  f.ctx._ids20Confirmados=new Set(['A-op-1']);
  assert.equal(f.pending(),false);
  f.ctx._ids20Confirmados=new Set();
  assert.equal(f.pending(),true);
});
test('missing notebook identity cannot waive the queue', () => {
  const f=fixture([{opId:'B-op-1',_salaOrigen:'B'}],{license:''});
  assert.equal(f.pending(),true);
});