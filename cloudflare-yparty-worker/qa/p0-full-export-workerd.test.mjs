// Real local Workerd/Miniflare SQL durability QA; never touches a real Firebase/DO.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';import {Miniflare} from 'miniflare';import * as Y from 'yjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
const fixture=new URL('./fixtures/full-export-workerd.mjs',import.meta.url).pathname;
const bundled=await build({entryPoints:[fixture],bundle:true,platform:'browser',format:'esm',target:'es2022',conditions:['workerd','browser'],write:false});
const script=bundled.outputFiles[0].text;
function source(){
 const doc=new Y.Doc(),frames=[];doc.on('update',b=>frames.push(Array.from(b)));
 const op=doc.getMap('eventos');
 op.set('sale-op-1001',{amountCents:450});op.set('sale-op-1002',{amountCents:1200});op.set('sale-op-1003',{amountCents:740});
 const state=Y.encodeStateAsUpdate(doc),vector=Y.encodeStateVector(doc);
 const proof={frames,channel:'ops',frozenHead:'synthetic-head-003',completeToHead:true,
  expectedStateSha256:sha(state),expectedVectorSha256:sha(vector),expectedOpIds:3};
 doc.destroy();return {proof,state};
}
function nextUpdate(base,{large=false}={}){
 const doc=new Y.Doc();Y.applyUpdate(doc,base);
 const parts=[];doc.on('update',b=>parts.push(Array.from(b)));
 doc.getMap('eventos').set('sale-op-1004',{amountCents:2500});
 if(large)doc.getText('business-evidence').insert(0,'x'.repeat(1_220_000));
 const expected=Y.encodeStateAsUpdate(doc),vector=Y.encodeStateVector(doc);
 doc.destroy();
 return {parts,expected,expectedSha:sha(expected),expectedVectorSha:sha(vector)};
}
async function harness(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'f123-complete-export-'));let mf;
 const boot=async()=>{mf=new Miniflare({modules:true,script,compatibilityDate:'2026-06-01',compatibilityFlags:['nodejs_compat'],
   durableObjects:{FullExportRoom:{className:'FullExportRoom',useSQLite:true}},durableObjectsPersist:path.join(dir,'state')});await mf.ready;};
 await boot();
 return {async request(room,route,body){return mf.dispatchFetch('http://localhost/'+room+route,{
   method:body?'POST':'GET',headers:{'x-fixture-only':'synthetic','content-type':'application/json'},body:body?JSON.stringify(body):undefined
 });},async restart(){await mf.dispose();await boot();},async dispose(){await mf.dispose();fs.rmSync(dir,{recursive:true,force:true});}};
}
async function ok(r){const body=await r.text();assert.equal(r.status,200,body);return JSON.parse(body);}
async function exportBytes(h,room){
 const response=await h.request(room,'/export');
 assert.equal(response.status,200,'a complete SQL history must export');
 return {bytes:new Uint8Array(await response.arrayBuffer()),headers:response.headers};
}

test('full YParty reverse Yjs export includes post-snapshot sale and >512KiB SQL journal after a Workerd restart',{timeout:60000},async()=>{
 const h=await harness(),s=source();
 try{
  await ok(await h.request('room-a','/seed',s.proof));
  const d=nextUpdate(s.state,{large:true});
  assert.equal(d.parts.length,2);
  await ok(await h.request('room-a','/append',{frames:d.parts}));
  await h.restart();
  const out=await exportBytes(h,'room-a');
  assert.equal(sha(out.bytes),d.expectedSha,'recovered state must include the after-cut sale, not just frozen head');
  assert.equal(out.headers.get('x-state-sha256'),d.expectedSha);
  assert.equal(out.headers.get('x-vector-sha256'),d.expectedVectorSha);
  assert.equal(out.headers.get('x-event-count'),'4');
  assert.ok(out.bytes.length>1024*1024);
  const receiver=new Y.Doc();
  try{
   Y.applyUpdate(receiver,out.bytes);assert.equal(receiver.getMap('eventos').size,4);
   assert.equal(receiver.getMap('eventos').get('sale-op-1004').amountCents,2500);
   assert.equal(receiver.getText('business-evidence').length,1_220_000);
   assert.equal(receiver.store.pendingStructs,null);assert.equal(receiver.store.pendingDs,null);
  }finally{receiver.destroy();}
  // Export twice: no duplicate sale or SQL mutation.
  const again=await exportBytes(h,'room-a');assert.equal(sha(again.bytes),d.expectedSha);
 }finally{await h.dispose();}
});

test('missing middle journal part fails closed without silently discarding a large sale',{timeout:60000},async()=>{
 const h=await harness(),s=source();
 try{
  await ok(await h.request('room-b','/seed',s.proof));
  const d=nextUpdate(s.state,{large:true});
  await ok(await h.request('room-b','/append',{frames:d.parts}));
  const before=await ok(await h.request('room-b','/inspect'));
  assert.ok(before.journalBlocks>=3);
  await ok(await h.request('room-b','/break',{mode:'remove-middle-chunk'}));
  const error=await h.request('room-b','/export');
  assert.equal(error.status,409,await error.text());
  const after=await ok(await h.request('room-b','/inspect'));
  assert.equal(after.journalRows,before.journalRows,'fail-closed export may not clear journal');
  assert.equal(after.journalBlocks,before.journalBlocks-1);
 }finally{await h.dispose();}
});

test('orphan journal block and missing Yjs ancestor both prevent exporting any apparently complete snapshot',{timeout:60000},async()=>{
 const h=await harness(),s=source();
 try{
  await ok(await h.request('room-a','/seed',s.proof));
  await ok(await h.request('room-a','/break',{mode:'orphan-journal-block'}));
  const orphan=await h.request('room-a','/export');
  assert.equal(orphan.status,409,await orphan.text());
  // A separate store for the missing-parent case.
  await ok(await h.request('room-b','/seed',s.proof));
  const actor=new Y.Doc(),updates=[];actor.on('update',b=>updates.push(Array.from(b)));
  actor.getMap('eventos').set('lost-parent-1',{cents:1});actor.getMap('eventos').set('lost-parent-2',{cents:2});
  actor.destroy();
  await ok(await h.request('room-b','/append',{frames:updates.slice(1)}));
  const pending=await h.request('room-b','/export');
  assert.equal(pending.status,409,await pending.text());
  const inspect=await ok(await h.request('room-b','/inspect'));
  assert.equal(inspect.journalRows,1,'failed export does not delete an unresolved update');
 }finally{await h.dispose();}
});

test('legacy single-row snapshot plus journal reconstructs same Yjs facts without duplicating events',{timeout:60000},async()=>{
 const h=await harness(),s=source();try{
  await ok(await h.request('room-a','/legacy',{frame:Array.from(s.state)}));
  const d=nextUpdate(s.state);
  await ok(await h.request('room-a','/append',{frames:d.parts}));
  const out=await exportBytes(h,'room-a');
  assert.equal(sha(out.bytes),d.expectedSha);
  assert.equal(out.headers.get('x-event-count'),'4');
 }finally{await h.dispose();}
});
