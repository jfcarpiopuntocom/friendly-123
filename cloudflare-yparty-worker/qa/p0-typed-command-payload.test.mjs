import test from 'node:test';
import assert from 'node:assert/strict';
import {createTypedCommercialLedger} from '../src/typed-commercial-ledger.mjs';

const LICENSE='F123-ABCDEFGH';
const command=Object.freeze({license:LICENSE,opId:'sale_test_00001',kind:'sale.record',
  productId:'product_synthetic',quantity:2,amountCents:1234});
function fixture({deny=false,failPayload=false}={}){
  let receipts=new Map(),payloads=new Map();
  const sql={exec(query,...args){
    if(query.startsWith('CREATE TABLE'))return [];
    if(query.startsWith('SELECT payload_json')){
      const payload=payloads.get(args.join(':'));
      return payload===undefined?[]:[{payload_json:payload}];
    }
    if(query.startsWith('SELECT payload_hash')){
      const row=receipts.get(args.join(':'));
      return row?[row]:[];
    }
    if(query.startsWith('INSERT INTO typed_commercial_ops')){
      const key=args[0]+':'+args[1];
      if(receipts.has(key))throw Error('duplicate');
      receipts.set(key,{payload_hash:args[2],receipt_json:args[3]});
      return [];
    }
    if(query.startsWith('INSERT INTO typed_commercial_payloads')){
      if(failPayload)throw Error('payload disk error');
      const key=args[0]+':'+args[1];
      if(payloads.has(key))throw Error('duplicate payload');
      payloads.set(key,args[2]);
      return [];
    }
    throw Error('Unexpected SQL: '+query);
  }};
  const transactionSync=fn=>{
    const oldReceipts=new Map(receipts),oldPayloads=new Map(payloads);
    try{return fn();}catch(e){receipts=oldReceipts;payloads=oldPayloads;throw e;}
  };
  const authorize=async({license,scope})=>deny?{ok:false}:{
    ok:true,principal:{license,subject:'synthetic-owner',scopes:[scope]}
  };
  return {ledger:createTypedCommercialLedger({sql,transactionSync,authorize,clock:()=>42}),
    receipts:()=>receipts,payloads:()=>payloads};
}
test('new command is durable as canonical payload and inbox receipt atomically',async()=>{
  const f=fixture();
  const r=await f.ledger.submit({ticket:'synthetic-ticket',command});
  assert.equal(r.ok,true);assert.equal(r.duplicate,false);
  assert.equal(r.receipt.stage,'stored-for-application');
  assert.deepEqual(JSON.parse(f.payloads().get(LICENSE+':'+command.opId)),{
    license:LICENSE,opId:command.opId,kind:'sale.record',
    productId:'product_synthetic',quantity:2,amountCents:1234
  });
  assert.equal(f.receipts().size,1);
  const again=await f.ledger.submit({ticket:'synthetic-ticket',command:{...command}});
  assert.equal(again.duplicate,true);
  assert.deepEqual(again.receipt,r.receipt);
  assert.equal(f.payloads().size,1);
});
test('same opId with different money cannot overwrite canonical payload',async()=>{
  const f=fixture();
  await f.ledger.submit({ticket:'synthetic-ticket',command});
  const conflict=await f.ledger.submit({ticket:'synthetic-ticket',command:{...command,amountCents:9999}});
  assert.equal(conflict.status,409);
  assert.equal(JSON.parse(f.payloads().values().next().value).amountCents,1234);
});
test('payload write failure rolls back receipt and refuses ACK',async()=>{
  const f=fixture({failPayload:true});
  const result=await f.ledger.submit({ticket:'synthetic-ticket',command});
  assert.equal(result.ok,false);assert.equal(result.status,503);
  assert.equal(f.receipts().size,0);assert.equal(f.payloads().size,0);
});
test('hash-only historical receipt must not claim replayable duplicate ACK',async()=>{
  const f=fixture();
  const first=await f.ledger.submit({ticket:'synthetic-ticket',command});
  assert.equal(first.ok,true);
  f.payloads().delete(LICENSE+':'+command.opId); // models a legacy receipt without payload
  const repeated=await f.ledger.submit({ticket:'synthetic-ticket',command});
  assert.equal(repeated.ok,false);
  assert.equal(repeated.status,409);
  assert.equal(repeated.reason,'operation-recovery-required');
  assert.equal(f.receipts().size,1);
  assert.equal(f.payloads().size,0);
});
test('corrupt canonical payload must not claim replayable duplicate ACK',async()=>{
  const f=fixture();
  await f.ledger.submit({ticket:'synthetic-ticket',command});
  f.payloads().set(LICENSE+':'+command.opId,JSON.stringify({...command,amountCents:9999}));
  const repeated=await f.ledger.submit({ticket:'synthetic-ticket',command});
  assert.equal(repeated.ok,false);
  assert.equal(repeated.status,409);
  assert.equal(repeated.reason,'operation-recovery-required');
});
test('denied authority cannot write either row',async()=>{
  const f=fixture({deny:true});
  const result=await f.ledger.submit({ticket:'synthetic-ticket',command});
  assert.equal(result.status,403);
  assert.equal(f.receipts().size,0);assert.equal(f.payloads().size,0);
});
