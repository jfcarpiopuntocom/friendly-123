// C66 · Yjs native causal continuity certificate for independently frozen
// imports. Separate tiny immutable Yjs state-vector, never a replacement
// checkpoint, remote certificate, or an economic/business ACK.
// Created atomically with the original frozen import receipt+Yjs SQL blocks.
import * as Y from 'yjs';

const MAX_VECTOR=1024*1024;
const HEX=/^[0-9a-f]{64}$/;
const fail=reason=>{throw new Error('frozen vector baseline refused: '+reason)};
function copyBytes(value){
 if(value instanceof Uint8Array)return new Uint8Array(value);
 if(value instanceof ArrayBuffer)return new Uint8Array(value);
 if(ArrayBuffer.isView(value))
  return new Uint8Array(value.buffer,value.byteOffset,value.byteLength).slice();
 fail('unreadable vector BLOB');
}
function validateSize(bytes){
 if(!(bytes instanceof Uint8Array)||bytes.byteLength<2||bytes.byteLength>MAX_VECTOR)
  fail('invalid immutable vector bytes');
}
async function sha256(bytes){
 const digest=await crypto.subtle.digest('SHA-256',bytes);
 return Array.from(new Uint8Array(digest),x=>x.toString(16).padStart(2,'0')).join('');
}
export function installFrozenVectorBaseline(sql,vector){
 if(!sql?.exec)fail('durable SQL required');
 const bytes=copyBytes(vector);validateSize(bytes);
 const decoded=Y.decodeStateVector(bytes);
 if(!decoded.size)fail('empty frozen vector');
 sql.exec('CREATE TABLE IF NOT EXISTS f123_frozen_import_vectors (id INTEGER PRIMARY KEY CHECK(id=1), vector BLOB NOT NULL)');
 if(sql.exec('SELECT id FROM f123_frozen_import_vectors WHERE id=1').toArray().length)
  fail('immutable vector already installed');
 sql.exec('INSERT INTO f123_frozen_import_vectors (id,vector) VALUES (1,?)',bytes);
}
// This verifier sees a separately sha-anchored pre-cut vector and the entire
// CURRENT Yjs state after snapshot+journal. Legitimate deletions and new
// post-cut writers only advance clocks; loss of any original writer refuses.
export async function verifyFrozenVectorBaseline({storage,bytes,expectedVectorSha256}={}){
 if(!storage?.sql?.exec||!(bytes instanceof Uint8Array)||
    !HEX.test(expectedVectorSha256||''))fail('invalid independent proof');
 const sql=storage.sql;
 const names=new Set(sql.exec("SELECT name FROM sqlite_master WHERE type='table'")
  .toArray().map(row=>row.name));
 if(!names.has('f123_frozen_import_vectors'))
  fail('missing immutable vector baseline (old receipt cannot be backfilled)');
 const row=sql.exec('SELECT vector FROM f123_frozen_import_vectors WHERE id=1').toArray()[0];
 if(!row)fail('missing immutable vector row');
 const original=copyBytes(row.vector);validateSize(original);
 if(await sha256(original)!==expectedVectorSha256)
  fail('original vector SHA differs from independent frozen receipt');
 let oldVector,newVector;
 try{
  oldVector=Y.decodeStateVector(original);
  newVector=Y.decodeStateVector(Y.encodeStateVectorFromUpdate(bytes));
 }catch(_){fail('invalid Yjs vector readback')}
 if(!oldVector.size)fail('empty certified frozen vector');
 for(const [clientId,clock] of oldVector){
  if(!Number.isSafeInteger(clock)||clock<1||
     !Number.isSafeInteger(newVector.get(clientId)||0)||
     (newVector.get(clientId)||0)<clock)
   fail('original historical clock missing from current Yjs');
 }
 return Object.freeze({verified:true,originalWriterCount:oldVector.size});
}
