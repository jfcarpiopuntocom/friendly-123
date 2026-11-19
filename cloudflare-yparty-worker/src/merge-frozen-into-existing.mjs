// Gate D4: ONE durable, idempotent Yjs union for a nonempty Tienda -ops room.
// Never rewrites existing base/journal, PIN, photos or typed commercial SQL.
// Frozen service proof is independently validated before the SQL barrier.
// A CRDT merge alone does NOT certify commercial postings or customer cutover.
import * as Y from 'yjs';
import {Sha256Sync,sha256Sync} from './sha256-sync.mjs';
import {prepareFrozenImport} from './certified-frozen-import.mjs';
import {snapshotInsideBarrier,framesFrom,exportCompleteYpartyYjs} from './durable-full-yjs-export.mjs';

const BLOCK=512*1024,MAX_EVENTS=25000,MAX_PAYLOAD=256*1024,MAX_BASELINE=16*1024*1024;
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
function createCert(sql){
 sql.exec('CREATE TABLE IF NOT EXISTS f123_frozen_unions (id INTEGER PRIMARY KEY CHECK(id=1), channel TEXT NOT NULL, frozen_head TEXT NOT NULL, frozen_sha256 TEXT NOT NULL, vector_sha256 TEXT NOT NULL, frozen_events INTEGER NOT NULL, union_events INTEGER NOT NULL, union_sha256 TEXT NOT NULL, events_sha256 TEXT NOT NULL)');
 sql.exec('CREATE TABLE IF NOT EXISTS f123_frozen_union_events (opid TEXT PRIMARY KEY, payload TEXT NOT NULL)');
}
function certRead(sql){
 if(!sql.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='f123_frozen_unions'").toArray().length)return null;
 return sql.exec('SELECT channel,frozen_head,frozen_sha256,vector_sha256,frozen_events,union_events,union_sha256,events_sha256 FROM f123_frozen_unions WHERE id=1').toArray()[0]||null;
}
function verifyDocumentAgainstCert(storage,expected){
 return storage.transactionSync(()=>{
  const sql=storage.sql,cert=certRead(sql);
  if(!cert||cert.channel!=='ops'||cert.frozen_head!==expected.frozen_head||
     cert.frozen_sha256!==expected.frozen_sha256||cert.vector_sha256!==expected.vector_sha256||
     !Number.isSafeInteger(Number(cert.frozen_events))||!Number.isSafeInteger(Number(cert.union_events))||
     !HEX.test(cert.union_sha256||'')||!HEX.test(cert.events_sha256||''))
   deny('union certificate mismatch');
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
   // A pure compaction must retain the exact canonical Yjs union. Later new
   // post-cut events legitimately advance the SHA; the baseline still binds them.
   if(rows.size===Number(cert.union_events)&&
      sha256(Y.encodeStateAsUpdate(doc))!==cert.union_sha256)
    deny('union SHA mismatch after SQL readback');
   return {opened:true,already:true,verifiedEvents:rows.size,unionSha256:cert.union_sha256};
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
export async function mergeFrozenIntoExisting({storage,source}={}){
 if(!storage?.transactionSync||!storage?.sql||source?.channel!=='ops')
  deny('trusted ops SQL and source required');
 if(hasFrozenUnion(storage))return verifyFrozenUnionReopen({storage,source});
 // Defensive copy before async certification, no client-controlled transient array.
 const frames=source.frames?.map(sqlBlob);
 const trustedSource={...source,frames};
 const proof=await prepareFrozenImport(trustedSource);
 if(proof.channel!=='ops'||proof.eventCount!==source.expectedOpIds)deny('invalid ops proof');
 const receipt=storage.transactionSync(()=>{
  const sql=storage.sql;
  if(certRead(sql))deny('concurrent union already exists');
  if(sql.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='f123_frozen_imports'").toArray().length&&
      sql.exec('SELECT id FROM f123_frozen_imports WHERE id=1').toArray().length)
    deny('cannot union atop frozen import certificate');
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
   const unionSha256=sha256(Y.encodeStateAsUpdate(local));
   const eventsSha256=eventsDigest(merged);
   // No SQL mutations until EVERY causal/financial opId comparison passes.
   // This journal delta and both cert/digest rows are ONE SQLite transaction.
   createCert(sql);
   if(!noDelta)appendFrame(sql,delta);
   sql.exec('INSERT INTO f123_frozen_unions (id,channel,frozen_head,frozen_sha256,vector_sha256,frozen_events,union_events,union_sha256,events_sha256) VALUES (1,?,?,?,?,?,?,?,?)',
    proof.channel,proof.frozenHead,proof.sha256,proof.vectorSha256,proof.eventCount,merged.size,unionSha256,eventsSha256);
   for(const [opid,payload] of merged)
    sql.exec('INSERT INTO f123_frozen_union_events (opid,payload) VALUES (?,?)',opid,payload);
   return {frozenHead:proof.frozenHead,frozenSha256:proof.sha256,
    mergedEventCount:merged.size,frozenEventCount:fromSource.size,bytes:noDelta?0:delta.length,
    unionSha256,eventsSha256};
  }finally{local.destroy();frozen.destroy();}
 });
 // Verify complete durable Yjs SQL readback, not merely INSERT success.
 const result=await exportCompleteYpartyYjs({storage,channel:'ops'});
 if(result.eventCount!==receipt.mergedEventCount||result.sha256!==receipt.unionSha256)
  deny('union readback SHA or event count mismatch');
 verifyFrozenUnionReopen({storage,source});
 return {opened:true,already:false,receipt};
}
