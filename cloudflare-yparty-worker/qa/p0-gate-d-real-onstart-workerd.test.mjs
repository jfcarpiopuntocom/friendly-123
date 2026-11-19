// Gate D TDD: REAL Tienda and router from src/index.js, not the laboratory
// subclass in qa/fixtures/gate-d-open-existing-worker.mjs. Only synthetic
// pre-cut histories and independent internal-service test bindings are used.
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
const bundle=(await build({entryPoints:[path.join(import.meta.dirname,'../src/index.js')],
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
 // An operations history is a distinct, independently authored
 // Y.Doc. It can never carry products, costs, PINs or customer metadata.
 const opsDoc=new Y.Doc(),opsFrames=[];
 opsDoc.on('update',u=>opsFrames.push([...u]));
 const events=opsDoc.getMap('eventos');
 legacy.getMap('eventos').forEach((record,id)=>events.set(id,structuredClone(record)));
 const cat={channel:'cat',frozenHead:'synthetic-head-0042',completeToHead:true,
  frames:frames.map(f=>[...f]),expectedStateSha256:sha(Y.encodeStateAsUpdate(legacy)),
  expectedVectorSha256:sha(Y.encodeStateVector(legacy))};
 const ops={channel:'ops',frozenHead:'synthetic-head-0042',completeToHead:true,
  frames:opsFrames,expectedStateSha256:sha(Y.encodeStateAsUpdate(opsDoc)),
  expectedVectorSha256:sha(Y.encodeStateVector(opsDoc)),expectedOpIds:events.size};
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
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'f123-gate-d-real-')),env=await authority();let mf,url;
 let sourceCalls=0,sourceAllowed=true;
 const bindings={SALA_PILOTO:room,WS_AUTHORITY_QA:'1',WS_SEPARATE_ROOMS_QA:'1',WS_SERVICE_KEY:key,
  ...(flag?{WS_OPEN_EXISTING_QA:'1'}:{})};
 const boot=async()=>{mf=new Miniflare({modules:true,script:bundle,compatibilityDate:'2026-06-01',compatibilityFlags:['nodejs_compat'],
  durableObjects:{Tienda:{className:'Tienda',useSQLite:true}},durableObjectsPersist:path.join(dir,'do'),
  kvNamespaces:['LICENCIAS'],bindings,
  serviceBindings:{
    WS_AUTHORITY:async r=>authorityWorker.fetch(new Request(r.url,r),env),
    WS_FROZEN_HISTORY_SOURCE:async req=>{
      sourceCalls++;
      if(!sourceAllowed)return new Response('source temporarily unavailable',{status:503});
      if(req.method!=='POST'||req.headers.get('authorization')!=='Bearer '+key)
        return new Response('invalid internal service grant',{status:403});
      let params;try{params=await req.json()}catch(_){return new Response('invalid JSON',{status:400})}
      if(!['cat','ops'].includes(params.channel)||params.room!==room+'-'+params.channel)
        return new Response('invalid room',{status:403});
      const payload=source?.[params.channel];
      if(!payload)return new Response('no certified history',{status:404});
      return Response.json({room:params.room,...payload});
    }
   }});
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
  get sourceCalls(){return sourceCalls;},
  disableSource(){sourceAllowed=false;},
  async restart(){open.splice(0).forEach(f=>f());await mf.dispose();await boot();},
  async close(){open.splice(0).forEach(f=>f());await mf.dispose();fs.rmSync(dir,{recursive:true,force:true});}};
}
async function waitFor(pred,label,ms=8000){const t=Date.now();while(!pred()){if(Date.now()-t>ms)throw Error('timeout '+label);await new Promise(r=>setTimeout(r,25));}}
const pending=d=>d.store.pendingStructs||d.store.pendingDs;


test('REAL Tienda.onStart imports certified pre-cut Yjs to the live WS room before first reader',{timeout:60000},async()=>{
 const h=history(),w=await relay({flag:true,source:h.source});
 try{
  const cat=await w.connect('cat',['cat:read','cat:write']);
  assert.equal(pending(cat),null);
  assert.deepEqual(cat.getMap('products').toJSON(),h.legacy.getMap('products').toJSON(),
    'real Tienda must serve the original history, not an empty document');
  assert.equal(sha(Y.encodeStateVector(cat)),h.source.cat.expectedVectorSha256);
  assert.equal(w.sourceCalls,1,'one internal history source read for first cold boot');
  cat.getMap('products').set('sku-9',{name:'Synthetic new post-cut',priceCents:900});
  const witnessed=await w.connect('cat',['cat:read']);
  await waitFor(()=>witnessed.getMap('products').get('sku-9')?.priceCents===900,
    'server accepted and forwarded post-cut update');
  await w.restart();
  w.disableSource();
  const cold=await w.connect('cat',['cat:read']);
  assert.equal(pending(cold),null);
  assert.equal(cold.getMap('products').get('sku-9').priceCents,900);
  assert.equal(cold.getMap('products').size,8);
  assert.equal(w.sourceCalls,1,'verified frozen receipt must reopen SQL+journal without a fresh source request');
  assert.deepEqual(h.legacy.getMap('products').size,7);
 }finally{await w.close();}
});

test('REAL Tienda.onStart preserves separate -ops immutable events, not catalog cross-room leakage',{timeout:60000},async()=>{
 const h=history(),w=await relay({flag:true,source:h.source});
 try{
  const cat=await w.connect('cat',['cat:read']);
  const ops=await w.connect('ops',['ops:read']);
  assert.equal(cat.getMap('products').size,7);
  assert.deepEqual(ops.getMap('eventos').toJSON(),h.legacy.getMap('eventos').toJSON());
  assert.equal(ops.getMap('products').size,0,
    'commercial ops must never export private catalog map from the other room');
  assert.equal(w.sourceCalls,2,'each named room imports its own historical proof');
 }finally{await w.close();}
});

test('Gate D rejects private catalog Y.Doc disguised as an ops-room history',{timeout:30000},async()=>{
 const h=history();
 h.source.ops={...h.source.cat,channel:'ops',expectedOpIds:h.legacy.getMap('eventos').size};
 const w=await relay({flag:true,source:h.source});
 try{
  await assert.rejects(()=>w.connect('ops',['ops:read']),/timeout|refused|failure|closed|error/i);
  assert.equal(w.sourceCalls,1,'internal service was consulted, then rejected');
 }finally{await w.close();}
});

test('Gate D OFF: production Tienda never calls frozen source or rewrites the old room',{timeout:30000},async()=>{
 const h=history(),w=await relay({flag:false,source:h.source});
 try{
  const cat=await w.connect('cat',['cat:read']);
  assert.equal(cat.getMap('products').size,0);
  assert.equal(w.sourceCalls,0);
 }finally{await w.close();}
});

test('missing parent in imported Yjs may never be silently served as a complete historical shop',{timeout:30000},async()=>{
 const h=history({dropParent:true}),w=await relay({flag:true,source:h.source});
 try{
  // It is intentionally impossible to promise a successful synchronized
  // room with a certified missing ancestor. A bounded first connection that
  // never reaches synced is the expected safe behavior.
  await assert.rejects(()=>w.connect('cat',['cat:read']),/timeout|refused|failure|closed|error/i);
  assert.equal(w.sourceCalls,1);
 }finally{await w.close();}
});
