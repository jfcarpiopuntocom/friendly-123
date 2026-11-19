import * as Y from 'yjs';
import {projectPublicCatalog,F123_PUBLIC_PROJECTION_VERSION} from './catalog-safe-projection.mjs';

// Gate D: server-only pre-cut history from an independently certified source.
// Every page uses a private Service Binding with the same scoped grant.
// No browser-supplied frames, GET import route, live Cloudflare mutation or auto-switch.
const MAX_WIRE=16*1024*1024; // JSON bytes per page
const MAX_FRAMES=4096;      // frames per page
const MAX_FRAME=4*1024*1024;
const MAX_PAGES=8; // Until SQL staging + bounded final Yjs proof is verified
const MAX_TOTAL_FRAMES=16384;
const MAX_TOTAL_BYTES=24*1024*1024; // -cat pending bounded SQL staging
const MAX_OPS_WIRE=12*1024*1024; // -ops D5: reject BEFORE Yjs validator and merge
const PAGE_TIMEOUT_MS=5000;
const GLOBAL_TIMEOUT_MS=120000;
const ROOM=/^[a-f0-9]{32}-(?:cat|ops)$/;
const HASH=/^[a-f0-9]{64}$/;
const HEAD=/^[A-Za-z0-9_.:-]{3,128}$/;
const B64=/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const fail=()=>new Error('trusted frozen history unavailable');
const utf8=new TextEncoder();

