// PORT 2.0 · browser boundary between PRIVATE Sync3 Y.Doc and PUBLIC YParty catalog.
// QA-only, one-shot display snapshot. This module never opens a socket, reads
// a PIN, changes the private document, attaches private updates or creates a
// second live catalog writer. A caller must supply an authenticated provider
// backed by server-issued scoped tickets; UI role is NOT server authority.
//
// Reuse EXACT production Cloudflare allowlist: products/shelves only.
// Do NOT wire this bridge into the legacy pilot before its file reservations,
// frozen source, authoritative writer and role/capability checks are cleared.
import {projectPublicCatalog} from '../cloudflare-yparty-worker/src/catalog-safe-projection.mjs';

const ROOM=/^[a-f0-9]{32}-cat$/;
const HEAD=/^[A-Za-z0-9_.:-]{3,128}$/;
const refuse=()=>new Error('public catalog QA scope unavailable');

// Defence in depth: the provider MUST validate before super() can create a
// socket. Merely projecting for display is not enough: a raw private Y.Doc
// may carry sensitive roots or extra fields hidden inside allowed roots.
export function assertPublicCatalogTransportDoc({doc,room}={}){
 if(!ROOM.test(room||'')||!doc||doc.isDestroyed||!doc.store||
    typeof doc.getMap!=='function'||!doc.share?.keys)
  throw new Error('public catalog transport scope invalid');
 if(doc.store.pendingStructs||doc.store.pendingDs)
  throw new Error('public catalog transport pending Yjs ancestry');
 for(const root of doc.share.keys()){
  if(root!=='productos'&&root!=='ubicaciones')
   throw new Error('private Yjs root cannot enter public catalog transport');
 }
 const verified=projectPublicCatalog({
  sourceDoc:doc,Y:{Doc:doc.constructor}
 });
 try{
  for(const root of ['productos','ubicaciones']){
   const original=doc.share.get(root);
   if(!original)continue;
   const allowed=verified.doc.getMap(root);
   if(original.size!==allowed.size)
    throw new Error('private catalog row mismatch');
   original.forEach((row,id)=>{
    const safe=allowed.get(id);
    if(!row||typeof row!=='object'||Array.isArray(row)||!safe)
     throw new Error('private catalog row rejected');
    const keys=Object.keys(row),normal=Object.keys(safe);
    if(keys.length!==normal.length||
       keys.some(k=>!Object.prototype.hasOwnProperty.call(safe,k)||row[k]!==safe[k]))
     throw new Error('private catalog field rejected before websocket');
   });
  }
  return true;
 }finally{verified.doc.destroy();}
}

export function createPublicCatalogBridge({
 privateDoc,Y,room,frozenHead,qaEnabled=false,localReady=false,
 isOwner,createProvider
}={}){
 // A missing/disabled QA opt-in must not trigger any storage, token or socket.
 if(qaEnabled!==true||localReady!==true)return null;
 if(typeof isOwner!=='function'||typeof createProvider!=='function')
  throw refuse();
 let owner=false;
 try{owner=isOwner()===true;}catch(_){return null;}
 if(!owner)return null;
 if(!ROOM.test(room||'')||!HEAD.test(frozenHead||'')||
    !Y||typeof Y.Doc!=='function'||
    !(privateDoc instanceof Y.Doc)||privateDoc.isDestroyed)
  throw refuse();
 if(privateDoc.store.pendingStructs||privateDoc.store.pendingDs)
  throw new Error('incomplete public catalog source: pending Yjs ancestry');

 // NEVER supply the original Y.Doc or its update bytes to a provider.
 // The established server-side field allowlist rejects malformed prices/stock
 // and strips _meta, payment data, contacts, costs, photos and unknown fields.
 const projection=projectPublicCatalog({sourceDoc:privateDoc,Y,room,channel:'cat',frozenHead});
 let publicDoc,provider;
 const frozenProjectionClientID=projection.doc.clientID;
 try{
  // The immutable frozen projection uses a deterministic clientID. A live
  // YParty *publisher* must not reuse it or remote writers would collide.
  // Reauthor only sanitized JavaScript values in a fresh, isolated Y.Doc.
  publicDoc=new Y.Doc({gc:true});
  if(publicDoc.clientID===frozenProjectionClientID)
   publicDoc.clientID=(frozenProjectionClientID+1)>>>0;
  publicDoc.transact(()=>{
   for(const root of ['productos','ubicaciones']){
    const target=publicDoc.getMap(root);
    projection.doc.getMap(root).forEach((row,id)=>target.set(id,{...row}));
   }
  },'qa-public-only-authoring');
  if(publicDoc.store.pendingStructs||publicDoc.store.pendingDs)
   throw new Error('public projection causal gap');
  if([...publicDoc.share.keys()].some(name=>name!=='productos'&&name!=='ubicaciones'))
   throw new Error('private catalog root cannot be published');
  // This factory must enforce a signed Owner ticket with cat:write on the
  // actual Worker; no bare room/license grants publication.
  provider=createProvider({doc:publicDoc,room,channel:'cat',purpose:'qa-public-display-snapshot'});
  if(!provider||typeof provider.destroy!=='function')
   throw new Error('public provider must be revocable');
  let closed=false;
  return Object.freeze({
   frozenProjectionClientID,
   // Only allowlisted plain JS values, never raw mutable source Y.Doc.
   display(){
    if(closed)return null;
    const safe=projectPublicCatalog({sourceDoc:publicDoc,Y,room,channel:'cat',frozenHead});
    try{
     return Object.freeze({
      productos:Object.freeze(safe.doc.getMap('productos').toJSON()),
      ubicaciones:Object.freeze(safe.doc.getMap('ubicaciones').toJSON())
     });
    }finally{safe.doc.destroy();}
   },
   close(){
    if(closed)return;
    closed=true;
    try{provider.destroy()}finally{publicDoc.destroy()}
   }
  });
 }catch(error){
  try{provider?.destroy?.()}catch(_){}
  try{publicDoc?.destroy()}catch(_){}
  throw error;
 }finally{
  projection.doc.destroy();
 }
}
