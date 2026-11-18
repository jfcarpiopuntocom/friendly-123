'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {webcrypto}=require('node:crypto'),path=require('node:path');
const root=require('node:url').pathToFileURL(path.join(__dirname,'../src/')).href;
const room='a'.repeat(32),license='F123-SYNT-TEAM',instance='synthetic-room-client';
const sha=async bytes=>[...new Uint8Array(await webcrypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');
function harness(){
 const issues=[],requests=[],photos=new Map();let counter=0;
 const getCredentials=()=>({kind:'owner',licenseCode:license,instanceId:instance,pin:'123'});
 const send=async(u,o)=>{
  const url=String(u);
  if(url.endsWith('/ws/ticket')){
   issues.push(JSON.parse(o.body));
   return Response.json({ok:true,token:'fixture'+(++counter)+'.stamp',expiresAt:Date.now()+10000});
  }
  const hash=new URL(url).searchParams.get('sha');requests.push({url,opts:o});
  if(o.method==='PUT'){
   const data=new Uint8Array(o.body);
   photos.set(hash,{data,tipo:o.headers['content-type']});
   return Response.json({sha:hash,bytes:data.length,tipo:o.headers['content-type']},{status:201});
  }
  const item=photos.get(hash);
  return item?new Response(item.data,{status:200,headers:{'content-type':item.tipo}}):new Response('',{status:404});
 };
 return{issues,requests,photos,getCredentials,send};
}
test('photo scopes are only allowed with explicit HTTP opt-in, fresh per call',async()=>{
 const {createOwnerTicketParams}=await import(root+'ws-owner-ticket-params.mjs');
 const f=harness(),args={licenseCode:license,instanceId:instance,room:room+'-fotos',getCredentials:f.getCredentials,fetch:f.send};
 assert.throws(()=>createOwnerTicketParams(args));
 const read=createOwnerTicketParams({...args,photoScope:'read'});
 const write=createOwnerTicketParams({...args,photoScope:'write'});
 assert.notEqual((await read()).cap,(await write()).cap);
 assert.deepEqual(f.issues.map(x=>x.scopes),[['fotos:read'],['fotos:write']]);
 assert.throws(()=>createOwnerTicketParams({...args,room:room+'-cat',photoScope:'write'}));
});
test('actual bridge streams SHA-verifiable HTTP photo bytes with separate one-use tickets',async()=>{
 const {createPhotoShaBridge}=await import(root+'photo-sha-bridge.mjs');
 const f=harness(),bridge=createPhotoShaBridge({host:'friendly123-yparty-qa-20261114.jfcarpio.workers.dev',
  licenseCode:license,instanceId:instance,room,getCredentials:f.getCredentials,fetch:f.send});
 const bytes=Buffer.alloc(2*1024*1024+31);bytes.fill(17);
 const hash=await sha(bytes),data='data:image/png;base64,'+bytes.toString('base64');
 assert.deepEqual(await bridge.put(hash,data),{sha:hash,bytes:bytes.length,tipo:'image/png'});
 assert.equal(await bridge.get(hash),data);
 assert.deepEqual(f.issues.map(x=>x.scopes),[['fotos:write'],['fotos:read']]);
 assert.ok(f.requests.every(x=>!x.url.includes('cap=')));
 assert.equal(f.requests[0].opts.headers['content-type'],'image/png');
});
test('reject corrupt and unsupported photo payload before asking issuer',async()=>{
 const {createPhotoShaBridge}=await import(root+'photo-sha-bridge.mjs');
 const f=harness(),bridge=createPhotoShaBridge({host:'friendly123-yparty-qa-20261114.jfcarpio.workers.dev',
  licenseCode:license,instanceId:instance,room,getCredentials:f.getCredentials,fetch:f.send});
 await assert.rejects(bridge.put('e'.repeat(64),'data:image/png;base64,QUJD'));
 await assert.rejects(bridge.put('e'.repeat(64),'data:image/svg+xml;base64,QUJD'));
 await assert.rejects(bridge.get('not-a-sha'));
 assert.equal(f.issues.length,0);
});

test('real pilot sources wire SHA photo bridge only when Owner session exists; legacy foto relay retained',()=>{
 const fs=require('node:fs'),path=require('node:path');
 const pilot=fs.readFileSync(path.join(__dirname,'../src/yparty-piloto.js'),'utf8');
 const sync=fs.readFileSync(path.join(__dirname,'../docs/sync-yjs.js'),'utf8');
 assert.match(pilot,/fotoSha\(\)/);
 assert.match(pilot,/createPhotoShaBridge/);
 assert.match(sync,/fotos_refs/);
 assert.match(sync,/bridgeFotoInicial\.put\(hash,\s*dataUrl\)/);
 assert.match(sync,/API\.fotosRefs\.set\(hash/);
 assert.match(sync,/bridge\.get\(hash\)/);
 assert.match(sync,/guardarPorHash\(hash/);
 assert.match(sync,/new window\.Y\.Doc\(\)/,'legacy encrypted fallback must not be silently removed');
});
