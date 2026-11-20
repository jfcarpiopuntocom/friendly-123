// C69 RED-FIRST · Occupied-room Gate D4/D5 union Yjs causal state-vector continuity
// on real native SQLite + real Workerd/Yjs. All facts synthetic; USD 0.00 Cloudflare/R2.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as Y from 'yjs';
import {openExistingStore} from '../src/open-existing-store.mjs';
import {mergeFrozenIntoExisting} from '../src/merge-frozen-into-existing.mjs';

const sha=b=>createHash('sha256').update(b).digest('hex');
const env={WS_OPEN_EXISTING_QA:'1'};
const ev=(id,cents)=>({kind:'sale.record',opId:id,amountCents:cents});

function wrap(db){
 const sql={exec(statement,...args){
  const stmt=db.prepare(statement);
  const values=args.map(v=>v instanceof Uint8Array?Buffer.from(v):v);
  const data=/^\s*(?:SELECT|PRAGMA|WITH)\b/i.test(statement)||/\bRETURNING\b/i.test(statement)
   ? stmt.all(...values)
   : (stmt.run(...values),[]);
  const rows=Array.isArray(data)?data:[];
  return {one:()=>rows[0],toArray:()=>rows,[Symbol.iterator]:function*(){yield*rows;}};
 }};
 return {
  sql,
  transactionSync(fn){
   db.exec('BEGIN IMMEDIATE');
   try{const out=fn();db.exec('COMMIT');return out;}
   catch(err){db.exec('ROLLBACK');throw err;}
  }
 };
}

function makeFrozenSource(){
 const doc=new Y.Doc();doc.clientID=202202;
 const m=doc.getMap('eventos');
 m.set('frozen-op-001',ev('frozen-op-001',1100));
 m.set('frozen-op-002',ev('frozen-op-002',2200));
 const bytes=Y.encodeStateAsUpdate(doc),vector=Y.encodeStateVector(doc);
 doc.destroy();
 return {
  channel:'ops',frozenHead:'c69-frozen-head-1',completeToHead:true,
  frames:[bytes],expectedStateSha256:sha(bytes),expectedVectorSha256:sha(vector),expectedOpIds:2,
  bytes
 };
}

async function makeOccupiedScenario(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'f123-c69-'));
 const file=path.join(dir,'union.sqlite');
 let db=new DatabaseSync(file);
 let storage=wrap(db);
 storage.sql.exec('CREATE TABLE diario (n INTEGER PRIMARY KEY AUTOINCREMENT,cambio BLOB)');
 storage.sql.exec('CREATE TABLE diario_bloques (n INTEGER NOT NULL,parte INTEGER NOT NULL,contenido BLOB NOT NULL,PRIMARY KEY(n,parte))');
 storage.sql.exec('CREATE TABLE documento (id INTEGER PRIMARY KEY,contenido BLOB)');
 storage.sql.exec('CREATE TABLE documento_bloques (n INTEGER PRIMARY KEY,contenido BLOB NOT NULL)');

 const localDoc=new Y.Doc();localDoc.clientID=303303;
 localDoc.getMap('eventos').set('local-op-001',ev('local-op-001',3300));
 const localUpdate=Y.encodeStateAsUpdate(localDoc);
 localDoc.destroy();
 storage.sql.exec('INSERT INTO diario (cambio) VALUES (?)',localUpdate);

 const source=makeFrozenSource();
 const merged=await mergeFrozenIntoExisting({storage,source});
 assert.equal(merged.opened,true);

 const futureDoc=new Y.Doc();futureDoc.clientID=554422;
 futureDoc.getMap('eventos').set('postcut-op-001',ev('postcut-op-001',4400));
 const futureUpdate=Y.encodeStateAsUpdate(futureDoc);
 futureDoc.destroy();

 return {
  storage,db,source,localUpdate,futureUpdate,
  async reopen(){return openExistingStore({env,storage});},
  compact(bytes){
   db.exec('BEGIN IMMEDIATE');
   try{
    storage.sql.exec('DELETE FROM diario_bloques');
    storage.sql.exec('DELETE FROM diario');
    storage.sql.exec('DELETE FROM documento_bloques');
    storage.sql.exec('DELETE FROM documento');
    storage.sql.exec('INSERT INTO documento_bloques (n,contenido) VALUES (0,?)',bytes);
    db.exec('COMMIT');
   }catch(err){db.exec('ROLLBACK');throw err;}
  },
  clean(){try{db.close();}catch{}fs.rmSync(dir,{recursive:true,force:true});}
 };
}

