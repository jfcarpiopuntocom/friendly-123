// Gate D QA: the real YParty Tienda opens an EXISTING store history as-is and goes forward,
// with failback to the current path. Real local Workerd; SYNTHETIC history only, no Firebase.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';import {Miniflare} from 'miniflare';
import WebSocket from 'ws';import * as Y from 'yjs';import YProvider from 'y-partyserver/provider';
import authorityWorker,{RegistroLicencias} from '../../cloudflare-worker/worker.js';
import {pinAuthority} from '../../cloudflare-worker/pin-authority.mjs';
import {salaDeLicencia} from '../src/sala.js';

const sha=b=>createHash('sha256').update(b).digest('hex');
const license='F123-SYNT-GATED-OPEN',instance='synthetic-gate-d-client',key='synthetic-gate-d-service-key-32-bytes!!';
const bundle=(await build({entryPoints:[path.join(import.meta.dirname,'fixtures/gate-d-open-existing-worker.mjs')],
 bundle:true,format:'esm',platform:'neutral',mainFields:['module','main'],
 conditions:['workerd','worker','browser'],external:['cloudflare:*'],write:false})).outputFiles[0].text;
const room=await salaDeLicencia(license);

// Firebase-shaped history: two writers, pages delivered child-before-parent, one delete.
function history({dropParent=false}={}){
 const a=new Y.Doc(),b=new Y.Doc();a.clientID=101;b.clientID=202;
 const fa=[],fb=[];a.on('update',u=>fa.push(u));b.on('update',u=>fb.push(u));
 const pa=a.getMap('products'),ea=a.getMap('eventos');
 for(let i=1;i<=5;i++){pa.set('sku-'+i,{name:'Synthetic '+i,priceCents:100*i});ea.set('sale-a-'+i,{cents:100*i});}
 Y.applyUpdate(b,Y.encodeStateAsUpdate(a),'firebase');
 fb.length=0;
 const pb=b.getMap('products');
 pb.set('sku-2',{name:'Synthetic 2',priceCents:250});pb.delete('sku-3');
 for(let i=6;i<=8;i++){pb.set('sku-'+i,{name:'Synthetic '+i,priceCents:100*i});b.getMap('eventos').set('sale-b-'+i,{cents:100*i});}
 const parents=dropParent?fa.filter((_,i)=>i!==2):fa;
 const frames=[...fb,...parents]; // B's children arrive in earlier pages than A's parents
 const legacy=new Y.Doc();for(const f of frames)Y.applyUpdate(legacy,f,'firebase');
 a.destroy();b.destroy();
 // Real 2.0 -ops contains ONLY its own commercial event Y.Doc.
 // The old synthetic test erroneously reused the mixed products+sales cat Y.Doc
 // for BOTH rooms. Strict C14 correctly forbids mixed/private economic roots.
 const opsDoc=new Y.Doc(),opsFrames=[];
 opsDoc.clientID=409;
 opsDoc.on('update',bytes=>opsFrames.push([...bytes]));
 legacy.getMap('eventos').forEach((event,id)=>
  opsDoc.getMap('eventos').set(id,structuredClone(event)));
 const cat={channel:'cat',frozenHead:'synthetic-head-0042',completeToHead:true,
  frames:frames.map(f=>[...f]),expectedStateSha256:sha(Y.encodeStateAsUpdate(legacy)),
  expectedVectorSha256:sha(Y.encodeStateVector(legacy))};
 const ops={channel:'ops',frozenHead:'synthetic-head-0042',completeToHead:true,
  frames:opsFrames,expectedStateSha256:sha(Y.encodeStateAsUpdate(opsDoc)),
  expectedVectorSha256:sha(Y.encodeStateVector(opsDoc)),
  expectedOpIds:opsDoc.getMap('eventos').size};
 opsDoc.destroy();
 return {legacy,frames,source:{cat,ops}};
}
async function authority(){
 let records=new Map(),tail=Promise.resolve();
 const db={get:async k=>structuredClone(records.get(k)),
  transaction:async fn=>{let release;const prev=tail;tail=new Promise(r=>release=r);await prev;
   const snap=new Map([...records].map(([k,v])=>[k,structuredClone(v)]));
   try{const out=await fn({get:async k=>structuredClone(snap.get(k)),put:async(k,v)=>snap.set(k,structuredClone(v)),
    delete:async k=>snap.delete(k),list:async({prefix,limit})=>new Map([...snap].filter(([k])=>k.startsWith(prefix)).slice(0,limit))});
    records=snap;return out;}finally{release();}}};
 await db.transaction(tx=>tx.put('inst:'+instance,{licenseCode:license,instanceId:instance}));
 const env={PIN_PEPPER:'synthetic-owner-secret-more-than-32bytes',TEAM_PIN_PEPPER:'synthetic-team-secret-separate-32bytes',
  TEAM_AUTHORITY_QA:'1',TEAM_AUTHORITY_LICENSE:license,WS_AUTHORITY_QA:'1',
  WS_SIGNING_KEY:'synthetic-ws-signing-secret-more-than-32bytes',WS_SERVICE_KEY:key};
 const owner=pinAuthority(db,env.PIN_PEPPER);await owner.masterSet(license,'123',0,[instance]);await owner.masterActivate(license,'123',0,[instance]);
 const registry=new RegistroLicencias({storage:db},env);
 env.REGISTROS={idFromName:()=>({}),get:()=>({fetch:(i,o)=>registry.fetch(new Request(i,o))})};
 return env;
}
async function relay({flag,source}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'f123-gate-d-')),env=await authority();let mf,url;
 const bindings={SALA_PILOTO:room,WS_AUTHORITY_QA:'1',WS_SEPARATE_ROOMS_QA:'1',WS_SERVICE_KEY:key,
  ...(flag?{WS_OPEN_EXISTING_QA:'1'}:{}),GATE_D_TEST_SOURCE:JSON.stringify(source)};
 const boot=async()=>{mf=new Miniflare({modules:true,script:bundle,compatibilityDate:'2026-06-01',compatibilityFlags:['nodejs_compat'],
  durableObjects:{Tienda:{className:'Tienda',useSQLite:true}},durableObjectsPersist:path.join(dir,'do'),
  kvNamespaces:['LICENCIAS'],bindings,
  serviceBindings:{WS_AUTHORITY:async r=>authorityWorker.fetch(new Request(r.url,r),env)}});
  await(await mf.getKVNamespace('LICENCIAS')).put('inst:'+instance,JSON.stringify({licenseCode:license,instanceId:instance}));
  url=await mf.ready;};
 await boot();
 const open=[];
 return {
  async connect(ch,scopes){
   const t=await authorityWorker.fetch(new Request('https://authority.invalid/ws/ticket',{method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({credentials:{kind:'owner',licenseCode:license,instanceId:instance,pin:'123'},room:room+'-'+ch,scopes,ttlMs:30000})}),env);
   const {token}=await t.json();assert.equal(t.status,200);
   const doc=new Y.Doc(),provider=new YProvider(url.host,room+'-'+ch,doc,{party:'tienda',
    params:{licencia:license,instancia:instance,cap:token},WebSocketPolyfill:WebSocket,disableBc:true});
   open.push(()=>{provider.destroy();doc.destroy();});
   await waitFor(()=>provider.synced,ch+' sync');return doc;},
  async gate(ch,body){
   return mf.dispatchFetch('http://localhost/parties/tienda/'+room+'-'+ch,{method:body?'POST':'GET',
    headers:{'x-f123-synthetic-gate-d':'1'},body});},
  async tamperCertificate(ch){
   return mf.dispatchFetch('http://localhost/parties/tienda/'+room+'-'+ch,{
     method:'GET',headers:{'x-f123-synthetic-gate-d':'1','x-f123-synthetic-tamper-cert':'1'}});
  },
  async restart(){open.splice(0).forEach(f=>f());await mf.dispose();await boot();},
  async close(){open.splice(0).forEach(f=>f());await mf.dispose();fs.rmSync(dir,{recursive:true,force:true});}};
}
async function waitFor(pred,label,ms=8000){const t=Date.now();while(!pred()){if(Date.now()-t>ms)throw Error('timeout '+label);await new Promise(r=>setTimeout(r,25));}}
const pending=d=>d.store.pendingStructs||d.store.pendingDs;