async function sha(bytes){
 const hash=await crypto.subtle.digest('SHA-256',bytes);
 return Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join('');
}
async function readLimited(response,signal){
 if(!response?.ok||!response.body||signal?.aborted)throw fail();
 const reader=response.body.getReader(),parts=[];let size=0;
 try{
  for(;;){
   if(signal?.aborted)throw fail();
   const {value,done}=await reader.read();
   if(done)break;
   if(!(value instanceof Uint8Array))throw fail();
   size+=value.byteLength;
   if(size>MAX_WIRE)throw fail();
   parts.push(value);
  }
  if(size<2)throw fail();
  const all=new Uint8Array(size);let off=0;
  for(const p of parts){all.set(p,off);off+=p.length;}
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(all));
 }catch(_){try{await reader.cancel()}catch(_){}throw fail()}
 finally{try{reader.releaseLock()}catch(_){}}
}
function metadata(body,room,channel){
 if(body?.room!==room||body.channel!==channel||
  !HEAD.test(body.frozenHead||'')||!HASH.test(body.expectedStateSha256||'')||
  !HASH.test(body.expectedVectorSha256||'')||
  (channel==='ops'&&(!Number.isSafeInteger(body.expectedOpIds)||body.expectedOpIds<0))||
  (channel==='cat'&&body.expectedOpIds!==undefined)||
  (body.expectedProjectedSha256!==undefined&&
   (channel!=='cat'||!HASH.test(body.expectedProjectedSha256)||
    body.projectionVersion!==F123_PUBLIC_PROJECTION_VERSION))||
  (body.expectedProjectedSha256===undefined&&body.projectionVersion!==undefined))throw fail();
}
function legacyFrames(body,channel){
 if(body.completeToHead!==true||body.manifest!==undefined||
  !Array.isArray(body.frames)||body.frames.length<1||body.frames.length>MAX_FRAMES)throw fail();
 let total=0;
 return body.frames.map(f=>{
  if(!Array.isArray(f)||f.length<1||f.length>MAX_FRAME)throw fail();
  total+=f.length;
  if(total>(channel==='ops'?MAX_OPS_WIRE:MAX_WIRE))throw fail();
  for(const b of f)if(!Number.isInteger(b)||b<0||b>255)throw fail();
  return Uint8Array.from(f);
 });
}
function pagedFrames(body,index,anchor,nextFrameIndex,channel){
 const m=body.manifest;
 if(!m||!Number.isSafeInteger(m.chunk)||m.chunk!==index||
  !Number.isSafeInteger(m.chunks)||m.chunks<1||m.chunks>MAX_PAGES||
  !Number.isSafeInteger(m.bytes)||m.bytes<1||m.bytes>MAX_WIRE||
  !Number.isSafeInteger(m.totalBytes)||m.totalBytes<1||
  m.totalBytes>(channel==='ops'?MAX_OPS_WIRE:MAX_TOTAL_BYTES)||
  !HASH.test(m.sha256||'')||!HASH.test(m.rootSha256||'')||
  !Number.isSafeInteger(m.firstFrameIndex)||m.firstFrameIndex!==nextFrameIndex||
  !Number.isSafeInteger(m.frameCount)||m.frameCount!==body.frames?.length||
  body.completeToHead!==(index===m.chunks)||
  !Array.isArray(body.frames)||body.frames.length<1||body.frames.length>MAX_FRAMES)throw fail();
 if(anchor&&(m.chunks!==anchor.chunks||m.totalBytes!==anchor.totalBytes||
  m.rootSha256!==anchor.rootSha256))throw fail();
 let n=0;
 const frames=body.frames.map(s=>{
  if(typeof s!=='string'||!s.length||s.length>Math.ceil(MAX_FRAME/3)*4||
   s.length%4!==0||!B64.test(s))throw fail();
  const decoded=atob(s);
  if(!decoded.length||decoded.length>MAX_FRAME||btoa(decoded)!==s)throw fail();
  const bytes=new Uint8Array(decoded.length);
  for(let i=0;i<bytes.length;i++)bytes[i]=decoded.charCodeAt(i);
  n+=bytes.length;
  if(n>MAX_WIRE)throw fail();
  return bytes;
 });
 if(n!==m.bytes)throw fail();
 return frames;
}
async function pageDigest(frames){
 const total=frames.reduce((n,b)=>n+4+b.length,0),wire=new Uint8Array(total),v=new DataView(wire.buffer);
 let offset=0;
 for(const f of frames){
  v.setUint32(offset,f.byteLength,false);offset+=4;
  wire.set(f,offset);offset+=f.byteLength;
 }
 return sha(wire);
}
async function validateDocument(frames,channel,strictCatalog,scope={}){
 const doc=new Y.Doc();
 try{
  for(const frame of frames)Y.applyUpdate(doc,frame,'certified-service');
  if(doc.store.pendingStructs||doc.store.pendingDs)throw fail();
  if(channel==='ops'){
   for(const root of doc.share.keys())if(root!=='eventos')throw fail();
  }else{
   // Reject definitely private legacy collections in both wire formats.
   const forbidden=new Set(['_meta','ventas','gastos','transferencias',
    'hechos_financieros','usuarios','clientes','promotoras','dispositivos',
    '_stock_pn_testigos_v1']);
   for(const root of doc.share.keys())if(forbidden.has(root))throw fail();
   if(strictCatalog||[...doc.share.keys()].some(x=>x==='productos'||x==='ubicaciones')){
    // Actual catalog root names must be independently projected in V1 and V2;
    // the v2 manifest also forbids obsolete synthetic non-public root aliases.
    // The v2 manifest may transport ONLY the exact detached PUBLIC projection.
    for(const root of doc.share.keys())if(root!=='productos'&&root!=='ubicaciones')throw fail();
    // Y.applyUpdate creates untyped root placeholders; materialize the Y.Map
    // before the allowlist projector reads .forEach on the reconstructed root.
    doc.getMap('productos');doc.getMap('ubicaciones');
    const publicCopy=projectPublicCatalog({sourceDoc:doc,Y,room:scope.room,
      channel,frozenHead:scope.frozenHead});
    try{
     if(scope.expectedProjectedSha256&&
        await sha(publicCopy.bytes)!==scope.expectedProjectedSha256)throw fail();
     for(const name of ['productos','ubicaciones']){
      const source=doc.share.get(name),safe=publicCopy.doc.getMap(name);
      if(source?.size!==undefined&&source.size!==safe.size)throw fail();
      for(const [id,row] of safe.entries()){
       if(JSON.stringify(source?.get(id))!==JSON.stringify(row))throw fail();
      }
     }
    }finally{publicCopy.doc.destroy();}
   }
  }
 }finally{doc.destroy();}
}
// Each page is a fresh scoped server-to-server request. 401/403 never retry;
// only rate-limit/transient upstream failures get one additional attempt.
async function fetchSignedPage(env,room,channel,index,deadline){
 for(let attempt=0;attempt<2;attempt++){
  const remaining=deadline-Date.now();
  if(remaining<=0)throw fail();
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),Math.min(PAGE_TIMEOUT_MS,remaining));
  try{
   const request=new Request('https://internal-history-source.invalid/v1/frozen',{
    method:'POST',cache:'no-store',credentials:'omit',redirect:'manual',
    referrerPolicy:'no-referrer',signal:controller.signal,
    headers:{authorization:'Bearer '+env.WS_SERVICE_KEY,'content-type':'application/json'},
    body:JSON.stringify(index===1?{room,channel}:{room,channel,chunk:index})
   });
   const response=await env.WS_FROZEN_HISTORY_SOURCE.fetch(request);
   if((response.status===429||response.status>=500)&&attempt===0){
    try{await response.body?.cancel()}catch(_){}
    if(deadline-Date.now()<=0)throw fail();
    await new Promise(resolve=>setTimeout(resolve,80));
    continue;
   }
   return await readLimited(response,controller.signal);
  }finally{clearTimeout(timer)}
 }
 throw fail();
}

