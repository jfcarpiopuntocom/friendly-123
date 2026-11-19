// C16b-S: actual IndexedDB semantics using the project's pinned fake-indexeddb 6.2.8.
// Tests run in Node, no browser origin, no Cloudflare and no shop data.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {indexedDB,IDBKeyRange} from 'fake-indexeddb';
import {createDurableTypedOpsStore} from '../src/port2-idb-ops-store.mjs';
import {createTypedOpsReconciler} from '../src/port2-typed-ops-reconciler.mjs';
const LICENSE='F123-SYNT-C16B-IDB',INSTANCE='synthetic_c16b_device1';
let serial=0;
const db=()=> 'c16b_fixture_'+(++serial);
const opts=(dbName,instanceId=INSTANCE)=>({licenseCode:LICENSE,instanceId,indexedDB,keyRange:IDBKeyRange,dbName});
const cmd=(opId='c16b_sale_000001',amountCents=1500)=>({
 license:LICENSE,opId,kind:'sale.record',productId:'sku_1',quantity:1,amountCents
});
const entry=(opId,command=cmd(opId),state='prepared',attempts=0)=>({
 opId,command,sameDoLocked:true,state,attempts,createdAt:1700000000000,updatedAt:1700000000000
});
test('C16b initial 0 state + transaction-complete durable save + independent reload',async()=>{
 const name=db(),a=createDurableTypedOpsStore(opts(name));
 try{
  assert.deepEqual(await a.loadAll(),[]);
  await a.save(entry('c16b_sale_000001'));
  assert.deepEqual((await a.loadAll()).map(x=>x.opId),['c16b_sale_000001']);
  await a.close();
  const b=createDurableTypedOpsStore(opts(name));
  try{
   const recovered=await b.loadAll();
   assert.equal(recovered.length,1);
   assert.equal(recovered[0].command.amountCents,1500);
   assert.equal(recovered[0].sameDoLocked,true);
   await b.remove('c16b_sale_000001');
   assert.deepEqual(await b.loadAll(),[]);
  }finally{await b.close()}
 }finally{await a.close()}
});
test('C16b same opId with changed economic payload is atomic fail-closed',async()=>{
 const store=createDurableTypedOpsStore(opts(db()));
 try{
  await store.save(entry('c16b_sale_000002'));
  await assert.rejects(store.save(entry('c16b_sale_000002',cmd('c16b_sale_000002',9999))));
  assert.equal((await store.loadAll())[0].command.amountCents,1500);
 }finally{await store.close()}
});
test('C16b C15 validator forbids PIN/extra fields/unsupported expense and unpersisted lock',async()=>{
 const store=createDurableTypedOpsStore(opts(db()));
 try{
  const original=entry('c16b_sale_000003');
  await assert.rejects(store.save({...original,command:{...original.command,pin:'123'}}));
  await assert.rejects(store.save({...original,sameDoLocked:false}));
  await assert.rejects(store.save({...original,command:{...original.command,kind:'expense.record'}}));
  await assert.rejects(store.save({...original,token:'secret'}));
  assert.deepEqual(await store.loadAll(),[]);
 }finally{await store.close()}
});
test('C16b scope isolates per instance and supports parallel independent shops',async()=>{
 const name=db(),a=createDurableTypedOpsStore(opts(name,'device_aaa111')),
  b=createDurableTypedOpsStore(opts(name,'device_bbb222'));
 try{
  await Promise.all([a.save(entry('c16b_sale_000004')),b.save(entry('c16b_sale_000005'))]);
  assert.deepEqual((await a.loadAll()).map(x=>x.opId),['c16b_sale_000004']);
  assert.deepEqual((await b.loadAll()).map(x=>x.opId),['c16b_sale_000005']);
 }finally{await Promise.all([a.close(),b.close()])}
});
test('C16b two live tabs conflict atomically on same opId without overwriting first sale',async()=>{
 const name=db(),a=createDurableTypedOpsStore(opts(name)),b=createDurableTypedOpsStore(opts(name));
 try{
  const res=await Promise.allSettled([
   a.save(entry('c16b_sale_000006',cmd('c16b_sale_000006',1500))),
   b.save(entry('c16b_sale_000006',cmd('c16b_sale_000006',3500)))
  ]);
  assert.deepEqual(res.map(x=>x.status).sort(),['fulfilled','rejected']);
  const value=(await a.loadAll())[0];
  assert([1500,3500].includes(value.command.amountCents));
  assert.equal((await b.loadAll())[0].command.amountCents,value.command.amountCents);
 }finally{await Promise.all([a.close(),b.close()])}
});
test('C16b tx read-only after close errors; no in-memory fake ACK',async()=>{
 const store=createDurableTypedOpsStore(opts(db()));
 await store.save(entry('c16b_sale_000007'));
 await store.close();
 await assert.rejects(store.loadAll());
 await assert.rejects(store.save(entry('c16b_sale_000008')));
 await assert.rejects(store.remove('c16b_sale_000007'));
});
test('C16b with C16a reconciler: IDB commit before dispatch, restart same opId and no legacy twice',async()=>{
 const name=db(),persist=createDurableTypedOpsStore(opts(name));
 const opId='c16b_sale_000009';let posted=0,replayed=0;
 const rec=createTypedOpsReconciler({
  store:persist,
  dispatch:async command=>{
   posted++;
   assert.equal(command.opId,opId);
   assert.equal((await persist.loadAll()).length,1,'POST only after indexedDB commit');
   return {committed:false,stage:'queued-not-committed',fallbackLegacy:false,
    reconcileRequired:true,retryTarget:'same-do-only',status:202};
  },
  isVisible:()=>true,
  schedule:()=>1,cancelSchedule:()=>{}
 });
 const initial=await rec.submit(cmd(opId));
 assert.equal(initial.committed,false);assert.equal(initial.fallbackLegacy,false);
 assert.equal(posted,1);
 rec.destroy();await persist.close();
 const reloadedStore=createDurableTypedOpsStore(opts(name));
 try{
  const rec2=createTypedOpsReconciler({
   store:reloadedStore,isVisible:()=>true,
   schedule:()=>1,cancelSchedule:()=>{},
   dispatch:async command=>{
    replayed++;assert.equal(command.opId,opId);
    return {committed:true,duplicate:true,stage:'business-committed',status:200,
     receipt:{opId,receiptId:'f'.repeat(24),stage:'business-committed'}};
   }
  });
  await rec2.ready();
  assert.equal(rec2.pending().length,1);
  await rec2.reconcileNow();
  assert.equal(replayed,1);
  assert.deepEqual(await reloadedStore.loadAll(),[]);
  rec2.destroy();
 }finally{await reloadedStore.close()}
});
test('C16b invalid or unavailable IDB fails closed before store is created',()=>{
 assert.throws(()=>createDurableTypedOpsStore({licenseCode:LICENSE,instanceId:INSTANCE,indexedDB:null,keyRange:IDBKeyRange}),/durable commercial outbox unavailable/);
 assert.throws(()=>createDurableTypedOpsStore({licenseCode:LICENSE,instanceId:INSTANCE,indexedDB,keyRange:null}),/durable commercial outbox unavailable/);
 assert.throws(()=>createDurableTypedOpsStore({...opts(db()),licenseCode:'DEMO'}),/durable commercial outbox unavailable/);
});
