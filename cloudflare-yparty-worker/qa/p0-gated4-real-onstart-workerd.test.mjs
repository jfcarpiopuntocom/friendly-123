// PORT2 Gate D4: REAL Tienda.onStart + SQLite-backed Miniflare Workerd.
// The QA subclass only seeds preexisting SQL. Production Gate D code is inherited.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {build} from 'esbuild';import {Miniflare} from 'miniflare';import * as Y from 'yjs';
import {salaDeLicencia} from '../src/sala.js';

const sha=b=>createHash('sha256').update(b).digest('hex');
const license='F123-SYNT-GATED4';
const room=await salaDeLicencia(license),serviceKey='synthetic-qa-service-key-32bytes!!';
const bundle=(await build({entryPoints:[path.join(import.meta.dirname,'fixtures/gated4-real-nonempty-worker.mjs')],
 bundle:true,format:'esm',platform:'neutral',mainFields:['module','main'],
 conditions:['workerd','worker','browser'],external:['cloudflare:*'],write:false})).outputFiles[0].text;
function frozen(){
 const doc=new Y.Doc();doc.clientID=202;
 for(let i=0;i<100;i++){
  const opid='historical-'+String(i).padStart(3,'0');
  doc.getMap('eventos').set(opid,{kind:'sale.record',opId:opid,amountCents:i+1});
 }
 const frame=Y.encodeStateAsUpdate(doc),vector=Y.encodeStateVector(doc);
 doc.destroy();
 return {channel:'ops',frozenHead:'certified-historical-head-100',
  completeToHead:true,frames:[Array.from(frame)],
  expectedStateSha256:sha(frame),expectedVectorSha256:sha(vector),expectedOpIds:100};
}
async function runtime({enabled=true}={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'f123-gated4-workerd-'));
 let mf,reads=0,available=true;const history=frozen();
 const boot=async()=>{
  mf=new Miniflare({modules:true,script:bundle,compatibilityDate:'2026-06-01',
   compatibilityFlags:['nodejs_compat'],durableObjects:{Tienda:{className:'Tienda',useSQLite:true}},
   durableObjectsPersist:path.join(dir,'do'),
   bindings:{SALA_PILOTO:room,WS_AUTHORITY_QA:'1',WS_SEPARATE_ROOMS_QA:'1',
    WS_SERVICE_KEY:serviceKey,...(enabled?{WS_OPEN_EXISTING_QA:'1'}:{})},
   serviceBindings:{WS_FROZEN_HISTORY_SOURCE:async request=>{
    reads++;
    if(!available)return new Response('unavailable',{status:503});
    if(request.headers.get('authorization')!=='Bearer '+serviceKey||request.method!=='POST')
      return new Response('unauthorized',{status:403});
    const input=await request.json();
    if(input.room!==room+'-ops'||input.channel!=='ops')return new Response('wrong room',{status:403});
    return Response.json({...history,room:input.room});
   }}
  });
  await mf.ready;
 };
 await boot();
 return {
  get reads(){return reads},
  disableSource(){available=false},
  async load(){
   const r=await mf.dispatchFetch('http://localhost/parties/tienda/'+room+'-ops',
    {headers:{'x-f123-gated4-fixture':'1'}});
   assert.equal(r.status,200,await r.clone().text());return r.json();
  },
  async restart(){await mf.dispose();await boot()},
  async close(){await mf.dispose();fs.rmSync(dir,{recursive:true,force:true})}
 };
}
test('REAL Tienda.onStart preserves nonempty journal 10 + frozen 100 and cold reopens without source',{timeout:45000},async()=>{
 const w=await runtime();
 try{
  const first=await w.load();
  assert.deepEqual([first.opened,first.count,first.localCount,first.historicCount,first.pending],
    [true,110,10,100,false]);
  assert.equal(first.amountCents,15095);
  assert.equal(first.unionProof,true);
  assert.equal(first.cert,false,'nonempty shop never fakes an empty-store certificate');
  assert.equal(w.reads,1);
  w.disableSource();await w.restart();
  const cold=await w.load();
  assert.equal(cold.opened,true);assert.equal(cold.already,true);
  assert.equal(cold.count,110);assert.equal(cold.amountCents,15095);
  assert.equal(cold.journal,first.journal,'cold reopen never repeats journal operations');
  assert.equal(w.reads,1,'receipt verifies local SQL without fetching Firebase again');
 }finally{await w.close();}
});
test('REAL Tienda flag OFF retains only its local 10 facts, no history source requests',{timeout:30000},async()=>{
 const w=await runtime({enabled:false});
 try{
  const value=await w.load();
  assert.equal(value.opened,false);
  assert.equal(value.count,10);assert.equal(value.localCount,10);
  assert.equal(value.historicCount,0);
  assert.equal(value.unionProof,false);
  assert.equal(w.reads,0);
 }finally{await w.close();}
});
