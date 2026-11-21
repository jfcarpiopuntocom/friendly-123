'use strict';
// C118 crossover QA: a remote PN CAS refusal must never erase a local owner
// adjustment issued while that remote strict save is pending. Synthetic-only.
// Uses the production OCSync receiver, POST route and IDB CAS, not helper fragments.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {browser}=require('./helpers/browser.cjs');
const state=w=>w.request('/api/respaldo/exportar');
const tick=()=>new Promise(ok=>setImmediate(ok));
async function until(fn, label){
  for(let i=0;i<150&&!fn();i++) await tick();
  assert.ok(fn(),label);
}
test('C118: failed remote CAS cannot silently ACK a local physical delta with missing PN',async()=>{
  const w=browser();
  w.localStorage.setItem('f123_device_id','C118-local-device');
  w.OCAuth={rolActual:()=> 'dueno'};
  const initial=(await state(w)).productos.find(p=>p.id==='p24');
  assert.ok(initial);
  await w.request('/api/productos/p24/ajustar','POST',{
    stockFisico:Number(initial.stockActual),motivo:'C118 synthetic base'
  });
  const baseline=(await state(w));
  const product=baseline.productos.find(p=>p.id==='p24');
  const originalSet=w.localStorage.setItem;
  w.localStorage.setItem=()=>{throw Error('synthetic full localStorage')};
  w.OCYjs={esLicenciaPruebaJfc:true};
  const pendings=[];
  w.OCEstadoIDB={soportado:true,guardarConRevision:(snapshot,expected)=>new Promise(resolve=>{
    pendings.push({snapshot,expected,resolve});
  }),ultimoError:()=>null};
  try{
    const remote=w.OCSync.aplicarOpRemota({opId:'C118-remote-fail',tipo:'ajuste',
      payload:{productoId:'p24',stockPNHecho:{base:Number(product.stockBase),
      epoch:String(product.stockEpochId||''),actor:'C118-other-device',add:0,sub:1}}});
    await until(()=>pendings.length===1,'remote strict CAS started');
    const local=w.fetch('/api/productos/p24/ajustar',{
      method:'POST',body:JSON.stringify({delta:-1,motivo:'C118 local correction',opId:'C118-local-adjust-0001'})
    });
    // Give local mutation a chance to enter the same live notebook before remote failure.
    await tick();
    pendings[0].resolve(false);
    const r=await remote;
    assert.equal(r?.ok,false,'remote operation refused');
    await until(()=>pendings.length>=2,'local strict CAS started after remote refusal');
    pendings[1].resolve(true);
    const response=await local;
    if(response.status===200){
      const accepted=pendings[1].snapshot;
      const written=accepted.productos.find(p=>p.id==='p24');
      assert.equal(written.stockActual,Number(product.stockActual)-1,
        'successful local -1 must survive remote rollback in same durable snapshot');
      assert.equal(Number(written.stockPN?.['C118-local-device']?.sub||0),1,
        'accepted adjustment contains its causal PN witness, not merely signed movement');
      assert.equal(accepted.movimientos.length,baseline.movimientos.length+1,
        'one and only one confirmed adjustment fact');
      const live=(await state(w)).productos.find(p=>p.id==='p24');
      assert.equal(live.stockActual,written.stockActual,'RAM agrees with durable stock');
    }else{
      assert.ok(response.status===503||response.status===507,
        'safe rejection may preserve retry; never claim uncommitted 200');
    }
  }finally{
    w.localStorage.setItem=originalSet;
    delete w.OCEstadoIDB;delete w.OCYjs;
  }
});
