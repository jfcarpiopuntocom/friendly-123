// C12: public, READ-ONLY cold-join to the already-certified YParty -cat room.
// The private Sync3 Y.Doc never crosses this boundary; no public re-seeding,
// no economic writes and no change to the active encrypted legacy relay.
import {createOwnerTicketParams} from './ws-owner-ticket-params.mjs';
import {createTeamTicketParams} from './ws-team-ticket-params.mjs';
import {projectPublicCatalog,assertPublicCatalogTransportDoc} from '../cloudflare-yparty-worker/src/catalog-safe-projection.mjs';

const ROOM=/^[a-f0-9]{32}-cat$/,HEAD=/^[A-Za-z0-9_.:-]{3,128}$/,SHA=/^[a-f0-9]{64}$/;
const HOST='friendly123-yparty-port2-canary-qa.jfcarpio.workers.dev';
const fail=()=>new Error('certified read-only catalog unavailable');
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
function safePublic(doc,room){
 assertPublicCatalogTransportDoc({doc,room});
 return Object.freeze({
  productos:structuredClone(doc.getMap('productos').toJSON()),
  ubicaciones:structuredClone(doc.getMap('ubicaciones').toJSON())
 });
}
export async function openCertifiedReadOnlyPublicCatalog({
 privateDoc,Y,room,licenseCode,instanceId,expectedFrozenHead,
 getCredentials,createProvider,fetch:send=globalThis.fetch?.bind(globalThis),
 isVisible=()=>globalThis.document?.hidden!==true,timeoutMs=6000
}={}){
 if(!ROOM.test(room||'')||!HEAD.test(expectedFrozenHead||'')||
    !Y||typeof Y.Doc!=='function'||!(privateDoc instanceof Y.Doc)||
    privateDoc.isDestroyed||privateDoc.store.pendingStructs||privateDoc.store.pendingDs||
    typeof send!=='function'||typeof getCredentials!=='function'||
    typeof isVisible!=='function'||!Number.isFinite(timeoutMs)||timeoutMs<200||timeoutMs>12000||
    !isVisible())throw fail();
 // Local-only projection, built from explicitly allowed fields. Its Yjs
 // structs/clientID are discarded and NEVER given to any network provider.
 let expected;
 const projected=projectPublicCatalog({sourceDoc:privateDoc,Y,room,channel:'cat',
  frozenHead:expectedFrozenHead});
 try{expected=canon(projected.doc)}finally{projected.doc.destroy();}
 const ticket=()=>{
  const sample=getCredentials();
  if(sample&&sample.kind==='team'){
   return createTeamTicketParams({licenseCode,instanceId,room,
    scope:'cat:read',getCredentials,fetch:send});
  }
  return createOwnerTicketParams({licenseCode,instanceId,room,
   catalogReadOnly:true,getCredentials,fetch:send});
 };
 // One use for HTTP certificate, and another fresh use for WS. In particular,
 // a proof token may never be replayed for socket admission.
 const params=ticket();
 const proofParams=await params();
 if(!isVisible()||privateDoc.isDestroyed)throw fail();
 const controller=new AbortController();
 const proofTimer=setTimeout(()=>controller.abort(),timeoutMs);
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
 finally{clearTimeout(proofTimer);}
 if(!isVisible()||privateDoc.isDestroyed||
    body?.ok!==true||body.room!==room||body.channel!=='cat'||
    (body.frozenHead!==expectedFrozenHead&&body.frozenHead!=='sala-vacia')||!SHA.test(body.stateSha256||'')||
    !SHA.test(body.vectorSha256||'')||
    Object.keys(body).sort().join(',')!=='channel,frozenHead,ok,room,stateSha256,vectorSha256')
   throw fail();
 // Critical: unlike C8's local display snapshot, this Y.Doc starts EMPTY.
 // No re-authoring, no duplicated clientID, and no private material in Yjs.
 const publicDoc=new Y.Doc({gc:true});
 let provider,closed=false,ready=false;
 function close(){
  if(closed)return;
  closed=true;ready=false;
  try{provider?.destroy?.()}finally{publicDoc.destroy();}
 }
 try{
  if(typeof createProvider==='function')
   provider=createProvider({doc:publicDoc,room,channel:'cat',params,
    readOnly:true,purpose:'certified-readonly-cold-join'});
  else {
   // Lazy-load the shipped provider only when no injected provider exists.
   // Browser-side C12 unit tests use the actual policy and a synthetic socket,
   // without depending on Node's package resolution outside Worker QA.
   const {default:AuthorizedYProvider}=await import('./authorized-yprovider.mjs');
   provider=new AuthorizedYProvider(HOST,room,publicDoc,{
    party:'tienda',params,disableBc:true,connect:false,maxBackoffTime:7500
   });
  }
  if(!provider||typeof provider.on!=='function'||
     typeof provider.connect!=='function'||typeof provider.destroy!=='function')throw fail();
  await new Promise((resolve,reject)=>{
   let finished=false;
   const cleanup=()=>{
    clearTimeout(timer);
    provider.off?.('synced',onSync);
    provider.off?.('authorization-error',onError);
   };
   const done=error=>{
    if(finished)return;
    finished=true;cleanup();
    error?reject(fail()):resolve();
   };
   const onSync=synced=>{if(synced===true)done();};
   const onError=()=>done(true);
   const timer=setTimeout(()=>done(true),timeoutMs);
   provider.on('synced',onSync);
   provider.on('authorization-error',onError);
   try{Promise.resolve(provider.connect()).catch(()=>done(true));}
   catch(_){done(true);}
  });
  if(!isVisible()||privateDoc.isDestroyed||
     publicDoc.store.pendingStructs||publicDoc.store.pendingDs)throw fail();
  // YParty sends remote Yjs structs as AbstractType placeholders until
  // getMap() binds them. The old C12 fake-provider tests wrote through
  // getMap() directly and accidentally hid the real cold-join failure.
  // Materialize ONLY these two publicly permitted roots; C9 still validates
  // ALL root names and row fields, rejecting private/economic roots.
  if(body.frozenHead==='sala-vacia'){
   publicDoc.getMap('productos');
   publicDoc.getMap('ubicaciones');
  }else if(!publicDoc.share.has('productos')||!publicDoc.share.has('ubicaciones')){
   throw fail();
  }else{
   publicDoc.getMap('productos');
   publicDoc.getMap('ubicaciones');
  }
  assertPublicCatalogTransportDoc({doc:publicDoc,room});
  // Compare DISPLAY state, never Yjs byte history/clientIDs, to avoid treating
  // re-authored local structs as a valid certified remote baseline.
  const localEmpty=expected==='{"productos":{},"ubicaciones":{}}';
  if(!(body.frozenHead==='sala-vacia'&&localEmpty)&&canon(publicDoc)!==expected)throw fail();
  ready=true;
  return Object.freeze({
   frozenHead:body.frozenHead,readOnly:true,
   isClosed:()=>closed,
   isActive:()=>ready&&!closed&&isVisible(),
   display(){
    if(!ready||closed||!isVisible())return null;
    try{return safePublic(publicDoc,room)}catch(_){close();return null;}
   },
   close
  });
 }catch(_){close();throw fail();}
}
