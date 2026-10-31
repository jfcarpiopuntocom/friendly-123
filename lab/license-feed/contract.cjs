'use strict';
// Prototype ONLY: encrypted-envelope transport contract for #2, after #3/#1/#5.
// No PIN verification, encryption keys, HTTP auth, database or live customer writes.
// Production adapters must supply signed, revocable sessions and one durable store.
const {createHash}=require('node:crypto');
const MAX_BYTES=64*1024, MAX_PAGE=100;
const sha=b=>createHash('sha256').update(b).digest('hex');
function createFeed({authorize,storage,maxEventsPerNotebook=1000}={}){
 if(typeof authorize!=='function'||!storage||typeof storage!=='object')
  throw Error('external server-authorized session and shared durable storage required');
 const auth=(token)=>{
  const s=authorize(token);
  if(!s||typeof s.notebookId!=='string'||!s.notebookId||
    typeof s.licenseId!=='string'||!s.licenseId||typeof s.deviceId!=='string'||!s.deviceId||
    !Number.isSafeInteger(s.pinRevision)||s.pinRevision<1||
    !Number.isSafeInteger(s.expiresAt)||s.expiresAt<=Date.now())
   throw Error('unauthorized-or-stale-session');
  return s;
 };
 const log=(s)=>{
  // A/B gateway can only view the same shared storage object. NEVER create
  // a separate per-gateway list, which silently forks the notebook.
  if(!storage[s.notebookId])storage[s.notebookId]={events:[],index:new Map(),receipts:new Map()};
  return storage[s.notebookId];
 };
 function append(token,body){
  const s=auth(token);
  if(!body||body.notebookId!==s.notebookId||typeof body.opId!=='string'||
     !/^[A-Za-z0-9_-]{8,100}$/.test(body.opId)||
     typeof body.ciphertext!=='string'||!body.ciphertext||
     !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(body.ciphertext)||
     typeof body.sha256!=='string'||!/^[a-f0-9]{64}$/.test(body.sha256)||
     !Array.isArray(body.parents)||body.parents.length>24||
     body.parents.some(p=>typeof p!=='string'||!/^[A-Za-z0-9_-]{8,100}$/.test(p))||
     Object.keys(body).some(k=>!['notebookId','opId','ciphertext','sha256','parents'].includes(k)))
   throw Error('invalid-envelope');
  const bytes=Buffer.from(body.ciphertext,'base64');
  if(bytes.length===0||bytes.length>MAX_BYTES||sha(bytes)!==body.sha256)
   throw Error('invalid-encrypted-payload');
  const db=log(s),existing=db.index.get(body.opId);
  if(existing){
   if(existing.sha256!==body.sha256)throw Error('event-id-conflict');
   return {seq:existing.seq,duplicate:true,durable:false}; // lab has no durable DB!
  }
  if(db.events.length>=maxEventsPerNotebook)throw Error('quota-exceeded');
  const record=Object.freeze({seq:db.events.length+1,opId:body.opId,
   sha256:body.sha256,ciphertext:body.ciphertext,parents:Object.freeze([...body.parents])});
  db.index.set(record.opId,record);db.events.push(record);
  return {seq:record.seq,duplicate:false,durable:false};
 }
 function page(token,{after=0,limit=MAX_PAGE}={}){
  const s=auth(token);
  if(!Number.isSafeInteger(after)||after<0||!Number.isSafeInteger(limit)||limit<1)throw Error('invalid-cursor');
  const db=log(s),subset=db.events.slice(after,after+Math.min(limit,MAX_PAGE));
  const cursor=subset.length?subset[subset.length-1].seq:after;
  return {notebookId:s.notebookId,cursor,hasMore:db.events.length>cursor,
   envelopes:subset.map(({seq,opId,sha256,ciphertext,parents})=>({seq,opId,sha256,ciphertext,parents:[...parents]}))};
 }
 function receipt(token,{cursor,appliedDigest}={}){
  const s=auth(token),db=log(s);
  if(!Number.isSafeInteger(cursor)||cursor<0||cursor>db.events.length||
     typeof appliedDigest!=='string'||!/^[a-f0-9]{64}$/.test(appliedDigest))
   throw Error('invalid-receipt');
  const prior=db.receipts.get(s.deviceId)||{cursor:0};
  if(cursor<prior.cursor)throw Error('cursor-rollback');
  const record={deviceId:s.deviceId,cursor,appliedDigest};
  db.receipts.set(s.deviceId,record);
  // Does NOT claim client durable ACK. Production receiver must persist to IDB
  // before sending and server must verify signed device-level receipts.
  return {accepted:true,transportAcknowledged:true,allReplicasApplied:false};
 }
 return {append,page,receipt};
}
module.exports={createFeed,MAX_BYTES};
