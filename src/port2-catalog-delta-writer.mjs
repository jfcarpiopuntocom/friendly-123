// PORT2 C19a: certified SINGLE-WRITER typed delta client for the public -cat room.
// Proof first (one-use cat:read ticket, C11), then a DIFFERENT one-use
// cat:read+cat:write ticket for the WebSocket (C10 enforces one writer per DO).
// The private Sync3 Y.Doc never crosses this boundary: the writer Y.Doc starts
// EMPTY, must reach exact display parity with the local projection, and only
// accepts typed deltas validated by the SAME allowlist used by the server (C8).
import {createOwnerTicketParams} from './ws-owner-ticket-params.mjs';
import {projectPublicCatalog,assertPublicCatalogTransportDoc} from '../cloudflare-yparty-worker/src/catalog-safe-projection.mjs';

const ROOM=/^[a-f0-9]{32}-cat$/,HEAD=/^[A-Za-z0-9_.:-]{3,128}$/,SHA=/^[a-f0-9]{64}$/;
// Same id contract as catalog-safe-projection.mjs (rejects __proto__/constructor/prototype).
const ID=/^(?!__proto__$)(?!constructor$)(?!prototype$)[A-Za-z0-9_-]{1,120}$/;
const HOST='friendly123-yparty-port2-canary-qa.jfcarpio.workers.dev';
const ORIGIN='port2-typed-catalog-delta';
const CONFLICT_REASON='Catalog writer already active';

function fail(code){
 const error=new Error('certified catalog writer unavailable');
 if(code)error.code=code;
 return error;
}
function stableValue(value){
 if(Array.isArray(value))return value.map(stableValue);
 if(value&&typeof value==='object'){
  const out={};
  for(const k of Object.keys(value).sort())out[k]=stableValue(value[k]);
  return out;
 }
 return value;
}
function canon(doc){
 return JSON.stringify(stableValue({productos:doc.getMap('productos').toJSON(),
  ubicaciones:doc.getMap('ubicaciones').toJSON()}));
}
function plainRow(row){
 return !!row&&typeof row==='object'&&!Array.isArray(row)&&
  Object.getPrototypeOf(row)===Object.prototype;
}
// Validate ONE row with the canonical transport allowlist on a scratch doc:
// exact field set, types, bounds; no silent dropping of private fields.
function validRow(Y,room,root,row){
 if(!plainRow(row)||!ID.test(row.id||''))throw new TypeError('invalid catalog delta');
 const scratch=new Y.Doc();
 try{
  scratch.getMap(root).set(row.id,{...row});
  assertPublicCatalogTransportDoc({doc:scratch,room});
 }catch(_){throw new TypeError('invalid catalog delta');}
 finally{scratch.destroy();}
 return {...row};
}
function parseDelta(Y,room,delta){
 if(!plainRow(delta))throw new TypeError('invalid catalog delta');
 const keys=Object.keys(delta).sort().join(',');
 switch(delta.kind){
  case 'product.upsert':{
   if(keys!=='kind,product')break;
   const row=validRow(Y,room,'productos',delta.product);
   return {root:'productos',id:row.id,row};
  }
  case 'shelf.upsert':{
   if(keys!=='kind,shelf')break;
   const row=validRow(Y,room,'ubicaciones',delta.shelf);
   return {root:'ubicaciones',id:row.id,row};
  }
  case 'product.delete':
  case 'shelf.delete':
   if(keys!=='id,kind'||typeof delta.id!=='string'||!ID.test(delta.id))break;
   return {root:delta.kind==='product.delete'?'productos':'ubicaciones',id:delta.id,row:null};
 }
 throw new TypeError('invalid catalog delta');
}
function closeCode(event){
 const e=Array.isArray(event)?event[0]:event;
 return {code:e?.code,reason:String(e?.reason||'')};
}