test('fixture is Firebase-shaped: child pages before parents leave Yjs pending until the whole history is read',()=>{
 const h=history(),partial=new Y.Doc();
 for(const f of h.frames.slice(0,3))Y.applyUpdate(partial,f);
 assert.ok(pending(partial),'children first must be pending');
 assert.equal(pending(h.legacy),null);
 assert.equal(h.legacy.getMap('products').size,7);
 assert.equal(h.legacy.getMap('eventos').size,8);
 partial.destroy();
});

test('Gate D: real Tienda opens the existing history as-is, goes forward, cold-joins after restart, failback adds only the new',{timeout:60000},async()=>{
 const h=history(),w=await relay({flag:true,source:h.source});
 try{
  const writer=await w.connect('cat',['cat:read','cat:write']);
  assert.equal(pending(writer),null);
  assert.equal(sha(Y.encodeStateVector(writer)),h.source.cat.expectedVectorSha256,'served state is the existing history, unchanged');
  assert.deepEqual(writer.getMap('products').toJSON(),h.legacy.getMap('products').toJSON());
  const status=await(await w.gate('cat')).json();
  assert.equal(status.gateD.opened,true);assert.equal(status.gateD.receipt.sha256,h.source.cat.expectedStateSha256);
  const ops=await w.connect('ops',['ops:read']);
  assert.deepEqual(ops.getMap('eventos').toJSON(),h.legacy.getMap('eventos').toJSON(),'sales history served as-is');
  writer.getMap('products').set('sku-9',{name:'Synthetic 9',priceCents:900});
  writer.getMap('products').set('sku-1',{name:'Synthetic 1',priceCents:111});
  const reader=await w.connect('cat',['cat:read']);
  await waitFor(()=>reader.getMap('products').get('sku-1')?.priceCents===111&&reader.getMap('products').has('sku-9'),'forward');
  const expected=reader.getMap('products').toJSON();
  await w.restart(); // same source binding: reopening must be a no-op, never re-import or erase the journal
  const cold=await w.connect('cat',['cat:read']);
  assert.equal(pending(cold),null);
  assert.deepEqual(cold.getMap('products').toJSON(),expected,'cold join = existing history + forward');
  const again=await(await w.gate('cat')).json();
  assert.deepEqual([again.gateD.opened,again.gateD.already],[true,true]);
  // Failback: the current path receives only what it lacks; applying twice duplicates nothing.
  const r=await w.gate('cat',Y.encodeStateVector(h.legacy));
  assert.equal(r.status,200,await r.clone().text());
  const update=new Uint8Array(await r.arrayBuffer());
  assert.deepEqual([...new Set(Y.decodeUpdate(update).structs.map(s=>s.id.client))].filter(c=>c===101||c===202),[],'no history resent');
  Y.applyUpdate(h.legacy,update);
  const once=sha(Y.encodeStateAsUpdate(h.legacy));
  assert.equal(once,r.headers.get('x-state-sha256'));
  Y.applyUpdate(h.legacy,update);
  assert.equal(sha(Y.encodeStateAsUpdate(h.legacy)),once,'idempotent failback');
  assert.deepEqual(h.legacy.getMap('products').toJSON(),expected);
 }finally{await w.close();}
});

