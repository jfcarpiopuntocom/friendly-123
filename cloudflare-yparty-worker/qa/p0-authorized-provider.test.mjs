// Synthetic local sockets exercise the imported provider, not a fake transport.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {once} from 'node:events';
import {build} from 'esbuild';
import WebSocket,{WebSocketServer} from 'ws';

const source=fileURLToPath(new URL('../../src/authorized-yprovider.mjs',import.meta.url));
const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'f123-authorized-provider-'));
const out=path.join(scratch,'client.mjs');
// Before the adapter exists, characterize the exact imported production behavior.
const entry=fs.existsSync(source)?source:'y-partyserver/provider';
const ticketSource=fileURLToPath(new URL('../../src/ws-owner-ticket-params.mjs',import.meta.url));
const ticketExport=fs.existsSync(ticketSource)?`export {createOwnerTicketParams} from ${JSON.stringify(ticketSource)};`:'export const createOwnerTicketParams=undefined;';
await build({stdin:{contents:`export {default as Provider} from ${JSON.stringify(entry)}; export * as Y from 'yjs'; ${ticketExport}`,resolveDir:fileURLToPath(new URL('..',import.meta.url))},nodePaths:[fileURLToPath(new URL('../node_modules',import.meta.url))],bundle:true,platform:'node',format:'esm',outfile:out});
const {Provider,Y,createOwnerTicketParams}=await import(pathToFileURL(out));
process.on('exit',()=>fs.rmSync(scratch,{recursive:true,force:true}));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(f,label){const end=Date.now()+3000;while(!f()){assert.ok(Date.now()<end,'timeout '+label);await sleep(5);}}
async function fixture(params,{denyUpgrade=false,closeCode}={}){
 const requests=[],handshakes=[];
 const server=new WebSocketServer({host:'127.0.0.1',port:0,verifyClient:info=>{handshakes.push(info.req.url);return !denyUpgrade;}});
 await once(server,'listening');server.on('connection',(socket,request)=>{requests.push({socket,url:new URL(request.url,'http://localhost')});if(closeCode)socket.close(closeCode,'synthetic admission denial');});
 const doc=new Y.Doc();doc.getMap('local').set('opId','synthetic-sale-stays-local');
 const provider=new Provider('127.0.0.1:'+server.address().port,'synthetic-private-room',doc,{party:'tienda',params,connect:false,disableBc:true,maxBackoffTime:20,WebSocketPolyfill:WebSocket});
 return{server,requests,handshakes,doc,provider,async close(){provider.destroy();provider.awareness.destroy();for(const s of server.clients)s.terminate();await new Promise(r=>server.close(r));doc.destroy();}};
}

test('failed credential renewal never reconnects with the previous single-use ticket',{timeout:10000},async()=>{
 let calls=0;const f=await fixture(async()=>{calls++;if(calls>1)throw Error('synthetic authority unavailable');return{cap:'synthetic-first-ticket'};});
 try{await f.provider.connect();await until(()=>f.requests.length===1&&f.provider.wsconnected,'first open');f.requests[0].socket.close(1012,'synthetic restart');await until(()=>calls>=2,'renewal attempted');await sleep(80);
  assert.equal(f.requests.length,1,'no second handshake may contain the old ticket');assert.equal(f.provider.shouldConnect,false,'denied renewal requires explicit resumption');assert.equal(f.doc.getMap('local').get('opId'),'synthetic-sale-stays-local');
 }finally{await f.close();}
});

test('pause during credential fetch prevents a late connection and preserves the local document',{timeout:10000},async()=>{
 let release,entered;const pending=new Promise(r=>entered=r),f=await fixture(()=>{entered();return new Promise(r=>release=r);});
 try{const attempt=f.provider.connect();await pending;f.provider.disconnect();release({cap:'synthetic-late-ticket'});await attempt.catch(()=>{});await sleep(50);assert.equal(f.requests.length,0);assert.equal(f.provider.shouldConnect,false);assert.equal(f.doc.getMap('local').get('opId'),'synthetic-sale-stays-local');}
 finally{await f.close();}
});

test('only the newest overlapping credential request may open a connection',{timeout:10000},async()=>{
 const releases=[];const f=await fixture(()=>new Promise(r=>releases.push(r)));
 try{const first=f.provider.connect();await until(()=>releases.length===1,'first params');const second=f.provider.connect();await until(()=>releases.length===2,'second params');releases[1]({cap:'synthetic-new-session'});await second;await until(()=>f.requests.length===1,'new session open');releases[0]({cap:'synthetic-obsolete-session'});await first.catch(()=>{});await sleep(50);assert.equal(f.provider.url.includes('synthetic-new-session'),true,'old resolution cannot replace the current session URL');assert.equal(f.requests.length,1);}
 finally{await f.close();}
});

