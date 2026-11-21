'use strict';
// C118: RED -> GREEN on REAL OCSync.aplicarOpRemota, not an extracted receiver fragment.
// No network, customers, browser profile, production storage, or global state.
// Strict IDB CAS is deliberately deferred. A/B localStorage is made unavailable
// to prove an unconfirmed operation cannot obtain a success receipt.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { browser } = require('./helpers/browser.cjs');

const state = w => w.request('/api/respaldo/exportar');
const tick = () => new Promise(resolve => setImmediate(resolve));
async function until(check, label) {
  for (let i = 0; i < 150 && !check(); i++) await tick();
  assert.ok(check(), label);
}
async function fixture() {
  const w = browser();
  w.OCAuth = { rolActual: () => 'dueno' };
  const before = await state(w);
  const product = before.productos.find(p => p.id === 'p24');
  assert.ok(product, 'real seeded product exists');
  // An authorized physical count establishes the same PN epoch as live stock.
  await w.request('/api/productos/p24/ajustar','POST',{
    stockFisico: Number(product.stockActual), motivo: 'C118 synthetic authorized count'
  });
  const fresh = (await state(w)).productos.find(p => p.id === 'p24');
  assert.ok(Number.isSafeInteger(Number(fresh.stockBase)), 'physical baseline exists');
  w.OCYjs = { esLicenciaPruebaJfc: true };
  const original = w.localStorage.setItem;
  w.localStorage.setItem = () => { throw Error('synthetic origin quota'); };
  const pending = [];
  w.OCEstadoIDB = {
    soportado:true,
    guardarConRevision:(candidate, expected)=>new Promise(resolve => {
      pending.push({ candidate,expected,resolve });
    }),
    ultimoError:()=>null
  };
  const op=(id,actor)=>({
    opId:id, tipo:'ajuste',deviceId:actor,
    payload:{productoId:'p24',stockPNHecho:{
      base:Number(fresh.stockBase),epoch:String(fresh.stockEpochId||''),
      actor,add:0,sub:1
    }}
  });
  return {w,op,pending,baseline:Number(fresh.stockActual),restore(){
    w.localStorage.setItem=original;delete w.OCEstadoIDB;delete w.OCYjs;
  }};
}
function pn(product,actor){return Number(product.stockPN && product.stockPN[actor] && product.stockPN[actor].sub||0)}
test('RED: duplicate opId cannot claim durable success while first CAS is unresolved',async()=>{
  const fx=await fixture(),{w,pending,op}=fx;
  try {
    const received=op('C118-same','phone-A');
    const first=w.OCSync.aplicarOpRemota(received);
    await until(()=>pending.length===1,'first strict CAS reached');
    let duplicateSettled=false,duplicateResult=null;
    const duplicate=Promise.resolve(w.OCSync.aplicarOpRemota(received)).then(result=>{
      duplicateSettled=true;duplicateResult=result;return result;
    });
    await tick();
    assert.ok(!duplicateSettled || duplicateResult?.ok!==true,
      'a provisional receipt cannot make a duplicate a completed success');
    pending[0].resolve(false);
    const firstResult=await first;
    assert.equal(firstResult?.ok,false,'first strict CAS refusal is an error');
    await tick();
    if(pending.length>1)pending[1].resolve(false); // correct implementations may retry the duplicate
    const secondResult=await duplicate;
    assert.notEqual(secondResult?.ok,true,'no success without any durable commit');
    const after=(await state(w)).productos.find(p=>p.id==='p24');
    assert.equal(after.stockActual,fx.baseline,'failed op must roll back');
    assert.equal(pn(after,'phone-A'),0,'no failed PN witness remains');
  }finally{fx.restore()}
});

test('RED: failed A cannot erase distinct B that subsequently receives durable ACK',async()=>{
  const fx=await fixture(),{w,pending,op}=fx;
  try {
    const A=w.OCSync.aplicarOpRemota(op('C118-A','phone-A'));
    const B=w.OCSync.aplicarOpRemota(op('C118-B','phone-B'));
    await until(()=>pending.length===1,'first strict CAS reached');
    pending[0].resolve(false);
    const first=await A;
    assert.equal(first?.ok,false);
    await until(()=>pending.length===2,'second strict save reaches IDB after first settles');
    pending[1].resolve(true);
    const second=await B;
    if(second?.ok===true) {
      const persisted=pending[1].candidate.productos.find(p=>p.id==='p24');
      const live=(await state(w)).productos.find(p=>p.id==='p24');
      assert.equal(pn(persisted,'phone-B'),1,'ACK B must include B causal PN in durable snapshot');
      assert.equal(pn(live,'phone-B'),1,'ACK B must retain PN in live stock');
      assert.equal(pn(live,'phone-A'),0,'failed A must not be counted');
      assert.equal(live.stockActual,fx.baseline-1,'stock equals exactly one accepted movement');
      assert.deepEqual((pending[1].candidate.opsAplicadas||[]).includes('C118-A'),false,
        'failed A must not ride in B durable receipts');
      assert.equal((pending[1].candidate.opsAplicadas||[]).includes('C118-B'),true,
        'accepted B receipt is in its own same commit');
    } else {
      const candidate=pending[1].candidate;
      assert.ok(candidate,'second attempted strict save before refusing');
      // A cautious receiver may decline B, but must never falsely ACK it.
    }
  }finally{fx.restore()}
});
