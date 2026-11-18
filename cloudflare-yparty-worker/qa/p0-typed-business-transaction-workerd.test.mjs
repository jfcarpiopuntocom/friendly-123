// P0 RED→GREEN: actual Workerd SQLite transaction, not Map mocks.
// Every identity, product and amount is synthetic; no deployed Worker is called.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {build} from 'esbuild';import {Miniflare} from 'miniflare';

const LICENSE='F123-SYNT-BUSINESS';
const persist=fs.mkdtempSync(path.join(os.tmpdir(),'f123-atomic-business-'));
const sale=(opId='synthetic-op-001',amountCents=1999)=>({
  opId,license:LICENSE,kind:'sale.record',productId:'sku-1',quantity:1,amountCents
});
let mf,base,bundle;
async function start(){
  mf=new Miniflare({modules:true,script:bundle,compatibilityDate:'2026-06-01',
    compatibilityFlags:['nodejs_compat'],durableObjects:{BUSINESS:{className:'SyntheticBusiness',useSQLite:true}},
    durableObjectsPersist:path.join(persist,'sqlite')});
  base=await mf.ready;
}
async function submit(command,ticket='synthetic-signed-ticket'){
  const response=await fetch(new URL('/submit',base),{method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({ticket,command})});
  return {status:response.status,body:await response.json()};
}
async function inspect(){
  const r=await fetch(new URL('/inspect',base));
  assert.equal(r.status,200);
  return r.json();
}
test('P0 Workerd real SQL: business-committed ACK iff money+stock+opId stored in ONE transaction, cold replay exactly-once',
  {timeout:45000},async()=>{
  const out=await build({entryPoints:[path.join(import.meta.dirname,'fixtures/typed-business-worker.mjs')],
    bundle:true,format:'esm',platform:'neutral',conditions:['workerd','worker','browser'],
    mainFields:['module','main'],external:['cloudflare:*'],write:false});
  bundle=out.outputFiles[0].text;
  try{
    await start();
    const original=await submit(sale());
    assert.equal(original.status,200);
    assert.equal(original.body.ok,true);
    assert.equal(original.body.receipt.stage,'business-committed',
      'stored-for-application is NOT a business ACK');
    assert.equal(original.body.duplicate,false);
    assert.deepEqual(await inspect(),{stock:9,cash:1999,ops:1,payloads:1});

    const duplicate=await submit(sale());
    assert.equal(duplicate.status,200);
    assert.equal(duplicate.body.duplicate,true);
    assert.deepEqual(duplicate.body.receipt,original.body.receipt);
    assert.deepEqual(await inspect(),{stock:9,cash:1999,ops:1,payloads:1},
      'retry MUST NOT reduce stock or add cash twice');
    const conflict=await submit(sale('synthetic-op-001',2999));
    assert.equal(conflict.status,409);
    assert.deepEqual(await inspect(),{stock:9,cash:1999,ops:1,payloads:1});
    assert.equal((await submit(sale('synthetic-op-002'),'revoked-invalid-ticket')).status,403);
    assert.deepEqual(await inspect(),{stock:9,cash:1999,ops:1,payloads:1});

    for(const [opId,label] of [
      ['synthetic-op-fail','SQL statement failure after stock decrement'],
      ['synthetic-op-async','async adapter may not escape transaction'],
      ['synthetic-op-refused','adapter explicit false is not a business commit']
    ]){
      const failed=await submit(sale(opId));
      assert.equal(failed.status,503,label);
      assert.equal(failed.body.ok,false,label);
      assert.deepEqual(await inspect(),{stock:9,cash:1999,ops:1,payloads:1},label);
    }

    await mf.dispose();mf=null;
    await start();
    const replay=await submit(sale());
    assert.equal(replay.status,200);
    assert.equal(replay.body.duplicate,true);
    assert.deepEqual(replay.body.receipt,original.body.receipt);
    assert.deepEqual(await inspect(),{stock:9,cash:1999,ops:1,payloads:1},
      'cold process restart cannot replay economic effects');
    const second=await submit(sale('synthetic-op-003',500));
    assert.equal(second.body.receipt.stage,'business-committed');
    assert.deepEqual(await inspect(),{stock:8,cash:2499,ops:2,payloads:2});
  } finally{
    await mf?.dispose();
    fs.rmSync(persist,{recursive:true,force:true});
  }
});