test('C69 control: occupied union + post-cut forward ops + compaction reopen opened:true',async()=>{
 const s=await makeOccupiedScenario();
 try{
  s.storage.sql.exec('INSERT INTO diario (cambio) VALUES (?)',s.futureUpdate);
  const first=await s.reopen();
  assert.equal(first.opened,true,JSON.stringify(first));
  const full=new Y.Doc();
  try{
   Y.applyUpdate(full,s.source.bytes);
   Y.applyUpdate(full,s.localUpdate);
   Y.applyUpdate(full,s.futureUpdate);
   s.compact(Y.encodeStateAsUpdate(full));
  }finally{full.destroy();}
  const second=await s.reopen();
  assert.equal(second.opened,true,JSON.stringify(second));
  assert.equal(second.verifiedEvents,4);
 }finally{s.clean();}
});

test('C69 RED P0: impostor writer replacing union clocks after post-cut ops must NOT reopen',async()=>{
 const s=await makeOccupiedScenario();
 try{
  // Same keys & JSON payloads as frozen+local+postcut, so eventsDigest matches 100%,
  // AND rows.size (4) > cert.union_events (3) bypasses union_sha256 check!
  const impostor=new Y.Doc();impostor.clientID=999888;
  try{
   const m=impostor.getMap('eventos');
   m.set('frozen-op-001',ev('frozen-op-001',1100));
   m.set('frozen-op-002',ev('frozen-op-002',2200));
   m.set('local-op-001',ev('local-op-001',3300));
   m.set('postcut-op-001',ev('postcut-op-001',4400));
   s.compact(Y.encodeStateAsUpdate(impostor));
  }finally{impostor.destroy();}
  const r=await s.reopen();
  assert.equal(r.opened,false,'must refuse when original frozen+local Yjs writer clocks disappeared');
  assert.match(r.failback||'',/vector|clock|causal/i);
 }finally{s.clean();}
});

test('C69 RED P0: dropping ONLY local pre-union writer clock while keeping frozen clock must NOT reopen',async()=>{
 const s=await makeOccupiedScenario();
 try{
  const partial=new Y.Doc();partial.clientID=777111;
  try{
   Y.applyUpdate(partial,s.source.bytes); // keeps clientID 202202
   const m=partial.getMap('eventos');
   m.set('local-op-001',ev('local-op-001',3300)); // forged by 777111 instead of 303303
   m.set('postcut-op-001',ev('postcut-op-001',4400));
   s.compact(Y.encodeStateAsUpdate(partial));
  }finally{partial.destroy();}
  const r=await s.reopen();
  assert.equal(r.opened,false,'must refuse when pre-union local writer clock is missing');
  assert.match(r.failback||'',/vector|clock|causal/i);
 }finally{s.clean();}
});

test('C69 RED P0: missing f123_frozen_union_vectors table cannot self-certify on reopen',async()=>{
 const s=await makeOccupiedScenario();
 try{
  s.storage.sql.exec('DROP TABLE IF EXISTS f123_frozen_union_vectors');
  const r=await s.reopen();
  assert.equal(r.opened,false,'legacy or stripped union without immutable vectors must fail closed');
  assert.match(r.failback||'',/vector/i);
 }finally{s.clean();}
});

test('C69 RED P0: tampered frozen_vector bytes failing cert.vector_sha256 must fail closed',async()=>{
 const s=await makeOccupiedScenario();
 try{
  s.storage.sql.exec('UPDATE f123_frozen_union_vectors SET frozen_vector=? WHERE id=1',Uint8Array.from([1,2,3]));
  const r=await s.reopen();
  assert.equal(r.opened,false);
  assert.match(r.failback||'',/vector/i);
 }finally{s.clean();}
});

test('C69 control: legitimate post-cut Yjs delete on post-cut key preserves union vector dominance',async()=>{
 const s=await makeOccupiedScenario();
 try{
  const full=new Y.Doc();
  try{
   Y.applyUpdate(full,s.source.bytes);
   Y.applyUpdate(full,s.localUpdate);
   Y.applyUpdate(full,s.futureUpdate);
   full.getMap('eventos').delete('postcut-op-001');
   s.compact(Y.encodeStateAsUpdate(full));
  }finally{full.destroy();}
  const r=await s.reopen();
  assert.equal(r.opened,true,JSON.stringify(r));
 }finally{s.clean();}
});
