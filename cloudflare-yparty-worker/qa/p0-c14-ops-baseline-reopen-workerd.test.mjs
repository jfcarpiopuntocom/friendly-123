// C14 actual Workerd+real Tienda, frozen imported -ops baseline must never rewrite past opId facts.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {createHash} from 'node:crypto';
import {Miniflare} from 'miniflare';import {build} from 'esbuild';import * as Y from 'yjs';
import {salaDeLicencia} from '../src/sala.js';
const license='F123-SYNT-C14-BASELINE',key='synthetic-c14-internal-service-key-32-bytes';
const roomBase=await salaDeLicencia(license),room=roomBase+'-ops';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const compiled=(await build({entryPoints:[path.join(import.meta.dirname,'fixtures/c14-imported-ops-baseline-worker.mjs')],
 bundle:true,format:'esm',platform:'neutral',mainFields:['module','main'],
 conditions:['workerd','worker','browser'],external:['cloudflare:*'],write:false})).outputFiles[0].text;
function source(){
 const d=new Y.Doc();d.clientID=401;
 const frames=[];d.on('update',u=>frames.push([...u]));
 for(let i=0;i<3;i++)d.getMap('eventos').set('historical-'+String(i+1).padStart(3,'0'),{
  opId:'historical-'+String(i+1).padStart(3,'0'),kind:'sale.record',amountCents:100*(i+1)
 });
 const payload={channel:'ops',frozenHead:'historical-c14-trusted-head',
  completeToHead:true,frames,expectedStateSha256:sha(Y.encodeStateAsUpdate(d)),
  expectedVectorSha256:sha(Y.encodeStateVector(d)),expectedOpIds:3};
 d.destroy();return payload;
}
async function fixture({enabled=true}={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'f123-c14-sql-'));let mf,reads=0,online=true;
 const frozen=source();
 async function boot(){
  mf=new Miniflare({modules:true,script:compiled,compatibilityDate:'2026-06-01',
   compatibilityFlags:['nodejs_compat'],durableObjects:{Tienda:{className:'Tienda',useSQLite:true}},
   durableObjectsPersist:path.join(dir,'durable'),kvNamespaces:['LICENCIAS'],
   bindings:{SALA_PILOTO:roomBase,WS_OPEN_EXISTING_QA:enabled?'1':'0',
    WS_AUTHORITY_QA:'1',WS_SEPARATE_ROOMS_QA:'1',WS_SERVICE_KEY:key},
   serviceBindings:{
    WS_AUTHORITY:async()=>new Response('not needed synthetic internal source'),
    WS_FROZEN_HISTORY_SOURCE:async req=>{
     reads++;
     if(!online)return new Response('synthetic frozen source offline',{status:503});
     if(req.method!=='POST'||req.headers.get('authorization')!=='Bearer '+key)return new Response('forbidden',{status:403});
     const b=await req.json();
     if(b.room!==room||b.channel!=='ops')return new Response('forbidden',{status:403});
     return Response.json({room,...frozen});
    }
   }});
  await mf.ready;
 }
 await boot();
 async function call(action='inspect'){
  return mf.dispatchFetch('http://localhost/parties/tienda/'+room,{headers:{
   'x-f123-c14-fixture':'synthetic-only','x-f123-c14-action':action}});
 }
 async function inspect(){const r=await call();assert.equal(r.status,200,await r.clone().text());return r.json();}
 async function act(name){const r=await call(name);assert.equal(r.status,200,await r.clone().text());}
 return {inspect,act,get reads(){return reads},async restart(){await mf.dispose();await boot();},
  offline(){online=false},async close(){try{await mf.dispose()}finally{fs.rmSync(dir,{recursive:true,force:true});}}};
}
test('C14 RED: real Tienda imported -ops baseline persists all historical opId payloads before admitting shop',{timeout:45000},async()=>{
 const f=await fixture();
 try{
  const first=await f.inspect();
  assert.equal(first.opened,true);
  assert.equal(first.cert,true);assert.equal(first.count,3);
  assert.equal(first.baseline,true,'import certificate is NOT enough: must durably pin every historical opId');
  assert.equal(first.baselineCount,3);
 }finally{await f.close();}
});
test('C14 RED: changing historical opId value at same count cannot falsely reopen certified SQL',{timeout:45000},async()=>{
 const f=await fixture();
 try{
  assert.equal((await f.inspect()).opened,true);
  await f.act('tamper');
  f.offline();await f.restart();
  const cold=await f.inspect();
  assert.equal(cold.count,3,'same number of opIds hides a changed historical economic amount');
  assert.equal(cold.opened,false,'the independent original opId/payload baseline MUST reject a corrupt past');
  assert.match(cold.failback||'',/histor|baseline|opId|frozen|mismatch|payload/i);
  assert.ok(cold.journal>0,'failed verification preserves journal and corrupt evidence');
 }finally{await f.close();}
});
test('C14 allows genuine new post-cut opIds, and after cold reopen does not re-query source',{timeout:45000},async()=>{
 const f=await fixture();
 try{
  assert.equal((await f.inspect()).opened,true);
  await f.act('append');
  f.offline();await f.restart();
  const cold=await f.inspect();
  assert.equal(cold.opened,true);assert.equal(cold.already,true);
  assert.equal(cold.count,4);assert.equal(cold.values['historical-001'].amountCents,100);
  assert.equal(cold.values['after-cut-001'].amountCents,1100);
  assert.equal(f.reads,1,'cold reopen must trust pinned verified SQL not a fresh Firebase request');
 }finally{await f.close();}
});
test('C14 deleting a historical baseline row fails shut; never recreate from live mutable history',{timeout:45000},async()=>{
 const f=await fixture();
 try{
  assert.equal((await f.inspect()).opened,true);
  await f.act('drop-baseline');f.offline();await f.restart();
  const cold=await f.inspect();
  assert.equal(cold.opened,false);
  assert.equal(cold.baselineCount,2,'failback must preserve evidence of tampered SQL');
 }finally{await f.close();}
});
test('C14 tampering baseline row fails digest validation',{timeout:45000},async()=>{
 const f=await fixture();
 try{
  assert.equal((await f.inspect()).opened,true);
  await f.act('damage-baseline');f.offline();await f.restart();
  assert.equal((await f.inspect()).opened,false);
 }finally{await f.close();}
});
test('C14 flag OFF never imports frozen histories or creates opId baselines',{timeout:45000},async()=>{
 const f=await fixture({enabled:false});
 try{
  const first=await f.inspect();
  assert.equal(first.opened,false);assert.equal(first.cert,false);
  assert.equal(first.baseline,false);assert.equal(f.reads,0);
 }finally{await f.close();}
});
