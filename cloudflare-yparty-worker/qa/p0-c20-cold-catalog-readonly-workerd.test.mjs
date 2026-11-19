// C20: independent real-Workerd regression of C12's formerly unbound Yjs root types.
// Fixture adapted from C19a (read-only here); no Cloudflare production calls or R2 writes.
// C19a · REAL Workerd Tienda DO + central one-use Owner tickets + C11 certified HEAD +
// C10 single writer + real AuthorizedYProvider. Synthetic-only data; no production
// HTTP, PIN, store, R2 or deployment mutations (USD 0.00).
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {Miniflare} from 'miniflare';import {build} from 'esbuild';
import WebSocket from 'ws';
import authorityWorker,{RegistroLicencias} from '../../cloudflare-worker/worker.js';
import {pinAuthority} from '../../cloudflare-worker/pin-authority.mjs';
import {salaDeLicencia} from '../src/sala.js';

const license='F123-SYNT-C19AWRITE',instance='synthetic-c19a-browser',key='synthetic-c19a-private-service-key-32chars!';
const origin='https://synthetic-browser.example';
const roomId=await salaDeLicencia(license),room=roomId+'-cat',head='certified-c19a-frozen-head-20261119';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const workerDir=fileURLToPath(new URL('..',import.meta.url));
const compiled=(await build({entryPoints:[path.join(workerDir,'src/index.js')],
 bundle:true,format:'esm',platform:'neutral',mainFields:['module','main'],
 conditions:['workerd','worker','browser'],external:['cloudflare:*'],write:false})).outputFiles[0].text;

// Bundle the REAL browser writer + REAL AuthorizedYProvider with the SAME yjs instance.
const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'f123-c19a-client-'));
const clientOut=path.join(scratch,'client.mjs');
await build({stdin:{contents:[
 `export {openCertifiedReadOnlyPublicCatalog} from ${JSON.stringify(path.resolve(workerDir,'../src/port2-readonly-catalog-session.mjs'))};`,
 `export {default as AuthorizedYProvider} from ${JSON.stringify(path.resolve(workerDir,'../src/authorized-yprovider.mjs'))};`,
 `export * as Y from 'yjs';`].join('\n'),resolveDir:workerDir},
 nodePaths:[path.join(workerDir,'node_modules')],bundle:true,platform:'node',format:'esm',
 external:['ws'],outfile:clientOut});
const client=await import(pathToFileURL(clientOut));
process.on('exit',()=>fs.rmSync(scratch,{recursive:true,force:true}));
const CY=client.Y;

