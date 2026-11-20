// C97: Inert, explicit, low-level R2 publication of ALREADY sealed C95 present state.
// No Cloudflare credentials, no live cutover, no source observation, no PIN.
// Caller must perform independent server-side owner authentication and
// audit the C93 union; this function is NOT an authorization gate.
// Writes are conditional first-writer-wins, all pages before any manifest;
// returns pins only after byte-exact R2 readback on both channels.
import {Sha256Sync} from '../src/sha256-sync.mjs';

const PREFIX='f123-frozen/v1/';
const ROOM=/^[a-f0-9]{32}$/;
const SHA=/^[a-f0-9]{64}$/;
const HEAD=/^[A-Za-z0-9_.:-]{3,128}$/;
const BASE64=/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const MAX_MANIFEST=65536,MAX_PAGE=4*1024*1024,MAX_FRAME=4*1024*1024;
const encoder=new TextEncoder();
const fail=msg=>{throw new TypeError('immutable R2 present seal refused: '+msg)};
function hashBytes(value){const h=new Sha256Sync();h.update(value);return h.hex();}
function hashText(text){return hashBytes(encoder.encode(text))}
function framedHash(frames) {
 const h=new Sha256Sync();
 for(const frame of frames) {
  const len=new Uint8Array(4);
  new DataView(len.buffer).setUint32(0,frame.length,false);
  h.update(len);h.update(frame);
 }
 return h.hex();
}
function sourceFrames(body,definition) {
 if(typeof body!=='string'||encoder.encode(body).length>MAX_PAGE)fail('R2 page size');
 let parsed;
 try{parsed=JSON.parse(body)}catch(_){fail('invalid page JSON')}
 if(!parsed||typeof parsed!=='object'||Array.isArray(parsed)||
    Object.keys(parsed).length!==1||!Array.isArray(parsed.frames)||
    parsed.frames.length!==definition.frameCount||parsed.frames.length>4096)
  fail('page structure mismatch');
 let total=0;const frames=[];
 for(const raw of parsed.frames) {
  if(typeof raw!=='string'||raw.length===0||raw.length%4!==0||
     raw.length>Math.ceil(MAX_FRAME/3)*4||!BASE64.test(raw))fail('invalid frame base64');
  const decoded=atob(raw);
  if(!decoded.length||decoded.length>MAX_FRAME||btoa(decoded)!==raw)fail('invalid frame bytes');
  const frame=new Uint8Array(decoded.length);
  for(let i=0;i<decoded.length;i++)frame[i]=decoded.charCodeAt(i);
  total+=frame.length;
  if(total>MAX_PAGE)fail('excessive page bytes');
  frames.push(frame);
 }
 if(total!==definition.bytes||framedHash(frames)!==definition.sha256)
  fail('page frames SHA integrity mismatch');
 return total;
}
function inspectArchive(archive,channel,summary) {
 if(!archive||typeof archive!=='object'||!archive.manifest||
    typeof archive.manifestText!=='string'||!Array.isArray(archive.objects))
  fail('missing '+channel+' archive');
 const manifest=archive.manifest;
 const room=summary.room+'-'+channel;
 if(manifest.version!==1||manifest.room!==room||manifest.channel!==channel||
    manifest.frozenHead!==summary.frozenHead||manifest.completeToHead!==true||
    !SHA.test(manifest.expectedStateSha256||'')||
    !SHA.test(manifest.expectedVectorSha256||'')||
    !SHA.test(manifest.rootSha256||'')||
    !Array.isArray(manifest.pages)||!manifest.pages.length||manifest.pages.length>8)
  fail('invalid '+channel+' manifest');
 if(channel==='ops') {
  if(!Number.isSafeInteger(manifest.expectedOpIds)||
     manifest.expectedOpIds!==summary.acceptedFacts)fail('ops count mismatch');
 }else if(manifest.projectionVersion!=='v1'||
          !SHA.test(manifest.expectedProjectedSha256||'')||
          manifest.expectedOpIds!==undefined)fail('public catalog projection proof');
 if(archive.manifestText!==JSON.stringify(manifest)||
    encoder.encode(archive.manifestText).length>MAX_MANIFEST||
    !SHA.test(archive.manifestSha256||'')||
    hashText(archive.manifestText)!==archive.manifestSha256)
  fail('manifest SHA integrity mismatch');
 if(archive.manifestSha256!==summary[channel+'ManifestSha256'])
  fail('summary manifest SHA mismatch');
 if(archive.objects.length!==manifest.pages.length+1)
  fail('unexpected R2 object count');
 const byKey=new Map();
 for(const o of archive.objects) {
  if(!o||typeof o.key!=='string'||typeof o.body!=='string'||byKey.has(o.key))
   fail('invalid or duplicate R2 key/body');
  byKey.set(o.key,o.body);
 }
 const prefix=PREFIX+room+'/'+summary.frozenHead+'/'+channel+'/';
 const manifestKey=prefix+'manifest.json';
 if(byKey.get(manifestKey)!==archive.manifestText)fail('manifest object body mismatch');
 const pageWrites=[];let expectedOffset=0,totalBytes=0;
 for(let i=0;i<manifest.pages.length;i++) {
  const p=manifest.pages[i];
  if(!p||p.chunk!==i+1||p.firstFrameIndex!==expectedOffset||
     !Number.isSafeInteger(p.frameCount)||p.frameCount<1||p.frameCount>4096||
     !Number.isSafeInteger(p.bytes)||p.bytes<1||p.bytes>MAX_PAGE||
     !SHA.test(p.sha256||''))fail('page definition mismatch');
  const key=prefix+'page-'+String(i+1).padStart(4,'0')+'.json';
  const body=byKey.get(key);
  if(typeof body!=='string')fail('missing expected page');
  sourceFrames(body,p);
  expectedOffset+=p.frameCount;totalBytes+=p.bytes;
  pageWrites.push({key,body});
 }
 const cap=channel==='ops'?12*1024*1024:24*1024*1024;
 if(totalBytes!==manifest.totalBytes||totalBytes>cap)fail('total R2 bytes');
 if(hashText(manifest.pages.map(p=>p.chunk+':'+p.sha256+'\n').join(''))!==manifest.rootSha256)
  fail('manifest page root integrity mismatch');
 if(byKey.size!==pageWrites.length+1)fail('unexpected R2 archive keys');
 return {pages:pageWrites,manifest:{key:manifestKey,body:archive.manifestText}};
}
function inspect(seal) {
 const summary=seal?.summary;
 if(!summary||summary.protocol!=='f123-present-seal-v1'||
    !ROOM.test(summary.room||'')||!HEAD.test(summary.frozenHead||'')||
    !SHA.test(summary.unionDigest||'')||!SHA.test(summary.businessScope||'')||
    !Number.isSafeInteger(summary.sourceCount)||summary.sourceCount<2||
    !Number.isSafeInteger(summary.acceptedFacts)||summary.acceptedFacts<1||
    !SHA.test(summary.opsBaselineSha256||''))
  fail('invalid C95 present union summary');
 const ops=inspectArchive(seal.ops,'ops',summary);
 const cat=inspectArchive(seal.cat,'cat',summary);
 return {
  ordered:[...ops.pages,...cat.pages,ops.manifest,cat.manifest],
  pins:{ops:seal.ops.manifestSha256,cat:seal.cat.manifestSha256},
  summary
 };
}
async function putImmutable(bucket,entry) {
 // R2Conditional POJO is atomic If-None-Match:*; also serializes through Miniflare R2 RPC.
 const options={onlyIf:{etagDoesNotMatch:'*'}};
 const stored=await bucket.put(entry.key,entry.body,options);
 const got=await bucket.get(entry.key);
 if(!got||typeof got.arrayBuffer!=='function')fail('R2 readback missing');
 const bytes=new Uint8Array(await got.arrayBuffer());
 if(bytes.length!==encoder.encode(entry.body).length||
    hashBytes(bytes)!==hashText(entry.body))
  fail('immutable R2 key conflict or SHA readback mismatch');
 return stored===null?1:0;
}
export async function publishPresentSealToR2({bucket,seal}={}) {
 if(!bucket||typeof bucket.put!=='function'||typeof bucket.get!=='function')
  fail('R2 bucket read/write binding required');
 // Fail closed on invalid seal BEFORE touching R2.
 const validated=inspect(seal);
 let reused=0;
 for(const entry of validated.ordered) {
  // No deletion or unconditional overwrite, including during crash retry.
  reused+=await putImmutable(bucket,entry);
 }
 return Object.freeze({
  locallyVerified:true,
  room:validated.summary.room,
  frozenHead:validated.summary.frozenHead,
  unionDigest:validated.summary.unionDigest,
  acceptedFacts:validated.summary.acceptedFacts,
  storedObjects:validated.ordered.length,
  reused,
  pins:Object.freeze(validated.pins)
 });
}