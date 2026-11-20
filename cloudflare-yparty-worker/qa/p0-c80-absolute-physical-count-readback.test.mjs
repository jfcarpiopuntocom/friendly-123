// C80 RED FIRST: physical count is an ABSOLUTE number, not an
// arbitrary zero-money delta. Real native SQLite ledger + product source.
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
function effect(s,opId){
 return s.sql.exec('SELECT rowid AS seq,quantity_delta,cash_delta_cents FROM f123_business_effects WHERE license=? AND op_id=?',
 license,opId).one();
}
function alterDeltaAndFinalStock(s,opId,newDelta,newFinal){
 s.sql.exec('UPDATE f123_business_effects SET quantity_delta=? WHERE license=? AND op_id=?',
  newDelta,license,opId);
 s.sql.exec('UPDATE f123_business_stock SET quantity=? WHERE license=? AND product_id=?',
  newFinal,license,sku);
}
test('C80 control: physical count5 from baseline10, duplicate count opId no double effect',async()=>{
 const s=await make();
 try{
  const c=count('synthetic-c80-count-001',5);
  const receipt=await s.submit(c);
  assert.equal(effect(s,c.opId).quantity_delta,-5);
  assert.deepEqual(s.totals(),{cash:500,stock:5,debt:3000,effects:1});
  assert.equal(s.retry().already,true);
  const dup=await s.submit(c);
  assert.equal(dup.duplicate,true);
  assert.deepEqual(dup.receipt,receipt.receipt);
  assert.deepEqual(s.totals(),{cash:500,stock:5,debt:3000,effects:1});
 }finally{s.db.close();}
});
test('C80 control: sale then count then sale, partial fiado and valid queued202 all survive causal reopen',async()=>{
 const s=await make();
 try{
  await s.submit(sale('synthetic-c80-zsale-before',2,3998)); // 10 -> 8
  await s.submit(count('synthetic-c80-acount-after',5)); // 8 -> 5
  await s.submit(sale('synthetic-c80-msale-after',1,1999)); // 5 -> 4
  await s.submit(pay('synthetic-c80-pay-fiado',1000));
  const q=await s.queued.submit({ticket:'synthetic-owner-ticket',
   command:sale('synthetic-c80-pending-202',1,1999)});
  assert.equal(q.receipt.stage,'stored-for-application');
  assert.deepEqual(s.totals(),{cash:7497,stock:4,debt:2000,effects:4});
  assert.equal(s.retry().already,true);
  assert.deepEqual(s.totals(),{cash:7497,stock:4,debt:2000,effects:4});
 }finally{s.db.close();}
});
test('C80 RED P0: altered physical count delta and matching stock must not certify count5 as count6',async()=>{
 const s=await make();
 try{
  const c=count('synthetic-c80-tamper-single',5);
  await s.submit(c);
  const before=s.row(c.opId);
  alterDeltaAndFinalStock(s,c.opId,-4,6);
  assert.equal(effect(s,c.opId).quantity_delta,-4);
  assert.deepEqual(s.totals(),{cash:500,stock:6,debt:3000,effects:1});
  assert.throws(()=>s.retry(),/business baseline reconcil|integrity|physical|count/i);
  assert.deepEqual(s.row(c.opId),before,'original canonical payload+receipt must stay intact');
  assert.deepEqual(s.totals(),{cash:500,stock:6,debt:3000,effects:1},
   'failed readback must never synthesize compensation or overwrite evidence');
 }finally{s.db.close();}
});
test('C80 RED P0: after sale and before new sale, tampered physical count delta cannot be hidden in final stock',async()=>{
 const s=await make();
 try{
  await s.submit(sale('synthetic-c80-sale-before',2,3998)); // 10 ->8
  const c=count('synthetic-c80-count-between',5);
  await s.submit(c); //8->5 delta-3
  await s.submit(sale('synthetic-c80-sale-after',1,1999)); //5->4
  assert.equal(effect(s,c.opId).quantity_delta,-3);
  alterDeltaAndFinalStock(s,c.opId,-2,5); // 10-2-2-1=5, false but sums agree
  assert.deepEqual(s.totals(),{cash:6497,stock:5,debt:3000,effects:3});
  assert.throws(()=>s.retry(),/business baseline reconcil|integrity|physical|count/i);
  assert.deepEqual(s.totals(),{cash:6497,stock:5,debt:3000,effects:3});
 }finally{s.db.close();}
});
test('C80 RED P0: zero-stock count may not silently become count1 with matching delta and final stock',async()=>{
 const s=await make();
 try{
  const c=count('synthetic-c80-zero-count',0);
  await s.submit(c); // 10 -> 0, delta -10
  assert.equal(effect(s,c.opId).quantity_delta,-10);
  alterDeltaAndFinalStock(s,c.opId,-9,1); // false count1
  assert.deepEqual(s.totals(),{cash:500,stock:1,debt:3000,effects:1});
  assert.throws(()=>s.retry(),/business baseline reconcil|integrity|physical|count/i);
  assert.deepEqual(s.totals(),{cash:500,stock:1,debt:3000,effects:1});
 }finally{s.db.close();}
});
test('C80 control: two authentic counts in reverse lexical opId order MUST use SQLite rowid insertion chronology',async()=>{
 const s=await make();
 try{
  const early=count('synthetic-c80-z-earlier-count',3);
  const late=count('synthetic-c80-a-later-count',7);
  await s.submit(early); // 10 -> 3 (delta -7)
  await s.submit(late); // 3 -> 7 (delta +4)
  assert.equal(effect(s,early.opId).quantity_delta,-7);
  assert.equal(effect(s,late.opId).quantity_delta,4);
  assert(effect(s,early.opId).seq<effect(s,late.opId).seq);
  assert.deepEqual(s.totals(),{cash:500,stock:7,debt:3000,effects:2});
  assert.equal(s.retry().already,true,'opId lexical ordering cannot substitute SQLite insertion order');
 }finally{s.db.close();}
});
test('C80 control: physical no-op count N=stock must retain zero delta and receipt',async()=>{
 const s=await make();
 try{
  const c=count('synthetic-c80-noop-count',10);
  await s.submit(c);
  assert.equal(effect(s,c.opId).quantity_delta,0);
  assert.equal(s.retry().already,true);
  assert.deepEqual(s.totals(),{cash:500,stock:10,debt:3000,effects:1});
 }finally{s.db.close();}
});
