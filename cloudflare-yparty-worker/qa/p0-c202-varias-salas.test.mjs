// C202 RED-first: the 2.0 Worker admits a SET of store rooms (SALAS_PILOTO),
// SALA_PILOTO (single) keeps working, and a room never opens another room.
// Synthetic licenses only; real Workerd + real issuer protocol.
import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {build} from 'esbuild';import {Miniflare} from 'miniflare';
import WebSocket from 'ws';import * as Y from 'yjs';import YProvider from 'y-partyserver/provider';
import authorityWorker,{RegistroLicencias} from '../../cloudflare-worker/worker.js';
import {pinAuthority} from '../../cloudflare-worker/pin-authority.mjs';
import {salaDeLicencia} from '../src/sala.js';

const key='synthetic-service-bridge-test-key-32-bytes',persist=fs.mkdtempSync(path.join(os.tmpdir(),'f123-c202-'));
const L={A:'F123-SYNT-AAAA',B:'F123-SYNT-BBBB',C:'F123-SYNT-CCCC'};
const inst={A:'synthetic-inst-a',B:'synthetic-inst-b',C:'synthetic-inst-c'},R={};
let db,env,mf,url,bundle,registry;
function storage(){
 let records=new Map(),tail=Promise.resolve();
 return {get:async k=>structuredClone(records.get(k)),
 transaction:async fn=>{let release;const previous=tail;tail=new Promise(r=>release=r);await previous;
 const snapshot=new Map([...records].map(([k,v])=>[k,structuredClone(v)]));
 try{const result=await fn({get:async k=>structuredClone(snapshot.get(k)),put:async(k,v)=>snapshot.set(k,structuredClone(v)),
 delete:async k=>snapshot.delete(k),list:async({prefix,limit})=>new Map([...snapshot].filter(([k])=>k.startsWith(prefix)).slice(0,limit))});records=snapshot;return result;}
 finally{release();}}};
}
async function relay(vars){
 if(mf)await mf.dispose();
 mf=new Miniflare({modules:true,script:bundle,compatibilityDate:'2026-06-01',compatibilityFlags:['nodejs_compat'],
 durableObjects:{Tienda:{className:'Tienda',useSQLite:true}},durableObjectsPersist:path.join(persist,'do'),
 kvNamespaces:['LICENCIAS'],bindings:{WS_AUTHORITY_QA:'1',WS_SEPARATE_ROOMS_QA:'1',WS_SERVICE_KEY:key,...vars},
 serviceBindings:{WS_AUTHORITY:async request=>authorityWorker.fetch(new Request(request.url,request),env)}});
 url=await mf.ready;
}
async function issue(k,channel,scopes){
 const result=await authorityWorker.fetch(new Request('https://authority.invalid/ws/ticket',{method:'POST',
  headers:{'content-type':'application/json'},body:JSON.stringify({credentials:{kind:'owner',licenseCode:L[k],instanceId:inst[k],pin:'123'},
  room:R[k]+'-'+channel,scopes,ttlMs:30000})}),env);
 const body=await result.json();assert.equal(result.status,200,JSON.stringify(body));return body.token;
}
async function attempt(roomName,k,token,timeoutMs=900){
 const target=new URL('/parties/tienda/'+roomName,url);target.protocol='ws:';
 target.search=new URLSearchParams({licencia:L[k],instancia:inst[k],cap:token});
 return new Promise(resolve=>{
  const ws=new WebSocket(target);let outcome='unknown',binary=0,done=false;
  const finish=r=>{if(done)return;done=true;clearTimeout(timer);ws.terminate();resolve({status:r,binary});};
  const timer=setTimeout(()=>finish(outcome==='connected'?'open':'timeout'),timeoutMs);
  ws.on('open',()=>{outcome='connected';});
  ws.on('message',(_d,isBinary)=>{if(isBinary)binary++;});
  ws.on('unexpected-response',(_q,res)=>finish(res.statusCode));
  ws.on('close',c=>finish(c));ws.on('error',()=>{});
 });
}
async function connect(k,channel,scopes){
 const doc=new Y.Doc(),token=await issue(k,channel,scopes);
 const provider=new YProvider(url.host,R[k]+'-'+channel,doc,{party:'tienda',
  params:{licencia:L[k],instancia:inst[k],cap:token},WebSocketPolyfill:WebSocket,disableBc:true});
 const start=Date.now();
 while(!provider.synced){if(Date.now()-start>6500){provider.destroy();doc.destroy();throw Error('timeout sync '+k+channel);}await new Promise(r=>setTimeout(r,25));}
 return{doc,close(){provider.destroy();doc.destroy();}};
}
before(async()=>{
 db=storage();env={PIN_PEPPER:'synthetic-owner-secret-more-than-32bytes',TEAM_PIN_PEPPER:'synthetic-team-secret-separate-32bytes',
  TEAM_AUTHORITY_QA:'1',TEAM_AUTHORITY_LICENSE:L.A,TEAM_AUTHORITY_LICENSES:L.B+','+L.C,WS_AUTHORITY_QA:'1',WS_SIGNING_KEY:'synthetic-ws-signing-secret-more-than-32bytes',WS_SERVICE_KEY:key};
 const owner=pinAuthority(db,env.PIN_PEPPER);
 for(const k of Object.keys(L)){
  R[k]=await salaDeLicencia(L[k]);
  await db.transaction(tx=>tx.put('inst:'+inst[k],{licenseCode:L[k],instanceId:inst[k]}));
  await owner.masterSet(L[k],'123',0,[inst[k]]);await owner.masterActivate(L[k],'123',0,[inst[k]]);
 }
 registry=new RegistroLicencias({storage:db},env);
 env.REGISTROS={idFromName:()=>({}),get:()=>({fetch:(input,opts)=>registry.fetch(new Request(input,opts))})};
 const out=await build({entryPoints:[path.join(import.meta.dirname,'../src/index.js')],
  bundle:true,format:'esm',platform:'neutral',mainFields:['module','main'],
  conditions:['workerd','worker','browser'],external:['cloudflare:*'],write:false});
 bundle=out.outputFiles[0].text;
});
after(async()=>{await mf?.dispose();fs.rmSync(persist,{recursive:true,force:true});});

