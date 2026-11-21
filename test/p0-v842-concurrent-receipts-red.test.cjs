'use strict';
// C118, source-extracted RED regression for PR #936. No production data or network.
// The older Sync3 ops observer awaits promises, but sync-realtime.js invokes
// OCSync.aplicarOpRemota(op) without awaiting it. Two remote frames may overlap.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const src = fs.readFileSync(path.join(__dirname, '../docs/mock-backend.js'), 'utf8');
const start = src.indexOf('      const witness = op.payload && op.payload.stockPNHecho;');
const end = src.indexOf('      /* NEUTRALIZADO', start);
const mergeStart = src.indexOf('  function _fundirHechoStock(p, w) {');
const mergeEnd = src.indexOf('  /* v515:', mergeStart);
assert.ok(start > 0 && end > start && mergeStart > 0 && mergeEnd > mergeStart, 'real source functions found');
assert.ok(src.includes('if (vistos.has(op.opId)) return { ok: true, repetida: true }'), 'real incoming duplicate gate found');
const receive = new Function('op','window','productos','guardarEstadoLocal','_fundirHechoStock',
  'clonar','_marcarOpAplicada','avisarCatalogoCambiado','_cargarOpsAplicadas',src.slice(start,end));
const merge = new Function(src.slice(mergeStart,mergeEnd) + ';return _fundirHechoStock;')();
const clone = x => JSON.parse(JSON.stringify(x));
const deferred = () => { let resolve; const promise = new Promise(ok => { resolve = ok; }); return { promise, resolve }; };
function fixture() {
  const product = { id:'p', stockBase:10, stockEpochId:'E', stockPN:{}, stockActual:10, stockDeficit:0 };
  const receipts = new Set(), ack = [], saves = [], pending = [], event = [];
  const win = { OCYjs:{ esLicenciaPruebaJfc:true } };
  let disk = null, previousSave = null;
  function save() {
    const slot = deferred();
    const begin = () => {
      // This models guardarEstadoLocal(true): a second strict writer waits for
      // _guardadoCatalogoPendiente before capturing its current live snapshot.
      const record = { product:clone(product), receipts:[...receipts] };
      saves.push(record); pending.push(slot);
      return slot.promise.then(ok => { if (ok === true) disk = clone(record); return ok; });
    };
    const run = previousSave ? previousSave.then(begin) : begin();
    previousSave = Promise.resolve(run).then(() => {}, () => {});
    return run;
  }
  function apply(opId, actor) {
    const op = { opId, tipo:'ajuste', payload:{ productoId:'p',
      stockPNHecho:{base:10,epoch:'E',actor,add:0,sub:1} } };
    // This mirrors the exact early gate from the production method.
    if (receipts.has(op.opId)) return {ok:true,repetida:true};
    return receive(op,win,[product],save,merge,clone,id=>ack.push(id),()=>event.push('changed'),()=>receipts);
  }
  return {apply,product,receipts,ack,saves,pending,event,get disk(){return disk;}};
}

test('RED: a duplicate opId cannot receive success while its first strict save is unconfirmed', async () => {
  const h = fixture();
  const first = h.apply('same-id','phone-A');
  const second = h.apply('same-id','phone-A');
  assert.equal(h.saves.length,1,'the duplicate must not start a second save');
  h.pending[0].resolve(false);
  const failed = await first;
  assert.equal(failed.ok,false,'the real strict commit was refused');
  assert.equal(h.product.stockActual,10,'failed optimistic stock is rolled back');
  assert.equal(h.receipts.has('same-id'),false,'failed opId remains eligible for retry');
  assert.notEqual(second && second.ok,true,
    'NO durable ACK for an in-flight duplicate whose first commit can still fail');
});

test('RED: one failed concurrent stock save cannot erase another opId accepted as durable', async () => {
  const h = fixture();
  const first = h.apply('op-A','phone-A');
  const second = h.apply('op-B','phone-B');
  assert.equal(h.product.stockActual,8,'two distinct PN witnesses are initially reflected');
  assert.equal(h.saves.length,1,'second strict save waits for the first to finish');
  h.pending[0].resolve(false);
  assert.equal((await first).ok,false);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.saves.length,2,'second strict save can start after the failed first');
  h.pending[1].resolve(true);
  const b = await second;
  if (b && b.ok) {
    assert.equal(h.receipts.has('op-B'),true,'accepted B receipt should remain');
    assert.equal(h.product.stockPN['phone-B']?.sub,1,
      'ACK B requires its physical PN witness to remain in the current read model');
    assert.equal(h.product.stockActual,h.disk.product.stockActual,
      'live stock cannot disagree with successful durable snapshot');
    assert.equal(h.disk.receipts.includes('op-A'),false,
      'a failed A must not get a receipt in the successful B snapshot');
  } else {
    assert.equal(h.receipts.has('op-B'),false,'unconfirmed B is retained for retry');
  }
});
