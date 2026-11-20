// C76 RED FIRST: every durable typed payload needs its receipt, including
// 202 pending records with NO SQL effect. Real source / native SQLite only.
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
function orphan(s,id='synthetic-c76-orphan-00001',targetLicense=license){
 const op=sale(id);
 op.license=targetLicense;
 s.sql.exec('INSERT INTO typed_commercial_payloads (license,op_id,payload_json) VALUES (?,?,?)',
   targetLicense,id,JSON.stringify(op));
}
test('C76 control: real sale, partial fiado payment and physical count reopen with all pairs',async()=>{
 const s=await make();
 try{
  const first=await s.submit(sale());
  await s.submit(pay());await s.submit(count());
  assert.deepEqual(s.totals(),{cash:5498,stock:5,debt:2000,effects:3});
  assert.equal(s.retry().already,true);
  const again=await s.submit(sale());
  assert.equal(again.duplicate,true);
  assert.deepEqual(again.receipt,first.receipt);
  assert.deepEqual(s.totals(),{cash:5498,stock:5,debt:2000,effects:3});
 }finally{s.db.close();}
});
test('C76 control: durable 202 queued intent keeps matching payload and receipt, without business effect',async()=>{
 const s=await make();
 try{
  const r=await s.queued.submit({ticket:'synthetic-owner-ticket',
   command:sale('synthetic-c76-queued-001')});
  assert.equal(r.ok,true);
  assert.equal(r.receipt.stage,'stored-for-application');
  assert.equal(s.totals().effects,0);
  assert.equal(s.retry().already,true);
  assert.equal(s.totals().cash,500);
 }finally{s.db.close();}
});
test('C76 RED P0: orphan sale payload after valid 200 receipt may not falsely ACK reopened store',async()=>{
 const s=await make();
 try{
  await s.submit(sale());
  orphan(s);
  const before=s.totals();
  assert.throws(()=>s.retry(),/business baseline reconciliation|receipt|orphan|payload/i);
  assert.deepEqual(s.totals(),before,'failed readback must not invent or compensate money/stock');
  const row=s.sql.exec('SELECT payload_json FROM typed_commercial_payloads WHERE license=? AND op_id=?',
   license,'synthetic-c76-orphan-00001').one();
  assert(row?.payload_json,'orphan payload must be quarantinable/recoverable, never erased');
 }finally{s.db.close();}
});
test('C76 RED P0: losing just the 202 receipt may not hide an otherwise intact pending opId',async()=>{
 const s=await make();
 try{
  const id='synthetic-c76-queued-002';
  const pending=await s.queued.submit({ticket:'synthetic-owner-ticket',command:sale(id)});
  assert.equal(pending.receipt.stage,'stored-for-application');
  s.sql.exec('DELETE FROM typed_commercial_ops WHERE license=? AND op_id=?',license,id);
  assert.equal(s.totals().effects,0);
  assert.throws(()=>s.retry(),/business baseline reconciliation|receipt|orphan|payload/i);
  assert(s.sql.exec('SELECT payload_json FROM typed_commercial_payloads WHERE license=? AND op_id=?',
    license,id).one()?.payload_json);
  assert.equal(s.totals().cash,500,'queued intent is not cash');
 }finally{s.db.close();}
});
test('C76 RED P0: extra orphan among genuine 202 payloads cannot be masked by no economic effects',async()=>{
 const s=await make();
 try{
  const pending=await s.queued.submit({ticket:'synthetic-owner-ticket',
   command:sale('synthetic-c76-queued-003')});
  assert.equal(pending.receipt.stage,'stored-for-application');
  orphan(s,'synthetic-c76-orphan-00003');
  assert.equal(s.totals().effects,0);
  assert.throws(()=>s.retry(),/business baseline reconciliation|receipt|orphan|payload/i);
 }finally{s.db.close();}
});
test('C76 control: unrelated license payloads cannot block certified store reopened for correct license',async()=>{
 const s=await make();
 try{
  await s.submit(sale());
  orphan(s,'synthetic-c76-other-00001','F123-OTHERROOMZZ');
  assert.equal(s.retry().already,true);
  assert.deepEqual(s.totals(),{cash:4498,stock:8,debt:3000,effects:1});
 }finally{s.db.close();}
});
