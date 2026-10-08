const {test}=require('node:test');
const assert=require('node:assert/strict');
const {browser}=require('./helpers/browser.cjs');
const L=require('../docs/core/payout-ledger.js');
async function setup(split=false){
 const entries=new Map();let fail=false;
 const storage={get length(){return entries.size},key:i=>[...entries.keys()][i],getItem:k=>entries.get(k)??null,
  setItem:(k,v)=>{if(fail)throw Error('Synthetic storage full');entries.set(k,String(v));},removeItem:k=>entries.delete(k)};
 const app=browser(storage);app.OCAuth={rolActual:()=> 'dueno'};
 const a=await app.request('/api/promotoras','POST',{nombre:'Synthetic A',comisionBase:40});
 const b=split?await app.request('/api/promotoras','POST',{nombre:'Synthetic B',comisionBase:10}):null;
 const r=await app.request('/api/ubicaciones','POST',{nombre:'Synthetic rack',tipo:'socio'});
 await app.request('/api/ubicaciones/'+r.id,'PUT',{promotoraId:a.id});
 const p=await app.request('/api/productos','POST',{nombre:'Synthetic',sku:'PARTIAL-GUARD',barcode:'PARTIAL-GUARD',precio:100,costo:20,stockInicial:2,ubicacionId:r.id});
 await app.request('/api/productos/'+p.id+'/venta','POST',{cantidad:1,...(b?{modoComision:'associate',promotoraId:a.id,asistenteId:b.id,asistentePct:10}:{})});
 return {app,a,b,r,p,storage,fail:()=>{fail=true},recover:()=>{fail=false}};
}
const pay=(f,opId='partial')=>({ubicacionId:f.r.id,payeeId:f.a.id,amountCents:1500,medioPago:'efectivo',opId});
async function raw(app,url,body){const r=await app.fetch(url,{method:'POST',body:JSON.stringify(body)});return {status:r.status,body:await r.json()};}
test('partial commission cannot report success when both durable stores fail, and retry can later succeed once',async()=>{
 const f=await setup();const before=await f.app.request('/api/respaldo/exportar');
 f.storage.setItem('f123_foto_percha_fixture','synthetic-photo-bytes');
 f.fail();f.app.OCEstadoIDB={guardar:async()=>false};
 const failed=await raw(f.app,'/api/payouts',pay(f));
 assert.equal(failed.status,507);assert.equal(failed.body.ok,undefined);
 const after=await f.app.request('/api/respaldo/exportar');
 assert.deepEqual(after.payouts,before.payouts);assert.deepEqual(after.ventas,before.ventas);
 assert.deepEqual(after.movimientos,before.movimientos);
 assert.equal(f.storage.getItem('f123_foto_percha_fixture'),'synthetic-photo-bytes','payment failure must not sacrifice legacy photo evidence');
 f.recover();await f.app.request('/api/payouts','POST',pay(f));await f.app.request('/api/payouts','POST',pay(f));
 assert.equal((await f.app.request('/api/payouts')).filter(p=>p.opId==='partial').length,1);
 assert.equal((await f.app.request('/api/liquidaciones')).find(x=>x.ubicacionId===f.r.id).stillDue,25);
});
test('IDB fallback must confirm before payout response or catalog notification',async()=>{
 const f=await setup();f.fail();let confirm;let notifications=0;
 f.app.addEventListener('oc-catalogo-cambiado',()=>notifications++);
 f.app.OCEstadoIDB={guardar:()=>new Promise(r=>{confirm=r})};
 let finished=false;const pending=raw(f.app,'/api/payouts',pay(f)).then(r=>{finished=true;return r});
 await new Promise(r=>setTimeout(r,0));
 assert.equal(finished,false);assert.equal(notifications,0);
 confirm(true);const done=await pending;assert.equal(done.status,200);assert.equal(done.body.ok,true);
 assert.equal(notifications,1);
});
test('failed reversal preserves the original payment, flags and financial history',async()=>{
 const f=await setup();const p=await f.app.request('/api/payouts','POST',pay(f));
 const before=await f.app.request('/api/respaldo/exportar');f.fail();f.app.OCEstadoIDB={guardar:async()=>false};
 const result=await raw(f.app,'/api/payouts/'+p.payout.id+'/reverse',{reason:'Synthetic correction'});
 assert.equal(result.status,507);
 const after=await f.app.request('/api/respaldo/exportar');
 assert.deepEqual(after.payouts,before.payouts);assert.deepEqual(after.ventas,before.ventas);assert.deepEqual(after.movimientos,before.movimientos);
});
test('legacy multi-person payment is stored as one durable batch or restores the entire batch',async()=>{
 const f=await setup(true);const before=await f.app.request('/api/respaldo/exportar');
 f.fail();f.app.OCEstadoIDB={guardar:async()=>false};
 const r=await raw(f.app,'/api/liquidaciones/'+f.r.id+'/marcar-pagado',{medioPago:'efectivo',opId:'legacy-batch'});
 assert.equal(r.status,507);
 const after=await f.app.request('/api/respaldo/exportar');
 assert.deepEqual(after.payouts,before.payouts);assert.deepEqual(after.ventas,before.ventas);assert.deepEqual(after.movimientos,before.movimientos);
});
test('payment guard rejects unsafe cents rather than recording imprecise money',()=>{
 const r=L.planPayout({sales:[{id:'s',fecha:'2026-10-01',ubicacionId:'r',promotoraId:'a',split:{montoComisionSocio:100000000000000}}],
  locations:[{id:'r',promotoraId:'a'}],payeeId:'a',id:'unsafe',opId:'unsafe',amountCents:9007199254740992});
 assert.equal(r.status,400);assert.equal(r.payout,undefined);
});
test('two simultaneous local retries share one durable intent without Web Locks',async()=>{
 const f=await setup();const results=await Promise.all([raw(f.app,'/api/payouts',pay(f)),raw(f.app,'/api/payouts',pay(f))]);
 assert.ok(results.every(r=>r.status===200));assert.equal(results.filter(r=>r.body.existing).length,1);
 assert.equal((await f.app.request('/api/payouts')).length,1);
 const restarted=browser(f.storage);restarted.OCAuth={rolActual:()=> 'dueno'};
 assert.equal((await restarted.request('/api/liquidaciones')).find(r=>r.ubicacionId===f.r.id).stillDue,25);
});
test('legacy multi-person success confirms one full snapshot containing both payouts',async()=>{
 const f=await setup(true);f.fail();let saves=0;let persisted;
 f.app.OCEstadoIDB={guardar:async snapshot=>{saves++;persisted=JSON.parse(JSON.stringify(snapshot));return true}};
 const r=await raw(f.app,'/api/liquidaciones/'+f.r.id+'/marcar-pagado',{medioPago:'efectivo',opId:'durable-batch'});
 assert.equal(r.status,200);assert.equal(r.body.payoutIds.length,2);assert.equal(saves,1);
 assert.equal(persisted.payouts.length,2);
});
test('incoming sync survives rollback of a failed payout and is applied after the durable boundary',async()=>{
 const f=await setup();const peer=browser();peer.OCAuth={rolActual:()=> 'dueno'};peer.receive(f.app);
 const customer=await peer.request('/api/clientes','POST',{nombre:'Synthetic remote customer'});
 f.fail();let finish;
 f.app.OCEstadoIDB={guardar:()=>new Promise(r=>{finish=r})};
 const pending=raw(f.app,'/api/payouts',pay(f));await new Promise(r=>setTimeout(r,0));
 f.app.receive(peer);finish(false);
 assert.equal((await pending).status,507);
 const after=await f.app.request('/api/respaldo/exportar');
 assert.equal(after.payouts.length,0);assert.ok(after.clientes.some(c=>c.id===customer.id));
});
