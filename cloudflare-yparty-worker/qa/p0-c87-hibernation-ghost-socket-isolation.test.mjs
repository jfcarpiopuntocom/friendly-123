// RED->GREEN: Ghost/faulting WebSocket in Hibernation outbound batch must NOT
// drop frames or evict (1008) healthy co-batched connections, while central
// authority outage or per-connection grant revocation still fails closed.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {build} from 'esbuild';
import {pathToFileURL} from 'node:url';
import fs from 'node:fs';
import os from 'node:os';

const workerEntry=path.resolve(import.meta.dirname,'../src/index.js');
const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'f123-c87-ghost-'));
const stubPath=path.join(scratch,'cf-workers-stub.mjs');
const bundledPath=path.join(scratch,'tienda.mjs');

fs.writeFileSync(stubPath,`
export const env = {};
export class DurableObject {
  constructor(ctx, env){ this.ctx = ctx; this.env = env; }
}
`);
await build({
 stdin:{
  contents:`export { Tienda } from ${JSON.stringify(workerEntry)};`,
  resolveDir:path.dirname(workerEntry)
 },
 plugins:[{
  name:'cf-workers-stub',
  setup(b){b.onResolve({filter:/^cloudflare:workers$/},()=>({path:stubPath}));}
 }],
 bundle:true,format:'esm',platform:'neutral',mainFields:['module','main'],
 conditions:['workerd','worker','browser'],outfile:bundledPath
});
const {Tienda}=await import(pathToFileURL(bundledPath));
process.on('exit',()=>fs.rmSync(scratch,{recursive:true,force:true}));

const ROOM='a'.repeat(32)+'-cat';
function makePrincipal(id,iat,exp){
 return {
  role:'dueno',subject:'owner-account',
  license:'F123-SYNT-TEAM',instance:'inst-'+id,room:ROOM,
  iat,exp,scopes:['cat:read','cat:write']
 };
}
function makeConn(id,{sendThrows=false,closeThrows=false,grantValid=true}={}){
 const sent=[],closes=[],now=Date.now(),iat=now-1000,exp=grantValid?now+60_000:now-500;
 return {
  id,readyState:1,
  state:{
   accesoFirmado:{
    token:'tok-'+id,licenseCode:'F123-SYNT-TEAM',instanceId:'inst-'+id,
    room:ROOM,requiredScope:'cat:read',
    principal:makePrincipal(id,iat,exp)
   }
  },
  setState(fn){
   this.state=typeof fn==='function'?fn(this.state):fn;
  },
  send(msg){
   if(sendThrows)throw new Error('broken hibernation socket');
   sent.push(msg);
  },
  close(code,reason){
   closes.push({code,reason});
   if(closeThrows)throw new Error('close on faulted socket failed');
   this.readyState=3;
  },
  sent,closes
 };
}

function makeTienda({authorityMode='allow-all'}={}){
 const waitPromises=[];
 const env={
  WS_AUTHORITY_QA:'1',WS_SEPARATE_ROOMS_QA:'1',SALA_PILOTO:'a'.repeat(32),
  WS_SERVICE_KEY:'synthetic-ghost-socket-service-key-32b',
  WS_AUTHORITY:{
   async fetch(urlArg,init){
    if(authorityMode==='throw')throw new Error('authority down');
    const req=urlArg instanceof Request?urlArg:new Request(urlArg,init);
    const url=new URL(req.url);
    if(url.pathname==='/ws/check-many'){
     const body=await req.json();
     const reqs=Array.isArray(body?.requests)?body.requests:[];
     const now=Date.now(),iat=now-1000,exp=now+60_000;
     if(authorityMode==='revoke-first'){
      return Response.json({ok:true,results:reqs.map((r,i)=>i===0?{ok:false}:{
       ok:true,principal:{
        role:'dueno',subject:'owner-account',
        license:r.licenseCode,instance:r.instanceId,room:r.room,
        iat,exp,scopes:['cat:read','cat:write']
       }
      })});
     }
     return Response.json({ok:true,results:reqs.map(r=>({
      ok:true,principal:{
       role:'dueno',subject:'owner-account',
       license:r.licenseCode,instance:r.instanceId,room:r.room,
       iat,exp,scopes:['cat:read','cat:write']
      }
     }))});
    }
    return new Response('not found',{status:404});
   }
  }
 };
 const ctx={
  waitUntil(p){waitPromises.push(p);},
  storage:{sql:{exec:()=>({toArray:()=>[],one:()=>({n:0})})},transactionSync:fn=>fn()}
 };
 const t=new Tienda(ctx,env);
 return {t,waitPromises};
}

test('RED->GREEN: faulted ghost socket throwing on send() does not drop or evict healthy co-batched clients',async()=>{
 const {t,waitPromises}=makeTienda({authorityMode:'allow-all'});
 const dead=makeConn('dead',{sendThrows:true,closeThrows:true});
 const healthy=makeConn('healthy');
 await t.enviarLoteAutorizado([
  {connection:dead,payload:'frame-to-dead'},
  {connection:healthy,payload:'frame-to-healthy'}
 ]);
 // Also exercise full queue microtask path
 t.pendingOutboundFrames.push(
  {connection:dead,payload:'queued-dead'},
  {connection:healthy,payload:'queued-healthy'}
 );
 dead.readyState=1;
 t.programarLoteSaliente();
 await new Promise(r=>setTimeout(r,20));
 await Promise.allSettled(waitPromises);

 assert.deepEqual(healthy.sent,['frame-to-healthy','queued-healthy']);
 assert.equal(healthy.closes.length,0,'healthy authorized client must NOT be evicted');
 assert.equal(healthy.readyState,1);
 assert.ok(dead.closes.length>=1,'faulted socket should still attempt bounded closure');
});

test('per-socket revocation and total authority failure still fail closed across all remaining sockets even if one socket close throws',async()=>{
 // 1. Revoke first socket whose close() throws; second socket still gets its frame
 const r1=makeTienda({authorityMode:'revoke-first'});
 const revoked=makeConn('revoked',{closeThrows:true});
 const okPeer=makeConn('okPeer');
 await r1.t.enviarLoteAutorizado([
  {connection:revoked,payload:'denied-payload'},
  {connection:okPeer,payload:'allowed-payload'}
 ]);
 assert.equal(revoked.state.accesoFirmado,null);
 assert.equal(revoked.closes[0]?.code,1008);
 assert.deepEqual(okPeer.sent,['allowed-payload']);

 // 2. Central authority throws: ALL active sockets in batch must be revoked & closed safely
 const r2=makeTienda({authorityMode:'throw'});
 const faultClosing=makeConn('faultClosing',{closeThrows:true});
 const peer2=makeConn('peer2');
 r2.t.pendingOutboundFrames.push(
  {connection:faultClosing,payload:'f1'},
  {connection:peer2,payload:'f2'}
 );
 r2.t.programarLoteSaliente();
 await new Promise(r=>setTimeout(r,20));
 await Promise.allSettled(r2.waitPromises);
 assert.equal(faultClosing.state.accesoFirmado,null);
 assert.equal(peer2.state.accesoFirmado,null);
 assert.equal(peer2.closes[0]?.code,1008);
 assert.equal(peer2.sent.length,0);
});