export async function openCertifiedPublicCatalogWriter({
 privateDoc,Y,room,licenseCode,instanceId,expectedFrozenHead,
 getCredentials,createProvider,fetch:send=globalThis.fetch?.bind(globalThis),
 isVisible=()=>globalThis.document?.hidden!==true,timeoutMs=6000,onWriterConflict=null
}={}){
 if(!ROOM.test(room||'')||!HEAD.test(expectedFrozenHead||'')||
    !Y||typeof Y.Doc!=='function'||!(privateDoc instanceof Y.Doc)||
    privateDoc.isDestroyed||privateDoc.store.pendingStructs||privateDoc.store.pendingDs||
    typeof send!=='function'||typeof getCredentials!=='function'||
    typeof isVisible!=='function'||!Number.isFinite(timeoutMs)||timeoutMs<200||timeoutMs>12000||
    (onWriterConflict!==null&&typeof onWriterConflict!=='function')||
    !isVisible())throw fail();

 // Local-only display projection; its Yjs structs are discarded immediately.
 let expected;
 const projected=projectPublicCatalog({sourceDoc:privateDoc,Y,room,channel:'cat',
  frozenHead:expectedFrozenHead});
 try{expected=canon(projected.doc);}finally{projected.doc.destroy();}

 // 1) Certified HEAD with a read-only one-use ticket (never replayed for WS).
 const proofTicket=createOwnerTicketParams({licenseCode,instanceId,room,
  catalogReadOnly:true,getCredentials,fetch:send});
 const proofParams=await proofTicket();
 if(!isVisible()||privateDoc.isDestroyed)throw fail();
 const controller=new AbortController();
 const timer=setTimeout(()=>controller.abort(),timeoutMs);
 let body;
 try{
  const response=await send('https://'+HOST+'/parties/tienda/'+room+'?frozen-proof=1',{
   method:'GET',mode:'cors',cache:'no-store',credentials:'omit',redirect:'error',
   referrerPolicy:'no-referrer',signal:controller.signal,headers:{
    'authorization':'Bearer '+proofParams.cap,
    'x-f123-license':licenseCode,'x-f123-instance':instanceId
   }
  });
  if(!response?.ok)throw fail();
  body=await response.json();
 }catch(_){throw fail();}
 finally{clearTimeout(timer);}
 if(!isVisible()||privateDoc.isDestroyed||
    body?.ok!==true||body.room!==room||body.channel!=='cat'||
    // JFC 22 nov 2026: el servidor 2.0 puede abrir la sala de la tienda vacia ('sala-vacia'); se acepta y se llena abajo.
    (body.frozenHead!==expectedFrozenHead&&body.frozenHead!=='sala-vacia')||!SHA.test(body.stateSha256||'')||
    !SHA.test(body.vectorSha256||'')||
    Object.keys(body).sort().join(',')!=='channel,frozenHead,ok,room,stateSha256,vectorSha256')
  throw fail();

 // 2) Fresh writer ticket (cat:read+cat:write) for an EMPTY public Y.Doc.
 const params=createOwnerTicketParams({licenseCode,instanceId,room,getCredentials,fetch:send});
 const publicDoc=new Y.Doc({gc:true});
 let provider,closed=false,active=false;
 const listeners=[];
 function listen(name,fn){provider.on(name,fn);listeners.push([name,fn]);}
 function close(){
  if(closed)return;
  closed=true;active=false;
  for(const [name,fn] of listeners.splice(0))try{provider?.off?.(name,fn);}catch(_){}
  try{provider?.destroy?.();}finally{publicDoc.destroy();}
 }
 try{
  if(typeof createProvider==='function')
   provider=createProvider({doc:publicDoc,room,channel:'cat',params,
    readOnly:false,purpose:'certified-single-writer-catalog-delta'});
  else{
   const {default:AuthorizedYProvider}=await import('./authorized-yprovider.mjs');
   provider=new AuthorizedYProvider(HOST,room,publicDoc,{
    party:'tienda',params,disableBc:true,connect:false,maxBackoffTime:7500
   });
  }
  if(!provider||typeof provider.on!=='function'||
     typeof provider.connect!=='function'||typeof provider.destroy!=='function')throw fail();

  await new Promise((resolve,reject)=>{
   let finished=false;
   const local=[];
   const on=(name,fn)=>{provider.on(name,fn);local.push([name,fn]);};
   const done=error=>{
    if(finished)return;
    finished=true;clearTimeout(t);
    for(const [name,fn] of local)provider.off?.(name,fn);
    error?reject(error):resolve();
   };
   on('synced',synced=>{if(synced===true)done();});
   on('authorization-error',()=>done(fail()));
   on('connection-close',event=>{
    const {code,reason}=closeCode(event);
    if(code===1008)done(fail(reason===CONFLICT_REASON?'writer-conflict':'writer-denied'));
   });
   const t=setTimeout(()=>done(fail('writer-timeout')),timeoutMs);
   try{Promise.resolve(provider.connect()).catch(()=>done(fail()));}
   catch(_){done(fail());}
  });

  if(!isVisible()||privateDoc.isDestroyed||
     publicDoc.store.pendingStructs||publicDoc.store.pendingDs)throw fail();
  // Remote roots arrive as untyped AbstractType until first getMap(); bind the
  // two allowed public roots so the canonical allowlist can inspect them.
  // Any other remote root stays untyped and is still refused by name below.
  publicDoc.getMap('productos');publicDoc.getMap('ubicaciones');
  assertPublicCatalogTransportDoc({doc:publicDoc,room});
  // JFC 22 nov 2026: tienda abierta en 2.0 SIN historia certificada ('sala-vacia'). Si el servidor esta vacio,
  // este aparato (con su cuaderno completo y sin pendientes) lo llena con su catalogo PUBLICO; Yjs suma, no borra.
  if(body.frozenHead==='sala-vacia'&&
     publicDoc.getMap('productos').size===0&&publicDoc.getMap('ubicaciones').size===0){
   const seed=projectPublicCatalog({sourceDoc:privateDoc,Y,room,channel:'cat',frozenHead:expectedFrozenHead});
   try{Y.applyUpdate(publicDoc,Y.encodeStateAsUpdate(seed.doc));}finally{seed.doc.destroy();}
   assertPublicCatalogTransportDoc({doc:publicDoc,room});
  }
  // Never write over a baseline that differs from the certified local view.
  if(canon(publicDoc)!==expected)throw fail();
 }catch(error){
  close();
  throw error?.code?error:fail();
 }

 // Runtime: a policy close (another writer / revocation) ends this writer.
 // No silent reconnection loop and no fallback writer.
 const revoke=conflict=>{
  if(closed)return;
  close();
  if(conflict&&typeof onWriterConflict==='function'){
   try{onWriterConflict(Object.freeze({reason:CONFLICT_REASON}));}catch(_){}
  }
 };
 listen('connection-close',event=>{
  const {code,reason}=closeCode(event);
  if(code===1008)revoke(reason===CONFLICT_REASON);
 });
 listen('authorization-error',()=>revoke(false));
 active=true;

 return Object.freeze({
  frozenHead:body.frozenHead,
  readOnly:false,
  isActive(){return active&&!closed;},
  applyDelta(delta){
   if(closed||!active)throw new Error('catalog writer inactive');
   if(!isVisible())throw new Error('catalog writer hidden; delta refused');
   const {root,id,row}=parseDelta(Y,room,delta);
   let byteLength=0;
   const count=u=>{byteLength+=u.byteLength;};
   publicDoc.on('update',count);
   try{
    publicDoc.transact(()=>{
     const map=publicDoc.getMap(root);
     if(row)map.set(id,row);else map.delete(id);
    },ORIGIN);
   }finally{publicDoc.off('update',count);}
   return Object.freeze({ok:true,kind:delta.kind,id,byteLength});
  },
  display(){
   if(closed||!isVisible())return null;
   try{
    assertPublicCatalogTransportDoc({doc:publicDoc,room});
    return Object.freeze({
     productos:structuredClone(publicDoc.getMap('productos').toJSON()),
     ubicaciones:structuredClone(publicDoc.getMap('ubicaciones').toJSON())
    });
   }catch(_){close();return null;}
  },
  close
 });
}