function frozenSource(){
 const d=new CY.Doc();d.clientID=419;const frames=[];d.on('update',u=>frames.push([...u]));
 d.getMap('productos').set('prod-1',{id:'prod-1',nombre:'Synthetic book',precio:15,stockActual:2});
 d.getMap('ubicaciones').set('shelf-1',{id:'shelf-1',nombre:'Synthetic shelf',activa:true});
 const source={channel:'cat',frozenHead:head,completeToHead:true,frames,
  expectedStateSha256:sha(CY.encodeStateAsUpdate(d)),expectedVectorSha256:sha(CY.encodeStateVector(d))};
 d.destroy();return source;
}
function privateLocal(){
 const d=new CY.Doc();
 d.getMap('productos').set('prod-1',{id:'prod-1',nombre:'Synthetic book',precio:15,stockActual:2});
 d.getMap('ubicaciones').set('shelf-1',{id:'shelf-1',nombre:'Synthetic shelf',activa:true});
 d.getMap('_meta').set('pinsRol',{owner:'PRIVATE_NEVER_EXPOSE'});
 d.getMap('ventas').set('v1',{importe:777777});
 return d;
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
async function waitFor(predicate,label,limitMs=8000){
 const start=Date.now();
 while(!predicate()){
  if(Date.now()-start>limitMs)throw Error('timeout waiting for '+label);
  await new Promise(r=>setTimeout(r,25));
 }
}
async function fixture(){
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'f123-c19a-'));
 const db=fakeDb();await db.transaction(tx=>tx.put('inst:'+instance,{licenseCode:license,instanceId:instance}));
 const authEnv={PIN_PEPPER:'synthetic-c19a-owner-pepper-long-key-01',TEAM_PIN_PEPPER:'synthetic-c19a-team-pepper-long-key--02',
  TEAM_AUTHORITY_QA:'1',TEAM_AUTHORITY_LICENSE:license,WS_AUTHORITY_QA:'1',
  WS_SIGNING_KEY:'synthetic-c19a-signing-key-long-private',WS_SERVICE_KEY:key};
 const owner=pinAuthority(db,authEnv.PIN_PEPPER);await owner.masterSet(license,'123',0,[instance]);await owner.masterActivate(license,'123',0,[instance]);
 const registry=new RegistroLicencias({storage:db},authEnv);
 authEnv.REGISTROS={idFromName:()=>({}),get:()=>({fetch:(input,init)=>registry.fetch(new Request(input,init))})};
 const source=frozenSource();let online=true,mf,url,readCount=0;
 async function start(){
  mf=new Miniflare({modules:true,script:compiled,compatibilityDate:'2026-06-01',compatibilityFlags:['nodejs_compat'],
   durableObjects:{Tienda:{className:'Tienda',useSQLite:true}},durableObjectsPersist:path.join(folder,'do'),
   kvNamespaces:['LICENCIAS'],
   bindings:{SALA_PILOTO:roomId,WS_AUTHORITY_QA:'1',WS_SEPARATE_ROOMS_QA:'1',
    WS_OPEN_EXISTING_QA:'1',WS_CATALOG_ORIGIN_QA:origin,WS_SERVICE_KEY:key},
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
  url=await mf.ready;
 }
 await start();
 const requests=[];
 // Browser fetch shim: issuer -> real central authority; proof -> real Workerd (with browser Origin).
 async function send(target,opts={}){
  requests.push(target);
  if(target==='https://friendly123-licencias.jfcarpio.workers.dev/ws/ticket')
   return authorityWorker.fetch(new Request('https://authority.invalid/ws/ticket',
    {method:'POST',headers:opts.headers,body:opts.body}),authEnv);
  const u=new URL(target);
  assert.equal(u.host,'friendly123-yparty-port2-canary-qa.jfcarpio.workers.dev','pinned QA host only');
  return mf.dispatchFetch('https://synthetic-worker.example'+u.pathname+u.search,
   {method:opts.method,headers:{...opts.headers,origin}});
 }
 function createProvider({doc,room:r,params,readOnly}){
  assert.equal(readOnly,false);
  return new client.AuthorizedYProvider(url.host,r,doc,{party:'tienda',params,
   WebSocketPolyfill:WebSocket,disableBc:true,connect:false,maxBackoffTime:200});
 }
 async function ticket(scopes){
  const response=await authorityWorker.fetch(new Request('https://authority.invalid/ws/ticket',{method:'POST',
   headers:{'content-type':'application/json'},body:JSON.stringify({
    credentials:{kind:'owner',licenseCode:license,instanceId:instance,pin:'123'},room,scopes,ttlMs:30000})}),authEnv);
  const data=await response.json();assert.equal(response.status,200,JSON.stringify(data));return data.token;
 }
 async function reader(){
  const doc=new CY.Doc();
  const provider=new client.AuthorizedYProvider(url.host,room,doc,{party:'tienda',
   params:async()=>({licencia:license,instancia:instance,cap:await ticket(['cat:read'])}),
   WebSocketPolyfill:WebSocket,disableBc:true,connect:false});
  await provider.connect();
  await waitFor(()=>provider.synced,'reader sync');
  return {doc,provider,close(){provider.destroy();doc.destroy();}};
 }
 function writerInput(privateDoc,extra={}){
  return {privateDoc,Y:CY,room,licenseCode:license,instanceId:instance,expectedFrozenHead:head,
   getCredentials:()=>({kind:'owner',licenseCode:license,instanceId:instance,pin:'123'}),
   createProvider,fetch:send,isVisible:()=>true,timeoutMs:6000,...extra};
 }
 function createReadOnlyProvider({doc,room:r,params,readOnly,purpose}){
  assert.equal(readOnly,true);
  assert.equal(purpose,'certified-readonly-cold-join');
  assert.equal(doc.share.size,0,'C12 starts EMPTY Y.Doc before YParty network sync');
  return new client.AuthorizedYProvider(url.host,r,doc,{party:'tienda',params,
   WebSocketPolyfill:WebSocket,disableBc:true,connect:false,maxBackoffTime:200});
 }
 return {source,requests,reader,writerInput,createReadOnlyProvider,get readCount(){return readCount},
  async restart(){await mf.dispose();await start();},sourceDown(){online=false},
  async close(){try{await mf.dispose()}finally{fs.rmSync(folder,{recursive:true,force:true});}}};
}


test('C20 REAL Workerd: C12 cold read of certified public -cat, real YParty sockets, NO writer, SQL restart without source',{timeout:65000},async()=>{
 const f=await fixture();
 const local=privateLocal();
 try{
  const input=()=>f.writerInput(local,{createProvider:f.createReadOnlyProvider,timeoutMs:8000});
  const first=await client.openCertifiedReadOnlyPublicCatalog(input());
  assert.equal(first.readOnly,true);
  const display=first.display();
  assert.equal(display.productos['prod-1'].stockActual,2);
  assert.equal(display.ubicaciones['shelf-1'].nombre,'Synthetic shelf');
  assert.equal(Object.prototype.hasOwnProperty.call(display,'_meta'),false);
  assert.equal(Object.prototype.hasOwnProperty.call(display,'ventas'),false);
  assert.equal(local.getMap('_meta').get('pinsRol').owner,'PRIVATE_NEVER_EXPOSE');
  const proofCount=f.requests.filter(x=>x.includes('frozen-proof=1')).length;
  assert.equal(proofCount,1);
  first.close();
  // DO cold restart must recover certified SQL without re-reading Firebase/R2.
  f.sourceDown();
  await f.restart();
  const cold=await client.openCertifiedReadOnlyPublicCatalog(input());
  assert.equal(cold.readOnly,true);
  assert.equal(cold.display().productos['prod-1'].precio,15);
  assert.equal(f.readCount,1,'exactly one frozen source read before cold SQL restart');
  cold.close();
 }finally{local.destroy();await f.close();}
});