test('C202 (a)(b)(c): SALAS_PILOTO=A,B admits both stores, keeps them isolated, refuses unlisted C and cross-room tickets',{timeout:40000},async()=>{
 await relay({SALAS_PILOTO:R.A+', '+R.B});
 const a=await connect('A','cat',['cat:read','cat:write']),b=await connect('B','cat',['cat:read','cat:write']);
 try{
  a.doc.getMap('products').set('only-in-a',{n:1});
  const bRead=await connect('B','cat',['cat:read']);
  try{await new Promise(r=>setTimeout(r,400));assert.equal(bRead.doc.getMap('products').has('only-in-a'),false,'room B never sees room A');}finally{bRead.close();}
 }finally{a.close();b.close();}
 // (b) valid ticket and license but the room is not in the set: 404 before any DO.
 const c=await attempt(R.C+'-ops','C',await issue('C','ops',['ops:read']));
 assert.equal(c.status,404);assert.equal(c.binary,0);
 // (c) ticket minted for A used on the room of B (both admitted): refused, no Yjs.
 const cross=await attempt(R.B+'-ops','A',await issue('A','ops',['ops:read']));
 assert.notEqual(cross.status,'open');assert.equal(cross.binary,0);
 // an unsupported suffix of an admitted room is still 404
 assert.equal((await attempt(R.A+'-zzz','A',await issue('A','ops',['ops:read']))).status,404);
});

test('C202 (d): legacy single SALA_PILOTO behaves as before; SALAS_PILOTO is a union, junk entries ignored',{timeout:40000},async()=>{
 await relay({SALA_PILOTO:R.A});
 const a=await connect('A','cat',['cat:read']);a.close();
 const b=await attempt(R.B+'-ops','B',await issue('B','ops',['ops:read']));
 assert.equal(b.status,404,'only A configured: B stays unlisted');
 await relay({SALA_PILOTO:R.A,SALAS_PILOTO:'not-a-room,'+R.B+','});
 const both=[await connect('A','cat',['cat:read']),await connect('B','cat',['cat:read'])];
 both.forEach(x=>x.close());
 await relay({SALA_PILOTO:'not-hex',SALAS_PILOTO:''});
 assert.equal((await attempt(R.A+'-ops','A',await issue('A','ops',['ops:read']))).status,404,'no valid room: fail closed');
});

test('C202 (e): the 2.0 ticket authority refuses a license that is not in its list',async()=>{
 const res=await authorityWorker.fetch(new Request('https://authority.invalid/ws/ticket',{method:'POST',headers:{'content-type':'application/json'},
  body:JSON.stringify({credentials:{kind:'owner',licenseCode:'F123-SYNT-DDDD',instanceId:'synthetic-inst-d',pin:'123'},room:R.A+'-cat',scopes:['sync:read'],ttlMs:30000})}),env);
 assert.equal(res.status,404);assert.equal((await res.json()).reason,'not-found');
});
