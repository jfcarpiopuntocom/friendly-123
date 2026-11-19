// Full Gate D6 chain: REAL R2 Workerd -> signed source -> existing reader ->
// actual Tienda.onStart -> occupied SQLite journal -> cold restart. No customer data.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Miniflare} from 'miniflare';import {build} from 'esbuild';import * as Y from 'yjs';
import {salaDeLicencia} from '../src/sala.js';

const sha=b=>createHash('sha256').update(b).digest('hex');
const key='synthetic-g6-server-only-shared-key-0001';
const head='certified-immutable-g6-head';
const license='F123-SYNTH-G6-R2';
const roomId=await salaDeLicencia(license),room=roomId+'-ops';
const storagePrefix='f123-frozen/v1/'+room+'/'+head+'/ops/';
const buildWorker=async file=>(await build({entryPoints:[path.join(import.meta.dirname,file)],
 bundle:true,format:'esm',platform:'neutral',mainFields:['module','main'],
 conditions:['workerd','worker','browser'],external:['cloudflare:*'],write:false})).outputFiles[0].text;
function history(){
 const doc=new Y.Doc();doc.clientID=202;
 const frames=[];doc.on('update',u=>frames.push(new Uint8Array(u)));
 for(let i=0;i<100;i++){
  const opId='historical-'+String(i).padStart(3,'0');
  doc.getMap('eventos').set(opId,{kind:'sale.record',opId,amountCents:i+1});
 }
 const stateSha=sha(Y.encodeStateAsUpdate(doc)),vectorSha=sha(Y.encodeStateVector(doc));doc.destroy();
 const groups=[frames.slice(0,50),frames.slice(50)];
 const pages=groups.map((g,i)=>{
  const bytes=Buffer.allocUnsafe(g.reduce((n,f)=>n+4+f.length,0));
  let off=0;for(const f of g){bytes.writeUInt32BE(f.length,off);off+=4;Buffer.from(f).copy(bytes,off);off+=f.length;}
  return {chunk:i+1,firstFrameIndex:i*50,frameCount:g.length,bytes:g.reduce((n,f)=>n+f.length,0),
   sha256:sha(bytes)};
 });
 const rootSha256=sha(new TextEncoder().encode(pages.map(p=>p.chunk+':'+p.sha256+'\n').join('')));
 const m={version:1,room,channel:'ops',frozenHead:head,completeToHead:true,
  expectedStateSha256:stateSha,expectedVectorSha256:vectorSha,expectedOpIds:100,
  totalBytes:pages.reduce((n,p)=>n+p.bytes,0),rootSha256,pages};
 const manifestText=JSON.stringify(m);
 return {pin:sha(new TextEncoder().encode(manifestText)),manifestText,
  pages:groups.map(g=>JSON.stringify({frames:g.map(f=>Buffer.from(f).toString('base64'))}))};
}
test('R2 immutable source → real Tienda nonempty 10+100 → cold reopen without R2/Firebase',{timeout:45000},async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'f123-g6-real-'));
 const frozen=history();
 const sourceScript=await buildWorker('../src/frozen-r2-source.mjs');
 const appScript=await buildWorker('fixtures/gated4-real-nonempty-worker.mjs');
 const sourceMf=new Miniflare({modules:true,script:sourceScript,
  compatibilityDate:'2026-06-01',compatibilityFlags:['nodejs_compat'],
  r2Buckets:['F123_FROZEN_R2'],
  bindings:{F123_FROZEN_ROOM:roomId,F123_FROZEN_HEAD:head,
   F123_FROZEN_OPS_MANIFEST_SHA256:frozen.pin,WS_SERVICE_KEY:key}});
 let mf,reads=0,sourceOnline=true;
 try{
  await sourceMf.ready;
  const bucket=await sourceMf.getR2Bucket('F123_FROZEN_R2');
  await bucket.put(storagePrefix+'manifest.json',frozen.manifestText);
  for(let i=0;i<frozen.pages.length;i++)
   await bucket.put(storagePrefix+'page-'+String(i+1).padStart(4,'0')+'.json',frozen.pages[i]);
  const boot=async()=>{
   mf=new Miniflare({modules:true,script:appScript,
    compatibilityDate:'2026-06-01',compatibilityFlags:['nodejs_compat'],
    durableObjects:{Tienda:{className:'Tienda',useSQLite:true}},
    durableObjectsPersist:path.join(dir,'do'),
    bindings:{SALA_PILOTO:roomId,WS_AUTHORITY_QA:'1',WS_SEPARATE_ROOMS_QA:'1',
     WS_OPEN_EXISTING_QA:'1',WS_SERVICE_KEY:key},
    serviceBindings:{WS_FROZEN_HISTORY_SOURCE:async request=>{
     reads++;
     if(!sourceOnline)return new Response('source offline',{status:503});
     return sourceMf.dispatchFetch(request.url,{
      method:request.method,headers:Object.fromEntries(request.headers),
      body:await request.text()
     });
    }}
   });
   await mf.ready;
  };
  await boot();
  const pull=async()=>{
   const res=await mf.dispatchFetch('https://port2.invalid/parties/tienda/'+room,
     {headers:{'x-f123-gated4-fixture':'1'}});
   assert.equal(res.status,200,await res.clone().text());return res.json();
  };
  const first=await pull();
  assert.equal(first.opened,true,JSON.stringify(first));
  assert.equal(first.count,110);assert.equal(first.localCount,10);assert.equal(first.historicCount,100);
  assert.equal(first.amountCents,15095);
  assert.equal(first.unionProof,true);assert.equal(first.cert,false);
  assert.equal(first.pending,false);assert.equal(reads,2,'exactly two verified R2 pages');
  await mf.dispose();
  sourceOnline=false;
  await boot();
  const cold=await pull();
  assert.equal(cold.opened,true);assert.equal(cold.already,true);
  assert.equal(cold.count,110);assert.equal(cold.amountCents,15095);
  assert.equal(cold.journal,first.journal,'no double append on restart');
  assert.equal(reads,2,'cold startup reads only local verified SQL, never re-fetches R2');
 }finally{
  try{await mf?.dispose()}catch(_){}
  await sourceMf.dispose();fs.rmSync(dir,{recursive:true,force:true});
 }
});
