// Gate D5 RED→GREEN: memory refusal BEFORE Yjs and pre-transaction PITR on occupied SQL.
// Native real SQLite contract, synthetic facts only. Exact original Gate D4 module.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as Y from 'yjs';
import {createHash} from 'node:crypto';
import {mergeFrozenIntoExisting,verifyFrozenUnionReopen} from '../src/merge-frozen-into-existing.mjs';
import {openExistingStore} from '../src/open-existing-store.mjs';

const MiB=1024*1024;
const sha=b=>createHash('sha256').update(b).digest('hex');
const env={WS_OPEN_EXISTING_QA:'1'};
function source(count=100){
 const doc=new Y.Doc();doc.clientID=202;
 for(let i=0;i<count;i++){
  const opId='historical-'+String(i).padStart(3,'0');
  doc.getMap('eventos').set(opId,{kind:'sale.record',opId,amountCents:i+1});
 }
 const bytes=Y.encodeStateAsUpdate(doc),vector=Y.encodeStateVector(doc);
 doc.destroy();
 return {channel:'ops',frozenHead:'frozen-head-d5-01',completeToHead:true,
  frames:[bytes],expectedStateSha256:sha(bytes),expectedVectorSha256:sha(vector),expectedOpIds:count};
}
function shop(){
 const dir=mkdtempSync(path.join(os.tmpdir(),'f123-gated5-'));
 const db=new DatabaseSync(path.join(dir,'shop.db'));
 const events=new Y.Doc();events.clientID=303;
 for(let i=0;i<10;i++){
  const opId='local-'+String(i).padStart(3,'0');
  events.getMap('eventos').set(opId,{kind:'sale.record',opId,amountCents:1000+i});
 }
 const localBytes=Y.encodeStateAsUpdate(events);events.destroy();
 const trace=[];
 const storage={
  sql:{exec(q,...args){
   const p=db.prepare(q),values=args.map(v=>v instanceof Uint8Array?Buffer.from(v):v);
   const rows=/^\\s*(SELECT|PRAGMA)/i.test(q)||/RETURNING/i.test(q)?
    p.all(...values):(p.run(...values),[]);
   return {toArray:()=>rows,one:()=>rows[0],[Symbol.iterator]:function*(){yield* rows}};
  }},
  transactionSync(fn){
   trace.push('BEGIN');
   db.exec('BEGIN IMMEDIATE');
   try{const value=fn();db.exec('COMMIT');trace.push('COMMIT');return value}
   catch(error){db.exec('ROLLBACK');trace.push('ROLLBACK');throw error;}
  }
 };
 storage.sql.exec('CREATE TABLE diario (n INTEGER PRIMARY KEY AUTOINCREMENT,cambio BLOB)');
 storage.sql.exec('CREATE TABLE diario_bloques (n INTEGER NOT NULL,parte INTEGER NOT NULL,contenido BLOB NOT NULL,PRIMARY KEY(n,parte))');
 storage.sql.exec('CREATE TABLE documento (id INTEGER PRIMARY KEY,contenido BLOB)');
 storage.sql.exec('CREATE TABLE documento_bloques (n INTEGER PRIMARY KEY,contenido BLOB NOT NULL)');
 storage.sql.exec('INSERT INTO diario (cambio) VALUES (?)',localBytes);
 const countRows=tbl=>Number(storage.sql.exec('SELECT COUNT(*) AS n FROM '+tbl).one().n);
 return {storage,trace,countRows,destroy(){db.close();rmSync(dir,{recursive:true,force:true})}};
}
test('oversized wire refuses before any Yjs and leaves journal+SQL cert untouched',async()=>{
 const s=shop(),history=source();
 try{
  history.frames=[new Uint8Array(12*MiB+1)]; // invalid Yjs: size must reject BEFORE decoder
  const before=s.countRows('diario');
  await assert.rejects(mergeFrozenIntoExisting({storage:s.storage,source:history}),/wire|size|memory|budget|limit/i);
  assert.equal(s.countRows('diario'),before);
  assert.equal(s.storage.sql.exec("SELECT name FROM sqlite_master WHERE name='f123_frozen_unions'").toArray().length,0);
 }finally{s.destroy();}
});
test('tightened test-call maxWireBytes refuses a valid small history with no transaction',async()=>{
 const s=shop(),history=source();
 try{
  const before=s.countRows('diario');
  await assert.rejects(mergeFrozenIntoExisting({storage:s.storage,source:history,limits:{maxWireBytes:100}}),/wire|size|budget|limit/i);
  assert.equal(s.countRows('diario'),before);
  assert.equal(s.storage.sql.exec("SELECT name FROM sqlite_master WHERE name='f123_frozen_unions'").toArray().length,0);
 }finally{s.destroy();}
});
test('tightened final union-size ceiling refuses before SQL commit',async()=>{
 const s=shop(),history=source();
 try{
  await assert.rejects(mergeFrozenIntoExisting({storage:s.storage,source:history,limits:{maxUnionBytes:100}}),/union|size|budget|memory/i);
  assert.equal(s.countRows('diario'),1);
  assert.equal(s.storage.sql.exec("SELECT name FROM sqlite_master WHERE name='f123_frozen_unions'").toArray().length,0);
 }finally{s.destroy();}
});
test('tightened estimated peak ceiling refuses a valid small source',async()=>{
 const s=shop(),history=source();
 try{
  await assert.rejects(mergeFrozenIntoExisting({storage:s.storage,source:history,limits:{maxEstimatedPeakBytes:1000}}),/peak|size|budget|memory/i);
  assert.equal(s.countRows('diario'),1);
 }finally{s.destroy();}
});
test('PITR bookmark taken BEFORE transaction and persisted in union certificate',async()=>{
 const s=shop(),history=source();
 s.storage.getCurrentBookmark=async()=>{s.trace.push('PITR');return 'bmk-0001'};
 try{
  const result=await mergeFrozenIntoExisting({storage:s.storage,source:history});
  assert.equal(result.opened,true);
  assert.equal(result.receipt.pitrBookmark,'bmk-0001');
  assert.equal(result.receipt.pitrAvailable,true);
  const cert=s.storage.sql.exec('SELECT pitr_bookmark FROM f123_frozen_unions WHERE id=1').one();
  assert.equal(cert.pitr_bookmark,'bmk-0001');
  assert.ok(s.trace.indexOf('PITR')<s.trace.indexOf('BEGIN'));
  const reread=verifyFrozenUnionReopen({storage:s.storage});
  assert.equal(reread.opened,true);
  assert.equal(reread.pitrBookmark,'bmk-0001');
 }finally{s.destroy();}
});
test('platform without PITR API stores NULL and transparently marks it unavailable',async()=>{
 const s=shop();
 try{
  const result=await mergeFrozenIntoExisting({storage:s.storage,source:source()});
  assert.equal(result.opened,true);
  assert.equal(result.receipt.pitrBookmark,null);
  assert.equal(result.receipt.pitrAvailable,false);
  assert.equal(s.storage.sql.exec('SELECT pitr_bookmark FROM f123_frozen_unions WHERE id=1').one().pitr_bookmark,null);
 }finally{s.destroy();}
});
test('unexpected PITR bookmark failure refuses merge without any SQL change',async()=>{
 const s=shop();s.storage.getCurrentBookmark=async()=>{throw Error('PITR service unavailable')};
 try{
  await assert.rejects(mergeFrozenIntoExisting({storage:s.storage,source:source()}),/PITR|bookmark|unavailable/i);
  assert.equal(s.countRows('diario'),1);
  assert.equal(s.storage.sql.exec("SELECT name FROM sqlite_master WHERE name='f123_frozen_unions'").toArray().length,0);
 }finally{s.destroy();}
});
test('tampering ONLY events_sha256 at unchanged opId count and Yjs SHA refuses reopen',async()=>{
 const s=shop();
 try{
  assert.equal((await openExistingStore({env,storage:s.storage,source:source()})).opened,true);
  s.storage.sql.exec('UPDATE f123_frozen_unions SET events_sha256=? WHERE id=1','f'.repeat(64));
  const r=await openExistingStore({env,storage:s.storage,source:undefined});
  assert.equal(r.opened,false);
  assert.match(r.failback,/digest|mismatch|certif/i);
  assert.equal(s.countRows('diario'),2);
 }finally{s.destroy();}
});
