// P0 RED -> GREEN; actual source contract + actual Workerd SQLite commit.
// No production Worker, customer license, Firebase or network is called.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';import {Miniflare} from 'miniflare';

const workerPath=path.join(import.meta.dirname,'../src/index.js');
const fixture=path.join(import.meta.dirname,'fixtures/authoritative-sql-worker.mjs');
const license='F123-SYNT-BUSINESS';
const sale=(opId='synthetic-op-001',quantity=1,amountCents=1999,productId='sku_1')=>({
  license,opId,kind:'sale.record',productId,quantity,amountCents
});
const baseline={license,frozenHead:'firebase-head-001',products:[
  {productId:'sku_1',quantity:10,unitPriceCents:1999},
  {productId:'sku_2',quantity:0,unitPriceCents:500}
],openingCashCents:0};
const expectedSha256=createHash('sha256').update(JSON.stringify(baseline)).digest('hex');
test('P0 source: actual Tienda -ops HTTP injects server-only SQL executor ONLY with explicit QA flag',()=>{
  const source=fs.readFileSync(workerPath,'utf8');
  assert.match(source,/from ['"]\.\/authoritative-business-sql\.mjs['"]/,
    'the real Worker must import the true transaction callback');
  assert.match(source,/WS_BUSINESS_EXECUTOR_QA\s*===\s*['"]1['"]/,
    'business commit must remain disabled by default');
  assert.match(source,/applyBusiness:\s*this\.env\.WS_BUSINESS_EXECUTOR_QA/,
    'the real onRequest typed ledger must receive applyBusiness, not a fake 200');
});
test('Workerd real SQLite: certified sale ACK, stock/cash once, fail-closed, restart, staged inbox promotion',
  {timeout:45000},async()=>{
    const out=await build({entryPoints:[fixture],bundle:true,format:'esm',
      platform:'neutral',conditions:['workerd','worker','browser'],
      mainFields:['module','main'],external:['cloudflare:*'],write:false});
    const script=out.outputFiles[0].text;
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),'f123-authoritative-sql-'));
    let mf,base;
    const start=async()=>{
      mf=new Miniflare({modules:true,script,compatibilityDate:'2026-06-01',
        compatibilityFlags:['nodejs_compat'],
        durableObjects:{BUSINESS:{className:'CommercialFixture',useSQLite:true}},
        durableObjectsPersist:path.join(dir,'sqlite')});
      base=await mf.ready;
    };
    const req=async(route,body,ticket='synthetic-owner-ticket')=>{
      const r=await fetch(new URL(route,base),{method:'POST',headers:{'content-type':'application/json'},
        body:JSON.stringify(route==='/seed'?body:{ticket,command:body})});
      return {status:r.status,body:await r.json()};
    };
    const stats=async()=>{const r=await fetch(new URL('/stats',base));return r.json();};
    try{
      await start();
      let r=await req('/submit',sale());
      assert.equal(r.status,503,'without certified initial stock, no business ACK and no sale');
      assert.deepEqual((await stats()).receipts,[]);
      r=await req('/seed',{...baseline,sourceFrozenVerified:true,expectedSha256:'0'.repeat(64)});
      assert.equal(r.status,409,'wrong independently anchored SHA cannot open the ledger');
      assert.deepEqual((await stats()).stock,[]);
      const proof={...baseline,sourceFrozenVerified:true,expectedSha256};
      r=await req('/seed',proof);
      assert.equal(r.status,200,JSON.stringify(r.body));
      assert.equal(r.body.already,false);
      assert.equal((await req('/seed',proof)).body.already,true,'same frozen head/sha is idempotent');
      assert.equal((await req('/seed',{...proof,openingCashCents:123})).status,409,
        'a different snapshot cannot replace the original frozen stock');
      r=await req('/submit',sale());
      assert.equal(r.status,200,JSON.stringify(r.body));
      assert.equal(r.body.receipt.stage,'business-committed','202 inbox cannot count as economic success');
      assert.equal(r.body.duplicate,false);
      const receipt=r.body.receipt;
      let st=await stats();
      assert.equal(st.baseline[0].cash_cents,1999);
      assert.equal(st.stock[0].quantity,9);
      assert.equal(st.effects.length,1);
      assert.equal(st.receipts.length,1);
      r=await req('/submit',sale());
      assert.equal(r.status,200);
      assert.equal(r.body.duplicate,true);
      assert.deepEqual(r.body.receipt,receipt);
      st=await stats();assert.equal(st.baseline[0].cash_cents,1999);assert.equal(st.stock[0].quantity,9);
      assert.equal((await req('/submit',sale('synthetic-op-001',1,2099))).status,409,
        'same opId with changed cents must not replace original receipt');
      r=await req('/submit',sale('synthetic-team-002',2,3998),'synthetic-team-ticket');
      assert.equal(r.status,200,'centrally authenticated employee only via typed sale, no Yjs write');
      assert.equal(r.body.receipt.stage,'business-committed');
      st=await stats();assert.equal(st.stock[0].quantity,7);assert.equal(st.baseline[0].cash_cents,5997);
      assert.equal((await req('/submit',sale('synthetic-revoked-003'), 'synthetic-revoked-ticket')).status,403);
      assert.equal((await req('/submit',sale('synthetic-price-004',1,1))).status,503);
      assert.equal((await req('/submit',sale('synthetic-oversell-005',8,15992))).status,503);
      assert.equal((await req('/submit',sale('synthetic-unknown-006',1,1999,'unknown'))).status,503);
      st=await stats();assert.equal(st.effects.length,2);assert.equal(st.stock[0].quantity,7);
      r=await req('/queue',sale('synthetic-queue-007'));
      assert.equal(r.status,202);assert.equal(r.body.receipt.stage,'stored-for-application');
      assert.equal((await stats()).effects.length,2);
      const pendingReceipt=r.body.receipt;
      r=await req('/submit',sale('synthetic-queue-007'));
      assert.equal(r.status,200);assert.equal(r.body.duplicate,true);
      assert.equal(r.body.receipt.stage,'business-committed');
      assert.equal(r.body.receipt.receiptId,pendingReceipt.receiptId);
      assert.equal(r.body.receipt.acceptedAt,pendingReceipt.acceptedAt);
      assert.equal((await req('/submit',sale('synthetic-rollback-after-stock'))).status,503);
      st=await stats();assert.equal(st.stock[0].quantity,6);
      assert.equal(st.baseline[0].cash_cents,7996);
      assert.equal(st.effects.length,3,'failed SQL transaction must roll back stock, cash and opId receipt');
      await mf.dispose();mf=null;await start();
      r=await req('/submit',sale('synthetic-queue-007'));
      assert.equal(r.status,200);assert.equal(r.body.duplicate,true);
      assert.equal((await req('/queue',sale('synthetic-queue-007'))).body.receipt.stage,'business-committed');
      st=await stats();assert.equal(st.stock[0].quantity,6);assert.equal(st.baseline[0].cash_cents,7996);
      assert.equal(st.effects.length,3,'cold Workerd restart must preserve exactly-once sale effects');
      r=await req('/submit',sale('synthetic-after-restart-008'));
      assert.equal(r.status,200);
      st=await stats();assert.equal(st.stock[0].quantity,5);assert.equal(st.baseline[0].cash_cents,9995);
      assert.equal(st.effects.length,4);
    }finally{
      await mf?.dispose();
      fs.rmSync(dir,{recursive:true,force:true});
    }
  });
