// Gate A · typed stock adjustment (physical count) through the REAL Tienda -ops
// router and Workerd SQLite. Synthetic license, fake Service Binding grants;
// no issuer, Firebase, browser app or production endpoint is involved.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {build} from 'esbuild';import {Miniflare} from 'miniflare';
const ROOM='b'.repeat(32),LICENSE='F123-SYNT-BUSINESS',INSTANCE='synthetic-device-123';
const adjust=(opId='synthetic-adjust-op-001',quantity=9,amountCents=0)=>({
  license:LICENSE,opId,kind:'stock.adjust',productId:'sku_1',quantity,amountCents
});
test('real Tienda -ops: Owner typed stock.adjust sets physical count once by opId; Team and sale-only tickets denied',
  {timeout:50000},async()=>{
  const entry=path.join(import.meta.dirname,'fixtures/seeded-real-yparty-business-worker.mjs');
  const built=await build({entryPoints:[entry],bundle:true,format:'esm',platform:'neutral',
    conditions:['workerd','worker','browser'],mainFields:['module','main'],
    external:['cloudflare:*'],write:false});
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'f123-typed-adjust-'));
  const seen=new Set();let mf=null,base;
  const start=async()=>{
    mf=new Miniflare({modules:true,script:built.outputFiles[0].text,
      compatibilityDate:'2026-06-01',compatibilityFlags:['nodejs_compat'],
      durableObjects:{Tienda:{className:'Tienda',useSQLite:true}},
      durableObjectsPersist:path.join(dir,'sqlite'),
      bindings:{SALA_PILOTO:ROOM,WS_AUTHORITY_QA:'1',WS_SEPARATE_ROOMS_QA:'1',
        WS_TYPED_COMMANDS_QA:'1',WS_TYPED_ORIGIN_QA:'https://synthetic-shop.test',
        WS_BUSINESS_EXECUTOR_QA:'1',WS_TEST_ONLY_INTERNAL_SEED:'1',
        WS_SERVICE_KEY:'synthetic-authority-service-key-32-bytes'},
      serviceBindings:{WS_AUTHORITY:async request=>{
        const ask=await request.json(),token=ask.token;
        const valid=new URL(request.url).pathname==='/ws/consume'&&
          typeof token==='string'&&token.startsWith('fixture-')&&!seen.has(token)&&
          ask.licenseCode===LICENSE&&ask.instanceId===INSTANCE&&ask.room===ROOM+'-ops';
        if(!valid)return Response.json({ok:false},{status:403});
        seen.add(token);
        const team=token.includes('team'),saleOnly=token.includes('saleonly');
        const now=Date.now();
        return Response.json({ok:true,principal:{
          license:LICENSE,instance:INSTANCE,room:ROOM+'-ops',
          subject:team?'team_12345':'owner-account',role:team?'empleado':'dueno',
          scopes:saleOnly?['ops:sale']:[ask.requiredScope],iat:now-1000,exp:now+60000
        }});
      }}});
    base=await mf.ready;
  };
  const route=()=>new URL('/parties/tienda/'+ROOM+'-ops',base);
  const submit=async(command,token)=>{
    const resp=await fetch(route(),{method:'POST',headers:{
      'content-type':'application/json','authorization':'Bearer '+token,
      'x-f123-license':LICENSE,'x-f123-instance':INSTANCE,'origin':'https://synthetic-shop.test'
    },body:JSON.stringify(command)});
    return {status:resp.status,body:await resp.json().catch(()=>null)};
  };
  const stats=async()=>{
    const r=await fetch(route(),{method:'POST',headers:{
      'origin':'https://synthetic-shop.test','x-f123-synthetic-inspect':'1'}});
    assert.equal(r.status,200);
    return r.json();
  };
  try{
    await start();
    // Inbox table does not exist yet; receipts:1 after the first success proves
    // that none of the denied requests below left a receipt or an effect.
    // Employee is denied before any SQL: no receipt, no stock change.
    let r=await submit(adjust(),'fixture-team-adj-001');
    assert.equal(r.status,403,JSON.stringify(r.body));
    // An Owner ticket scoped only for sales cannot adjust stock.
    r=await submit(adjust(),'fixture-owner-saleonly-001');
    assert.equal(r.status,403,JSON.stringify(r.body));
    // Adjustments carry no money: a nonzero amount is an invalid command.
    r=await submit(adjust('synthetic-adjust-money-01',9,100),'fixture-owner-adj-000');
    assert.equal(r.status,400,JSON.stringify(r.body));
    // Owner physical count: stock becomes exactly 9, cash untouched, business ACK.
    r=await submit(adjust(),'fixture-owner-adj-001');
    assert.equal(r.status,200,JSON.stringify(r.body));
    assert.equal(r.body.receipt.stage,'business-committed');
    assert.equal(r.body.receipt.kind,'stock.adjust');
    assert.equal(r.body.duplicate,false);
    const receipt=r.body.receipt;
    assert.deepEqual(await stats(),{stock:9,cash:500,effects:1,receipts:1});
    // A sale after the count still applies against the adjusted stock.
    r=await submit({license:LICENSE,opId:'synthetic-adjust-sale-01',kind:'sale.record',
      productId:'sku_1',quantity:2,amountCents:3000},'fixture-owner-sale-002');
    assert.equal(r.status,200,JSON.stringify(r.body));
    assert.deepEqual(await stats(),{stock:7,cash:3500,effects:2,receipts:2});
    // Identical replay: same receipt, the count is NOT re-applied over the sale.
    r=await submit(adjust(),'fixture-owner-adj-002');
    assert.equal(r.status,200);assert.equal(r.body.duplicate,true);
    assert.deepEqual(r.body.receipt,receipt);
    assert.deepEqual(await stats(),{stock:7,cash:3500,effects:2,receipts:2});
    // Same opId with different payload is a conflict, not a second effect.
    r=await submit(adjust('synthetic-adjust-op-001',3),'fixture-owner-adj-003');
    assert.equal(r.status,409);
    // Count to zero is a valid physical result.
    r=await submit(adjust('synthetic-adjust-op-002',0),'fixture-owner-adj-004');
    assert.equal(r.status,200,JSON.stringify(r.body));
    assert.deepEqual(await stats(),{stock:0,cash:3500,effects:3,receipts:3});
    // Unknown product fails closed with rollback (no receipt).
    r=await submit({...adjust('synthetic-adjust-op-003',4),productId:'sku_missing'},'fixture-owner-adj-005');
    assert.equal(r.status,503);
    assert.deepEqual(await stats(),{stock:0,cash:3500,effects:3,receipts:3});
    // Durable across a Workerd restart: replay returns the same receipt.
    await mf.dispose();mf=null;await start();
    r=await submit(adjust(),'fixture-owner-adj-006');
    assert.equal(r.status,200);assert.equal(r.body.duplicate,true);
    assert.deepEqual(r.body.receipt,receipt);
    assert.deepEqual(await stats(),{stock:0,cash:3500,effects:3,receipts:3});
  }finally{
    await mf?.dispose();fs.rmSync(dir,{recursive:true,force:true});
  }
});
