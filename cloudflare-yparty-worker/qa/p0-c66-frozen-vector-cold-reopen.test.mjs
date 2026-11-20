// C66 RED-FIRST · source-executed REAL native SQLite + original Yjs library.
// Synthetic independent writers only; no browser/client/Firebase/network data.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import * as Y from 'yjs';
import {prepareFrozenImport,installFrozenImport} from '../src/certified-frozen-import.mjs';
import {openExistingStore} from '../src/open-existing-store.mjs';

const sha=b=>createHash('sha256').update(b).digest('hex');
function wrap(db){
 const sql={exec(statement,...args){
  const stmt=db.prepare(statement);
  const values=args.map(v=>v instanceof Uint8Array?Buffer.from(v):v);
  const data=/^\s*(SELECT|PRAGMA|WITH)\b/i.test(statement)?stmt.all(...values):stmt.run(...values);
  const rows=Array.isArray(data)?data:[];
  return {one:()=>rows[0],toArray:()=>rows,[Symbol.iterator]:function*(){yield*rows;}};
 }};
 return {sql,transactionSync(fn){db.exec('BEGIN IMMEDIATE');try{const out=fn();db.exec('COMMIT');return out;}
  catch(err){db.exec('ROLLBACK');throw err;}}};
}
async function scenario(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'f123-c66-'));
 const db=new DatabaseSync(path.join(dir,'durable.sqlite'));
 const storage=wrap(db);
 const original=new Y.Doc(),future=new Y.Doc();
 original.clientID=334411;future.clientID=554422;
 original.getMap('productos').set('original-book',
  {id:'original-book',nombre:'Historical book',precio:12.5,stockActual:4});
 future.getMap('productos').set('new-book',
  {id:'new-book',nombre:'New book',precio:30,stockActual:1});
 const originalUpdate=Y.encodeStateAsUpdate(original);
 const futureUpdate=Y.encodeStateAsUpdate(future);
 const proof=await prepareFrozenImport({
  frames:[originalUpdate],channel:'cat',
  frozenHead:'c66-independently-anchored-head-1',completeToHead:true,
  expectedStateSha256:sha(originalUpdate),
  expectedVectorSha256:sha(Y.encodeStateVector(original))
 });
 await installFrozenImport({storage,proof});
 const env={WS_OPEN_EXISTING_QA:'1'};
 const clean=()=>{original.destroy();future.destroy();db.close();fs.rmSync(dir,{recursive:true,force:true});};
 return {storage,env,db,originalUpdate,futureUpdate,clean,
  async reopen(){return openExistingStore({env,storage})},
  compact(bytes){
   db.exec('BEGIN IMMEDIATE');
   try{
    storage.sql.exec('DELETE FROM diario_bloques');
    storage.sql.exec('DELETE FROM diario');
    storage.sql.exec('DELETE FROM documento_bloques');
    storage.sql.exec('INSERT INTO documento_bloques (n,contenido) VALUES (0,?)',bytes);
    db.exec('COMMIT');
   }catch(err){db.exec('ROLLBACK');throw err;}
  }
 };
}
test('C66 control: genuine frozen source, forward independent journal and compaction preserve original causal clocks',async()=>{
 const s=await scenario();
 try{
  s.storage.sql.exec('INSERT INTO diario (cambio) VALUES (?)',s.futureUpdate);
  const first=await s.reopen();
  assert.equal(first.opened,true,JSON.stringify(first));
  const complete=new Y.Doc();
  try{Y.applyUpdate(complete,s.originalUpdate);Y.applyUpdate(complete,s.futureUpdate);
   s.compact(Y.encodeStateAsUpdate(complete));
  }finally{complete.destroy();}
  const after=await s.reopen();
  assert.equal(after.opened,true,JSON.stringify(after));
  assert.match(after.verifiedSha256,/^[0-9a-f]{64}$/);
 }finally{s.clean();}
});
test('C66 RED: valid Yjs BLOCK snapshot from new writer MUST NOT replace certified pre-cut writer',async()=>{
 const s=await scenario();
 try{
  // After a legal SQL compaction the table name, n=0 and Yjs are all valid,
  // but every record from the original independent writer disappeared.
  s.compact(s.futureUpdate);
  const result=await s.reopen();
  assert.equal(result.opened,false,'never ACK a lost original Yjs client clock');
  assert.match(result.failback||'',/frozen.*vector|causal.*baseline|historical.*clock/i);
  assert.equal(s.storage.sql.exec('SELECT COUNT(*) AS n FROM documento_bloques').one().n,1,
    'fail-closed must never erase another writer or reconstruct imaginary data');
 }finally{s.clean();}
});

test('C66 refuses missing immutable vector row rather than backfilling from current Yjs',async()=>{
 const s=await scenario();
 try{
  s.storage.sql.exec('DELETE FROM f123_frozen_import_vectors');
  const result=await s.reopen();
  assert.equal(result.opened,false);
  assert.match(result.failback||'',/frozen vector baseline refused: missing immutable vector row/);
  assert.equal(s.storage.sql.exec('SELECT COUNT(*) AS n FROM f123_frozen_import_vectors').one().n,0);
 }finally{s.clean();}
});
test('C66 refuses source-vector tampering despite valid original SQL base and receipt',async()=>{
 const s=await scenario();
 try{
  s.storage.sql.exec('UPDATE f123_frozen_import_vectors SET vector=? WHERE id=1',
   Uint8Array.from([1,1,1]));
  const result=await s.reopen();
  assert.equal(result.opened,false);
  assert.match(result.failback||'',/frozen vector baseline refused: original vector SHA/);
 }finally{s.clean();}
});
test('C66 legacy pre-vector receipt cannot be self-certified on cold reopen',async()=>{
 const s=await scenario();
 try{
  s.storage.sql.exec('DROP TABLE f123_frozen_import_vectors');
  const result=await s.reopen();
  assert.equal(result.opened,false);
  assert.match(result.failback||'',/old receipt cannot be backfilled/);
 }finally{s.clean();}
});
test('C66 legitimate post-cut deletion retains frozen original causal clocks',async()=>{
 const s=await scenario();
 const all=new Y.Doc();
 try{
  Y.applyUpdate(all,s.originalUpdate);Y.applyUpdate(all,s.futureUpdate);
  all.getMap('productos').delete('original-book');
  // A legitimate deletion is a Yjs tombstone, NOT loss of the historical writer.
  s.compact(Y.encodeStateAsUpdate(all));
  const result=await s.reopen();
  assert.equal(result.opened,true,JSON.stringify(result));
 }finally{all.destroy();s.clean();}
});
