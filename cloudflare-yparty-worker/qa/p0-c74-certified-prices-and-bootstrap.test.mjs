// C74 RED-FIRST · original frozen unit price and occupied economic bootstrap.
// EXECUTES actual authoritative-business-sql + typed-commercial-ledger with
// native Node 22 SQLite; all facts synthetic, no customer Firebase or R2 writes.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {prepareBusinessBaseline,installBusinessBaseline,createBusinessSqlExecutor}
 from '../src/authoritative-business-sql.mjs';
import {createTypedCommercialLedger} from '../src/typed-commercial-ledger.mjs';

const license='F123-SYNT-BUSINESS',sku='sku_1',fiado='fiado_1';
const state={license,frozenHead:'c74-original-synthetic-firebase-head',
 products:[{productId:sku,quantity:10,unitPriceCents:1999}],
 openingCashCents:500,receivables:[{receivableId:fiado,balanceCents:3000}]};
const sha=text=>createHash('sha256').update(text).digest('hex');
function makeDB(){
 const db=new DatabaseSync(':memory:');
 const sql={exec(query,...args){
  const stmt=db.prepare(query);
  const raw=/^\s*(SELECT|PRAGMA|WITH)\b/i.test(query)?stmt.all(...args):stmt.run(...args);
  const rows=Array.isArray(raw)?raw:[];
  return {one:()=>rows[0],toArray:()=>rows,[Symbol.iterator]:function*(){yield*rows;}};
 }};
 const storage={sql,transactionSync(fn){
  db.exec('BEGIN IMMEDIATE');
  try{const value=fn();db.exec('COMMIT');return value}
  catch(e){db.exec('ROLLBACK');throw e}
 }};
 const table=name=>sql.exec("SELECT name FROM sqlite_master WHERE type='table' AND name=?",name).toArray().length>0;
 const baselines=()=>table('f123_business_baseline')?
  Number(sql.exec('SELECT COUNT(*) AS n FROM f123_business_baseline').one().n):0;
 return {db,sql,storage,baselines};
}
async function proof(){
 return prepareBusinessBaseline({...state,sourceFrozenVerified:true,
  expectedSha256:sha(JSON.stringify(state))});
}
function existingOpsTables(sql){
 sql.exec('CREATE TABLE typed_commercial_ops (license TEXT NOT NULL, op_id TEXT NOT NULL, payload_hash TEXT NOT NULL, receipt_json TEXT NOT NULL, PRIMARY KEY(license,op_id))');
 sql.exec('CREATE TABLE typed_commercial_payloads (license TEXT NOT NULL, op_id TEXT NOT NULL, payload_json TEXT NOT NULL, PRIMARY KEY(license,op_id))');
}
function existingUnion(sql){
 // Matches real merge-frozen-into-existing.mjs::createCert SQLite certificate.
 sql.exec('CREATE TABLE f123_frozen_unions (id INTEGER PRIMARY KEY CHECK(id=1), channel TEXT NOT NULL, frozen_head TEXT NOT NULL, frozen_sha256 TEXT NOT NULL, vector_sha256 TEXT NOT NULL, frozen_events INTEGER NOT NULL, union_events INTEGER NOT NULL, union_sha256 TEXT NOT NULL, events_sha256 TEXT NOT NULL, pitr_bookmark TEXT)');
}
function sale(){return {license,opId:'synthetic-c74-sale-001',kind:'sale.record',productId:sku,quantity:2,amountCents:3998};}
function pay(){return {license,opId:'synthetic-c74-pay-001',kind:'credit.payment.record',receivableId:fiado,amountCents:1000};}
function count(){return {license,opId:'synthetic-c74-count-001',kind:'stock.adjust',productId:sku,quantity:5,amountCents:0};}
function receiptLedger(store){
 const sql=store.sql;
 return createTypedCommercialLedger({
  sql,transactionSync:store.storage.transactionSync.bind(store.storage),
  authorize:async({scope})=>({ok:true,principal:{
   license,role:'dueno',subject:'owner-account',scopes:[scope]}}),
  authorizeReceivable:async()=>true,
  clock:()=>1730000000000,
  applyBusiness:createBusinessSqlExecutor({sql})
 });
}
async function apply(ledger,command){
 const result=await ledger.submit({ticket:'synthetic-owner-ticket',command});
 assert.equal(result.ok,true,JSON.stringify(result));
 assert.equal(result.receipt.stage,'business-committed');
 return result;
}
function stats(sql){return {
 cash:sql.exec('SELECT cash_cents FROM f123_business_baseline WHERE license=?',license).one()?.cash_cents,
 stock:sql.exec('SELECT quantity FROM f123_business_stock WHERE license=? AND product_id=?',license,sku).one()?.quantity,
 debt:sql.exec('SELECT balance_cents FROM f123_business_receivables WHERE license=? AND receivable_id=?',license,fiado).one()?.balance_cents,
 effects:sql.exec('SELECT COUNT(*) AS n FROM f123_business_effects WHERE license=?',license).one()?.n
};}
test('C74 control: certified price 2x1999, partial fiado, stock count and opId retries remain exact',async()=>{
 const s=makeDB();
 try{
  const cert=await proof();
  assert.equal(installBusinessBaseline({storage:s.storage,proof:cert}).already,false);
  const ledger=receiptLedger(s);
  const a=await apply(ledger,sale());
  await apply(ledger,pay());await apply(ledger,count());
  assert.deepEqual(stats(s.sql),{cash:5498,stock:5,debt:2000,effects:3});
  const again=await apply(ledger,sale());
  assert.equal(again.duplicate,true);
  assert.deepEqual(again.receipt,a.receipt);
  assert.equal(installBusinessBaseline({storage:s.storage,proof:cert}).already,true);
  assert.deepEqual(stats(s.sql),{cash:5498,stock:5,debt:2000,effects:3});
 }finally{s.db.close()}
});
test('C74 RED P0: coordinated SHA-valid sale at 4998 must not exceed certified 2x1999 price at cold reopen',async()=>{
 const s=makeDB();
 try{
  const cert=await proof();
  installBusinessBaseline({storage:s.storage,proof:cert});
  await apply(receiptLedger(s),sale());
  const old=s.sql.exec('SELECT payload_json FROM typed_commercial_payloads WHERE license=? AND op_id=?',
    license,sale().opId).one().payload_json;
  const cmd=JSON.parse(old);
  assert.equal(cmd.amountCents,3998);
  cmd.amountCents=4998;
  const payload=JSON.stringify(cmd),digest=sha(payload);
  const row=s.sql.exec('SELECT receipt_json FROM typed_commercial_ops WHERE license=? AND op_id=?',
    license,sale().opId).one();
  const receipt=JSON.parse(row.receipt_json);
  receipt.receiptId=digest.slice(0,24);
  s.sql.exec('UPDATE typed_commercial_payloads SET payload_json=? WHERE license=? AND op_id=?',payload,license,sale().opId);
  s.sql.exec('UPDATE typed_commercial_ops SET payload_hash=?,receipt_json=? WHERE license=? AND op_id=?',
    digest,JSON.stringify(receipt),license,sale().opId);
  s.sql.exec('UPDATE f123_business_effects SET cash_delta_cents=4998 WHERE license=? AND op_id=?',license,sale().opId);
  s.sql.exec('UPDATE f123_business_baseline SET cash_cents=5498 WHERE license=?',license);
  assert.deepEqual(stats(s.sql),{cash:5498,stock:8,debt:3000,effects:1});
  // C72 validates the new digest and matched SQL effect; C74 must use the
  // DIFFERENT original independently certified catalog price source.
  assert.throws(()=>installBusinessBaseline({storage:s.storage,proof:cert}),
   /business baseline reconciliation|integrity|price/i);
  assert.deepEqual(stats(s.sql),{cash:5498,stock:8,debt:3000,effects:1},
   'readback is fail closed, preserves evidence and makes no compensating writes');
 }finally{s.db.close()}
});
test('C74 RED P0: orphan durable typed payload blocks first economic baseline',async()=>{
 const s=makeDB();
 try{
  s.sql.exec('CREATE TABLE typed_commercial_payloads (license TEXT NOT NULL,op_id TEXT NOT NULL,payload_json TEXT NOT NULL,PRIMARY KEY(license,op_id))');
  s.sql.exec('INSERT INTO typed_commercial_payloads (license,op_id,payload_json) VALUES (?,?,?)',
   license,'synthetic-precut-orphan-0001',JSON.stringify(sale()));
  const cert=await proof();
  assert.throws(()=>installBusinessBaseline({storage:s.storage,proof:cert}),
   /controlled migration|history|baseline/i);
  assert.equal(s.baselines(),0,'cannot silently cut over and overwrite an unacknowledged old command');
 }finally{s.db.close()}
});
test('C74 RED P0: existing frozen union certificate blocks fresh business baseline',async()=>{
 const s=makeDB();
 try{
  existingUnion(s.sql);
  s.sql.exec('INSERT INTO f123_frozen_unions (id,channel,frozen_head,frozen_sha256,vector_sha256,frozen_events,union_events,union_sha256,events_sha256,pitr_bookmark) VALUES (1,?,?,?,?,?,?,?,?,?)',
   'catalog','precut-firebase-head','a'.repeat(64),'b'.repeat(64),1,1,'c'.repeat(64),'d'.repeat(64),null);
  const cert=await proof();
  assert.throws(()=>installBusinessBaseline({storage:s.storage,proof:cert}),
   /controlled migration|history|baseline/i);
  assert.equal(s.baselines(),0);
 }finally{s.db.close()}
});
test('C74 control: empty typed tables and empty Yjs union certificate allow certified first cut',async()=>{
 const s=makeDB();
 try{
  existingOpsTables(s.sql);existingUnion(s.sql);
  const cert=await proof();
  assert.equal(installBusinessBaseline({storage:s.storage,proof:cert}).already,false);
  assert.equal(installBusinessBaseline({storage:s.storage,proof:cert}).already,true);
  assert.deepEqual(stats(s.sql),{cash:500,stock:10,debt:3000,effects:0});
 }finally{s.db.close()}
});