test('immediate resume after pause waits for closure and obtains a fresh ticket',{timeout:10000},async()=>{
 let calls=0;const f=await fixture(async()=>({cap:'synthetic-ticket-'+(++calls)}));
 try{await f.provider.connect();await until(()=>f.provider.wsconnected,'initial socket');f.provider.disconnect();await f.provider.connect();await until(()=>f.requests.length===2&&f.provider.wsconnected,'immediate resumed socket');assert.equal(calls,2);assert.equal(f.requests[1].url.searchParams.get('cap'),'synthetic-ticket-2');assert.equal(f.provider.shouldConnect,true);}
 finally{await f.close();}
});
for(const mode of ['policy-close','upgrade-denial'])test(mode+' bounds repeated unsynced admissions without a ticket issuance loop',{timeout:10000},async()=>{
 let calls=0;const f=await fixture(async()=>({cap:'synthetic-ticket-'+(++calls)}),mode==='policy-close'?{closeCode:1008}:{denyUpgrade:true});
 try{await f.provider.connect();await until(()=>f.handshakes.length>=2,'bounded retry');await sleep(150);assert.equal(f.handshakes.length,2);assert.equal(calls,2);assert.equal(f.provider.shouldConnect,false);assert.equal(f.doc.getMap('local').get('opId'),'synthetic-sale-stays-local');}
 finally{await f.close();}
});
test('destroying during credential fetch cannot open a late socket or destroy the caller document',{timeout:10000},async()=>{
 let release;const f=await fixture(()=>new Promise(r=>release=r));
 try{const attempt=f.provider.connect();await until(()=>release,'pending credentials');f.provider.destroy();release({cap:'synthetic-destroyed-ticket'});await attempt;await sleep(50);assert.equal(f.requests.length,0);assert.equal(f.doc.isDestroyed,false);assert.equal(f.doc.getMap('local').get('opId'),'synthetic-sale-stays-local');}
 finally{await f.close();}
});

const identity={kind:'owner',licenseCode:'F123-SYNT-TEAM',instanceId:'synthetic-instance',pin:'123'};
const privateRoom='0'.repeat(32)+'-priv';
test('Owner ticket parameters keep the PIN in the HTTPS body and return only the room capability',async()=>{
 assert.equal(typeof createOwnerTicketParams,'function','Owner issuer client is implemented');let request;
 const params=createOwnerTicketParams({licenseCode:identity.licenseCode,instanceId:identity.instanceId,room:privateRoom,getCredentials:()=>identity,fetch:async(url,options)=>{request=new Request(url,options);return Response.json({ok:true,token:'synthetic.signed-ticket',expiresAt:Date.now()+30000});}});
 const result=await params();assert.deepEqual(result,{licencia:'F123-SYNT-TEAM',instancia:'synthetic-instance',cap:'synthetic.signed-ticket'});
 assert.equal(request.url,'https://friendly123-licencias.jfcarpio.workers.dev/ws/ticket');assert.equal(request.redirect,'error');assert.equal(request.credentials,'omit');assert.equal(request.cache,'no-store');
 const body=await request.json();assert.deepEqual(body.credentials,identity);assert.deepEqual(body.scopes,['priv:read','priv:write']);assert.equal(body.room,privateRoom);assert.equal(Object.hasOwn(result,'pin'),false);
});
test('local roles or a mismatching identity cannot request an Owner capability',async()=>{
 assert.equal(typeof createOwnerTicketParams,'function','Owner issuer client is implemented');let fetched=false;
 for(const credentials of [{role:'dueno',verifiedByBackend:true},{...identity,kind:'team'},{...identity,instanceId:'other-instance'}]){
  const params=createOwnerTicketParams({licenseCode:identity.licenseCode,instanceId:identity.instanceId,room:privateRoom,getCredentials:()=>credentials,fetch:async()=>{fetched=true;throw Error('must not fetch');}});await assert.rejects(params(),/authorization/i);
 }assert.equal(fetched,false);
});
test('an issuer denial or expired response never produces reusable socket parameters',async()=>{
 assert.equal(typeof createOwnerTicketParams,'function','Owner issuer client is implemented');
 for(const response of [Response.json({ok:false,reason:'synthetic private detail'},{status:403}),Response.json({ok:true,token:'synthetic.expired',expiresAt:Date.now()-1}),Response.json({ok:true,token:'synthetic.invalid',expiresAt:Date.now()+120000})]){
  const params=createOwnerTicketParams({licenseCode:identity.licenseCode,instanceId:identity.instanceId,room:privateRoom,getCredentials:()=>identity,fetch:async()=>response});await assert.rejects(params(),e=>/authorization/i.test(e.message)&&!e.message.includes('private detail'));
 }
});
test('switching identity during issuance discards the delayed ticket',async()=>{
 assert.equal(typeof createOwnerTicketParams,'function','Owner issuer client is implemented');let current=identity,release;
 const params=createOwnerTicketParams({licenseCode:identity.licenseCode,instanceId:identity.instanceId,room:privateRoom,getCredentials:()=>current,fetch:()=>new Promise(r=>release=r)});
 const attempt=params();await until(()=>release,'issuance in flight');current={...identity,instanceId:'other-instance'};release(Response.json({ok:true,token:'synthetic.obsolete',expiresAt:Date.now()+30000}));await assert.rejects(attempt,/authorization/i);
});
