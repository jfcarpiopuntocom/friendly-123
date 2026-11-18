// Gate A · REAL Tienda -ops router (src/index.js) on Workerd SQLite: typed sale,
// stock adjust and cobro (credit.payment.record) apply with a business receipt.
// Synthetic license and fake Service Binding grants; no issuer, Firebase or deploy.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {build} from 'esbuild';import {Miniflare} from 'miniflare';
const ROOM='c'.repeat(32),LICENSE='F123-SYNT-BUSINESS',INSTANCE='synthetic-device-123';
const pay=(opId='synthetic-pay-op-001',amountCents=1000,receivableId='fiado_1')=>({
  license:LICENSE,opId,kind:'credit.payment.record',receivableId,amountCents});
const adjust=(opId='synthetic-adjust-op-001',quantity=9)=>({
  license:LICENSE,opId,kind:'stock.adjust',productId:'sku_1',quantity,amountCents:0});
const sale=(opId='synthetic-sale-op-001')=>({
  license:LICENSE,opId,kind:'sale.record',productId:'sku_1',quantity:1,amountCents:1500});
async function router(executor){
  const built=await build({entryPoints:[path.join(import.meta.dirname,'fixtures/seeded-real-yparty-business-worker.mjs')],
    bundle:true,format:'esm',platform:'neutral',conditions:['workerd','worker','browser'],
    mainFields:['module','main'],external:['cloudflare:*'],write:false});
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'f123-router-payment-'));
  const seen=new Set();let n=0;
  const r={mf:null,base:null,dir};
  r.start=async()=>{
    r.mf=new Miniflare({modules:true,script:built.outputFiles[0].text,
      compatibilityDate:'2026-06-01',compatibilityFlags:['nodejs_compat'],
      durableObjects:{Tienda:{className:'Tienda',useSQLite:true}},
      durableObjectsPersist:path.join(dir,'sqlite'),
      bindings:{SALA_PILOTO:ROOM,WS_AUTHORITY_QA:'1',WS_SEPARATE_ROOMS_QA:'1',
        WS_TYPED_COMMANDS_QA:'1',WS_TYPED_ORIGIN_QA:'https://synthetic-shop.test',
        ...(executor?{WS_BUSINESS_EXECUTOR_QA:'1'}:{}),WS_TEST_ONLY_INTERNAL_SEED:'1',
        WS_SERVICE_KEY:'synthetic-authority-service-key-32-bytes'},
      serviceBindings:{WS_AUTHORITY:async request=>{
        const ask=await request.json(),token=ask.token;
        const valid=new URL(request.url).pathname==='/ws/consume'&&
          typeof token==='string'&&token.startsWith('fixture-')&&!seen.has(token)&&
          ask.licenseCode===LICENSE&&ask.instanceId===INSTANCE&&ask.room===ROOM+'-ops';
        if(!valid)return Response.json({ok:false},{status:403});
        seen.add(token);
        const role=token.startsWith('fixture-team')?'empleado':token.startsWith('fixture-admin')?'admin':'dueno';
        const now=Date.now();
        return Response.json({ok:true,principal:{
          license:LICENSE,instance:INSTANCE,room:ROOM+'-ops',
          subject:role==='dueno'?'owner-account':role==='admin'?'admin_12345':'team_12345',role,
          scopes:[ask.requiredScope],iat:now-1000,exp:now+60000}});
      }}});
    r.base=await r.mf.ready;
  };
  const url=()=>new URL('/parties/tienda/'+ROOM+'-ops',r.base);
  r.submit=async(command,who='owner')=>{
    const resp=await fetch(url(),{method:'POST',headers:{
      'content-type':'application/json','authorization':'Bearer fixture-'+who+'-'+(++n),
      'x-f123-license':LICENSE,'x-f123-instance':INSTANCE,'origin':'https://synthetic-shop.test'
    },body:JSON.stringify(command)});
    return {status:resp.status,body:await resp.json().catch(()=>null)};
  };
  r.stats=async()=>{
    const s=await fetch(url(),{method:'POST',headers:{
      'origin':'https://synthetic-shop.test','x-f123-synthetic-inspect':'2'}});
    assert.equal(s.status,200);
    return s.json();
  };
  r.close=async()=>{await r.mf?.dispose();r.mf=null;};
  await r.start();
  return r;
}
test('real router, executor ON: sale, adjust and cobro apply once with receipt; employee cobra but cannot adjust; overpay rolls back',
  {timeout:60000},async()=>{
  const r=await router(true);
  try{
    // Sale applies on the real router.
    let x=await r.submit(sale());
    assert.equal(x.status,200,JSON.stringify(x.body));
    assert.equal(x.body.receipt.stage,'business-committed');
    assert.deepEqual(await r.stats(),{stock:4,cash:2000,effects:1,receipts:1,debt:3000});
    // Employee registers a cobro: debt down, cash up, business ACK.
    x=await r.submit(pay(),'team');
    assert.equal(x.status,200,JSON.stringify(x.body));
    assert.equal(x.body.receipt.stage,'business-committed');
    assert.equal(x.body.receipt.kind,'credit.payment.record');
    assert.equal(x.body.duplicate,false);
    const receipt=x.body.receipt;
    assert.deepEqual(await r.stats(),{stock:4,cash:3000,effects:2,receipts:2,debt:2000});
    // Identical replay returns the same receipt and applies nothing.
    x=await r.submit(pay(),'owner');
    assert.equal(x.status,200);assert.equal(x.body.duplicate,true);
    assert.deepEqual(x.body.receipt,receipt);
    assert.deepEqual(await r.stats(),{stock:4,cash:3000,effects:2,receipts:2,debt:2000});
    // Employee cannot adjust stock: denied at admission, no receipt.
    x=await r.submit(adjust(),'team');
    assert.equal(x.status,403,JSON.stringify(x.body));
    assert.deepEqual(await r.stats(),{stock:4,cash:3000,effects:2,receipts:2,debt:2000});
    // Admin collects too.
    x=await r.submit(pay('synthetic-pay-op-002',500),'admin');
    assert.equal(x.status,200,JSON.stringify(x.body));
    assert.deepEqual(await r.stats(),{stock:4,cash:3500,effects:3,receipts:3,debt:1500});
    // Cobro over the balance is rolled back: no receipt, no cash, no debt change.
    x=await r.submit(pay('synthetic-pay-op-003',1501));
    assert.equal(x.status,503,JSON.stringify(x.body));
    assert.deepEqual(await r.stats(),{stock:4,cash:3500,effects:3,receipts:3,debt:1500});
    // Unknown receivable is denied by the trusted resource check.
    x=await r.submit(pay('synthetic-pay-op-404',100,'fiado_missing'));
    assert.equal(x.status,403,JSON.stringify(x.body));
    // Owner adjust applies.
    x=await r.submit(adjust());
    assert.equal(x.status,200,JSON.stringify(x.body));
    assert.equal(x.body.receipt.stage,'business-committed');
    assert.deepEqual(await r.stats(),{stock:9,cash:3500,effects:4,receipts:4,debt:1500});
    // Durable across a Workerd restart: the cobro replay keeps its receipt.
    await r.close();await r.start();
    x=await r.submit(pay(),'team');
    assert.equal(x.status,200);assert.equal(x.body.duplicate,true);
    assert.deepEqual(x.body.receipt,receipt);
    assert.deepEqual(await r.stats(),{stock:9,cash:3500,effects:4,receipts:4,debt:1500});
  }finally{await r.close();fs.rmSync(r.dir,{recursive:true,force:true});}
});
test('real router, executor flag OFF: previous behaviour (sale queued 202, cobro 503, no effects)',
  {timeout:40000},async()=>{
  const r=await router(false);
  try{
    let x=await r.submit(sale());
    assert.equal(x.status,202,JSON.stringify(x.body));
    assert.equal(x.body.receipt.stage,'stored-for-application');
    x=await r.submit(pay());
    assert.equal(x.status,503,JSON.stringify(x.body));
    assert.equal(x.body.reason,'receivable-authority-unavailable');
    assert.deepEqual(await r.stats(),{stock:5,cash:500,effects:0,receipts:1,debt:3000});
  }finally{await r.close();fs.rmSync(r.dir,{recursive:true,force:true});}
});