test('Gate D refuses a history with a missing parent: nothing written, shop stays on the current path intact',{timeout:40000},async()=>{
 const h=history({dropParent:true}),before=sha(Y.encodeStateAsUpdate(h.legacy)),w=await relay({flag:true,source:h.source});
 try{
  assert.ok(pending(h.legacy),'fixture really lacks a parent');
  const reader=await w.connect('cat',['cat:read']);
  assert.equal(reader.getMap('products').size,0,'no partial history served');
  const s=await(await w.gate('cat')).json();
  assert.equal(s.gateD.opened,false);assert.match(s.gateD.failback,/pending|mismatch/);assert.equal(s.blocks,0);
  assert.equal((await w.gate('cat',Y.encodeStateVector(h.legacy))).status,409);
  assert.equal(sha(Y.encodeStateAsUpdate(h.legacy)),before);
 }finally{await w.close();}
});

test('Gate D flag OFF by default: the new server opens nothing',{timeout:40000},async()=>{
 const h=history(),w=await relay({flag:false,source:h.source});
 try{
  const reader=await w.connect('cat',['cat:read']);
  assert.equal(reader.getMap('products').size,0);
  const s=await(await w.gate('cat')).json();
  assert.deepEqual([s.gateD.opened,s.gateD.failback,s.blocks],[false,'flag-off',0]);
 }finally{await w.close();}
});

test('Gate D RED: corrupted certified import receipt cannot ACK a reopened Yjs store',{timeout:50000},async()=>{
 const h=history(),w=await relay({flag:true,source:h.source});
 try{
  const writer=await w.connect('cat',['cat:read','cat:write']);
  assert.equal(writer.getMap('products').size,7);
  assert.equal((await(await w.gate('cat')).json()).gateD.opened,true);
  const corrupted=await w.tamperCertificate('cat');
  assert.equal(corrupted.status,200);
  assert.equal((await corrupted.json()).tampered,true);
  await w.restart();
  const status=await(await w.gate('cat')).json();
  assert.equal(status.gateD.opened,false,
    'a certificate is not itself proof that the existing Yjs history is still valid');
  assert.equal(status.gateD.already,undefined,'no false already-opened ACK');
  assert.match(status.gateD.failback,/certif|mismatch|proof|corrupt/i);
  assert.ok(status.blocks>0,'reject without deleting source evidence or resetting the store');
 }finally{await w.close();}
});
