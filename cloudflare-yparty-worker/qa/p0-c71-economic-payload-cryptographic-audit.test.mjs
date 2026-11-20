// C71 RED-FIRST · REAL authoritative-business-sql.mjs + typed-commercial-ledger.mjs +
// native SQLite SHA-256 cryptographic cross-check of every economic effect against its
// immutable typed_commercial_ops receipt + typed_commercial_payloads canonical command.
// All data synthetic; USD 0.00 Cloudflare/R2.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {
 prepareBusinessBaseline,installBusinessBaseline,createBusinessSqlExecutor
} from '../src/authoritative-business-sql.mjs';
import {createTypedCommercialLedger} from '../src/typed-commercial-ledger.mjs';

const license='F123-SYNT-BUSINESS',productId='sku_1',receivableId='fiado_1';
const state={
 license,frozenHead:'c71-independent-firebase-head-001',
 products:[{productId,quantity:10,unitPriceCents:1999}],
 openingCashCents:500,
 receivables:[{receivableId,balanceCents:3000}]
};
const sha=value=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');

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

async function makeLedgerHarness(){
 const db=new DatabaseSync(':memory:'),{sql,storage}=wrap(db);
 const proof=await prepareBusinessBaseline({...state,sourceFrozenVerified:true,expectedSha256:sha(state)});
 assert.equal(installBusinessBaseline({storage,proof}).already,false);
 const applyBusiness=createBusinessSqlExecutor({sql});
 const principal={license,role:'dueno',subject:'owner-account',
  scopes:['ops:sale','ops:adjust','ops:payment']};
 const authorize=async({scope})=>({ok:true,principal:{...principal,scopes:[scope]}});
 const authorizeReceivable=async()=>true;
 const committedLedger=createTypedCommercialLedger({
  sql,transactionSync:storage.transactionSync.bind(storage),
  authorize,authorizeReceivable,applyBusiness,clock:()=>1730000000000
 });
 const queuedLedger=createTypedCommercialLedger({
  sql,transactionSync:storage.transactionSync.bind(storage),
  authorize,authorizeReceivable,applyBusiness:null,clock:()=>1730000000001
 });
 return {
  db,sql,storage,proof,
  retry:()=>installBusinessBaseline({storage,proof}),
  commit:command=>committedLedger.submit({ticket:'synthetic-c71-ticket',command}),
  queueOnly:command=>queuedLedger.submit({ticket:'synthetic-c71-ticket',command})
 };
}

test('C71 control: full cryptographic sale+payment+adjust+202-queued ledger passes reopen readback',async()=>{
 const h=await makeLedgerHarness();
 try{
  const s=await h.commit({license,opId:'c71-sale-001',kind:'sale.record',productId,quantity:2,amountCents:3998});
  const p=await h.commit({license,opId:'c71-pay-001',kind:'credit.payment.record',receivableId,amountCents:1000});
  const a=await h.commit({license,opId:'c71-adj-001',kind:'stock.adjust',productId,quantity:5,amountCents:0});
  const q=await h.queueOnly({license,opId:'c71-queued-001',kind:'sale.record',productId,quantity:1,amountCents:1999});
  assert.equal(s.receipt.stage,'business-committed');
  assert.equal(p.receipt.stage,'business-committed');
  assert.equal(a.receipt.stage,'business-committed');
  assert.equal(q.receipt.stage,'stored-for-application');
  assert.equal(h.retry().already,true,'committed effects + pending 202 inbox must certify cleanly');
 }finally{h.db.close();}
});

