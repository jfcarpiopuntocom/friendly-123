// Gate D4: ONE durable, idempotent Yjs union for a nonempty Tienda -ops room.
// Never rewrites existing base/journal, PIN, photos or typed commercial SQL.
// Frozen service proof is independently validated before the SQL barrier.
// A CRDT merge alone does NOT certify commercial postings or customer cutover.
import * as Y from 'yjs';
import {Sha256Sync,sha256Sync} from './sha256-sync.mjs';
import {prepareFrozenImport} from './certified-frozen-import.mjs';
import {snapshotInsideBarrier,framesFrom,exportCompleteYpartyYjs} from './durable-full-yjs-export.mjs';

const BLOCK=512*1024,MAX_EVENTS=25000,MAX_PAYLOAD=256*1024,MAX_BASELINE=16*1024*1024;
const MiB=1024*1024;
// Hard upper bounds, never relaxed by a caller. Cloudflare isolate is 128 MiB;
// these are conservative APPROXIMATIONS, not a substitute for real peak tests.
export const FROZEN_UNION_BUDGETS=Object.freeze({
 maxWireBytes:12*MiB,maxUnionBytes:12*MiB,maxEstimatedPeakBytes:128*MiB
});
const PEAK_FACTOR=3;
function tightenedBudgets(overrides){
 if(overrides===undefined)return FROZEN_UNION_BUDGETS;
 if(!overrides||typeof overrides!=='object'||Array.isArray(overrides))
  deny('invalid size budgets');
 const result={...FROZEN_UNION_BUDGETS};
 for(const [name,value] of Object.entries(overrides)){
  if(!(name in FROZEN_UNION_BUDGETS)||
   !Number.isSafeInteger(value)||value<=0||value>FROZEN_UNION_BUDGETS[name])
   deny('unsafe or enlarged size budget');
  result[name]=value;
 }
 return result;
}
function unallocatedWireBytes(frames,budgets){
 if(!Array.isArray(frames)||frames.length===0)deny('missing frozen wire frames');
 let n=0;
 for(const frame of frames){
  const valid=frame instanceof Uint8Array||frame instanceof ArrayBuffer||
   ArrayBuffer.isView(frame);
  if(!valid||!Number.isSafeInteger(frame.byteLength)||frame.byteLength<=0)
   deny('invalid frozen wire frame');
  n+=frame.byteLength;
  if(!Number.isSafeInteger(n)||n>budgets.maxWireBytes)
   deny('frozen wire size budget exceeded BEFORE Yjs');
 }
 return n;
}
function checkSize(value,cap,label){
 if(!Number.isSafeInteger(value)||value<0||value>cap)
  deny(label+' size budget exceeded');
}
function checkPeak(source,local,union,budgets){
 const projected=(source+local+union)*PEAK_FACTOR;
 if(!Number.isSafeInteger(projected)||projected>budgets.maxEstimatedPeakBytes)
  deny('estimated peak memory budget exceeded');
}
function countSqlBytes(sql,budgets){
 const tables=new Set(sql.exec("SELECT name FROM sqlite_master WHERE type='table'")
  .toArray().map(r=>r.name));
 let n=0;
 for(const [table,col] of [['documento','contenido'],['documento_bloques','contenido'],
  ['diario','cambio'],['diario_bloques','contenido']]){
  if(!tables.has(table))continue;
  const bytes=Number(sql.exec('SELECT COALESCE(SUM(LENGTH('+col+')),0) AS n FROM '+table).one()?.n||0);
  n+=bytes;
  checkSize(n,budgets.maxUnionBytes,'existing SQL journal');
 }
 return n;
}

