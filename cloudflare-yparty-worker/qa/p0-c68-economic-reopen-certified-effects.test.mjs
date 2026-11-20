// C68 RED FIRST · REAL authoritative-business-sql.mjs + native SQLite + Yjs-independent
// economic effect readback. All values synthetic; zero cloud/customer writes.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {
 prepareBusinessBaseline,installBusinessBaseline,createBusinessSqlExecutor
} from '../src/authoritative-business-sql.mjs';

const license='F123-SYNT-BUSINESS',productId='sku_1',receivableId='fiado_1';
const state={
 license,frozenHead:'c68-independent-firebase-head-001',
 products:[{productId,quantity:10,unitPriceCents:1999}],
 openingCashCents:500,
 receivables:[{receivableId,balanceCents:3000}]
};
const sha=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
function wrap(db){
 const sql={exec(query,...args){
  const stmt=db.prepare(query),values=args.map(v=>v instanceof Uint8Array?Buffer.from(v):v);
  const raw=/^\s*(SELECT|PRAGMA|WITH)\b/i.test(query)?stmt.all(...values):stmt.run(...values);
  const rs=Array.isArray(raw)?raw:[];
  return {one:()=>rs[0],toArray:()=>rs,[Symbol.iterator]:function*(){yield*rs;}};
 }};
 const storage={sql,transactionSync(fn){
  db.exec('BEGIN IMMEDIATE');
  try{const result=fn();db.exec('COMMIT');return result;}
  catch(e){db.exec('ROLLBACK');throw e;}
 }};
 return {storage,sql};
}
async function make(){
 const db=new DatabaseSync(':memory:'),{sql,storage}=wrap(db);
 const proof=await prepareBusinessBaseline({...state,
  sourceFrozenVerified:true,expectedSha256:sha(state)});
 const first=installBusinessBaseline({storage,proof});
 assert.equal(first.already,false);
 const executor=createBusinessSqlExecutor({sql});
 const principal={license,role:'dueno',subject:'owner-account',
  scopes:['ops:sale','ops:adjust','ops:payment']};
 const apply=command=>storage.transactionSync(()=>executor({sql,command,principal}));
 return {db,sql,storage,proof,apply,
  retry:()=>installBusinessBaseline({storage,proof}),
  read:()=>({
   cash:sql.exec('SELECT cash_cents FROM f123_business_baseline WHERE license=?',license).one()?.cash_cents,
   quantity:sql.exec('SELECT quantity FROM f123_business_stock WHERE license=? AND product_id=?',license,productId).one()?.quantity,
   debt:sql.exec('SELECT balance_cents FROM f123_business_receivables WHERE license=? AND receivable_id=?',license,receivableId).one()?.balance_cents,
   effects:sql.exec('SELECT op_id FROM f123_business_effects WHERE license=?',license).toArray().length
  })
 };
}
test('C68 control: empty effects, then valid sale+payment+count keep certified cash, stock, fiado and duplicate ACK',async()=>{
 const s=await make();
 try{
  assert.equal(s.retry().already,true);
  s.apply({license,opId:'synthetic-c68-sale-001',kind:'sale.record',productId,quantity:2,amountCents:3998});
  s.apply({license,opId:'synthetic-c68-payment-001',kind:'credit.payment.record',receivableId,amountCents:1000});
  s.apply({license,opId:'synthetic-c68-count-001',kind:'stock.adjust',productId,quantity:5,amountCents:0});
  assert.deepEqual(s.read(),{cash:5498,quantity:5,debt:2000,effects:3});
  assert.equal(s.retry().already,true,'effects from legitimate sales/payments/physical count preserve certified baseline');
  assert.deepEqual(s.read(),{cash:5498,quantity:5,debt:2000,effects:3});
 }finally{s.db.close();}
});
test('C68 RED P0: deleted original fiado row must never get already:true',async()=>{
 const s=await make();
 try{
  s.sql.exec('DELETE FROM f123_business_receivables WHERE license=? AND receivable_id=?',license,receivableId);
  assert.throws(()=>s.retry(),/reconcil|integrity|fiado|receivable/i);
  assert.equal(s.read().debt,undefined,'refusal is read-only, never recreates fictitious fiado');
 }finally{s.db.close();}
});
test('C68 RED P0: reduced fiado without a payment opId must never get already:true',async()=>{
 const s=await make();
 try{
  s.sql.exec('UPDATE f123_business_receivables SET balance_cents=1234 WHERE license=?',license);
  assert.throws(()=>s.retry(),/reconcil|integrity|fiado|receivable/i);
  assert.equal(s.read().debt,1234);
 }finally{s.db.close();}
});
test('C68 RED P0: inflated cash without sale/payment effect must never get already:true',async()=>{
 const s=await make();
 try{
  s.sql.exec('UPDATE f123_business_baseline SET cash_cents=9000 WHERE license=?',license);
  assert.throws(()=>s.retry(),/reconcil|integrity|cash/i);
  assert.equal(s.read().cash,9000);
 }finally{s.db.close();}
});
test('C68 RED P0: phantom stock loss without sale/count opId must never get already:true',async()=>{
 const s=await make();
 try{
  s.sql.exec('UPDATE f123_business_stock SET quantity=2 WHERE license=?',license);
  assert.throws(()=>s.retry(),/reconcil|integrity|stock/i);
  assert.equal(s.read().quantity,2);
 }finally{s.db.close();}
});
test('C68 RED P0: losing a paid fiado effect must not certify original cash and debt',async()=>{
 const s=await make();
 try{
  s.apply({license,opId:'synthetic-c68-payment-002',kind:'credit.payment.record',receivableId,amountCents:1000});
  s.sql.exec('DELETE FROM f123_business_effects WHERE op_id=?','synthetic-c68-payment-002');
  assert.throws(()=>s.retry(),/reconcil|integrity|cash|fiado/i);
  assert.deepEqual(s.read(),{cash:1500,quantity:10,debt:2000,effects:0});
 }finally{s.db.close();}
});
test('C68 RED P0: unrecognized economic effect SKU cannot invent stock or already ACK',async()=>{
 const s=await make();
 try{
  s.sql.exec('INSERT INTO f123_business_effects (license,op_id,product_id,quantity_delta,cash_delta_cents) VALUES (?,?,?,?,?)',
   license,'synthetic-c68-orphan','unknown_sku',1,0);
  assert.throws(()=>s.retry(),/reconcil|integrity|unknown|stock/i);
  assert.equal(s.read().effects,1);
 }finally{s.db.close();}
});
test('C68 RED P0: phantom receivable outside frozen head may not pass idempotent import',async()=>{
 const s=await make();
 try{
  s.sql.exec('INSERT INTO f123_business_receivables (license,receivable_id,balance_cents) VALUES (?,?,?)',
    license,'unknown_fiado',900);
  assert.throws(()=>s.retry(),/reconcil|integrity|fiado|receivable/i);
 }finally{s.db.close();}
});
