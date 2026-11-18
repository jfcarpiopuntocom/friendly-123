// Workerd/SQLite (not a Map mock): prove actual durable-object persistence.
// Fixture creates synthetic authority ONLY inside this isolated QA worker.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {creditPaymentCommandFromDurableFact} from '../../src/credit-payment-command.mjs';
import {Miniflare} from 'miniflare';
const ROOT=path.dirname(fileURLToPath(import.meta.url));
const persist=fs.mkdtempSync(path.join(os.tmpdir(),'f123-typed-inbox-'));
let mf,base,bundle;
const sale=(opId='synthetic-op-001',amountCents=1999)=>({opId,kind:'sale.record',license:'F123-SYNT-LEDGER',productId:'sku-1',quantity:1,amountCents});
const send=async(command,ticket='synthetic-signed-ticket')=>{
 const response=await fetch(new URL('/submit',base),{
   method:'POST',headers:{'content-type':'application/json'},
   body:JSON.stringify({ticket,command})
 });
 const raw=await response.text();let body;try{body=JSON.parse(raw);}catch(_){throw Error('nonJSON Workerd reply HTTP '+response.status+': '+raw.slice(0,1200));}return{status:response.status,body};
};
const count=async()=>{const r=await fetch(new URL('/test-count',base));assert.equal(r.status,200);return (await r.json()).count};
const payloadReadback=async(opId)=>{const url=new URL('/test-payload',base);if(opId)url.searchParams.set('op',opId);const r=await fetch(url);assert.equal(r.status,200);return (await r.json()).payload};
async function start(){
 mf=new Miniflare({modules:true,script:bundle,compatibilityDate:'2026-06-01',
  compatibilityFlags:['nodejs_compat'],durableObjects:{COMMANDS:{className:'SyntheticCommands',useSQLite:true}},
  durableObjectsPersist:path.join(persist,'storage')});
 base=await mf.ready;
}
test('real Workerd SQLite: one durable inbox row survives reopen and conflicting retries fail closed',{timeout:45000},async()=>{
 const bundleResult=await build({
  entryPoints:[path.join(ROOT,'fixtures/typed-ledger-worker.mjs')],
  bundle:true,format:'esm',platform:'neutral',conditions:['workerd','worker','browser'],
  mainFields:['module','main'],write:false,external:['cloudflare:*']
 });
 bundle=bundleResult.outputFiles[0].text;
 try{
  await start();
  const a=await send(sale());
  assert.equal(a.status,200);assert.equal(a.body.ok,true);assert.equal(a.body.receipt.stage,'stored-for-application');
  assert.equal(a.body.duplicate,false);
  const b=await send(sale());
  assert.equal(b.status,200);assert.equal(b.body.duplicate,true);assert.deepEqual(b.body.receipt,a.body.receipt);
  assert.equal(await count(),1);
  assert.deepEqual(JSON.parse(await payloadReadback()),{
    license:'F123-SYNT-LEDGER',opId:'synthetic-op-001',kind:'sale.record',
    productId:'sku-1',quantity:1,amountCents:1999
  });
  const conflict=await send(sale('synthetic-op-001',2000));
  assert.equal(conflict.status,409);assert.equal(await count(),1);
  const denied=await send(sale('synthetic-op-002'),'synthetic-expired');
  assert.equal(denied.status,403);assert.equal(await count(),1);
  await mf.dispose();mf=null;
  await start();
  const c=await send(sale());
  assert.equal(c.status,200);assert.equal(c.body.duplicate,true);assert.deepEqual(c.body.receipt,a.body.receipt);
  assert.equal(await count(),1);
  assert.equal(JSON.parse(await payloadReadback()).amountCents,1999);
  // Browser fact projector -> real Workerd SQLite; TEST synthetic issuer only.
  const originalOpId='customer-payment:8f79b07c-3db5-478f-ab69-59b0e483912b';
  const storedFact={tipo:'cartera_abono',datos:{
    opId:originalOpId,clienteId:'client_1',monto:1.01,
    moneyEngine:'dinero-2.0.2-half-up',montoSolicitado:1.005
  }};
  const customer=await creditPaymentCommandFromDurableFact({
    license:'F123-SYNT-LEDGER',opId:originalOpId,
    readPersistedFacts:async()=>[storedFact]
  });
  assert.equal(customer.kind,'credit.customer.payment.record');
  const first=await send(customer);
  assert.equal(first.status,200);assert.equal(first.body.receipt.stage,'stored-for-application');
  assert.equal(first.body.receipt.opId,originalOpId);
  assert.equal((await send(customer)).body.duplicate,true);
  assert.equal((await send({...customer,amountCents:100})).status,409);
  assert.equal(await count(),2);
  assert.deepEqual(JSON.parse(await payloadReadback(originalOpId)),{
    license:'F123-SYNT-LEDGER',opId:originalOpId,
    kind:'credit.customer.payment.record',clienteId:'client_1',amountCents:101
  });
  await mf.dispose();mf=null;await start();
  const again=await send(customer);
  assert.equal(again.status,200);assert.equal(again.body.duplicate,true);
  assert.deepEqual(again.body.receipt,first.body.receipt);
  assert.equal(await count(),2);
  assert.equal(JSON.parse(await payloadReadback(originalOpId)).amountCents,101);
  const legacy={license:'F123-SYNT-LEDGER',opId:'legacy-payment-0001',
    kind:'credit.payment.record',receivableId:'debt_1',amountCents:505};
  const legacyFirst=await send(legacy);
  assert.equal(legacyFirst.status,200);
  assert.equal(legacyFirst.body.receipt.stage,'stored-for-application');
  assert.equal((await send({...legacy,receivableId:'debt_2'})).status,403);
  assert.equal((await send({...legacy,amountCents:506})).status,409);
  assert.equal(await count(),3);
  await mf.dispose();mf=null;await start();
  const legacyReplay=await send(legacy);
  assert.equal(legacyReplay.status,200);assert.equal(legacyReplay.body.duplicate,true);
  assert.deepEqual(legacyReplay.body.receipt,legacyFirst.body.receipt);
  const wrongCustomer=await send({...customer,opId:'customer-payment:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',clienteId:'client_2'});
  assert.equal(wrongCustomer.status,403,'same license must not imply arbitrary customer membership');
  assert.equal(wrongCustomer.body.reason,'customer-not-authorized');
  assert.equal(await count(),3);
  const deniedCustomer=await send({...customer,opId:'customer-payment:99999999-9999-4999-8999-999999999999'},'synthetic-expired');
  assert.equal(deniedCustomer.status,403);assert.equal(await count(),3);
 }finally{
   await mf?.dispose();
   fs.rmSync(persist,{recursive:true,force:true});
 }
});