const HEX=/^[a-f0-9]{64}$/;
const deny=reason=>{throw new Error('frozen union refused: '+reason);};
const sqlBlob=value=>{
 if(value instanceof Uint8Array)return new Uint8Array(value);
 if(value instanceof ArrayBuffer)return new Uint8Array(value);
 if(ArrayBuffer.isView(value))return new Uint8Array(value.buffer,value.byteOffset,value.byteLength).slice();
 deny('invalid frozen frame');
};
export function hasFrozenUnion(storage) {
 if(!storage?.sql?.exec)return false;
 const sql=storage.sql;
 const exists=sql.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='f123_frozen_unions'").toArray().length>0;
 return exists&&sql.exec('SELECT id FROM f123_frozen_unions WHERE id=1').toArray().length>0;
}
function docFrom(frames){
 const doc=new Y.Doc();
 try{
  for(const f of frames)Y.applyUpdate(doc,sqlBlob(f),'f123-verified-history');
  if(doc.store.pendingStructs||doc.store.pendingDs)deny('pending Yjs parent or delete');
  for(const root of doc.share.keys())if(root!=='eventos')deny('private or mixed room in ops union');
  doc.getMap('eventos');
  return doc;
 }catch(error){doc.destroy();throw error;}
}
function stable(value,depth=0){
 if(depth>16)deny('event nesting depth');
 if(value===null||typeof value==='string'||typeof value==='boolean')return JSON.stringify(value);
 if(typeof value==='number'){
  if(!Number.isFinite(value)||!Number.isSafeInteger(value))deny('unsafe event amount');
  return JSON.stringify(value);
 }
 if(Array.isArray(value))return '['+value.map(v=>stable(v,depth+1)).join(',')+']';
 if(typeof value==='object'&&value&&Object.getPrototypeOf(value)===Object.prototype){
  const keys=Object.keys(value).sort();
  return '{'+keys.map(k=>JSON.stringify(k)+':'+stable(value[k],depth+1)).join(',')+'}';
 }
 deny('unknown event payload type');
}
function eventRows(doc){
 const map=doc.getMap('eventos');
 if(map.size>MAX_EVENTS)deny('too many events');
 const rows=new Map();let bytes=0;
 for(const [id,event] of map.entries()){
  if(typeof id!=='string'||id.length<1||id.length>160)deny('invalid opId');
  const payload=stable(event);
  if(payload.length>MAX_PAYLOAD)deny('oversized event payload');
  bytes+=id.length+payload.length;
  if(bytes>MAX_BASELINE)deny('event baseline exceeds bounded memory');
  rows.set(id,payload);
 }
 return rows;
}
function sha256(bytes){return sha256Sync(bytes);}
function eventsDigest(rows){
 const h=new Sha256Sync();
 for(const id of [...rows.keys()].sort()){
  h.update(id);h.update('\0');h.update(rows.get(id));h.update('\n');
 }
 return h.hex();
}
const MAX_VECTOR=1024*1024;
function parseVector(blob,label){
 const bytes=sqlBlob(blob);
 if(bytes.byteLength<2||bytes.byteLength>MAX_VECTOR)deny(label+' size invalid');
 let decoded;
 try{decoded=Y.decodeStateVector(bytes);}catch(_){deny(label+' unreadable');}
 if(!decoded.size)deny(label+' empty');
 return {bytes,map:decoded};
}
function assertVectorDominates(superMap,subMap,reason){
 for(const [clientId,clock] of subMap){
  if(!Number.isSafeInteger(clock)||clock<1||(superMap.get(clientId)||0)<clock)deny(reason);
 }
}
function createCert(sql){
 sql.exec('CREATE TABLE IF NOT EXISTS f123_frozen_unions (id INTEGER PRIMARY KEY CHECK(id=1), channel TEXT NOT NULL, frozen_head TEXT NOT NULL, frozen_sha256 TEXT NOT NULL, vector_sha256 TEXT NOT NULL, frozen_events INTEGER NOT NULL, union_events INTEGER NOT NULL, union_sha256 TEXT NOT NULL, events_sha256 TEXT NOT NULL, pitr_bookmark TEXT)');
 const columns=sql.exec('PRAGMA table_info(f123_frozen_unions)').toArray();
 if(!columns.some(c=>c.name==='pitr_bookmark'))
  sql.exec('ALTER TABLE f123_frozen_unions ADD COLUMN pitr_bookmark TEXT');
 sql.exec('CREATE TABLE IF NOT EXISTS f123_frozen_union_events (opid TEXT PRIMARY KEY, payload TEXT NOT NULL)');
 sql.exec('CREATE TABLE IF NOT EXISTS f123_frozen_union_vectors (id INTEGER PRIMARY KEY CHECK(id=1), frozen_vector BLOB NOT NULL, union_vector BLOB NOT NULL, union_vector_sha256 TEXT NOT NULL)');
}
function certRead(sql){
 if(!sql.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='f123_frozen_unions'").toArray().length)return null;
 const hasPitr=sql.exec('PRAGMA table_info(f123_frozen_unions)').toArray()
  .some(c=>c.name==='pitr_bookmark');
 const column=hasPitr?'pitr_bookmark':'NULL AS pitr_bookmark';
 return sql.exec('SELECT channel,frozen_head,frozen_sha256,vector_sha256,frozen_events,union_events,union_sha256,events_sha256,'+column+' FROM f123_frozen_unions WHERE id=1').toArray()[0]||null;
}
function verifyDocumentAgainstCert(storage,expected){
 return storage.transactionSync(()=>{
  const sql=storage.sql,cert=certRead(sql);
  if(!cert||cert.channel!=='ops'||cert.frozen_head!==expected.frozen_head||
     cert.frozen_sha256!==expected.frozen_sha256||cert.vector_sha256!==expected.vector_sha256||
     !Number.isSafeInteger(Number(cert.frozen_events))||Number(cert.frozen_events)<0||
     !Number.isSafeInteger(Number(cert.union_events))||Number(cert.union_events)<Number(cert.frozen_events)||
     !HEX.test(cert.union_sha256||'')||!HEX.test(cert.events_sha256||''))
   deny('union certificate mismatch');
  if(!sql.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='f123_frozen_union_vectors'").toArray().length)
   deny('missing immutable union vector baseline (legacy receipt cannot be self-certified)');
  const vecRow=sql.exec('SELECT frozen_vector,union_vector,union_vector_sha256 FROM f123_frozen_union_vectors WHERE id=1').toArray()[0];
  if(!vecRow||!HEX.test(vecRow.union_vector_sha256||''))
   deny('missing immutable union vector row');
  const frozenVec=parseVector(vecRow.frozen_vector,'frozen vector');
  const unionVec=parseVector(vecRow.union_vector,'union vector');
  if(sha256(frozenVec.bytes)!==cert.vector_sha256)
   deny('frozen vector SHA mismatch after SQL readback');
  if(sha256(unionVec.bytes)!==vecRow.union_vector_sha256)
   deny('union vector SHA mismatch after SQL readback');
  assertVectorDominates(unionVec.map,frozenVec.map,'union vector missing frozen causal clock');
  const snapshot=framesFrom(snapshotInsideBarrier(storage));
  const doc=docFrom(snapshot.frames);
  try{
   const rows=eventRows(doc);
   if(rows.size<Number(cert.union_events)||rows.size<Number(cert.frozen_events))
    deny('frozen event loss on reopen');
   const baseline=sql.exec('SELECT opid,payload FROM f123_frozen_union_events ORDER BY opid').toArray();
   if(baseline.length!==Number(cert.union_events))deny('baseline count mismatch');
   const expected=new Map(baseline.map(row=>[row.opid,row.payload]));
   if(expected.size!==baseline.length||eventsDigest(expected)!==cert.events_sha256)
    deny('event baseline digest mismatch');
   for(const row of baseline)if(rows.get(row.opid)!==row.payload)
    deny('frozen or local opId changed or removed');
   const liveVectorBytes=Y.encodeStateVector(doc);
   const liveVec=parseVector(liveVectorBytes,'live vector');
   assertVectorDominates(liveVec.map,unionVec.map,'union historical Yjs clock missing after reopen');
   // Exact state comparison applies ONLY while the Yjs causal vector matches
   // the certified union vector (e.g. pure compaction). Valid post-cut creates+deletes
   // advance the state vector even when map size returns to union_events.
   if(sha256(liveVectorBytes)===vecRow.union_vector_sha256&&
      sha256(Y.encodeStateAsUpdate(doc))!==cert.union_sha256)
    deny('union SHA mismatch after SQL readback');
   return {opened:true,already:true,verifiedEvents:rows.size,
    unionSha256:cert.union_sha256,pitrBookmark:cert.pitr_bookmark??null,
    pitrAvailable:typeof cert.pitr_bookmark==='string'&&cert.pitr_bookmark.length>0};
  }finally{doc.destroy();}
 });
}
export function verifyFrozenUnionReopen({storage,source}={}){
 if(!storage?.transactionSync||!storage?.sql)deny('durable SQL required');
 const cert=certRead(storage.sql);
 if(!cert)deny('missing union certificate');
 if(source&&(source.channel!==cert.channel||source.frozenHead!==cert.frozen_head||
    source.expectedStateSha256!==cert.frozen_sha256||
    source.expectedVectorSha256!==cert.vector_sha256||
    source.expectedOpIds!==Number(cert.frozen_events)))
   deny('conflicting independent frozen source');
 return verifyDocumentAgainstCert(storage,cert);
}
function appendFrame(sql,frame){
 sql.exec('CREATE TABLE IF NOT EXISTS diario (n INTEGER PRIMARY KEY AUTOINCREMENT,cambio BLOB)');
 sql.exec('CREATE TABLE IF NOT EXISTS diario_bloques (n INTEGER NOT NULL,parte INTEGER NOT NULL,contenido BLOB NOT NULL,PRIMARY KEY(n,parte))');
 if(frame.byteLength<=BLOCK){
  sql.exec('INSERT INTO diario (cambio) VALUES (?)',frame);
 }else{
  const row=sql.exec("INSERT INTO diario (cambio) VALUES (X'') RETURNING n").one();
  if(!Number.isSafeInteger(Number(row?.n)))deny('invalid journal id');
  for(let offset=0,part=0;offset<frame.byteLength;offset+=BLOCK,part++){
   sql.exec('INSERT INTO diario_bloques (n,parte,contenido) VALUES (?,?,?)',
    row.n,part,frame.subarray(offset,Math.min(offset+BLOCK,frame.byteLength)));
  }
 }
}
export async function mergeFrozenIntoExisting({storage,source,limits}={}){
 if(!storage?.transactionSync||!storage?.sql||source?.channel!=='ops')
  deny('trusted ops SQL and source required');
 if(hasFrozenUnion(storage))return verifyFrozenUnionReopen({storage,source});
 const budgets=tightenedBudgets(limits);
 // FIRST guard: reject without even allocating a copy or applying ANY Yjs.
 const sourceWireBytes=unallocatedWireBytes(source.frames,budgets);
 checkPeak(sourceWireBytes,0,0,budgets);
 // Defensive copy only after the raw byte budget has passed.
 const frames=source.frames.map(sqlBlob);
 const trustedSource={...source,frames};
 const proof=await prepareFrozenImport(trustedSource);
 if(proof.channel!=='ops'||proof.eventCount!==source.expectedOpIds)deny('invalid ops proof');
 checkSize(proof.bytes,budgets.maxUnionBytes,'certified frozen state');
 checkPeak(sourceWireBytes,0,proof.bytes,budgets);
 // A bookmark is evidence of the PRE-MUTATION point, not proof of recovery.
 // Capture it BEFORE transactionSync; if unsupported explicitly store NULL.
 let pitrBookmark=null;
 if(typeof storage.getCurrentBookmark==='function'){
  const b=await storage.getCurrentBookmark();
  if(typeof b!=='string'||b.length<1||b.length>2048)
   deny('invalid PITR bookmark');
  pitrBookmark=b;
 }
 const receipt=storage.transactionSync(()=>{
  const sql=storage.sql;
  if(certRead(sql))deny('concurrent union already exists');
  if(sql.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='f123_frozen_imports'").toArray().length&&
      sql.exec('SELECT id FROM f123_frozen_imports WHERE id=1').toArray().length)
    deny('cannot union atop frozen import certificate');
  // Budget the old SQL journal before cloning/reconstructing a Y.Doc.
  const localSqlBytes=countSqlBytes(sql,budgets);
  checkPeak(sourceWireBytes,localSqlBytes,proof.bytes,budgets);
  const local=docFrom(framesFrom(snapshotInsideBarrier(storage)).frames);
  const frozen=docFrom(frames);
  try{
   const previous=eventRows(local),fromSource=eventRows(frozen),expected=new Map(previous);
   if(fromSource.size!==proof.eventCount)deny('frozen opId count mismatch');
   for(const [opid,payload] of fromSource){
    if(previous.has(opid)&&previous.get(opid)!==payload)deny('same opId conflicting event');
    expected.set(opid,payload);
   }
   const delta=Y.encodeStateAsUpdate(frozen,Y.encodeStateVector(local));
   const noDelta=delta.length===2&&delta[0]===0&&delta[1]===0;
   if(!noDelta)Y.applyUpdate(local,delta,'frozen-ops-diff');
   if(local.store.pendingStructs||local.store.pendingDs)deny('pending union ancestry');
   const merged=eventRows(local);
   if(merged.size!==expected.size)deny('union event count differs');
   for(const [id,payload] of expected)if(merged.get(id)!==payload)
    deny('union changed original business facts');
   const mergedBytes=Y.encodeStateAsUpdate(local);
   checkSize(mergedBytes.byteLength,budgets.maxUnionBytes,'merged Yjs union');
   checkSize(delta.byteLength,budgets.maxUnionBytes,'delta journal');
   checkPeak(sourceWireBytes,localSqlBytes,mergedBytes.byteLength,budgets);
   const unionSha256=sha256(mergedBytes);
   const eventsSha256=eventsDigest(merged);
   const frozenVectorVec=parseVector(Y.encodeStateVector(frozen),'frozen vector');
   if(sha256(frozenVectorVec.bytes)!==proof.vectorSha256)deny('frozen vector SHA mismatch');
   const unionVectorVec=parseVector(Y.encodeStateVector(local),'union vector');
   assertVectorDominates(unionVectorVec.map,frozenVectorVec.map,'union vector missing frozen causal clock');
   const unionVectorSha256=sha256(unionVectorVec.bytes);
   // No SQL mutations until EVERY causal/financial opId and vector check passes.
   // Journal delta, cert, events digest and immutable vectors are ONE SQLite tx.
   createCert(sql);
   if(!noDelta)appendFrame(sql,delta);
   sql.exec('INSERT INTO f123_frozen_unions (id,channel,frozen_head,frozen_sha256,vector_sha256,frozen_events,union_events,union_sha256,events_sha256,pitr_bookmark) VALUES (1,?,?,?,?,?,?,?,?,?)',
    proof.channel,proof.frozenHead,proof.sha256,proof.vectorSha256,proof.eventCount,merged.size,unionSha256,eventsSha256,pitrBookmark);
   sql.exec('INSERT INTO f123_frozen_union_vectors (id,frozen_vector,union_vector,union_vector_sha256) VALUES (1,?,?,?)',
    frozenVectorVec.bytes,unionVectorVec.bytes,unionVectorSha256);
   for(const [opid,payload] of merged)
    sql.exec('INSERT INTO f123_frozen_union_events (opid,payload) VALUES (?,?)',opid,payload);
   return {frozenHead:proof.frozenHead,frozenSha256:proof.sha256,
    mergedEventCount:merged.size,frozenEventCount:fromSource.size,bytes:noDelta?0:delta.length,
    unionSha256,eventsSha256,pitrBookmark,pitrAvailable:pitrBookmark!==null};
  }finally{local.destroy();frozen.destroy();}
 });
 // Verify complete durable Yjs SQL readback, not merely INSERT success.
 const result=await exportCompleteYpartyYjs({storage,channel:'ops'});
 if(result.eventCount!==receipt.mergedEventCount||result.sha256!==receipt.unionSha256)
  deny('union readback SHA or event count mismatch');
 verifyFrozenUnionReopen({storage,source});
 return {opened:true,already:false,receipt};
}
