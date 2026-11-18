import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const target = '../src/certified-frozen-import.mjs';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

async function code() {
  try {return await import(target);}
  catch (error) {assert.fail('P0 import certificate module is not implemented: '+error.code);}
}
function syntheticHistory() {
  const src = new Y.Doc();
  const frames=[];
  src.on('update',update => frames.push(new Uint8Array(update)));
  src.getMap('eventos').set('sale-opid-00000001',{amountCents:1250});
  src.getMap('eventos').set('sale-opid-00000002',{amountCents:2500});
  src.getMap('eventos').set('sale-opid-00000003',{amountCents:3500});
  const bytes=Y.encodeStateAsUpdate(src);
  const expectedStateSha256=sha(bytes), expectedVectorSha256=sha(Y.encodeStateVector(src));
  src.destroy();
  return {frames,expectedStateSha256,expectedVectorSha256,expectedOpIds:3,channel:'ops',frozenHead:'fixture-3',completeToHead:true};
}
function makeSql(db){
 const sql={exec(statement,...args) {
   const stmt=db.prepare(statement), values=args.map(v=>v instanceof Uint8Array?Buffer.from(v):v);
   let rows=[];
   if(/^\s*SELECT\b/i.test(statement))rows=stmt.all(...values);
   else stmt.run(...values);
   return {one:()=>rows[0],toArray:()=>rows,[Symbol.iterator]:function*(){yield*rows;}};
 }};
 return {sql, transactionSync(f) {
    db.exec('BEGIN IMMEDIATE');
    try {const answer=f();db.exec('COMMIT');return answer;}
    catch(error){db.exec('ROLLBACK');throw error;}
 }};
}
function newStore(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'f123-frozen-'));
 const filename=path.join(dir,'durable.sqlite');
 const db=new DatabaseSync(filename);
 const storage=makeSql(db);
 return {db,storage,reopen(){
   db.close();const fresh=new DatabaseSync(filename);
   return {db:fresh,storage:makeSql(fresh)};
 },cleanup(){try{db.close();}catch{}fs.rmSync(dir,{recursive:true,force:true});}};
}
const prepare=async(m,overrides={})=>m.prepareFrozenImport({...syntheticHistory(),...overrides});

test('complete frozen history imports exact original Yjs ops into native SQL and cold-exports',async()=>{
 const m=await code(),t=syntheticHistory(),w=newStore();
 try{
  const proof=await m.prepareFrozenImport(t);
  assert.equal(proof.sha256,t.expectedStateSha256);
  assert.equal(proof.vectorSha256,t.expectedVectorSha256);
  assert.equal(proof.eventCount,3);
  const first=await m.installFrozenImport({storage:w.storage,proof});
  assert.equal(first.already,false);
  const exported=await m.readFrozenImport({storage:w.storage});
  assert.equal(sha(exported.bytes),t.expectedStateSha256);
  // Close the actual SQLite handle and reopen its on-disk file. A read against
  // only the initial connection would not prove durability after a cold start.
  const cold=w.reopen();
  try {
   const coldExport=await m.readFrozenImport({storage:cold.storage});
   assert.equal(sha(coldExport.bytes),t.expectedStateSha256);
   const restored=new Y.Doc();Y.applyUpdate(restored,coldExport.bytes);
   assert.equal(restored.getMap('eventos').size,3);
   assert.equal(restored.store.pendingStructs,null);
   assert.equal(restored.store.pendingDs,null);
   restored.destroy();
   assert.equal((await m.installFrozenImport({storage:cold.storage,proof})).already,true);
  } finally {cold.db.close();}
 }finally{w.cleanup();}
});

test('an out-of-order isolated Yjs child is refused even with the expected frozen HEAD',async()=>{
 const m=await code(),t=syntheticHistory();
 await assert.rejects(m.prepareFrozenImport({...t,frames:t.frames.slice(1)}),/pending|ancestor|missing/i);
});

test('independent SHA, state-vector and opId evidence must match before opening SQL',async()=>{
 const m=await code(),t=syntheticHistory();
 for(const bad of [
  {expectedStateSha256:'0'.repeat(64)},
  {expectedVectorSha256:'f'.repeat(64)},
  {expectedOpIds:2},
  {completeToHead:false},
  {frozenHead:''}
 ]){
  await assert.rejects(m.prepareFrozenImport({...t,...bad}));
 }
});

test('competing same-shop histories cannot overwrite existing durable ops or their certificate',async()=>{
 const m=await code(),t=syntheticHistory(),w=newStore();
 try{
  const proof=await m.prepareFrozenImport(t);
  await m.installFrozenImport({storage:w.storage,proof});
  const different=syntheticHistory();
  const peer=new Y.Doc();peer.getMap('eventos').set('another-sale-opid-123456',{amountCents:999});
  different.frames=[Y.encodeStateAsUpdate(peer)];
  different.expectedStateSha256=sha(Y.encodeStateAsUpdate(peer));
  different.expectedVectorSha256=sha(Y.encodeStateVector(peer));
  different.expectedOpIds=1;
  const rival=await m.prepareFrozenImport(different);
  await assert.rejects(m.installFrozenImport({storage:w.storage,proof:rival}),/conflict|already|nonempty|different/i);
  assert.equal(sha((await m.readFrozenImport({storage:w.storage})).bytes),t.expectedStateSha256);
  peer.destroy();
 }finally{w.cleanup();}
});

