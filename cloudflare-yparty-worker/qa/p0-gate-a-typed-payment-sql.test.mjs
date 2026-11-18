// Gate A · typed cobro (credit.payment.record = abono a fiado) on real Workerd SQLite
// through the production SQL executor + typed ledger. All data is synthetic.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';import {Miniflare} from 'miniflare';

const license='F123-SYNT-BUSINESS';
const pay=(opId='synthetic-pay-op-001',amountCents=1000,receivableId='fiado_1')=>({
  license,opId,kind:'credit.payment.record',receivableId,amountCents
});
const baseline={license,frozenHead:'firebase-head-pay-001',
  products:[{productId:'sku_1',quantity:10,unitPriceCents:1999}],openingCashCents:500,
  receivables:[{receivableId:'fiado_1',balanceCents:3000}]};
const expectedSha256=createHash('sha256').update(JSON.stringify(baseline)).digest('hex');

test('Workerd SQL: typed cobro reduces fiado balance and adds cash once by opId; overpay and employee fail closed',
  {timeout:45000},async()=>{
  const out=await build({entryPoints:[path.join(import.meta.dirname,'fixtures/authoritative-sql-worker.mjs')],
    bundle:true,format:'esm',platform:'neutral',conditions:['workerd','worker','browser'],
    mainFields:['module','main'],external:['cloudflare:*'],write:false});
  const script=out.outputFiles[0].text;
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'f123-typed-payment-'));
  let mf=null,base;
  const start=async()=>{
    mf=new Miniflare({modules:true,script,compatibilityDate:'2026-06-01',
      compatibilityFlags:['nodejs_compat'],
      durableObjects:{BUSINESS:{className:'CommercialFixture',useSQLite:true}},
      durableObjectsPersist:path.join(dir,'sqlite')});
    base=await mf.ready;
  };
  const post=async(route,body)=>{
    const r=await fetch(new URL(route,base),{method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify(body)});
    return {status:r.status,body:await r.json()};
  };
  const submit=(command,ticket='synthetic-owner-ticket')=>post('/submit',{ticket,command});
  const state=async()=>{
    const s=await (await fetch(new URL('/stats',base))).json();
    return {balance:s.receivables.map(r=>Number(r.balance_cents)),cash:Number(s.baseline[0]?.cash_cents),
      stock:Number(s.stock[0]?.quantity),effects:s.effects.length,receipts:s.receipts.length};
  };
  try{
    await start();
    const seeded=await post('/seed',{...baseline,sourceFrozenVerified:true,expectedSha256});
    assert.equal(seeded.status,200,JSON.stringify(seeded.body));
    assert.deepEqual(await state(),{balance:[3000],cash:500,stock:10,effects:0,receipts:0});
    // A revoked ticket cannot collect: denied with no effect (employee cobro is allowed, JFC 2026-11-18).
    let r=await submit(pay(),'synthetic-revoked-ticket');
    assert.notEqual(r.status,200,JSON.stringify(r.body));
    assert.deepEqual(await state(),{balance:[3000],cash:500,stock:10,effects:0,receipts:0});
    // Unknown receivable is denied by the trusted resource check.
    r=await submit(pay('synthetic-pay-op-404',100,'fiado_missing'));
    assert.equal(r.status,403,JSON.stringify(r.body));
    // A zero cobro is not a payment.
    r=await submit(pay('synthetic-pay-op-000',0));
    assert.equal(r.status,503,JSON.stringify(r.body));
    // Owner cobro: balance down, cash up, business ACK in the same transaction.
    r=await submit(pay());
    assert.equal(r.status,200,JSON.stringify(r.body));
    assert.equal(r.body.receipt.stage,'business-committed');
    assert.equal(r.body.receipt.kind,'credit.payment.record');
    assert.equal(r.body.duplicate,false);
    const receipt=r.body.receipt;
    assert.deepEqual(await state(),{balance:[2000],cash:1500,stock:10,effects:1,receipts:1});
    // Identical replay: same receipt, no second cobro.
    r=await submit(pay());
    assert.equal(r.status,200);assert.equal(r.body.duplicate,true);
    assert.deepEqual(r.body.receipt,receipt);
    assert.deepEqual(await state(),{balance:[2000],cash:1500,stock:10,effects:1,receipts:1});
    // Same opId, different amount: conflict, not a second effect.
    r=await submit(pay('synthetic-pay-op-001',1200));
    assert.equal(r.status,409);
    // Cannot collect more than the outstanding balance: rollback, no receipt.
    r=await submit(pay('synthetic-pay-op-002',2001));
    assert.equal(r.status,503,JSON.stringify(r.body));
    assert.deepEqual(await state(),{balance:[2000],cash:1500,stock:10,effects:1,receipts:1});
    // Exact remaining balance settles the fiado to zero.
    r=await submit(pay('synthetic-pay-op-003',2000));
    assert.equal(r.status,200,JSON.stringify(r.body));
    assert.deepEqual(await state(),{balance:[0],cash:3500,stock:10,effects:2,receipts:2});
    r=await submit(pay('synthetic-pay-op-004',1));
    assert.equal(r.status,503);
    assert.deepEqual(await state(),{balance:[0],cash:3500,stock:10,effects:2,receipts:2});
    // Durable across a Workerd restart.
    await mf.dispose();mf=null;await start();
    r=await submit(pay());
    assert.equal(r.status,200);assert.equal(r.body.duplicate,true);
    assert.deepEqual(r.body.receipt,receipt);
    assert.deepEqual(await state(),{balance:[0],cash:3500,stock:10,effects:2,receipts:2});
  }finally{
    await mf?.dispose();fs.rmSync(dir,{recursive:true,force:true});
  }
});

test('Workerd SQL: Admin may adjust stock like the Owner; employee may not',{timeout:45000},async()=>{
  const out=await build({entryPoints:[path.join(import.meta.dirname,'fixtures/authoritative-sql-worker.mjs')],
    bundle:true,format:'esm',platform:'neutral',conditions:['workerd','worker','browser'],
    mainFields:['module','main'],external:['cloudflare:*'],write:false});
  const mf=new Miniflare({modules:true,script:out.outputFiles[0].text,compatibilityDate:'2026-06-01',
    compatibilityFlags:['nodejs_compat'],
    durableObjects:{BUSINESS:{className:'CommercialFixture',useSQLite:true}}});
  try{
    const base=await mf.ready;
    const post=async(route,body)=>{
      const r=await fetch(new URL(route,base),{method:'POST',headers:{'content-type':'application/json'},
        body:JSON.stringify(body)});
      return {status:r.status,body:await r.json()};
    };
    assert.equal((await post('/seed',{...baseline,sourceFrozenVerified:true,expectedSha256})).status,200);
    const adjust=opId=>({license,opId,kind:'stock.adjust',productId:'sku_1',quantity:4,amountCents:0});
    let r=await post('/submit',{ticket:'synthetic-team-ticket',command:adjust('synthetic-adm-adj-01')});
    assert.notEqual(r.status,200);
    r=await post('/submit',{ticket:'synthetic-admin-ticket',command:adjust('synthetic-adm-adj-02')});
    assert.equal(r.status,200,JSON.stringify(r.body));
    assert.equal(r.body.receipt.stage,'business-committed');
    const s=await (await fetch(new URL('/stats',base))).json();
    assert.equal(Number(s.stock[0].quantity),4);
  }finally{await mf.dispose();}
});
