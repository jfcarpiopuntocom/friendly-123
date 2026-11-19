// Gate D7: deterministic OFFLINE packager for independently verified Firebase
// frozen Yjs history. Produces R2 object KEY + UTF8 BODY bytes, but NEVER
// uploads, certifies upstream HEAD, opens a public route or deploys a Worker.
// Ops frames retain original Yjs client IDs and causal order byte-for-byte.
// A private catalog is reauthored only as a detached, PUBLIC display snapshot.
import * as Y from 'yjs';
import {createHash} from 'node:crypto';
import {prepareFrozenImport} from '../src/certified-frozen-import.mjs';
import {projectPublicCatalog,F123_PUBLIC_PROJECTION_VERSION} from '../src/catalog-safe-projection.mjs';

const PREFIX='f123-frozen/v1/';
const ROOM=/^[a-f0-9]{32}-(?:cat|ops)$/;
const HEAD=/^[A-Za-z0-9_.:-]{3,128}$/;
const HEX=/^[a-f0-9]{64}$/;
const MiB=1024*1024,MAX_JSON=4*MiB,MAX_FRAME=4*MiB;
const MAX_PAGES=8,MAX_FRAMES=16384,MAX_PAGE_FRAMES=4096;
const MAX_OPS=12*MiB,MAX_CAT=24*MiB;
const fail=reason=>{throw new Error('certified R2 freeze refused: '+reason)};
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const utf8=new TextEncoder();
function framesDigest(frames){
 const h=createHash('sha256');
 const len=Buffer.allocUnsafe(4);
 for(const frame of frames){
  len.writeUInt32BE(frame.byteLength,0);h.update(len);h.update(frame);
 }
 return h.digest('hex');
}
function options(limits){
 if(limits===undefined)return {maxFramesPerPage:MAX_PAGE_FRAMES,maxPageJsonBytes:MAX_JSON};
 if(!limits||typeof limits!=='object'||Array.isArray(limits))fail('unsafe limits');
 const o={maxFramesPerPage:MAX_PAGE_FRAMES,maxPageJsonBytes:MAX_JSON};
 for(const [k,v] of Object.entries(limits)){
  if(!(k in o)||!Number.isSafeInteger(v)||v<=0||v>o[k])fail('unsafe limit override');
  o[k]=v;
 }
 return o;
}
function validateWire(frames,channel){
 if(!Array.isArray(frames)||frames.length<1||frames.length>MAX_FRAMES)fail('missing source frames');
 const max=channel==='ops'?MAX_OPS:MAX_CAT;
 let sum=0;
 for(const f of frames){
  if(!(f instanceof Uint8Array)||f.byteLength<1||f.byteLength>MAX_FRAME)
   fail('invalid source frame or wire budget');
  sum+=f.byteLength;
  if(!Number.isSafeInteger(sum)||sum>max)fail('source wire size budget exceeded');
 }
 return sum;
}
function validateAnchor({room,channel,frozenHead,externalProof}){
 if(!ROOM.test(room||'')||!['ops','cat'].includes(channel)||
    !room.endsWith('-'+channel)||!HEAD.test(frozenHead||'')||
    !externalProof||typeof externalProof!=='object'||Array.isArray(externalProof)||
    externalProof.sourceHead!==frozenHead||externalProof.completeToHead!==true||
    !HEX.test(externalProof.sourceFramesSha256||'')||
    !HEX.test(externalProof.expectedStateSha256||'')||
    !HEX.test(externalProof.expectedVectorSha256||'')||
    (channel==='ops'&&(!Number.isSafeInteger(externalProof.expectedOpIds)||
     externalProof.expectedOpIds<0||externalProof.expectedOpIds>25000))||
    (channel==='cat'&&externalProof.expectedOpIds!==undefined))
  fail('independent frozen HEAD and frame proof required');
}
function opsOnly(frames){
 const d=new Y.Doc();
 try{
  for(const b of frames)Y.applyUpdate(d,b,'certified-input');
  if(d.store.pendingStructs||d.store.pendingDs)fail('pending Yjs ancestors or deletes');
  for(const name of d.share.keys())if(name!=='eventos')fail('private root in ops channel');
  d.getMap('eventos');
 }finally{d.destroy();}
}
function publicCatalogFrames(frames,room,frozenHead){
 const source=new Y.Doc();
 try{
  for(const b of frames)Y.applyUpdate(source,b,'certified-input');
  if(source.store.pendingStructs||source.store.pendingDs)fail('pending Yjs ancestors or deletes');
  source.getMap('productos');source.getMap('ubicaciones');
  const published=projectPublicCatalog({sourceDoc:source,Y,room,channel:'cat',frozenHead});
  try{return [new Uint8Array(published.bytes)]}
  finally{published.doc.destroy()}
 }finally{source.destroy()}
}
function pageBundle(frames,limits){
 const groups=[],maxFrames=limits.maxFramesPerPage,maxJson=limits.maxPageJsonBytes;
 let group=[],b64=[];
 const flush=()=>{if(group.length){groups.push({frames:group,body:JSON.stringify({frames:b64})});group=[];b64=[]}};
 for(const frame of frames){
  const base64=Buffer.from(frame).toString('base64');
  if(JSON.stringify({frames:[base64]}).length>maxJson)
   fail('source frame exceeds bounded R2 JSON page');
  if(group.length&&(group.length>=maxFrames||
    JSON.stringify({frames:[...b64,base64]}).length>maxJson))flush();
  group.push(frame);b64.push(base64);
  if(groups.length>=MAX_PAGES&&group.length>0)fail('R2 page count exceeds cap');
 }
 flush();
 if(groups.length===0||groups.length>MAX_PAGES)fail('R2 page count exceeds cap');
 return groups;
}
export async function packFrozenR2Archive({
 room,channel,frozenHead,frames,externalProof,limits
}={}){
 validateAnchor({room,channel,frozenHead,externalProof});
 validateWire(frames,channel); // FIRST: no Yjs allocations for overbudget wire
 if(framesDigest(frames)!==externalProof.sourceFramesSha256)
  fail('independent frame byte SHA mismatch');
 // This certifies internal Yjs closure against the independent supplied oracle.
 // It does NOT independently establish that all upstream Firebase frames exist.
 let sourceProof;
 try{
  sourceProof=await prepareFrozenImport({
   frames,channel,frozenHead,completeToHead:externalProof.completeToHead,
   expectedStateSha256:externalProof.expectedStateSha256,
   expectedVectorSha256:externalProof.expectedVectorSha256,
   ...(channel==='ops'?{expectedOpIds:externalProof.expectedOpIds}:{})
  });
 }catch(e){fail('source causal or state SHA proof mismatch')}
 let outbound;
 if(channel==='ops'){
  opsOnly(frames);
  outbound=frames; // Preserves raw bytes, no synthesized state update.
 }else{
  outbound=publicCatalogFrames(frames,room,frozenHead);
 }
 validateWire(outbound,channel);
 const constraints=options(limits),groups=pageBundle(outbound,constraints);
 const pages=[];let firstFrameIndex=0,totalBytes=0;
 for(let i=0;i<groups.length;i++){
  const g=groups[i];
  const bytes=g.frames.reduce((n,f)=>n+f.byteLength,0);
  const page={chunk:i+1,firstFrameIndex,frameCount:g.frames.length,
   bytes,sha256:framesDigest(g.frames)};
  firstFrameIndex+=g.frames.length;totalBytes+=bytes;pages.push(page);
 }
 const rootSha256=sha(utf8.encode(pages.map(p=>p.chunk+':'+p.sha256+'\n').join('')));
 const outputDoc=new Y.Doc();
 let expectedStateSha256,expectedVectorSha256,expectedProjectedSha256;
 try{
  for(const f of outbound)Y.applyUpdate(outputDoc,f,'outbound-freeze');
  if(outputDoc.store.pendingStructs||outputDoc.store.pendingDs)
   fail('outbound missing causal ancestors');
  expectedStateSha256=sha(Y.encodeStateAsUpdate(outputDoc));
  expectedVectorSha256=sha(Y.encodeStateVector(outputDoc));
  if(channel==='cat'){
   // Verify that a repeated deterministic public projection reproduces bytes.
   outputDoc.getMap('productos');outputDoc.getMap('ubicaciones');
   const proof=projectPublicCatalog({sourceDoc:outputDoc,Y,room,channel:'cat',frozenHead});
   try{
    expectedProjectedSha256=sha(proof.bytes);
    if(expectedProjectedSha256!==expectedStateSha256)
     fail('public projection is not deterministic');
   }finally{proof.doc.destroy();}
  }
 }finally{outputDoc.destroy();}
 if(channel==='ops'&&
    (expectedStateSha256!==sourceProof.sha256||
     expectedVectorSha256!==sourceProof.vectorSha256))
  fail('raw original Yjs op frames changed');
 const manifest={
  version:1,room,channel,frozenHead,completeToHead:true,
  expectedStateSha256,expectedVectorSha256,
  ...(channel==='ops'?{expectedOpIds:externalProof.expectedOpIds}:{
   expectedProjectedSha256,projectionVersion:F123_PUBLIC_PROJECTION_VERSION}),
  totalBytes,rootSha256,pages
 };
 const manifestText=JSON.stringify(manifest);
 if(utf8.encode(manifestText).length>64*1024)fail('manifest too large');
 const prefix=PREFIX+room+'/'+frozenHead+'/'+channel+'/';
 const objects=[
  {key:prefix+'manifest.json',body:manifestText},
  ...groups.map((g,i)=>({key:prefix+'page-'+String(i+1).padStart(4,'0')+'.json',
   body:g.body}))
 ];
 return {manifest,manifestText,manifestSha256:sha(utf8.encode(manifestText)),objects};
}
