// C11 · REAL Tienda + central one-use owner ticket + SQL certified frozen public catalog.
// Synthetic-only source, no production HTTP, PIN, store, R2 or deployment mutations.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Miniflare} from 'miniflare';import {build} from 'esbuild';import * as Y from 'yjs';
import authorityWorker,{RegistroLicencias} from '../../cloudflare-worker/worker.js';
import {pinAuthority} from '../../cloudflare-worker/pin-authority.mjs';
import {salaDeLicencia} from '../src/sala.js';
const license='F123-SYNT-C11PROOF',instance='synthetic-c11-browser',key='synthetic-c11-private-service-key-32chars!';
const origin='https://synthetic-browser.example',wrongOrigin='https://wrong-browser.example';
const roomId=await salaDeLicencia(license),room=roomId+'-cat',head='certified-c11-frozen-head-20261119';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const compiled=(await build({entryPoints:[path.join(import.meta.dirname,'../src/index.js')],
 bundle:true,format:'esm',platform:'neutral',mainFields:['module','main'],
 conditions:['workerd','worker','browser'],external:['cloudflare:*'],write:false})).outputFiles[0].text;
function snapshot({privateRoot=false}={}){
 const d=new Y.Doc();d.clientID=311;const frames=[];d.on('update',u=>frames.push([...u]));
 d.getMap('productos').set('prod-1',{id:'prod-1',nombre:'Synthetic book',precio:15,stockActual:2});
 d.getMap('ubicaciones').set('shelf-1',{id:'shelf-1',nombre:'Synthetic shelf',activa:true});
 if(privateRoot)d.getMap('_meta').set('pinsRol',{owner:'PRIVATE_NEVER_EXPOSE'});
 const source={channel:'cat',frozenHead:head,completeToHead:true,frames,
  expectedStateSha256:sha(Y.encodeStateAsUpdate(d)),expectedVectorSha256:sha(Y.encodeStateVector(d))};
 d.destroy();return source;
}
function fakeDb(){
 let records=new Map(),tail=Promise.resolve();
 return {get:async k=>structuredClone(records.get(k)),transaction:async fn=>{
  let release;const previous=tail;tail=new Promise(r=>release=r);await previous;
  const txRows=new Map([...records].map(([k,v])=>[k,structuredClone(v)]));
  try{const result=await fn({get:async k=>structuredClone(txRows.get(k)),put:async(k,v)=>txRows.set(k,structuredClone(v)),
   delete:async k=>txRows.delete(k),list:async({prefix,limit})=>new Map([...txRows].filter(([k])=>k.startsWith(prefix)).slice(0,limit))});
   records=txRows;return result;}finally{release();}
 }};
}
async function fixture({enabled=true,privateRoot=false}={}){
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'f123-c11-proof-'));
 const db=fakeDb();await db.transaction(tx=>tx.put('inst:'+instance,{licenseCode:license,instanceId:instance}));
 const authEnv={PIN_PEPPER:'synthetic-c11-owner-pepper-long-key-01',TEAM_PIN_PEPPER:'synthetic-c11-team-pepper-long-key--02',
  TEAM_AUTHORITY_QA:'1',TEAM_AUTHORITY_LICENSE:license,WS_AUTHORITY_QA:'1',
  WS_SIGNING_KEY:'synthetic-c11-signing-key-long-private',WS_SERVICE_KEY:key};
 const owner=pinAuthority(db,authEnv.PIN_PEPPER);await owner.masterSet(license,'123',0,[instance]);await owner.masterActivate(license,'123',0,[instance]);
 const registry=new RegistroLicencias({storage:db},authEnv);
 authEnv.REGISTROS={idFromName:()=>({}),get:()=>({fetch:(input,init)=>registry.fetch(new Request(input,init))})};
 const source=snapshot({privateRoot});let online=true,mf,readCount=0;
 async function start(){
  mf=new Miniflare({modules:true,script:compiled,compatibilityDate:'2026-06-01',compatibilityFlags:['nodejs_compat'],
   durableObjects:{Tienda:{className:'Tienda',useSQLite:true}},durableObjectsPersist:path.join(folder,'do'),
   kvNamespaces:['LICENCIAS'],
   bindings:{SALA_PILOTO:roomId,WS_AUTHORITY_QA:'1',WS_SEPARATE_ROOMS_QA:'1',
    WS_OPEN_EXISTING_QA:enabled?'1':'0',WS_CATALOG_ORIGIN_QA:origin,WS_SERVICE_KEY:key},
   serviceBindings:{
    WS_AUTHORITY:async request=>authorityWorker.fetch(new Request(request.url,request),authEnv),
    WS_FROZEN_HISTORY_SOURCE:async request=>{
     readCount++;if(!online)return new Response('synthetic history offline',{status:503});
     const body=await request.json();
     if(request.method!=='POST'||body.room!==room||body.channel!=='cat'||request.headers.get('authorization')!=='Bearer '+key)
      return new Response('not authorized',{status:403});
     return Response.json({room,...source});
    }
   }});
  await(await mf.getKVNamespace('LICENCIAS')).put('inst:'+instance,JSON.stringify({licenseCode:license,instanceId:instance}));
  await mf.ready;
 }
 await start();
 async function ticket(){
  const response=await authorityWorker.fetch(new Request('https://authority.invalid/ws/ticket',{method:'POST',
   headers:{'content-type':'application/json'},body:JSON.stringify({
    credentials:{kind:'owner',licenseCode:license,instanceId:instance,pin:'123'},
    room,scopes:['cat:read'],ttlMs:30000
   })}),authEnv);
  const data=await response.json();assert.equal(response.status,200,JSON.stringify(data));return data.token;
 }
 const endpoint='https://synthetic-worker.example/parties/tienda/'+room+'?frozen-proof=1';
 async function get({token=null,originHeader=origin,method='GET',extraHeaders={}}={}){
  const headers={...(originHeader===null?{}:{origin:originHeader}),
   ...(token?{authorization:'Bearer '+token}:{}),
   'x-f123-license':license,'x-f123-instance':instance,...extraHeaders};
  return mf.dispatchFetch(endpoint,{method,headers});
 }
 return {source,get,ticket,get readCount(){return readCount},
  async restart(){await mf.dispose();await start();},sourceDown(){online=false},
  async close(){try{await mf.dispose()}finally{fs.rmSync(folder,{recursive:true,force:true});}}};
}
test('C11 RED: certified catalog head requires one-use signed Owner ticket and SQL readback',{timeout:30000},async()=>{
 const f=await fixture();
 try{
  const minted=await f.ticket();
  const response=await f.get({token:minted});
  assert.equal(response.status,200,'real Workerd must expose the signed read-only catalog head only after certified import');
  const result=await response.json();
  assert.deepEqual(result,{ok:true,room,channel:'cat',frozenHead:head,
   stateSha256:f.source.expectedStateSha256,vectorSha256:f.source.expectedVectorSha256});
  assert.equal(response.headers.get('cache-control'),'no-store');
  assert.equal(response.headers.get('access-control-allow-origin'),origin);
  assert.equal((await f.get({token:minted})).status,403,'one-use capability must never authorize a second read');
  assert.equal((await f.get()).status,403,'no bare license+instance admission');
  assert.equal(f.readCount,1,'certified source read once for first cold import');
 }finally{await f.close();}
});
test('C11 rejects foreign browser origin before consuming capability and handles exact preflight',{timeout:30000},async()=>{
 const f=await fixture();
 try{
  const preflight=await f.get({method:'OPTIONS',token:null,extraHeaders:{
   'access-control-request-method':'GET',
   'access-control-request-headers':'authorization,x-f123-license,x-f123-instance'
  }});
  assert.equal(preflight.status,204);
  assert.equal(preflight.headers.get('access-control-allow-origin'),origin);
  const foreign=await f.get({method:'OPTIONS',originHeader:wrongOrigin,extraHeaders:{
   'access-control-request-method':'GET','access-control-request-headers':'authorization'
  }});
  assert.equal(foreign.status,403);
  const minted=await f.ticket();
  const denied=await f.get({token:minted,originHeader:wrongOrigin});
  assert.equal(denied.status,403);
  assert.equal((await f.get({token:minted})).status,200,'wrong-origin request must not burn a valid token');
 }finally{await f.close();}
});
test('C11 refuses private-root catalog even with certified SQL row and signed Owner ticket',{timeout:30000},async()=>{
 const f=await fixture({privateRoot:true});
 try{
  const result=await f.get({token:await f.ticket()});
  assert.notEqual(result.status,200);
  assert.equal((await result.text()).includes('PRIVATE_NEVER_EXPOSE'),false);
 }finally{await f.close();}
});
test('C11 QA flag OFF refuses proof even with a minted ticket',{timeout:30000},async()=>{
 const f=await fixture({enabled:false});
 try{
  assert.notEqual((await f.get({token:await f.ticket()})).status,200);
  assert.equal(f.readCount,0);
 }finally{await f.close();}
});
test('C11 after Workerd cold restart retains certified HEAD without Firebase/R2 source',{timeout:40000},async()=>{
 const f=await fixture();
 try{
  const first=await f.get({token:await f.ticket()});assert.equal(first.status,200);
  f.sourceDown();await f.restart();
  const cold=await f.get({token:await f.ticket()});
  assert.equal(cold.status,200);
  assert.equal((await cold.json()).frozenHead,head);
  assert.equal(f.readCount,1,'cold verification reads SQL certificate + Yjs journal, not unavailable source');
 }finally{await f.close();}
});
