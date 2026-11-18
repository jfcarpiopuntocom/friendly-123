// Actual Tienda.onRequest and default HTTP router, with test-only seeded subclass.
// Uses Miniflare Workerd SQLite and fake Service Binding grants; no real issuer,
// customer license, Firebase, browser app, or production endpoint is involved.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {build} from 'esbuild';import {Miniflare} from 'miniflare';
const ROOM='a'.repeat(32),LICENSE='F123-SYNT-BUSINESS',INSTANCE='synthetic-device-123';
const sale=(opId='synthetic-router-op-001',qty=1,cents=1500)=>({
  license:LICENSE,opId,kind:'sale.record',productId:'sku_1',quantity:qty,amountCents:cents
});
test('real Tienda -ops HTTP route: 202 with flag OFF; signed scoped 200 after QA-certified baseline, idempotent Workerd restart',
  {timeout:50000},async()=>{
  const entry=path.join(import.meta.dirname,'fixtures/seeded-real-yparty-business-worker.mjs');
  const built=await build({entryPoints:[entry],bundle:true,format:'esm',platform:'neutral',
    conditions:['workerd','worker','browser'],mainFields:['module','main'],
    external:['cloudflare:*'],write:false});
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'f123-real-router-business-'));
  const seen=new Set();let mf=null,base,enabled=false;
  const start=async()=>{
    mf=new Miniflare({modules:true,script:built.outputFiles[0].text,
      compatibilityDate:'2026-06-01',compatibilityFlags:['nodejs_compat'],
      durableObjects:{Tienda:{className:'Tienda',useSQLite:true}},
      durableObjectsPersist:path.join(dir,'sqlite'),
      bindings:{SALA_PILOTO:ROOM,WS_AUTHORITY_QA:'1',WS_SEPARATE_ROOMS_QA:'1',
        WS_TYPED_COMMANDS_QA:'1',WS_TYPED_ORIGIN_QA:'https://synthetic-shop.test',
        WS_BUSINESS_EXECUTOR_QA:enabled?'1':'0',WS_TEST_ONLY_INTERNAL_SEED:'1',
        WS_SERVICE_KEY:'synthetic-authority-service-key-32-bytes'},
      serviceBindings:{WS_AUTHORITY:async request=>{
        const action=new URL(request.url).pathname;
        const ask=await request.json();
        const token=ask.token;
        const valid=action==='/ws/consume'&&
          typeof token==='string'&&token.startsWith('fixture-')&&!seen.has(token)&&
          ask.licenseCode===LICENSE&&ask.instanceId===INSTANCE&&
          ask.room===ROOM+'-ops'&&ask.requiredScope==='ops:sale';
        if(!valid)return Response.json({ok:false},{status:403});
        seen.add(token);
        const team=token.includes('team');
        const now=Date.now();
        return Response.json({ok:true,principal:{
          license:LICENSE,instance:INSTANCE,room:ROOM+'-ops',
          subject:team?'team_12345':'owner-account',role:team?'empleado':'dueno',
          scopes:['ops:sale'],iat:now-1000,exp:now+60000
        }});
      }}});
    base=await mf.ready;
  };
  const route=()=>new URL('/parties/tienda/'+ROOM+'-ops',base);
  const submit=async(command,token,origin='https://synthetic-shop.test')=>{
    const resp=await fetch(route(),{method:'POST',headers:{
      'content-type':'application/json','authorization':'Bearer '+token,
      'x-f123-license':LICENSE,'x-f123-instance':INSTANCE,'origin':origin
    },body:JSON.stringify(command)});
    const data=await resp.json().catch(()=>null);
    return {status:resp.status,body:data,headers:resp.headers};
  };
  const stats=async()=>{
    const response=await fetch(route(),{method:'POST',headers:{
      'origin':'https://synthetic-shop.test','x-f123-synthetic-inspect':'1'
    }});
    assert.equal(response.status,200);
    return response.json();
  };
  try{
    await start();
    let r=await fetch(route(),{method:'OPTIONS',headers:{
      'origin':'https://synthetic-shop.test',
      'access-control-request-method':'POST',
      'access-control-request-headers':'Authorization, Content-Type, X-F123-License, X-F123-Instance'
    }});
    assert.equal(r.status,204);
    assert.equal(r.headers.get('access-control-allow-origin'),'https://synthetic-shop.test');
    // Flag OFF: actual signed HTTP route only persists inbox, NEVER business ACK.
    r=await submit(sale(),'fixture-owner-001');
    assert.equal(r.status,202,JSON.stringify(r.body));
    assert.equal(r.body.receipt.stage,'stored-for-application');
    assert.deepEqual(await stats(),{stock:5,cash:500,effects:0,receipts:1});
    await mf.dispose();mf=null;enabled=true;await start();
    // The same durable opId is promoted to a true business ACK in SQL.
    r=await submit(sale(),'fixture-owner-002');
    assert.equal(r.status,200,JSON.stringify(r.body));
    assert.equal(r.body.receipt.stage,'business-committed');
    assert.equal(r.body.duplicate,true,'pending operation is upgraded, not duplicated');
    assert.deepEqual(await stats(),{stock:4,cash:2000,effects:1,receipts:1});
    const receipt=r.body.receipt;
    r=await submit(sale(),'fixture-owner-003');
    assert.equal(r.status,200);assert.equal(r.body.duplicate,true);
    assert.deepEqual(r.body.receipt,receipt);
    assert.deepEqual(await stats(),{stock:4,cash:2000,effects:1,receipts:1});
    // CORS rejection happens before consuming the one-time ticket.
    r=await submit(sale('synthetic-router-wrong-origin',1,1500),
      'fixture-owner-origin','https://attacker.invalid');
    assert.equal(r.status,403);
    r=await submit(sale('synthetic-router-wrong-origin',1,1500),'fixture-owner-origin');
    assert.equal(r.status,200,'invalid origin must not burn a genuine capability');
    assert.deepEqual(await stats(),{stock:3,cash:3500,effects:2,receipts:2});
    r=await submit(sale('synthetic-router-team-002',1,1500),'fixture-team-001');
    assert.equal(r.status,200);assert.equal(r.body.receipt.stage,'business-committed');
    assert.deepEqual(await stats(),{stock:2,cash:5000,effects:3,receipts:3});
    assert.equal((await submit(sale('synthetic-router-price-003',1,100),'fixture-owner-004')).status,503,
      'worker rejects client-asserted discount not in certified catalog');
    assert.equal((await submit(sale('synthetic-router-oversell-004',3,4500),'fixture-owner-005')).status,503);
    assert.equal((await submit(sale('synthetic-router-team-002',1,1700),'fixture-team-006')).status,409);
    assert.equal((await submit(sale('synthetic-router-op-001'),'fixture-owner-002')).status,403,
      'one-use capability cannot replay even an old receipt');
    assert.deepEqual(await stats(),{stock:2,cash:5000,effects:3,receipts:3});
    await mf.dispose();mf=null;await start();
    r=await submit(sale('synthetic-router-op-001'),'fixture-owner-007');
    assert.equal(r.status,200);assert.equal(r.body.duplicate,true);
    assert.deepEqual(await stats(),{stock:2,cash:5000,effects:3,receipts:3});
  }finally{
    await mf?.dispose();fs.rmSync(dir,{recursive:true,force:true});
  }
});