test('legacy document, existing journal and orphan blocks each block initial import',async()=>{
 const m=await code(),proof=await prepare(m);
 for(const seed of [
  ['documento','INSERT INTO documento (id,contenido) VALUES (1,?)'],
  ['diario','INSERT INTO diario (cambio) VALUES (?)'],
  ['diario_bloques','INSERT INTO diario_bloques (n,parte,contenido) VALUES (1,0,?)']
 ]){
  const w=newStore();
  try{
   const schema=seed[0]==='documento'?'CREATE TABLE documento (id INTEGER PRIMARY KEY,contenido BLOB)':
     seed[0]==='diario'?'CREATE TABLE diario (n INTEGER PRIMARY KEY AUTOINCREMENT,cambio BLOB)':
     'CREATE TABLE diario_bloques (n INTEGER NOT NULL,parte INTEGER NOT NULL,contenido BLOB NOT NULL, PRIMARY KEY(n,parte))';
   w.storage.sql.exec(schema);
   w.storage.sql.exec(seed[1],new Uint8Array([1,2,3]));
   await assert.rejects(m.installFrozenImport({storage:w.storage,proof}),/nonempty|legacy|journal|existing/i);
  }finally{w.cleanup();}
 }
});

test('one failed 512KiB chunk rolls back all SQLite rows and the certificate',async()=>{
 const m=await code(),src=new Y.Doc(),frames=[];
 src.on('update',u=>frames.push(new Uint8Array(u)));
 src.getText('large').insert(0,'a'.repeat(1_200_000));
 const proof=await m.prepareFrozenImport({frames,frozenHead:'fixture-large',completeToHead:true,channel:'cat',expectedStateSha256:sha(Y.encodeStateAsUpdate(src)),expectedVectorSha256:sha(Y.encodeStateVector(src))});
 const w=newStore();let wrote=0;
 const badSql={exec(query,...args){
  if(query.startsWith('INSERT INTO documento_bloques')&&++wrote===2)throw Error('synthetic disk interruption');
  return w.storage.sql.exec(query,...args);
 }};
 try{
  await assert.rejects(m.installFrozenImport({storage:{...w.storage,sql:badSql},proof}),/synthetic disk interruption/);
  const table=w.storage.sql.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='f123_frozen_imports'").toArray();
  assert.equal(table.length,0,'transaction rollback includes the import certificate');
  assert.equal((await m.installFrozenImport({storage:w.storage,proof})).already,false);
  const round=await m.readFrozenImport({storage:w.storage});
  assert.ok(round.bytes.byteLength>1024*1024);
  assert.equal(sha(round.bytes),sha(Y.encodeStateAsUpdate(src)));
 }finally{src.destroy();w.cleanup();}
});

test('corrupt or missing SQLite chunk never gets a successful readback certificate',async()=>{
 const m=await code(),proof=await prepare(m),w=newStore();
 try{
  await m.installFrozenImport({storage:w.storage,proof});
  w.storage.sql.exec('UPDATE documento_bloques SET contenido=? WHERE n=0',new Uint8Array([1,2,3]));
  await assert.rejects(m.readFrozenImport({storage:w.storage}),/hash|corrupt|mismatch|missing|invalid/i);
 }finally{w.cleanup();}
});

test('frozen-only export fails closed once a later SQL journal update exists',async()=>{
 const m=await code(),proof=await prepare(m),w=newStore();
 try{
  await m.installFrozenImport({storage:w.storage,proof});
  w.storage.sql.exec('INSERT INTO diario (cambio) VALUES (?)',new Uint8Array([1,2,3]));
  await assert.rejects(m.readFrozenImport({storage:w.storage}),/journal/i);
  assert.equal(w.storage.sql.exec('SELECT COUNT(*) AS n FROM diario').one().n,1,
    'later unsynchronized operation must never be deleted to make export green');
 } finally {w.cleanup();}
});

test('an imported certificate with a missing SQL chunk is never accepted as a duplicate',async()=>{
 const m=await code(),proof=await prepare(m),w=newStore();
 try{
  await m.installFrozenImport({storage:w.storage,proof});
  w.storage.sql.exec('DELETE FROM documento_bloques WHERE n=0');
  await assert.rejects(m.installFrozenImport({storage:w.storage,proof}),/missing|corrupt/i);
  assert.equal(w.storage.sql.exec('SELECT COUNT(*) AS n FROM f123_frozen_imports').one().n,1,
    'failed duplicate does not erase migration evidence');
 } finally {w.cleanup();}
});