test('C71 RED P0: fabricated sale effect with wrong unit price (q=-2, c=1) + matching cash must fail closed',async()=>{
 const h=await makeLedgerHarness();
 try{
  const s=await h.commit({license,opId:'c71-sale-ok-01',kind:'sale.record',productId,quantity:2,amountCents:3998});
  assert.equal(s.receipt.stage,'business-committed');
  // Tamper effect to underprice $0.01 + adjust cash_cents to match arithmetic sum.
  h.sql.exec('INSERT INTO f123_business_effects (license,op_id,product_id,quantity_delta,cash_delta_cents) VALUES (?,?,?,?,?)',
   license,'c71-forged-cheap',productId,-1,1);
  h.sql.exec('UPDATE f123_business_stock SET quantity = quantity - 1 WHERE license = ? AND product_id = ?',license,productId);
  h.sql.exec('UPDATE f123_business_baseline SET cash_cents = cash_cents + 1 WHERE license = ?',license);
  assert.throws(()=>h.retry(),/reconcil|integrity|price/i);
 }finally{h.db.close();}
});

test('C71 RED P0: effect row lacking corresponding business-committed receipt in typed_commercial_ops must fail closed',async()=>{
 const h=await makeLedgerHarness();
 try{
  await h.commit({license,opId:'c71-sale-002',kind:'sale.record',productId,quantity:2,amountCents:3998});
  h.sql.exec('DELETE FROM typed_commercial_ops WHERE license = ? AND op_id = ?',license,'c71-sale-002');
  assert.throws(()=>h.retry(),/reconcil|integrity|receipt|ops/i);
 }finally{h.db.close();}
});

test('C71 RED P0: missing or tampered typed_commercial_payloads (SHA mismatch) for a committed effect must fail closed',async()=>{
 const h=await makeLedgerHarness();
 try{
  await h.commit({license,opId:'c71-pay-002',kind:'credit.payment.record',receivableId,amountCents:1000});
  h.sql.exec('UPDATE typed_commercial_payloads SET payload_json = ? WHERE license = ? AND op_id = ?',
   JSON.stringify({license,opId:'c71-pay-002',kind:'credit.payment.record',receivableId,amountCents:999}),
   license,'c71-pay-002');
  assert.throws(()=>h.retry(),/reconcil|integrity|hash|payload/i);
 }finally{h.db.close();}
});

test('C71 RED P0: tampered receipt_json (receiptId/stage mismatch with payload SHA) must fail closed',async()=>{
 const h=await makeLedgerHarness();
 try{
  const res=await h.commit({license,opId:'c71-sale-003',kind:'sale.record',productId,quantity:1,amountCents:1999});
  const forgedReceipt=JSON.stringify({...res.receipt,receiptId:'f'.repeat(24)});
  h.sql.exec('UPDATE typed_commercial_ops SET receipt_json = ? WHERE license = ? AND op_id = ?',
   forgedReceipt,license,'c71-sale-003');
  assert.throws(()=>h.retry(),/reconcil|integrity|receipt/i);
 }finally{h.db.close();}
});

test('C71 RED P0: orphaned business-committed receipt whose effect was deleted and cash masked via stock adjust must fail closed',async()=>{
 const h=await makeLedgerHarness();
 try{
  await h.commit({license,opId:'c71-pay-003',kind:'credit.payment.record',receivableId,amountCents:1000});
  h.sql.exec('DELETE FROM f123_business_effects WHERE license = ? AND op_id = ?',license,'c71-pay-003');
  h.sql.exec('UPDATE f123_business_receivables SET balance_cents = 3000 WHERE license = ?',license);
  h.sql.exec('UPDATE f123_business_baseline SET cash_cents = 500 WHERE license = ?',license);
  assert.throws(()=>h.retry(),/reconcil|integrity|effect/i);
 }finally{h.db.close();}
});

test('C71 RED P0: dropping typed_commercial_payloads while typed_commercial_ops exists must fail closed',async()=>{
 const h=await makeLedgerHarness();
 try{
  await h.commit({license,opId:'c71-sale-004',kind:'sale.record',productId,quantity:1,amountCents:1999});
  h.sql.exec('DROP TABLE typed_commercial_payloads');
  assert.throws(()=>h.retry(),/reconcil|integrity|payload/i);
 }finally{h.db.close();}
});
