// PORT 2.0 Gate D6: immutable, independently anchored R2 frozen history SOURCE.
// READ-ONLY Service Binding target for trusted-frozen-source.mjs in real Tienda.
// Never rebuild Yjs or write, list or mutate R2. A pin stored outside R2
// binds exact manifest bytes to one immutable HEAD. Customer data NOT logged.
const PREFIX='f123-frozen/v1/';
const HEX=/^[a-f0-9]{64}$/;
const ROOM=/^[a-f0-9]{32}$/;
const HEAD=/^[A-Za-z0-9_.:-]{3,128}$/;
const B64=/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const MAX_REQ=512;
const MAX_MANIFEST=64*1024;
const MAX_PAGE_JSON=4*1024*1024;
const MAX_FRAME=4*1024*1024;
const MAX_FRAMES_PAGE=4096,MAX_FRAMES_TOTAL=16384,MAX_PAGES=8;
const OP_BYTES=12*1024*1024,CAT_BYTES=24*1024*1024;
const enc=new TextEncoder();
const dec=new TextDecoder('utf-8',{fatal:true});
function constantEquals(a,b){
 if(typeof a!=='string'||typeof b!=='string'||a.length>256||b.length>256)return false;
 let mismatch=a.length^b.length;
 for(let i=0;i<Math.max(a.length,b.length);i++)
  mismatch|=(a.charCodeAt(i)||0)^(b.charCodeAt(i)||0);
 return mismatch===0;
}
const denied=()=>new Response('Forbidden',{status:403,headers:{'cache-control':'no-store'}});
const corrupt=()=>new Response('Certified frozen history unavailable',{status:409,headers:{'cache-control':'no-store'}});
const unavailable=()=>new Response('Certified frozen history unavailable',{status:503,headers:{'cache-control':'no-store'}});
const ok=payload=>Response.json(payload,{headers:{'cache-control':'no-store','x-content-type-options':'nosniff'}});
async function sha256(value){
 const hash=await crypto.subtle.digest('SHA-256',value);
 return [...new Uint8Array(hash)].map(x=>x.toString(16).padStart(2,'0')).join('');
}
function need(ok){if(!ok)throw new Error('invalid independently certified frozen source')}
function safeCount(value,lo,hi){return Number.isSafeInteger(value)&&value>=lo&&value<=hi}
async function boundedRequest(request){
 if(!request.body)throw new Error('missing request body');
 const reader=request.body.getReader();let bytes=0,parts=[];
 try{
  for(;;){
   const {done,value}=await reader.read();if(done)break;
   need(value instanceof Uint8Array);
   bytes+=value.length;need(bytes<=MAX_REQ);parts.push(value);
  }
  need(bytes>0);
  const data=new Uint8Array(bytes);let offset=0;
  for(const p of parts){data.set(p,offset);offset+=p.length}
  return JSON.parse(dec.decode(data));
 }finally{try{await reader.cancel()}catch(_){}reader.releaseLock()}
}
async function getJson(bucket,key,maxSize){
 const item=await bucket.get(key);
 if(!item)return null;
 need(safeCount(item.size,1,maxSize)&&typeof item.arrayBuffer==='function');
 const bytes=new Uint8Array(await item.arrayBuffer());
 need(bytes.length===item.size&&bytes.length<=maxSize);
 return {data:JSON.parse(dec.decode(bytes)),raw:bytes};
}
function key(room,head,channel,filename){
 // All segments are matched to non-path regexes before this function runs.
 return PREFIX+room+'/'+head+'/'+channel+'/'+filename;
}
function verifyManifest(manifest,room,channel,head){
 need(manifest&&typeof manifest==='object'&&!Array.isArray(manifest));
 need(manifest.version===1&&manifest.room===room&&manifest.channel===channel&&
      manifest.frozenHead===head&&manifest.completeToHead===true);
 need(HEX.test(manifest.expectedStateSha256||'')&&HEX.test(manifest.expectedVectorSha256||''));
 if(channel==='ops'){
  need(safeCount(manifest.expectedOpIds,0,25000));
  need(manifest.expectedProjectedSha256===undefined&&manifest.projectionVersion===undefined);
 }else{
  need(manifest.expectedOpIds===undefined&&manifest.projectionVersion==='v1'&&
    HEX.test(manifest.expectedProjectedSha256||''));
 }
 const cap=channel==='ops'?OP_BYTES:CAT_BYTES;
 need(safeCount(manifest.totalBytes,1,cap)&&HEX.test(manifest.rootSha256||''));
 need(Array.isArray(manifest.pages)&&safeCount(manifest.pages.length,1,MAX_PAGES));
 let frames=0,raw=0;
 for(let i=0;i<manifest.pages.length;i++){
  const p=manifest.pages[i];
  need(p&&typeof p==='object'&&!Array.isArray(p));
  need(p.chunk===i+1&&p.firstFrameIndex===frames&&
       safeCount(p.frameCount,1,MAX_FRAMES_PAGE)&&
       safeCount(p.bytes,1,MAX_PAGE_JSON)&&HEX.test(p.sha256||''));
  frames+=p.frameCount;raw+=p.bytes;
  need(frames<=MAX_FRAMES_TOTAL&&raw<=cap);
 }
 need(raw===manifest.totalBytes);
 return manifest.pages;
}
async function validatePage(raw,definition){
 need(raw&&typeof raw==='object'&&!Array.isArray(raw));
 need(Object.keys(raw).length===1&&Array.isArray(raw.frames)&&
      raw.frames.length===definition.frameCount);
 const frames=[];let total=0;
 for(const encoded of raw.frames){
  need(typeof encoded==='string'&&encoded.length>0&&
      encoded.length%4===0&&encoded.length<=Math.ceil(MAX_FRAME/3)*4&&
      B64.test(encoded));
  const decoded=atob(encoded);
  need(decoded.length>0&&decoded.length<=MAX_FRAME&&btoa(decoded)===encoded);
  const b=new Uint8Array(decoded.length);
  for(let i=0;i<decoded.length;i++)b[i]=decoded.charCodeAt(i);
  total+=b.length;need(total<=MAX_PAGE_JSON);frames.push(b);
 }
 need(total===definition.bytes);
 const sized=new Uint8Array(total+4*frames.length),dv=new DataView(sized.buffer);
 let offset=0;
 for(const f of frames){
  dv.setUint32(offset,f.length,false);offset+=4;
  sized.set(f,offset);offset+=f.length;
 }
 need(await sha256(sized)===definition.sha256);
 return raw.frames;
}
async function frozenFetch(request,env){
 if(request.method!=='POST'||new URL(request.url).pathname!=='/v1/frozen')
  return new Response('Not found',{status:404});
 const secret=env?.WS_SERVICE_KEY;
 if(typeof secret!=='string'||secret.length<32||
    !constantEquals(request.headers.get('authorization')||'','Bearer '+secret))return denied();
 if(!ROOM.test(env?.F123_FROZEN_ROOM||'')||
    !HEAD.test(env?.F123_FROZEN_HEAD||'')||
    typeof env?.F123_FROZEN_R2?.get!=='function')return unavailable();
 if(!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type')||''))
  return denied();
 let args;
 try{args=await boundedRequest(request)}catch(_){return denied()}
 const {room,channel}=args||{};
 if(!['ops','cat'].includes(channel)||room!==env.F123_FROZEN_ROOM+'-'+channel||
    !safeCount(args.chunk===undefined?1:args.chunk,1,MAX_PAGES))return denied();
 const chunk=args.chunk===undefined?1:args.chunk;
 const pin=channel==='ops'?env.F123_FROZEN_OPS_MANIFEST_SHA256:
   env.F123_FROZEN_CAT_MANIFEST_SHA256;
 if(!HEX.test(pin||''))return unavailable();
 const keyBase=key(room,env.F123_FROZEN_HEAD,channel,'');
 try{
  const packed=await getJson(env.F123_FROZEN_R2,keyBase+'manifest.json',MAX_MANIFEST);
  if(!packed)return unavailable();
  need(await sha256(packed.raw)===pin);
  const manifest=packed.data;
  const pages=verifyManifest(manifest,room,channel,env.F123_FROZEN_HEAD);
  const root=await sha256(enc.encode(pages.map(p=>p.chunk+':'+p.sha256+'\n').join('')));
  need(root===manifest.rootSha256);
  if(chunk>pages.length)return denied();
  const page=pages[chunk-1];
  const body=await getJson(env.F123_FROZEN_R2,keyBase+'page-'+
    String(chunk).padStart(4,'0')+'.json',MAX_PAGE_JSON);
  if(!body)return unavailable();
  const frames=await validatePage(body.data,page);
  const result={
   room,channel,frozenHead:manifest.frozenHead,
   completeToHead:chunk===pages.length,
   expectedStateSha256:manifest.expectedStateSha256,
   expectedVectorSha256:manifest.expectedVectorSha256,
   ...(channel==='ops'?{expectedOpIds:manifest.expectedOpIds}:{
      projectionVersion:manifest.projectionVersion,
      expectedProjectedSha256:manifest.expectedProjectedSha256}),
   frames,
   manifest:{
     chunk,chunks:pages.length,firstFrameIndex:page.firstFrameIndex,
     frameCount:page.frameCount,bytes:page.bytes,
     totalBytes:manifest.totalBytes,sha256:page.sha256,
     rootSha256:manifest.rootSha256
   }
  };
  return ok(result);
 }catch(_){
  // Deliberately no stack traces, R2 keys or payload bytes in response/logs.
  return corrupt();
 }
}
export default {fetch:frozenFetch};
export {frozenFetch};