test('P0 queued opId is promoted to business-committed exactly once after attaching SQL executor, even across restart',
 {timeout:45000},async()=>{
 const storagePath=fs.mkdtempSync(path.join(os.tmpdir(),'f123-pending-promotion-'));
 const output=await build({entryPoints:[path.join(import.meta.dirname,'fixtures/typed-business-worker.mjs')],
  bundle:true,format:'esm',platform:'neutral',conditions:['workerd','worker','browser'],
  mainFields:['module','main'],external:['cloudflare:*'],write:false});
 let worker=null;
 const begin=async()=>{
  worker=new Miniflare({modules:true,script:output.outputFiles[0].text,compatibilityDate:'2026-06-01',
   compatibilityFlags:['nodejs_compat'],durableObjects:{BUSINESS:{className:'SyntheticBusiness',useSQLite:true}},
   durableObjectsPersist:path.join(storagePath,'sql')});
  return worker.ready;
 };
 let base2;
 const send=async(route,command=sale('synthetic-queued-001',788))=>{
  const response=await fetch(new URL(route,base2),{method:'POST',headers:{'content-type':'application/json'},
   body:JSON.stringify({ticket:'synthetic-signed-ticket',command})});
  return{status:response.status,body:await response.json()};
 };
 const stats=async()=>{const r=await fetch(new URL('/inspect',base2));return r.json();};
 try{
  base2=await begin();
  const stored=await send('/queue');
  assert.equal(stored.status,200);
  assert.equal(stored.body.receipt.stage,'stored-for-application');
  assert.deepEqual(await stats(),{stock:null,cash:null,ops:1,payloads:1},
    'a pending receipt cannot pretend to change money');
  await worker.dispose();worker=null;
  base2=await begin();
  const applied=await send('/submit');
  assert.equal(applied.status,200);
  assert.equal(applied.body.duplicate,true);
  assert.equal(applied.body.receipt.stage,'business-committed',
   'replayed pending op MUST actually run the SQL business effects');
  assert.equal(applied.body.receipt.receiptId,stored.body.receipt.receiptId);
  assert.equal(applied.body.receipt.acceptedAt,stored.body.receipt.acceptedAt);
  assert.deepEqual(await stats(),{stock:9,cash:788,ops:1,payloads:1});
  assert.equal((await send('/submit')).body.receipt.stage,'business-committed');
  assert.equal((await send('/queue')).body.receipt.stage,'business-committed',
   'a late old inbox must never downgrade a committed receipt');
  assert.deepEqual(await stats(),{stock:9,cash:788,ops:1,payloads:1});
  assert.equal((await send('/submit',sale('synthetic-queued-001',799))).status,409);
  await worker.dispose();worker=null;
  base2=await begin();
  assert.equal((await send('/submit')).body.receipt.stage,'business-committed');
  assert.deepEqual(await stats(),{stock:9,cash:788,ops:1,payloads:1},
   'cold replay cannot double count formerly queued opId');
  const pendingFailure=await send('/queue',sale('synthetic-op-fail',77));
  assert.equal(pendingFailure.body.receipt.stage,'stored-for-application');
  const retryFailure=await send('/submit',sale('synthetic-op-fail',77));
  assert.equal(retryFailure.status,503);
  assert.deepEqual(await stats(),{stock:9,cash:788,ops:2,payloads:2},
   'failed queued promotion must roll back stock and retain pending op');
  assert.equal((await send('/queue',sale('synthetic-op-fail',77))).body.receipt.stage,'stored-for-application');
 }finally{await worker?.dispose();fs.rmSync(storagePath,{recursive:true,force:true});}
});
