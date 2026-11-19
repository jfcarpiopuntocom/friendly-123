import * as Y from 'yjs';

// Gate D: server-only, bounded pre-cut history intake for the *actual* Tienda.
// This binding must be to an independent, authorized source service; never read
// a Firebase HEAD, PIN, frames or claimed proof from a browser/WebSocket.
// Workerd QA only: a complete business backfill >16 MiB REQUIRES pagination.
const MAX_WIRE=16*1024*1024;
const MAX_FRAMES=4096;
const MAX_FRAME=4*1024*1024;
const TIMEOUT_MS=5000;
const ROOM=/^[a-f0-9]{32}-(?:cat|ops)$/;
const HASH=/^[a-f0-9]{64}$/;
const HEAD=/^[A-Za-z0-9_.:-]{3,128}$/;
const fail=()=>new Error('trusted frozen history unavailable');

async function readLimited(response,signal){
 if(!response?.ok||!response.body||signal?.aborted)throw fail();
 const reader=response.body.getReader(),parts=[];
 let size=0;
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
  const bytes=new Uint8Array(size);let at=0;
  for(const part of parts){bytes.set(part,at);at+=part.length;}
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
 }catch(_){try{await reader.cancel()}catch(_){}throw fail()}
 finally{try{reader.releaseLock()}catch(_){}}
}

export async function readTrustedFrozenSource({env,room,channel}={}){
 if(env?.WS_OPEN_EXISTING_QA!=='1'||env.WS_AUTHORITY_QA!=='1'||
    env.WS_SEPARATE_ROOMS_QA!=='1'||!ROOM.test(room||'')||
    !['cat','ops'].includes(channel)||room!==env.SALA_PILOTO+'-'+channel||
    typeof env.WS_FROZEN_HISTORY_SOURCE?.fetch!=='function'||
    typeof env.WS_SERVICE_KEY!=='string'||env.WS_SERVICE_KEY.length<32)
   throw fail();
 let stage='fetch';
 const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),TIMEOUT_MS);
 try{
  // Service Binding, NOT global fetch. No publicly routable upload endpoint.
  const request=new Request('https://internal-history-source.invalid/v1/frozen',{
   method:'POST',cache:'no-store',credentials:'omit',redirect:'manual',referrerPolicy:'no-referrer',
   signal:controller.signal,headers:{
    'authorization':'Bearer '+env.WS_SERVICE_KEY,
    'content-type':'application/json'
   },body:JSON.stringify({room,channel})
  });
  const response=await env.WS_FROZEN_HISTORY_SOURCE.fetch(request);
  stage='bounded-source-read';
  const body=await readLimited(response,controller.signal);
  stage='proof-shape';
  if(body?.room!==room||body.channel!==channel||!HEAD.test(body.frozenHead||'')||
     body.completeToHead!==true||!HASH.test(body.expectedStateSha256||'')||
     !HASH.test(body.expectedVectorSha256||'')||
     (channel==='ops'&&(!Number.isSafeInteger(body.expectedOpIds)||body.expectedOpIds<0))||
     (channel==='cat'&&body.expectedOpIds!==undefined)||
     !Array.isArray(body.frames)||body.frames.length<1||body.frames.length>MAX_FRAMES)
    throw fail();
  stage='byte-frames';
  let total=0;
  const frames=body.frames.map(frame=>{
   if(!Array.isArray(frame)||frame.length<1||frame.length>MAX_FRAME)throw fail();
   total+=frame.length;
   if(total>MAX_WIRE)throw fail();
   for(const value of frame)if(!Number.isInteger(value)||value<0||value>255)throw fail();
   return Uint8Array.from(frame);
  });
  // Distinct ops room may ONLY contain event IDs. Never import the raw
  // private catalog Y.Doc into a room with a different authorization scope.
  if(channel==='ops'){
   const doc=new Y.Doc();
   try {
    for(const frame of frames)Y.applyUpdate(doc,frame,'trusted-source-ops-check');
    if(doc.store.pendingStructs||doc.store.pendingDs)throw fail();
    for(const root of doc.share.keys())if(root!=='eventos')throw fail();
   }finally{doc.destroy()}
  }
  return {channel,frozenHead:body.frozenHead,completeToHead:true,
   expectedStateSha256:body.expectedStateSha256,
   expectedVectorSha256:body.expectedVectorSha256,
   ...(channel==='ops'?{expectedOpIds:body.expectedOpIds}:{}),frames};
 }catch(error){
  // SANITIZED QA diagnostic only, never log request, headers, PIN or history.
  const kind=error instanceof TypeError?'type':
    error?.name==='AbortError'?'timeout':
    error?.name==='SyntaxError'?'json':'rejected';
  throw new Error('trusted frozen history unavailable: '+stage+' ('+kind+
    ')');
 }
 finally{clearTimeout(timeout)}
}
