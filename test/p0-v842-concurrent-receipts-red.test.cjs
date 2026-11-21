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
    await until(()=>duplicateSettled || pending.length>1,
      'duplicate must either finish with failure or request a bounded retry');
    if(pending.length>1)pending[1].resolve(false); // a safe second attempt is also refused
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
    let Bsettled=false;
    const B=Promise.resolve(w.OCSync.aplicarOpRemota(op('C118-B','phone-B'))).then(result=>{
      Bsettled=true;return result;
    });
    await until(()=>pending.length===1,'first strict CAS reached');
    pending[0].resolve(false);
    const first=await A;
    assert.equal(first?.ok,false);
    // Correct receivers may wait and commit B, or reject it for safe retry.
    await until(()=>Bsettled || pending.length>=2,'B must either reject or attempt a strict CAS');
    if(pending.length>=2)pending[1].resolve(true);
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
      // Fail closed is acceptable: retry must be possible and there is no ACK B.
      assert.ok(!second || second.ok!==true,'uncommitted B must not receive success');
    }
  }finally{fx.restore()}
});

test('C119: queued remote PN must reject a business switch even when device notebookId stays constant',async()=>{
  const fx=await fixture(),{w,op,pending}=fx;
  const originalLicense=w.OCTienda.licenciaActual;
  const originalNotebook=w.OCTienda.cuadernoId;
  try {
    // The real notebookId identifies the DEVICE, not its active business.
    // Fix this synthetic identity despite the forced-full localStorage fixture.
    w.OCTienda.cuadernoId=()=> 'C119-stable-device';
    let active='F123-SYNTH-SHOP-A';
    w.OCTienda.licenciaActual=()=>active;
    const deviceNotebook=String(w.OCTienda.cuadernoId()||'');
    assert.ok(deviceNotebook,'fixture exposes a durable per-device notebookId');
    const first=w.OCSync.aplicarOpRemota(op('C119-first-fail','device-A'));
    await until(()=>pending.length===1,'first CAS is in flight before another op queues');
    let secondSettled=false;
    const second=Promise.resolve(w.OCSync.aplicarOpRemota(op('C119-queued-other-shop','device-B')))
      .then(result=>{secondSettled=true;return result});
    active='F123-SYNTH-SHOP-B';
    assert.equal(String(w.OCTienda.cuadernoId()||''),deviceNotebook,
      'per-device notebookId does not identify the active commercial shop');
    pending[0].resolve(false);
    assert.equal((await first)?.ok,false,'first CAS refused');
    await until(()=>secondSettled || pending.length>=2,'queued operation reached identity fence or CAS');
    if(pending.length>=2)pending[1].resolve(true); // avoid a hung RED test on a broken receiver
    const result=await second;
    assert.equal(result?.ok,false,'queued A-shop operation must never ACK in B shop');
    assert.equal(pending.length,1,'wrong-shop operation must not attempt another IDB commit');
    const live=(await state(w)).productos.find(p=>p.id==='p24');
    assert.equal(pn(live,'device-B'),0,'no cross-shop PN witness contaminates B inventory');
  }finally{
    w.OCTienda.licenciaActual=originalLicense;
    w.OCTienda.cuadernoId=originalNotebook;
    fx.restore();
  }
});
