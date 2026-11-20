// Offline / read-only Firebase RTDB -> Yjs/R2 frozen HEAD certifier for friendly-123 PORT 2.0.
// Never mutates Firebase/R2, never logs license codes, keys, PINs, or customer data,
// and never bypasses frozen-r2-packager.mjs or certified-frozen-import.mjs contracts.
import * as Y from 'yjs';
import {createHash,webcrypto} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {prepareImportedOpsBaseline} from '../src/frozen-ops-baseline.mjs';
import {packFrozenR2Archive} from './frozen-r2-packager.mjs';

const SALT='amigable-sync-v1';
const B64=/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const HEAD=/^[A-Za-z0-9_.:-]{3,128}$/;
const MAX_RECORDS=16384;
const MAX_FRAME_CIPHER=1450000;
const MAX_OPS_WIRE=12*1024*1024;
const MAX_CAT_WIRE=24*1024*1024;
const PUBLIC_CAT_ROOTS=new Set(['productos','ubicaciones']);

const fail=reason=>{throw new Error('firebase frozen certifier refused: '+reason);};
const shaHex=bytes=>createHash('sha256').update(bytes).digest('hex');

function framesDigest(frames){
 const h=createHash('sha256');
 const len=Buffer.allocUnsafe(4);
 for(const frame of frames){
  len.writeUInt32BE(frame.byteLength,0);
  h.update(len);
  h.update(frame);
 }
 return h.digest('hex');
}

function normalizeLicense(codigo){
 if(typeof codigo!=='string')fail('invalid license format');
 const normalized=codigo.trim().toUpperCase();
 if(normalized.length<6||normalized.length>80)fail('invalid license format');
 return normalized;
}

export async function deriveFirebaseCertifierBindings(codigo){
 const normalized=normalizeLicense(codigo);
 const enc=new TextEncoder();
 const fbHash=createHash('sha256').update('amigable-sala:'+normalized).digest('hex').slice(0,40);
 const ypHash=createHash('sha256').update('f123-yparty-v1:'+normalized).digest('hex').slice(0,32);
 const base=await webcrypto.subtle.importKey('raw',enc.encode(normalized),'PBKDF2',false,['deriveKey']);
 const aesKey=await webcrypto.subtle.deriveKey(
  {name:'PBKDF2',salt:enc.encode(SALT),iterations:100000,hash:'SHA-256'},
  base,{name:'AES-GCM',length:256},false,['decrypt']
 );
 return Object.freeze({
  firebaseRoom40:fbHash,
  ypartyRoom32:ypHash,
  firebasePaths:Object.freeze({
   y:'/f123/'+fbHash+'-y',
   ops:'/f123/'+fbHash+'-ops',
   fotos:'/f123/'+fbHash+'-fotos',
   legacy:'/f123/'+fbHash
  }),
  ypartyRooms:Object.freeze({
   cat:ypHash+'-cat',
   ops:ypHash+'-ops'
  }),
  aesKey
 });
}

function decodeBase64Cipher(c){
 if(typeof c!=='string'||!c.length||c.length>MAX_FRAME_CIPHER||c.length%4!==0||!B64.test(c)){
  fail('invalid Firebase ciphertext encoding');
 }
 const raw=Buffer.from(c,'base64');
 if(raw.byteLength<29||raw.toString('base64')!==c){
  fail('invalid Firebase ciphertext encoding');
 }
 return new Uint8Array(raw.buffer,raw.byteOffset,raw.byteLength);
}

async function decryptRecordBytes(aesKey,c){
 const encrypted=decodeBase64Cipher(c);
 const iv=encrypted.subarray(0,12);
 const cipher=encrypted.subarray(12);
 try{
  const plain=await webcrypto.subtle.decrypt({name:'AES-GCM',iv},aesKey,cipher);
  return new Uint8Array(plain);
 }catch(_){
  fail('decrypt auth failed');
 }
}

function collectOrderedRecords(snapshot){
 if(!snapshot||typeof snapshot!=='object'||Array.isArray(snapshot)){
  fail('invalid snapshot envelope');
 }
 const kEntries=[];
 if(snapshot.k!=null){
  if(typeof snapshot.k!=='object'||Array.isArray(snapshot.k))fail('invalid checkpoint map');
  for(const [revKey,val] of Object.entries(snapshot.k)){
   if(!/^[1-9][0-9]{0,8}$/.test(revKey))fail('invalid checkpoint revision key');
   if(!val||typeof val!=='object'||typeof val.s!=='number'||!Number.isFinite(val.s)||val.s<0||typeof val.c!=='string'){
    fail('invalid checkpoint record');
   }
   kEntries.push({source:'k',rev:Number(revKey),key:revKey,s:val.s,c:val.c});
  }
  kEntries.sort((a,b)=>a.rev-b.rev);
 }
 const oEntries=[];
 if(snapshot.o!=null){
  if(typeof snapshot.o!=='object'||Array.isArray(snapshot.o))fail('invalid ops map');
  for(const [pushKey,val] of Object.entries(snapshot.o)){
   if(!pushKey||!val||typeof val!=='object'||typeof val.s!=='number'||!Number.isFinite(val.s)||val.s<0||typeof val.c!=='string'){
    fail('invalid operation record');
   }
   oEntries.push({source:'o',rev:null,key:pushKey,s:val.s,c:val.c});
  }
  // Exact tie-breaking rule from docs/firebase-relay.js:87-94
  oEntries.sort((a,b)=>a.s-b.s||(a.key<b.key?-1:a.key>b.key?1:0));
 }
 const total=kEntries.length+oEntries.length;
 if(total<1||total>MAX_RECORDS)fail('record count out of safe budget');
 return {kEntries,oEntries};
}

