const {test}=require('node:test');
const assert=require('node:assert/strict');
const {browser}=require('./helpers/browser.cjs');
const L=require('../docs/core/payout-ledger.js');
async function waitForAck(acks,count){for(let i=0;i<150&&acks.length<count;i++)await new Promise(resolve=>setImmediate(resolve));assert.ok(acks.length>=count,`expected ${count} durable saves, observed ${acks.length}`);}
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
 const sale=await app.request('/api/productos/'+p.id+'/venta','POST',{cantidad:1,...(b?{modoComision:'associate',promotoraId:a.id,asistenteId:b.id,asistentePct:10}:{})});
 return {app,a,b,r,p,sale,storage,fail:()=>{fail=true},recover:()=>{fail=false}};
}
const pay=(f,opId='partial')=>({ubicacionId:f.r.id,payeeId:f.a.id,amountCents:1500,medioPago:'efectivo',opId});
async function raw(app,url,body){const r=await app.fetch(url,{method:'POST',body:JSON.stringify(body)});return {status:r.status,body:await r.json()};}
test('partial commission cannot report success when both durable stores fail, and retry can later succeed once',async()=>{
 const f=await setup();const before=await f.app.request('/api/respaldo/exportar');
 f.storage.setItem('f123_foto_percha_fixture','synthetic-photo-bytes');
 f.fail();f.app.OCEstadoIDB={guardarConRevision:async()=>false};
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
 f.app.OCEstadoIDB={guardarConRevision:()=>new Promise(r=>{confirm=r})};
 let finished=false;const pending=raw(f.app,'/api/payouts',pay(f)).then(r=>{finished=true;return r});
 await new Promise(r=>setTimeout(r,0));
 assert.equal(finished,false);assert.equal(notifications,0);
 confirm(true);const done=await pending;assert.equal(done.status,200);assert.equal(done.body.ok,true);
 assert.equal(notifications,1);
});
test('failed reversal preserves the original payment, flags and financial history',async()=>{
 const f=await setup();const p=await f.app.request('/api/payouts','POST',pay(f));
 const before=await f.app.request('/api/respaldo/exportar');f.fail();f.app.OCEstadoIDB={guardarConRevision:async()=>false};
 const result=await raw(f.app,'/api/payouts/'+p.payout.id+'/reverse',{reason:'Synthetic correction'});
 assert.equal(result.status,507);
 const after=await f.app.request('/api/respaldo/exportar');
 assert.deepEqual(after.payouts,before.payouts);assert.deepEqual(after.ventas,before.ventas);assert.deepEqual(after.movimientos,before.movimientos);
});
test('legacy multi-person payment is stored as one durable batch or restores the entire batch',async()=>{
 const f=await setup(true);const before=await f.app.request('/api/respaldo/exportar');
 f.fail();f.app.OCEstadoIDB={guardarConRevision:async()=>false};
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
 f.app.OCEstadoIDB={guardarConRevision:async snapshot=>{saves++;persisted=JSON.parse(JSON.stringify(snapshot));return true}};
 const r=await raw(f.app,'/api/liquidaciones/'+f.r.id+'/marcar-pagado',{medioPago:'efectivo',opId:'durable-batch'});
 assert.equal(r.status,200);assert.equal(r.body.payoutIds.length,2);assert.equal(saves,1);
 assert.equal(persisted.payouts.length,2);
});
test('incoming sync survives rollback of a failed payout and keeps deferred Yjs name provenance',async()=>{
 const f=await setup();const peer=browser();peer.OCAuth={rolActual:()=> 'dueno'};peer.receive(f.app);
 const customer=await peer.request('/api/clientes','POST',{nombre:'Synthetic remote customer'});
 await f.app.request('/api/instancia/nombre','POST',{nombre:'Before payout'});
 const canonical=f.app.catalog();canonical.nombreNegocio='Queued Yjs after payout';
 canonical.nombreNegocioTs=1;canonical._nombreDesdeYjs=true;
 f.fail();const acks=[];
 f.app.OCEstadoIDB={guardarConRevision:(snapshot,priorRev)=>Number.isSafeInteger(priorRev)?new Promise(resolve=>acks.push({snapshot:JSON.parse(JSON.stringify(snapshot)),resolve})):Promise.resolve(false)};
 const pending=raw(f.app,'/api/payouts',pay(f));await waitForAck(acks,1);
 f.app.receive(peer);
 f.app.OCSync.aplicarCatalogo(canonical,'dueno',true);
 assert.equal(f.app.catalog(),null,'do not publish a provisional catalog while payout durability is pending');
 acks[0].resolve(false);
 assert.equal((await pending).status,507);
 await waitForAck(acks,2);
 assert.equal(acks[1].snapshot.payouts.length,0,'failed payout is absent from the first replay snapshot');
 assert.ok(['Before payout','Queued Yjs after payout'].includes(acks[1].snapshot.nombreNegocio),'intermediate replay snapshot retains a valid name');
 acks[1].resolve(true);
 await waitForAck(acks,3);
 assert.equal(acks[2].snapshot.nombreNegocio,'Queued Yjs after payout');
 assert.equal(acks[2].snapshot.payouts.length,0,'failed payout is absent from replay snapshot');
 assert.ok(acks[2].snapshot.clientes.some(c=>c.id===customer.id),'final replay snapshot preserves peer customer');
 acks[2].resolve(true);
 const after=await f.app.request('/api/respaldo/exportar');
 assert.equal(after.payouts.length,0);assert.ok(after.clientes.some(c=>c.id===customer.id));
 assert.equal(f.app.catalog().nombreNegocio,'Queued Yjs after payout',
   'failed payout replay must retain the trusted Yjs origin against the newer local timestamp');
});
test('failed sale return replays deferred Yjs owner name without losing stock or sale',async()=>{
 const f=await setup();
 await f.app.request('/api/instancia/nombre','POST',{nombre:'Before return'});
 const canonical=f.app.catalog();canonical.nombreNegocio='Queued Yjs after return';
 canonical.nombreNegocioTs=1;canonical._nombreDesdeYjs=true;
 const before=await f.app.request('/api/respaldo/exportar');
 f.fail();const acks=[];
 f.app.OCEstadoIDB={guardarConRevision:(snapshot,priorRev)=>Number.isSafeInteger(priorRev)?new Promise(resolve=>acks.push({snapshot:JSON.parse(JSON.stringify(snapshot)),resolve})):Promise.resolve(false)};
 const pending=raw(f.app,'/api/ventas/'+f.sale.ventaId+'/devolucion',{motivo:'Synthetic deferred name'});
 await waitForAck(acks,1);
 f.app.OCSync.aplicarCatalogo(canonical,'dueno',true);
 assert.equal(f.app.catalog(),null,'return in flight is not publishable');
 acks[0].resolve(false);
 assert.equal((await pending).status,507);
 await waitForAck(acks,2);
 assert.equal(acks.length,2,'rollback replay reaches its separate durable catalog save');
 assert.equal(acks[1].snapshot.nombreNegocio,'Queued Yjs after return');
 acks[1].resolve(true);
 const after=await f.app.request('/api/respaldo/exportar');
 // Catalog merges materialize absent false/null return flags, without a financial change.
 // Compare all evidence after removing ONLY these equivalent default values.
 const defaults={anulada:false,canceladaExPostEn:null,devolucionId:null,devuelta:false,fechaDevolucion:null};
 const economic=items=>items.map(item=>{
   const v={...item};
   for(const [key,value] of Object.entries(defaults))
     if(v[key]===value)delete v[key];
   return v;
 });
 assert.deepEqual(economic(after.ventas),economic(before.ventas),
   'every sale ID, price, quantity, date and financial fact must survive the failed return');
 assert.ok(after.ventas.every(v=>v.devuelta!==true && !v.fechaDevolucion && !v.devolucionId),
   'no return may be recorded after failed persistence');
 // stockDeficit is a derived view: catalog replay materializes zero when absent.
 // Every actual stock counter, location, ledger and other product field remains strict.
 const productEvidence=items=>items.map(product=>{
   const p={...product};
   if(p.stockDeficit===0)delete p.stockDeficit;
   return p;
 });
 assert.deepEqual(productEvidence(after.productos),productEvidence(before.productos),
   'actual stock, product metadata and all PN-counter evidence must stay unchanged');
 assert.deepEqual(after.payouts,before.payouts,'commission payouts were not changed');
 assert.deepEqual(after.ajustesComision,before.ajustesComision,'commission adjustments were not changed');
 // A successful deferred catalog replay appends exactly one audit event.
 // Historical receipts must remain byte-for-byte equal, in original order.
 assert.deepEqual(after.movimientos.slice(0,before.movimientos.length),before.movimientos,
   'all pre-existing audit and money receipts remain immutable');
 const addedAudit=after.movimientos.slice(before.movimientos.length);
 assert.equal(addedAudit.length,1,'exactly one sync audit entry after deferred replay');
 assert.equal(addedAudit[0].tipo,'merge-catalogo','no return, payout or financial receipt added');
 assert.equal(addedAudit[0].prevSello,before.movimientos.at(-1).sello,
   'append-only audit chain links to its preceding immutable receipt');
 assert.equal(f.app.catalog().nombreNegocio,'Queued Yjs after return',
   'return rollback must retain Yjs-authoritative name on deferred replay');
});
