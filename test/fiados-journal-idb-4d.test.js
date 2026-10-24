'use strict';
// TDD prototype. Synthetic memory only. No live license, network, payment, or real IndexedDB.
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createJournal}=require('../scripts/prototypes/fiados-journal-idb.cjs');
function fixture({legacyData,quota=false,driverBroken=false,stale=false,verifiedLegacyRoom=false}={}){
 const data=new Map(),legacy=new Map(),stats={cas:0,localWrites:0};
 const key='f123_customer_allocation_intent_v1:client1';
 if(legacyData)legacy.set(key,JSON.stringify(legacyData));
 const driver={
   async get(k){if(driverBroken)throw Error('IDB blocked');return stale?null:data.get(k)||null;},
   async cas(k,rev,next){if(driverBroken)throw Error('IDB blocked');stats.cas++;
     let old=data.get(k),current=old?old.rev:0;
     if(current!==rev)return false;
     data.set(k,JSON.parse(JSON.stringify(next)));return true;}
 };
 const localStorage={getItem:k=>legacy.get(k)||null,setItem:(k,v)=>{stats.localWrites++;if(quota)throw Error('QuotaExceededError');legacy.set(k,v);}};
 const journal=createJournal({driver,localStorage,room:'synthetic-store-A',verifiedLegacyRoom});
 const intent={opId:'customer-allocation:operation1',paymentOpId:'customer-payment:operation1',
   monto:25,partes:[{cargoKey:'cargo:synthetic',monto:25}],motivo:'Abono'};
 return {key,journal,intent,data,legacy,stats,driver,localStorage};
}
test('T1: full localStorage quota, durable IDB success => safe write-ahead before request',async()=>{
 const f=fixture({quota:true});
 const a=await f.journal.begin(f.key,f.intent);
 assert.equal(a.state,'pending');assert.equal(f.stats.localWrites,0);
 assert.equal((await f.journal.read(f.key)).intent.opId,f.intent.opId);
});
test('T2: both stores unavailable => reject, never promise a saved payment reference',async()=>{
 const f=fixture({quota:true,driverBroken:true});
 await assert.rejects(f.journal.begin(f.key,f.intent),/IDB blocked/);
 assert.equal(f.stats.localWrites,0);assert.equal(f.data.size,0);
});
test('T3: a completed receipt and allocation remain tombstoned after reopen',async()=>{
 const f=fixture({quota:true});
 await f.journal.begin(f.key,f.intent);
 const r=await f.journal.receipt(f.key,f.intent.opId,'receipt-1');
 assert.equal(r.intent.abonoId,'receipt-1');assert.equal(r.state,'receipt-confirmed');
 const reopened=createJournal({driver:f.driver,localStorage:f.localStorage,room:'synthetic-store-A'});
 const loaded=await reopened.read(f.key);
 assert.equal(loaded.intent.abonoId,'receipt-1');
 await reopened.complete(f.key,f.intent.opId);
 await assert.rejects(reopened.begin(f.key,f.intent),e=>e.code==='PAYMENT_ALREADY_COMPLETED');
});
test('T4: simultaneous attempts with different operation ids cannot replace each other',async()=>{
 const f=fixture();
 const other={...f.intent,opId:'customer-allocation:operation2',paymentOpId:'customer-payment:operation2'};
 const results=await Promise.allSettled([f.journal.begin(f.key,f.intent),f.journal.begin(f.key,other)]);
 assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
 assert.equal(results.filter(x=>x.status==='rejected').length,1);
 const saved=await f.journal.read(f.key);
 assert.ok([f.intent.opId,other.opId].includes(saved.intent.opId));
});
test('T5: preexisting legacy reference is adopted, never replaced with a new id',async()=>{
 const f=fixture({verifiedLegacyRoom:true,legacyData:{opId:'customer-allocation:old',paymentOpId:'customer-payment:old',
   monto:5,motivo:'Abono',partes:[{cargoKey:'cargo:legacy',monto:5}]}});
 await assert.rejects(f.journal.begin(f.key,f.intent),e=>e.code==='PENDING_PAYMENT_REVIEW_REQUIRED');
 const old=JSON.parse(f.legacy.get(f.key));
 const adopted=await f.journal.begin(f.key,old);
 assert.equal(adopted.intent.opId,old.opId);
 assert.equal(f.legacy.get(f.key),JSON.stringify(old),'original LS bytes unchanged');
});
test('T6: old localStorage and new IndexedDB conflicting identities require human review',async()=>{
 const f=fixture();
 await f.journal.begin(f.key,f.intent);
 f.legacy.set(f.key,JSON.stringify({...f.intent,opId:'different'}));
 await assert.rejects(f.journal.read(f.key),e=>e.code==='DIVERGENT_INTENTS_REVIEW_REQUIRED');
});
test('T7: same client id on two licensed rooms never reads another room journal',async()=>{
 const f=fixture(),b=createJournal({driver:f.driver,localStorage:f.localStorage,room:'synthetic-store-B'});
 await f.journal.begin(f.key,f.intent);
 assert.equal(await b.read(f.key),null);
});
test('T8: repeated receipt is idempotent but a contradictory receipt is rejected',async()=>{
 const f=fixture();
 await f.journal.begin(f.key,f.intent);
 const a=await f.journal.receipt(f.key,f.intent.opId,'receipt-1');
 const b=await f.journal.receipt(f.key,f.intent.opId,'receipt-1');
 assert.equal(a.rev,b.rev);
 await assert.rejects(f.journal.receipt(f.key,f.intent.opId,'receipt-2'),e=>e.code==='DIFFERENT_RECEIPT_REVIEW_REQUIRED');
});
test('T9: write/readback divergence forbids acknowledgment',async()=>{
 const f=fixture({stale:true});
 await assert.rejects(f.journal.begin(f.key,f.intent),e=>e.code==='DURABLE_READBACK_FAILED');
});
test('T10: even a one-character room or invalid payload cannot be silently changed',async()=>{
 const f=fixture();
 await assert.rejects(f.journal.begin(f.key,{...f.intent,monto:0}),e=>e.code==='INVALID_AMOUNT');
 await assert.rejects(f.journal.begin('another-key',f.intent),e=>e.code==='INVALID_KEY');
 assert.equal(f.data.size,0);
});

test('T11: an unscoped legacy receipt cannot silently migrate across store rooms',async()=>{
 const f=fixture({legacyData:{opId:'customer-allocation:old',paymentOpId:'customer-payment:old',
   monto:5,motivo:'Abono',partes:[{cargoKey:'cargo:legacy',monto:5}]}});
 await assert.rejects(f.journal.read(f.key),e=>e.code==='LEGACY_ROOM_UNVERIFIED');
 assert.equal(f.data.size,0);
});