function unwrapUpdate(tag,payload,maxWireBytes){
 if(tag===0){
  if(!payload.byteLength||payload.byteLength>maxWireBytes)fail('invalid Yjs update payload');
  return new Uint8Array(payload);
 }
 if(tag===7){
  let plain;
  try{
   plain=gunzipSync(payload,{maxOutputLength:maxWireBytes});
  }catch(_){
   fail('invalid or overbudget gzip checkpoint');
  }
  if(!plain.byteLength||plain.byteLength>maxWireBytes)fail('invalid gzip Yjs payload');
  return new Uint8Array(plain.buffer,plain.byteOffset,plain.byteLength);
 }
 fail('unsupported durable wire tag '+tag);
}

function identicalBytes(a,b){
 if(a.byteLength!==b.byteLength)return false;
 for(let i=0;i<a.byteLength;i++)if(a[i]!==b[i])return false;
 return true;
}

async function decodeStream({entries,aesKey,maxWireBytes}){
 const fragments=new Map();
 const updates=[];
 let wireSum=0;
 const pushUpdate=(entry,bytes)=>{
  wireSum+=bytes.byteLength;
  if(!Number.isSafeInteger(wireSum)||wireSum>maxWireBytes)fail('decoded wire budget exceeded');
  updates.push({source:entry.source,rev:entry.rev,s:entry.s,bytes});
 };
 for(const entry of entries){
  const bytes=await decryptRecordBytes(aesKey,entry.c);
  if(bytes.byteLength<1)fail('empty wire frame');
  const tag=bytes[0];
  if(tag===3){
   if(bytes.byteLength<22)fail('malformed fragment frame');
   const original=bytes[1];
   let id='';
   for(let q=2;q<18;q++)id+=String.fromCharCode(bytes[q]);
   const index=bytes[18]*256+bytes[19];
   const total=bytes[20]*256+bytes[21];
   if(!total||index>=total)fail('invalid fragment bounds');
   let group=fragments.get(id);
   if(!group){
    group={tag:original,total,pieces:new Array(total),count:0,bytes:0};
    fragments.set(id,group);
   }
   if(group.total!==total||group.tag!==original)fail('conflicting fragment metadata');
   const piece=bytes.subarray(22);
   const existing=group.pieces[index];
   if(existing){
    if(!identicalBytes(existing,piece))fail('conflicting duplicate fragment');
    continue;
   }
   group.pieces[index]=new Uint8Array(piece);
   group.count++;
   group.bytes+=piece.byteLength;
   if(group.bytes>maxWireBytes)fail('reassembled fragment exceeds wire budget');
   if(group.count===total){
    fragments.delete(id);
    const merged=new Uint8Array(group.bytes);
    let offset=0;
    for(const p of group.pieces){merged.set(p,offset);offset+=p.byteLength;}
    pushUpdate(entry,unwrapUpdate(group.tag,merged,maxWireBytes));
   }
   continue;
  }
  pushUpdate(entry,unwrapUpdate(tag,bytes.subarray(1),maxWireBytes));
 }
 if(fragments.size>0)fail('incomplete fragment group');
 return updates;
}

function summarizeEventsSafely(doc){
 const eventos=doc.getMap('eventos');
 const kinds=Object.create(null);
 let unsafeEconomicPayloads=0;
 for(const [,val] of eventos){
  const k=val&&typeof val==='object'&&typeof val.kind==='string'?val.kind:'legacy-or-other';
  kinds[k]=(kinds[k]||0)+1;
  if(!val||typeof val!=='object'||Array.isArray(val))unsafeEconomicPayloads++;
 }
 return {kinds,unsafeEconomicPayloads};
}

function detectStaleCheckpoint({decodedK,decodedO,fullStateSha}){
 if(!decodedK.length)return false;
 const latestCkpt=decodedK[decodedK.length-1];
 const tailDoc=new Y.Doc();
 try{
  Y.applyUpdate(tailDoc,latestCkpt.bytes,'ckpt-probe');
  for(const op of decodedO){
   if(op.s>latestCkpt.s)Y.applyUpdate(tailDoc,op.bytes,'ckpt-probe');
  }
  if(tailDoc.store.pendingStructs||tailDoc.store.pendingDs)return true;
  return shaHex(Y.encodeStateAsUpdate(tailDoc))!==fullStateSha;
 }catch(_){
  return true;
 }finally{
  tailDoc.destroy();
 }
}