export async function readTrustedFrozenSource({env,room,channel}={}){
 if(env?.WS_OPEN_EXISTING_QA!=='1'||env.WS_AUTHORITY_QA!=='1'||
  env.WS_SEPARATE_ROOMS_QA!=='1'||!ROOM.test(room||'')||
  !['cat','ops'].includes(channel)||room!==env.SALA_PILOTO+'-'+channel||
  typeof env.WS_FROZEN_HISTORY_SOURCE?.fetch!=='function'||
  typeof env.WS_SERVICE_KEY!=='string'||env.WS_SERVICE_KEY.length<32)throw fail();
 let stage='fetch';
 const deadline=Date.now()+GLOBAL_TIMEOUT_MS;
 try{
  const hashes=[],all=[];
  let anchor=null,total=0;
  for(let index=1;index<=MAX_PAGES;index++){
   if(Date.now()>=deadline)throw fail();
   stage='fetch-page';
   const body=await fetchSignedPage(env,room,channel,index,deadline);
   stage='bounded-source-read';
   stage='proof-shape';
   metadata(body,room,channel);
   if(index===1&&!body.manifest){
    stage='byte-frames';
    const frames=legacyFrames(body,channel);
    await validateDocument(frames,channel,false,{room,frozenHead:body.frozenHead,
     expectedProjectedSha256:body.expectedProjectedSha256});
    return {channel,frozenHead:body.frozenHead,completeToHead:true,
     expectedStateSha256:body.expectedStateSha256,
     expectedVectorSha256:body.expectedVectorSha256,
     ...(channel==='ops'?{expectedOpIds:body.expectedOpIds}:{}),frames};
   }
   if(!body.manifest)throw fail();
   if(index===1)anchor={
    chunks:body.manifest.chunks,totalBytes:body.manifest.totalBytes,
    rootSha256:body.manifest.rootSha256,head:body.frozenHead,
    sha:body.expectedStateSha256,vector:body.expectedVectorSha256,
    opIds:body.expectedOpIds,projectedSha:body.expectedProjectedSha256,
    projectionVersion:body.projectionVersion
   };
   if(body.frozenHead!==anchor.head||body.expectedStateSha256!==anchor.sha||
    body.expectedVectorSha256!==anchor.vector||body.expectedOpIds!==anchor.opIds||
    body.expectedProjectedSha256!==anchor.projectedSha||
    body.projectionVersion!==anchor.projectionVersion)throw fail();
   stage='byte-frames';
   const frames=pagedFrames(body,index,anchor,all.length,channel);
   total+=frames.reduce((n,b)=>n+b.byteLength,0);
   if(total>(channel==='ops'?MAX_OPS_WIRE:MAX_TOTAL_BYTES)||
    all.length+frames.length>MAX_TOTAL_FRAMES)throw fail();
   stage='page-hash';
   if(await pageDigest(frames)!==body.manifest.sha256)throw fail();
   hashes.push(body.manifest.sha256);
   all.push(...frames);
   if(index===anchor.chunks){
    stage='root-proof';
    if(total!==anchor.totalBytes||
     await sha(utf8.encode(hashes.map((h,i)=>(i+1)+':'+h+'\n').join('')))!==anchor.rootSha256)throw fail();
    stage='privacy-and-causality';
    await validateDocument(all,channel,true,{room,frozenHead:anchor.head,
     expectedProjectedSha256:anchor.projectedSha});
    return {channel,frozenHead:anchor.head,completeToHead:true,
     expectedStateSha256:anchor.sha,expectedVectorSha256:anchor.vector,
     ...(channel==='ops'?{expectedOpIds:anchor.opIds}:{}),frames:all};
   }
  }
  throw fail();
 }catch(error){
  const kind=error instanceof TypeError?'type':
   error?.name==='AbortError'?'timeout':
   error?.name==='SyntaxError'?'json':'rejected';
  throw new Error('trusted frozen history unavailable: '+stage+' ('+kind+')');
 }
}
