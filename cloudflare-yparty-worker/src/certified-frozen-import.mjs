// Frozen, one-shot Yjs source import into the existing YParty SQL schema.
// SERVER-ONLY PRE-ACTIVATION ADAPTER. No endpoint, credential, client or auto-switch.
// The caller must independently freeze/verify Firebase HEAD and expected hashes;
// a partial Firebase ledger cannot be repaired by importing it into a Y.Doc.
import * as Y from 'yjs';

const BLOCK_BYTES=512*1024; // Identical to Tienda.onLoad/onSave in src/index.js.
const HEX=/^[0-9a-f]{64}$/;
const HEAD=/^[A-Za-z0-9_.:-]{3,128}$/;
const preparedBytes=new WeakMap();

function invalid(reason) {throw new Error(reason);}
async function digest(bytes) {
  const hash=await crypto.subtle.digest('SHA-256',bytes);
  return Array.from(new Uint8Array(hash),x=>x.toString(16).padStart(2,'0')).join('');
}
function bytesOf(value) {
  if(value instanceof Uint8Array)return new Uint8Array(value);
  if(value instanceof ArrayBuffer)return new Uint8Array(value);
  if(ArrayBuffer.isView(value))return new Uint8Array(value.buffer,value.byteOffset,value.byteLength).slice();
  invalid('invalid Yjs bytes');
}
function assertComplete(doc) {
  // Yjs can successfully apply a child update and retain unresolved parents.
  // Never clear pendingStructs / pendingDs: the missing economic facts are real.
  if(doc.store.pendingStructs || doc.store.pendingDs)invalid('pending Yjs ancestors or deletes');
}
function asDocument(bytes) {
  const doc=new Y.Doc();
  try {Y.applyUpdate(doc,bytes);assertComplete(doc);return doc;}
  catch(e){doc.destroy();throw e;}
}
function checkStorage(storage) {
  if(!storage || !storage.sql || typeof storage.sql.exec!=='function' ||
     typeof storage.transactionSync!=='function')
    invalid('durable SQL transaction required');
}
function createTables(sql) {
  // Same schema as the existing Durable Object. Never create a parallel store.
  sql.exec('CREATE TABLE IF NOT EXISTS documento (id INTEGER PRIMARY KEY, contenido BLOB)');
  sql.exec('CREATE TABLE IF NOT EXISTS documento_bloques (n INTEGER PRIMARY KEY, contenido BLOB NOT NULL)');
  sql.exec('CREATE TABLE IF NOT EXISTS diario (n INTEGER PRIMARY KEY AUTOINCREMENT, cambio BLOB)');
  sql.exec('CREATE TABLE IF NOT EXISTS diario_bloques (n INTEGER NOT NULL, parte INTEGER NOT NULL, contenido BLOB NOT NULL, PRIMARY KEY(n,parte))');
  sql.exec('CREATE TABLE IF NOT EXISTS f123_frozen_imports (id INTEGER PRIMARY KEY CHECK(id=1), channel TEXT NOT NULL, frozen_head TEXT NOT NULL, sha256 TEXT NOT NULL, vector_sha256 TEXT NOT NULL, event_count INTEGER, bytes INTEGER NOT NULL, chunks INTEGER NOT NULL)');
}
function count(sql,table) {return Number(sql.exec('SELECT COUNT(*) AS n FROM '+table).one()?.n||0);}
function snapshotChunks(sql) {
  return sql.exec('SELECT n,contenido FROM documento_bloques ORDER BY n').toArray();
}
function joinChunks(rows,countExpected,sizeExpected) {
  if(rows.length!==countExpected || !Number.isSafeInteger(sizeExpected) || sizeExpected<=0)
    invalid('missing frozen Yjs chunk');
  const whole=new Uint8Array(sizeExpected);
  let offset=0;
  rows.forEach((row,i)=>{
    const bytes=bytesOf(row.contenido);
    if(row.n!==i || !bytes.length || bytes.length>BLOCK_BYTES ||
       (i<countExpected-1&&bytes.length!==BLOCK_BYTES) || offset+bytes.length>whole.length)
      invalid('missing or corrupt frozen Yjs chunk');
    whole.set(bytes,offset);
    offset+=bytes.length;
  });
  if(offset!==sizeExpected)invalid('missing or corrupt frozen Yjs chunk');
  return whole;
}
function identicalBytes(a,b) {
  if(a.length!==b.length)return false;
  for(let i=0;i<a.length;i++)if(a[i]!==b[i])return false;
  return true;
}