export async function certifyFirebaseChannelSnapshot({
 codigo,
 channel,
 snapshot,
 frozenHead='firebase-head-certified',
 bindings=null
}={}){
 if(!['cat','ops'].includes(channel))fail('channel must be cat or ops');
 if(typeof frozenHead!=='string'||!HEAD.test(frozenHead))fail('invalid frozenHead');
 const activeBindings=bindings||await deriveFirebaseCertifierBindings(codigo);
 const maxWireBytes=channel==='ops'?MAX_OPS_WIRE:MAX_CAT_WIRE;
 const {kEntries,oEntries}=collectOrderedRecords(snapshot);
 const decodedK=await decodeStream({entries:kEntries,aesKey:activeBindings.aesKey,maxWireBytes});
 const decodedO=await decodeStream({entries:oEntries,aesKey:activeBindings.aesKey,maxWireBytes});
 const allDecoded=[...decodedK,...decodedO];
 if(!allDecoded.length)fail('empty decoded history');
 const frames=allDecoded.map(u=>u.bytes);

 const doc=new Y.Doc();
 try{
  for(const f of frames){
   try{Y.applyUpdate(doc,f,'firebase-certifier');}
   catch(_){fail('corrupt Yjs binary frame');}
  }
  if(doc.store.pendingStructs||doc.store.pendingDs){
   fail('pending Yjs ancestors or deletes');
  }
  const roots=[...doc.share.keys()];
  if(channel==='ops'){
   for(const r of roots)if(r!=='eventos')fail('disallowed root in ops channel');
   doc.getMap('eventos');
  }else{
   doc.getMap('productos');
   doc.getMap('ubicaciones');
  }

  const stateBytes=Y.encodeStateAsUpdate(doc);
  const vectorBytes=Y.encodeStateVector(doc);
  const expectedStateSha256=shaHex(stateBytes);
  const expectedVectorSha256=shaHex(vectorBytes);
  const sourceFramesSha256=framesDigest(frames);
  const staleCheckpointDetected=detectStaleCheckpoint({decodedK,decodedO,fullStateSha:expectedStateSha256});

  let opsBaseline=null,eventSummary=null;
  if(channel==='ops'){
   opsBaseline=prepareImportedOpsBaseline(doc);
   eventSummary=summarizeEventsSafely(doc);
  }
  const privateRootsStripped=channel==='cat'?roots.filter(r=>!PUBLIC_CAT_ROOTS.has(r)):[];
  const room=activeBindings.ypartyRooms[channel];

  const externalProof=Object.freeze({
   sourceHead:frozenHead,
   completeToHead:true,
   sourceFramesSha256,
   expectedStateSha256,
   expectedVectorSha256,
   ...(channel==='ops'?{expectedOpIds:opsBaseline.count}:{})
  });
  const certification=Object.freeze({
   channel,
   room,
   frozenHead,
   checkpointRevs:decodedK.map(k=>k.rev),
   opsRecordCount:decodedO.length,
   frameCount:frames.length,
   staleCheckpointDetected,
   pendingStructsCount:0,
   pendingDs:false,
   expectedStateSha256,
   expectedVectorSha256,
   sourceFramesSha256,
   ...(channel==='ops'?{
    opIdsCount:opsBaseline.count,
    opsBaselineDigest:opsBaseline.digest,
    eventKinds:eventSummary.kinds,
    unsafeEconomicPayloads:eventSummary.unsafeEconomicPayloads
   }:{
    privateRootsStripped
   })
  });
  return {frames,room,frozenHead,externalProof,certification};
 }finally{
  doc.destroy();
 }
}

export async function packFirebaseFrozenR2Bundle({
 codigo,
 frozenHead,
 ySnapshot,
 opsSnapshot,
 limits
}={}){
 if(typeof frozenHead!=='string'||!HEAD.test(frozenHead))fail('invalid frozenHead');
 const bindings=await deriveFirebaseCertifierBindings(codigo);
 const opsCert=await certifyFirebaseChannelSnapshot({
  codigo,channel:'ops',snapshot:opsSnapshot,frozenHead,bindings
 });
 const catCert=await certifyFirebaseChannelSnapshot({
  codigo,channel:'cat',snapshot:ySnapshot,frozenHead,bindings
 });
 const [opsArchive,catArchive]=await Promise.all([
  packFrozenR2Archive({
   room:opsCert.room,channel:'ops',frozenHead,frames:opsCert.frames,
   externalProof:opsCert.externalProof,limits
  }),
  packFrozenR2Archive({
   room:catCert.room,channel:'cat',frozenHead,frames:catCert.frames,
   externalProof:catCert.externalProof,limits
  })
 ]);
 const publicBindings=Object.freeze({
  firebaseRoom40:bindings.firebaseRoom40,
  ypartyRoom32:bindings.ypartyRoom32,
  firebasePaths:bindings.firebasePaths,
  ypartyRooms:bindings.ypartyRooms
 });
 return {
  bindings:publicBindings,
  ops:{certification:opsCert.certification,externalProof:opsCert.externalProof,archive:opsArchive},
  cat:{certification:catCert.certification,externalProof:catCert.externalProof,archive:catArchive}
 };
}
