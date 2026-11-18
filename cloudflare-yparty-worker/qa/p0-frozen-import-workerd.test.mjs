// Synthetic-only local Workerd regression for the dormant frozen-import adapter.
// This file and its companion fixture never run in production or touch Firebase.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';
import * as Y from 'yjs';

const SHA=bytes=>createHash('sha256').update(bytes).digest('hex');
const fixture=new URL('./fixtures/frozen-import-workerd.mjs',import.meta.url).pathname;
const bundle=await build({entryPoints:[fixture],bundle:true,platform:'browser',format:'esm',target:'es2022',conditions:['workerd','browser'],write:false});
const script=bundle.outputFiles[0].text;

function history(){
 const doc=new Y.Doc(),frames=[];
 doc.on('update',u=>frames.push([...u]));
 doc.getMap('eventos').set('synthetic-sale-1',{cents:1234});
 doc.getMap('eventos').set('synthetic-sale-2',{cents:5678});
 doc.getMap('eventos').set('synthetic-sale-3',{cents:9000});
 const receipt={channel:'ops',frozenHead:'synthetic-003',completeToHead:true,
   frames,expectedStateSha256:SHA(Y.encodeStateAsUpdate(doc)),
   expectedVectorSha256:SHA(Y.encodeStateVector(doc)),expectedOpIds:3};
 doc.destroy();return receipt;
}
async function workspace(){
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'f123-import-workerd-'));
 let mf;
 async function boot(){
  mf=new Miniflare({modules:true,script,
   compatibilityDate:'2026-06-01',compatibilityFlags:['nodejs_compat'],
   durableObjects:{FrozenRoom:{className:'FrozenRoom',useSQLite:true}},
   durableObjectsPersist:path.join(tmp,'db')});
  await mf.ready;
 }
 await boot();
 return {get mf(){return mf;},async restart(){await mf.dispose();await boot();},
  async fetch(room,pathname,body){
   return mf.dispatchFetch('http://localhost/'+room+pathname,{method:body?'POST':'GET',
     headers:{'x-fixture-only':'synthetic','content-type':'application/json'},body:body?JSON.stringify(body):undefined});
  },
  async close(){await mf.dispose();fs.rmSync(tmp,{recursive:true,force:true});}};
}

test('real Workerd SQL Durable Object imports a frozen Yjs ops state and survives full process restart',{timeout:60000},async()=>{
 const w=await workspace(),h=history();
 try{
  const first=await w.fetch('room-a','/seed',h);
  const firstBody=await first.text();
  assert.equal(first.status,200,firstBody);
  const acknowledgment=JSON.parse(firstBody);
  assert.equal(acknowledgment.already,false);
  assert.equal(acknowledgment.receipt.sha256,h.expectedStateSha256);
  const warm=await w.fetch('room-a','/read');
  assert.equal(warm.status,200,'warm Workerd readback must be successful');
  assert.equal(SHA(new Uint8Array(await warm.arrayBuffer())),h.expectedStateSha256);
  await w.restart();
  const cold=await w.fetch('room-a','/read');
  assert.equal(cold.status,200,'cold Workerd readback must be successful');
  const bytes=new Uint8Array(await cold.arrayBuffer());
  assert.equal(SHA(bytes),h.expectedStateSha256);
  const doc=new Y.Doc();try{Y.applyUpdate(doc,bytes);assert.equal(doc.getMap('eventos').size,3);
   assert.equal(doc.store.pendingStructs,null);assert.equal(doc.store.pendingDs,null);}finally{doc.destroy();}
  const duplicate=await w.fetch('room-a','/seed',h);
  const duplicateBody=await duplicate.text();
  assert.equal(duplicate.status,200,duplicateBody);
  assert.equal(JSON.parse(duplicateBody).already,true);
 }finally{await w.close();}
});

test('Workerd rejects incomplete Yjs ancestors and conflicting source without losing original snapshot',{timeout:60000},async()=>{
 const w=await workspace(),h=history();
 try{
  const rejected=await w.fetch('room-b','/seed',{...h,frames:h.frames.slice(1)});
  assert.equal(rejected.status,409,'child-only import must fail before writing SQL');
  const absent=await w.fetch('room-b','/read');
  assert.equal(absent.status,409);
  const full=await w.fetch('room-b','/seed',h);
  assert.equal(full.status,200,await full.text());
  const other={...h,expectedOpIds:2};
  const conflict=await w.fetch('room-b','/seed',other);
  assert.equal(conflict.status,409);
  const still=await w.fetch('room-b','/read');
  assert.equal(still.status,200);
  assert.equal(SHA(new Uint8Array(await still.arrayBuffer())),h.expectedStateSha256);
 }finally{await w.close();}
});