// The externally anchored HEAD and independently measured hashes/opId count
// are mandatory. 'completeToHead' is only a caller assertion, not proof by itself.
export async function prepareFrozenImport({
  frames,channel,frozenHead,completeToHead,
  expectedStateSha256,expectedVectorSha256,expectedOpIds
}={}) {
  if(!Array.isArray(frames)||frames.length===0||!['cat','ops'].includes(channel) ||
     completeToHead!==true || typeof frozenHead!=='string'||!HEAD.test(frozenHead) ||
     !HEX.test(expectedStateSha256||'')||!HEX.test(expectedVectorSha256||'')||
     (channel==='ops'&&(!Number.isSafeInteger(expectedOpIds)||expectedOpIds<0)) ||
     (channel==='cat'&&expectedOpIds!==undefined))
    invalid('independent frozen source proof required');
  const doc=new Y.Doc();
  try {
    for(const frame of frames) {
      const update=bytesOf(frame);
      if(!update.length)invalid('invalid frozen source frame');
      Y.applyUpdate(doc,update,'frozen-firebase');
    }
    assertComplete(doc);
    const bytes=Y.encodeStateAsUpdate(doc);
    const vector=Y.encodeStateVector(doc);
    const eventCount=channel==='ops'?doc.getMap('eventos').size:null;
    if(eventCount!==null&&eventCount!==expectedOpIds)
      invalid('frozen opId count mismatch');
    const [sha256,vectorSha256]=await Promise.all([digest(bytes),digest(vector)]);
    if(sha256!==expectedStateSha256||vectorSha256!==expectedVectorSha256)
      invalid('frozen SHA or state-vector mismatch');
    const proof=Object.freeze({
      channel,frozenHead,sha256,vectorSha256,eventCount,
      bytes:bytes.byteLength,chunks:Math.ceil(bytes.byteLength/BLOCK_BYTES)
    });
    preparedBytes.set(proof,new Uint8Array(bytes)); // Defensive copy, not editable via proof.
    return proof;
  } finally {doc.destroy();}
}

// A synchronous transaction is the only commit. If another import wins first
// it cannot be overwritten. A preexisting legacy doc or journal is never erased.
// Call only while the target DO is unserved / pre-activation (no live Y.Doc).
export async function installFrozenImport({storage,proof}={}) {
  checkStorage(storage);
  const bytes=preparedBytes.get(proof);
  if(!bytes)invalid('uncertified frozen import');
  const result=storage.transactionSync(()=>{
    const sql=storage.sql;
    createTables(sql);
    const row=sql.exec('SELECT channel,frozen_head,sha256,vector_sha256,event_count,bytes,chunks FROM f123_frozen_imports WHERE id=1').toArray()[0];
    if(row){
      if(row.channel!==proof.channel || row.frozen_head!==proof.frozenHead ||
         row.sha256!==proof.sha256 || row.vector_sha256!==proof.vectorSha256 ||
         row.event_count!==proof.eventCount || Number(row.bytes)!==proof.bytes ||
         Number(row.chunks)!==proof.chunks)
        invalid('conflicting frozen import');
      // An idempotent retry is a no-op. Check the baseline snapshot bytes and
      // keep any later journal entries, never destroy them on duplicate import.
      const saved=joinChunks(snapshotChunks(sql),proof.chunks,proof.bytes);
      if(!identicalBytes(saved,bytes))invalid('corrupt frozen import');
      return {already:true};
    }
    if(count(sql,'documento')||count(sql,'documento_bloques')||
       count(sql,'diario')||count(sql,'diario_bloques'))
      invalid('nonempty legacy or journal storage refuses frozen import');
    for(let n=0;n<proof.chunks;n++){
      sql.exec('INSERT INTO documento_bloques (n,contenido) VALUES (?,?)',
        n,bytes.subarray(n*BLOCK_BYTES,Math.min(bytes.length,(n+1)*BLOCK_BYTES)));
    }
    sql.exec('INSERT INTO f123_frozen_imports (id,channel,frozen_head,sha256,vector_sha256,event_count,bytes,chunks) VALUES (1,?,?,?,?,?,?,?)',
      proof.channel,proof.frozenHead,proof.sha256,proof.vectorSha256,proof.eventCount,proof.bytes,proof.chunks);
    return {already:false};
  });
  // A true readback (rather than trusting the insert return value) is required.
  // If this fails, never advertise the incomplete DO as a certified migration.
  const recovered=await readFrozenImport({storage});
  if(!identicalBytes(recovered.bytes,bytes))invalid('frozen import readback mismatch');
  return Object.freeze({...result,receipt:recovered.receipt});
}

// Back-export a verified Yjs binary only. It is NOT a Firebase transport/
// encryption adapter. Refuse export after live journal edits to avoid losing
// those ops (the eventual downpath must explicitly include and test them).
export async function readFrozenImport({storage}={}) {
  checkStorage(storage);
  const sql=storage.sql;
  const receipt=sql.exec('SELECT channel,frozen_head,sha256,vector_sha256,event_count,bytes,chunks FROM f123_frozen_imports WHERE id=1').toArray()[0];
  if(!receipt)invalid('missing frozen import certificate');
  if(count(sql,'diario')||count(sql,'diario_bloques'))
    invalid('journal has newer ops; frozen-only export is unsafe');
  if(count(sql,'documento'))invalid('legacy document conflicts with frozen import');
  const bytes=joinChunks(snapshotChunks(sql),Number(receipt.chunks),Number(receipt.bytes));
  const doc=asDocument(bytes);
  try {
    const [sha256,vectorSha256]=await Promise.all([
      digest(Y.encodeStateAsUpdate(doc)),digest(Y.encodeStateVector(doc))
    ]);
    if(sha256!==receipt.sha256 || vectorSha256!==receipt.vector_sha256 ||
       (receipt.channel==='ops' && doc.getMap('eventos').size!==receipt.event_count))
      invalid('frozen import hash or opId mismatch');
    return {bytes,receipt:Object.freeze({...receipt})};
  } finally {doc.destroy();}
}
