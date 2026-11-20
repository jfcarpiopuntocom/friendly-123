// C72 RED-FIRST: certified economic readback must prove effect <-> typed
// business-committed receipt & canonical payload in the SAME native SQLite DB.
// Real production modules; synthetic data only. No Firebase, R2 or customer I/O.
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
test('C72 positive: sale, partial fiado payment, count, retry opId and frozen reopen remain exact',async()=>{
 const s=await make();
 try{
  const a=await s.submit(sale()),b=await s.submit(pay()),c=await s.submit(count());
  assert.deepEqual(s.totals(),{cash:5498,stock:5,debt:2000,effects:3});
  assert.equal(s.retry().already,true);
  const again=await s.submit(sale());
  assert.equal(again.duplicate,true);
  assert.deepEqual(again.receipt,a.receipt);
  assert.deepEqual(s.totals(),{cash:5498,stock:5,debt:2000,effects:3});
  assert.equal(s.retry().already,true);
  assert.equal(b.receipt.kind,'credit.payment.record');
  assert.equal(c.receipt.kind,'stock.adjust');
 }finally{s.db.close();}
});
test('C72 positive: genuine 202 stored-for-application has NO SQL effect and is not business ACK',async()=>{
 const s=await make();
 try{
  const pending=await s.queued.submit({ticket:'synthetic-owner-ticket',
   command:sale('synthetic-c72-queued-001')});
  assert.equal(pending.receipt.stage,'stored-for-application');
  assert.equal(s.totals().effects,0);
  assert.equal(s.retry().already,true);
  const promoted=await s.submit(sale('synthetic-c72-queued-001'));
  assert.equal(promoted.duplicate,true);
  assert.equal(s.totals().effects,1);
  assert.equal(s.retry().already,true);
 }finally{s.db.close();}
});
test('C72 RED: balanced effect + cash/stock WITHOUT any 200 typed receipt must refuse frozen reopen',async()=>{
 const s=await make();
 try{
  s.sql.exec('INSERT INTO f123_business_effects (license,op_id,product_id,quantity_delta,cash_delta_cents) VALUES (?,?,?,?,?)',
   license,'synthetic-c72-orphan-001',sku,-2,3998);
  s.sql.exec('UPDATE f123_business_stock SET quantity=8 WHERE license=?',license);
  s.sql.exec('UPDATE f123_business_baseline SET cash_cents=4498 WHERE license=?',license);
  assert.deepEqual(s.totals(),{cash:4498,stock:8,debt:3000,effects:1});
  assert.throws(()=>s.retry(),/business baseline reconciliation|receipt|effect/i);
 }finally{s.db.close();}
});
test('C72 RED: genuine effect with its business-committed receipt row missing must refuse',async()=>{
 const s=await make();
 try{
  await s.submit(sale());
  s.sql.exec('DELETE FROM typed_commercial_ops WHERE license=? AND op_id=?',license,sale().opId);
  assert.throws(()=>s.retry(),/business baseline reconciliation|receipt|effect/i);
 }finally{s.db.close();}
});
test('C72 RED: genuine 200 receipt with companion canonical payload missing must refuse',async()=>{
 const s=await make();
 try{
  await s.submit(pay());
  s.sql.exec('DELETE FROM typed_commercial_payloads WHERE license=? AND op_id=?',license,pay().opId);
  assert.throws(()=>s.retry(),/business baseline reconciliation|receipt|effect/i);
 }finally{s.db.close();}
});
test('C72 RED: demoting a 200 receipt to stored-for-application while retaining payment effect must refuse',async()=>{
 const s=await make();
 try{
  await s.submit(pay());
  const r=JSON.parse(s.row(pay().opId).receipt_json);r.stage='stored-for-application';
  s.sql.exec('UPDATE typed_commercial_ops SET receipt_json=? WHERE license=? AND op_id=?',
   JSON.stringify(r),license,pay().opId);
  assert.throws(()=>s.retry(),/business baseline reconciliation|receipt|effect/i);
 }finally{s.db.close();}
});
test('C72 RED: business-committed sale receipt with deleted effect AND reverted cash/stock must refuse',async()=>{
 const s=await make();
 try{
  await s.submit(sale());
  s.sql.exec('DELETE FROM f123_business_effects WHERE license=? AND op_id=?',license,sale().opId);
  s.sql.exec('UPDATE f123_business_stock SET quantity=10 WHERE license=?',license);
  s.sql.exec('UPDATE f123_business_baseline SET cash_cents=500 WHERE license=?',license);
  assert.deepEqual(s.totals(),{cash:500,stock:10,debt:3000,effects:0});
  assert.throws(()=>s.retry(),/business baseline reconciliation|receipt|effect/i);
 }finally{s.db.close();}
});
test('C72 RED: altered sale effect + matching cash can balance but contradict original typed amount',async()=>{
 const s=await make();
 try{
  await s.submit(sale());
  s.sql.exec('UPDATE f123_business_effects SET cash_delta_cents=1999 WHERE license=? AND op_id=?',
   license,sale().opId);
  s.sql.exec('UPDATE f123_business_baseline SET cash_cents=2499 WHERE license=?',license);
  assert.deepEqual(s.totals(),{cash:2499,stock:8,debt:3000,effects:1});
  assert.throws(()=>s.retry(),/business baseline reconciliation|receipt|effect/i);
 }finally{s.db.close();}
});
test('C72 RED: receipt kind mutated independently of authentic canonical payload must refuse',async()=>{
 const s=await make();
 try{
  await s.submit(sale());
  const r=JSON.parse(s.row(sale().opId).receipt_json);r.kind='credit.payment.record';
  s.sql.exec('UPDATE typed_commercial_ops SET receipt_json=? WHERE license=? AND op_id=?',
   JSON.stringify(r),license,sale().opId);
  assert.throws(()=>s.retry(),/business baseline reconciliation|receipt|effect/i);
 }finally{s.db.close();}
});
test('C72 RED: receiptId changed despite original payload_hash and effect must refuse',async()=>{
 const s=await make();
 try{
  await s.submit(pay());
  const r=JSON.parse(s.row(pay().opId).receipt_json);r.receiptId='000000000000000000000000';
  s.sql.exec('UPDATE typed_commercial_ops SET receipt_json=? WHERE license=? AND op_id=?',
   JSON.stringify(r),license,pay().opId);
  assert.throws(()=>s.retry(),/business baseline reconciliation|receipt|effect/i);
 }finally{s.db.close();}
});
