'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const path=require('node:path');
const {IDBFactory}=require('fake-indexeddb');
const url=pathToFileURL(path.join(__dirname,'../src/pago-intento-idb.mjs')).href;
const NS_A='a'.repeat(64),NS_B='b'.repeat(64);
async function setup(indexedDB=new IDBFactory(),namespace=NS_A){
  const {createPaymentIntentStore}=await import(url);
  return createPaymentIntentStore({indexedDB,namespace});
}
const info=(id,amount=5)=>({opId:'customer-payment:'+id,monto:amount,motivo:'Fixture'});
test('RED Belén: browser storage-full does not prevent IDB durable pending payment readback after reopen',async()=>{
  const indexedDB=new IDBFactory();
  const store=await setup(indexedDB);
  const pending=info('cold-restart');
  assert.deepEqual(await store.get({kind:'payment',clientId:'synthetic-client'}),null);
  assert.equal((await store.putIfAbsent({kind:'payment',clientId:'synthetic-client',value:pending})).created,true);
  const reopened=await setup(indexedDB);
  assert.deepEqual(await reopened.get({kind:'payment',clientId:'synthetic-client'}),pending);
});
test('two tabs racing separate opIds cannot replace the pending receipt or double-charge',async()=>{
  const indexedDB=new IDBFactory();
  const a=await setup(indexedDB),b=await setup(indexedDB);
  const res=await Promise.allSettled([
    a.putIfAbsent({kind:'payment',clientId:'same-client',value:info('tab-A')}),
    b.putIfAbsent({kind:'payment',clientId:'same-client',value:info('tab-B')})
  ]);
  assert.equal(res.filter(x=>x.status==='fulfilled').length,1);
  assert.equal(res.filter(x=>x.status==='rejected').length,1);
  const saved=await a.get({kind:'payment',clientId:'same-client'});
  assert.ok(['customer-payment:tab-A','customer-payment:tab-B'].includes(saved.opId));
  assert.equal((await b.putIfAbsent({kind:'payment',clientId:'same-client',value:saved})).created,false,
    'same opId may be retried; it is not a new debit');
});
test("one customer's unpaid reference cannot leak into another client or license",async()=>{
  const indexedDB=new IDBFactory();
  const a=await setup(indexedDB,NS_A),b=await setup(indexedDB,NS_B);
  await a.putIfAbsent({kind:'payment',clientId:'cli-A',value:info('A')});
  assert.equal(await a.get({kind:'payment',clientId:'cli-B'}),null);
  assert.equal(await b.get({kind:'payment',clientId:'cli-A'}),null);
  assert.equal(await a.get({kind:'allocation',clientId:'cli-A'}),null);
});
test('receipt/allocation must preserve original opId; stale tab cannot overwrite or delete',async()=>{
  const s=await setup();
  await s.putIfAbsent({kind:'allocation',clientId:'cli-A',value:{opId:'customer-allocation:first',abonoId:null,partes:[{cargoKey:'sale:a',monto:5}]}});
  await assert.rejects(s.replaceIfOp({kind:'allocation',clientId:'cli-A',expectedOpId:'customer-allocation:stale',value:{opId:'customer-allocation:stale',abonoId:'old'}}),/conflict/i);
  await assert.rejects(s.removeIfOp({kind:'allocation',clientId:'cli-A',expectedOpId:'customer-allocation:stale'}),/conflict/i);
  assert.equal((await s.get({kind:'allocation',clientId:'cli-A'})).abonoId,null);
  const updated={opId:'customer-allocation:first',abonoId:'receipt-123',partes:[{cargoKey:'sale:a',monto:5}]};
  assert.equal((await s.replaceIfOp({kind:'allocation',clientId:'cli-A',expectedOpId:'customer-allocation:first',value:updated})).updated,true);
  assert.deepEqual(await s.get({kind:'allocation',clientId:'cli-A'}),updated);
  assert.equal(await s.removeIfOp({kind:'allocation',clientId:'cli-A',expectedOpId:'customer-allocation:first'}),true);
  assert.equal(await s.get({kind:'allocation',clientId:'cli-A'}),null);
});
test('IDB unavailable/quota/invalid data fails closed before any business request',async()=>{
  const {createPaymentIntentStore}=await import(url);
  assert.throws(()=>createPaymentIntentStore({indexedDB:new IDBFactory(),namespace:'unsafe-plaintext-license'}),/namespace/i);
  const s=await setup({open(){throw new Error('QuotaExceededError')}});
  await assert.rejects(s.putIfAbsent({kind:'payment',clientId:'cli-A',value:info('new')}),/QuotaExceeded|persistence/i);
  const sane=await setup();
  await assert.rejects(sane.putIfAbsent({kind:'payment',clientId:'cli-A',value:{opId:'',monto:5}}),/opId/i);
});
