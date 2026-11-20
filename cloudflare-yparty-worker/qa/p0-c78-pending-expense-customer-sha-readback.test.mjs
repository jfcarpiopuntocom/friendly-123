// C78 RED-FIRST: queued expense and customer-payment 202 need canonical SHA.
// Production ledger + actual SQL engine on native SQLite, no customer data.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {
 prepareBusinessBaseline,installBusinessBaseline,createBusinessSqlExecutor
} from '../src/authoritative-business-sql.mjs';
import {createTypedCommercialLedger} from '../src/typed-commercial-ledger.mjs';

const license='F123-SYNT-BUSINESS',sku='sku_1',fiado='fiado_1';
const initial={license,frozenHead:'c72-independent-synthetic-head-01',
 products:[{productId:sku,quantity:10,unitPriceCents:1999}],
 openingCashCents:500,receivables:[{receivableId:fiado,balanceCents:3000}]};
const sha=state=>createHash('sha256').update(JSON.stringify(state)).digest('hex');
function wrap(db){
 const sql={exec(stmt,...args){
  const q=db.prepare(stmt),bind=args.map(v=>v instanceof Uint8Array?Buffer.from(v):v);
  const raw=/^\s*(SELECT|PRAGMA|WITH)\b/i.test(stmt)?q.all(...bind):q.run(...bind);
  const rows=Array.isArray(raw)?raw:[];
  return {one:()=>rows[0],toArray:()=>rows,[Symbol.iterator]:function*(){yield*rows;}};
 }};
 const storage={sql,transactionSync(fn){
  db.exec('BEGIN IMMEDIATE');try{const result=fn();db.exec('COMMIT');return result;}
  catch(e){db.exec('ROLLBACK');throw e;}
 }};
 return {sql,storage};
}
function sale(id='synthetic-c72-sale-001',quantity=2,amountCents=3998){
 return {license,opId:id,kind:'sale.record',productId:sku,quantity,amountCents};
}
function pay(id='synthetic-c72-pay-001',amountCents=1000){
 return {license,opId:id,kind:'credit.payment.record',receivableId:fiado,amountCents};
}
function count(id='synthetic-c72-count-001',quantity=5){
 return {license,opId:id,kind:'stock.adjust',productId:sku,quantity,amountCents:0};
}
async function make(){
 const db=new DatabaseSync(':memory:'),{sql,storage}=wrap(db);
 const proof=await prepareBusinessBaseline({...initial,
  sourceFrozenVerified:true,expectedSha256:sha(initial)});
 assert.equal(installBusinessBaseline({storage,proof}).already,false);
 const settings={
  sql,transactionSync:storage.transactionSync.bind(storage),
  authorize:async({scope})=>({ok:true,principal:{
   license,role:'dueno',subject:'owner-account',scopes:[scope]}}),
  authorizeReceivable:async()=>true,
  authorizeCustomer:async()=>true,
  clock:()=>1730000000000
 };
 const applied=createTypedCommercialLedger({...settings,
  applyBusiness:createBusinessSqlExecutor({sql})});
 const queued=createTypedCommercialLedger(settings);
 return {db,sql,storage,proof,applied,queued,
  retry:()=>installBusinessBaseline({storage,proof}),
  async submit(command){
   const result=await applied.submit({ticket:'synthetic-owner-ticket',command});
   assert.equal(result.ok,true,JSON.stringify(result));
   assert.equal(result.receipt.stage,'business-committed');
   return result;
  },
  row(opId){
   return sql.exec('SELECT receipt_json,payload_hash FROM typed_commercial_ops WHERE license=? AND op_id=?',
    license,opId).one();
  },
  totals(){return {
   cash:sql.exec('SELECT cash_cents FROM f123_business_baseline WHERE license=?',license).one().cash_cents,
   stock:sql.exec('SELECT quantity FROM f123_business_stock WHERE license=? AND product_id=?',license,sku).one().quantity,
   debt:sql.exec('SELECT balance_cents FROM f123_business_receivables WHERE license=? AND receivable_id=?',license,fiado).one().balance_cents,
   effects:sql.exec('SELECT op_id FROM f123_business_effects WHERE license=?',license).toArray().length
  }}
 };
}
function orphan(s,id='synthetic-c76-orphan-00001',targetLicense=license){
 const op=sale(id);
 op.license=targetLicense;
 s.sql.exec('INSERT INTO typed_commercial_payloads (license,op_id,payload_json) VALUES (?,?,?)',
   targetLicense,id,JSON.stringify(op));
}
const expense=(id='synthetic-c78-expense-001',amountCents=1250)=>({
 license,opId:id,kind:'expense.record',categoryId:'expense_cat_1',amountCents
});
const customerPayment=(id='customer-payment:synthetic-c78-001',amountCents=900)=>({
 license,opId:id,kind:'credit.customer.payment.record',clienteId:'cliente_1',amountCents
});
async function queue(s,command){
 const r=await s.queued.submit({ticket:'synthetic-owner-ticket',command});
 assert.equal(r.ok,true,JSON.stringify(r));
 assert.equal(r.receipt.stage,'stored-for-application');
 return r;
}
function mutatePayload(s,opId,mutate){
 const prior=s.sql.exec('SELECT payload_json FROM typed_commercial_payloads WHERE license=? AND op_id=?',license,opId).one().payload_json;
 const updated=JSON.parse(prior);mutate(updated);
 const changed=JSON.stringify(updated);
 s.sql.exec('UPDATE typed_commercial_payloads SET payload_json=? WHERE license=? AND op_id=?',
  changed,license,opId);
 return {prior,changed};
}
test('C78 control: queued expense + customer payment preserve genuine 202 SHA, no money/effects',async()=>{
 const s=await make();
 try{
  const expenseReceipt=await queue(s,expense());
  const customerReceipt=await queue(s,customerPayment());
  assert.equal(s.retry().already,true);
  assert.deepEqual(s.totals(),{cash:500,stock:10,debt:3000,effects:0});
  assert.equal(s.row(expense().opId).receipt_json.includes('stored-for-application'),true);
  assert.equal(s.row(customerPayment().opId).receipt_json.includes('stored-for-application'),true);
  assert.notEqual(expenseReceipt.receipt.receiptId,customerReceipt.receipt.receiptId);
  assert.equal(s.retry().already,true);
 }finally{s.db.close();}
});
test('C78 control: queued sale 202 and committed sale + fiado remain correct',async()=>{
 const s=await make();
 try{
  await queue(s,sale('synthetic-c78-sale-queued'));
  const saleReceipt=await s.submit(sale('synthetic-c78-sale-applied'));
  const payReceipt=await s.submit(pay('synthetic-c78-fiado-001'));
  assert.equal(saleReceipt.receipt.stage,'business-committed');
  assert.equal(payReceipt.receipt.stage,'business-committed');
  assert.deepEqual(s.totals(),{cash:5498,stock:8,debt:2000,effects:2});
  assert.equal(s.retry().already,true);
 }finally{s.db.close();}
});
test('C78 RED P0: changing queued expense amount without original SHA must fail frozen reopen',async()=>{
 const s=await make();
 try{
  await queue(s,expense());
  const oldHash=s.row(expense().opId).payload_hash;
  const {prior,changed}=mutatePayload(s,expense().opId,r=>{r.amountCents=9999;});
  assert.notEqual(prior,changed);
  assert.equal(s.row(expense().opId).payload_hash,oldHash);
  assert.throws(()=>s.retry(),/business baseline reconciliation|receipt|sha|integrity/i);
  assert.deepEqual(s.totals(),{cash:500,stock:10,debt:3000,effects:0});
  assert.equal(s.sql.exec('SELECT payload_json FROM typed_commercial_payloads WHERE license=? AND op_id=?',
   license,expense().opId).one().payload_json,changed);
 }finally{s.db.close();}
});
test('C78 RED P0: changing queued customer payment clienteId without SHA must fail frozen reopen',async()=>{
 const s=await make();
 try{
  await queue(s,customerPayment());
  const oldHash=s.row(customerPayment().opId).payload_hash;
  const {changed}=mutatePayload(s,customerPayment().opId,r=>{r.clienteId='other_cliente';});
  assert.equal(s.row(customerPayment().opId).payload_hash,oldHash);
  assert.throws(()=>s.retry(),/business baseline reconciliation|receipt|sha|integrity/i);
  assert.deepEqual(s.totals(),{cash:500,stock:10,debt:3000,effects:0});
  assert.equal(s.sql.exec('SELECT payload_json FROM typed_commercial_payloads WHERE license=? AND op_id=?',
    license,customerPayment().opId).one().payload_json,changed);
 }finally{s.db.close();}
});
test('C78 RED P0: unknown 202 kind with self-consistent SHA cannot masquerade as typed command',async()=>{
 const s=await make();
 try{
  await queue(s,expense('synthetic-c78-unknown-001'));
  const id='synthetic-c78-unknown-001';
  const {changed}=mutatePayload(s,id,r=>{r.kind='invented.untrusted.record';});
  const hash=createHash('sha256').update(changed).digest('hex');
  const receipt=JSON.parse(s.row(id).receipt_json);
  receipt.kind='invented.untrusted.record';
  receipt.receiptId=hash.slice(0,24);
  s.sql.exec('UPDATE typed_commercial_ops SET payload_hash=?,receipt_json=? WHERE license=? AND op_id=?',
   hash,JSON.stringify(receipt),license,id);
  assert.throws(()=>s.retry(),/business baseline reconciliation|receipt|kind|unsupported/i);
  assert.deepEqual(s.totals(),{cash:500,stock:10,debt:3000,effects:0});
 }finally{s.db.close();}
});
test('C78 control: unrelated license and a genuine expense 202 cannot block own economic readback',async()=>{
 const s=await make();
 try{
  await queue(s,expense());
  const other=customerPayment('customer-payment:synthetic-c78-other');
  other.license='F123-OTHERROOMZZ';
  s.sql.exec('INSERT INTO typed_commercial_payloads (license,op_id,payload_json) VALUES (?,?,?)',
   other.license,other.opId,JSON.stringify(other));
  assert.equal(s.retry().already,true);
  assert.deepEqual(s.totals(),{cash:500,stock:10,debt:3000,effects:0});
 }finally{s.db.close();}
});
