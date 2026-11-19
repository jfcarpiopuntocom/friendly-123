// P0 PORT 2.0 APP REAL: merge independently certified frozen ops into a nonempty
// YParty SQLite journal WITHOUT replacing local money or replaying an opId twice.
// Native SQLite database on disk, source-executed, synthetic business facts only.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import os from 'node:os';import path from 'node:path';
import {openExistingStore} from '../src/open-existing-store.mjs';
import {exportCompleteYpartyYjs} from '../src/durable-full-yjs-export.mjs';

const sha=b=>createHash('sha256').update(b).digest('hex');
const env={WS_OPEN_EXISTING_QA:'1'};
const mkEvent=(name,cents)=>({kind:'sale.record',amountCents:cents,opId:name});
function frozen(){
 const doc=new Y.Doc();doc.clientID=202;
 const map=doc.getMap('eventos');
 for(let i=0;i<100;i++)map.set('historical-'+String(i).padStart(3,'0'),mkEvent('historical-'+String(i).padStart(3,'0'),i+1));
 const state=Y.encodeStateAsUpdate(doc),vector=Y.encodeStateVector(doc);
 const source={channel:'ops',frozenHead:'certified-head-100',completeToHead:true,frames:[state],
  expectedStateSha256:sha(state),expectedVectorSha256:sha(vector),expectedOpIds:100};
 doc.destroy();return source;
}
function local({overlap=null,collision=false}={}){
 const doc=new Y.Doc();doc.clientID=303;const events=doc.getMap('eventos');
 for(let i=0;i<10;i++){
  const id=i===0&&overlap?'historical-003':'local-'+String(i).padStart(3,'0');
  events.set(id,mkEvent(id,(i===0&&overlap&&!collision)?4:1000+i));
 }
 const update=Y.encodeStateAsUpdate(doc);
 const baseline=new Map(events.entries());
 doc.destroy();return {update,baseline};
}
function sqlStore({overlap=null,collision=false}={}){
 const dir=mkdtempSync(path.join(os.tmpdir(),'f123-gate-d4-'));
 const file=path.join(dir,'shop.sqlite');
 let db=new DatabaseSync(file);
 const wrap=d=>({
  sql:{exec(statement,...args){
   const prepared=d.prepare(statement);
   const values=args.map(v=>v instanceof Uint8Array?Buffer.from(v):v);
   const rows=/^\s*(?:SELECT|PRAGMA)\b/i.test(statement)?prepared.all(...values):
     /\bRETURNING\b/i.test(statement)?prepared.all(...values):(prepared.run(...values),[]);
   return {toArray:()=>rows,one:()=>rows[0],[Symbol.iterator]:function*(){yield*rows;}};
  }},
  transactionSync(callback){
   d.exec('BEGIN IMMEDIATE');
   try{const out=callback();d.exec('COMMIT');return out;}
   catch(error){d.exec('ROLLBACK');throw error;}
  }
 });
 let storage=wrap(db);
 storage.sql.exec('CREATE TABLE diario (n INTEGER PRIMARY KEY AUTOINCREMENT,cambio BLOB)');
 storage.sql.exec('CREATE TABLE diario_bloques (n INTEGER NOT NULL,parte INTEGER NOT NULL,contenido BLOB NOT NULL,PRIMARY KEY(n,parte))');
 storage.sql.exec('CREATE TABLE documento (id INTEGER PRIMARY KEY,contenido BLOB)');
 storage.sql.exec('CREATE TABLE documento_bloques (n INTEGER PRIMARY KEY,contenido BLOB NOT NULL)');
 const l=local({overlap,collision});
 storage.sql.exec('INSERT INTO diario (cambio) VALUES (?)',l.update);
 return {
  storage,local:l,
  reopen(){db.close();db=new DatabaseSync(file);storage=wrap(db);return storage;},
  destroy(){try{db.close()}catch{}rmSync(dir,{recursive:true,force:true});},
  count(name){return Number(storage.sql.exec('SELECT COUNT(*) AS n FROM '+name).one().n)}
 };
}
async function exported(store){
 const x=await exportCompleteYpartyYjs({storage:store.storage,channel:'ops'});
 const doc=new Y.Doc();Y.applyUpdate(doc,x.bytes);
 return {doc,x,events:doc.getMap('eventos')};
}
test('RED real SQL: 10 locally committed sales + 100 frozen sales => 110 immutable opIds and same cents',{timeout:15000},async()=>{
 const store=sqlStore(),source=frozen();
 try{
  const r=await openExistingStore({env,storage:store.storage,source});
  assert.equal(r.opened,true,JSON.stringify(r));
  const {doc,events}=await exported(store);
  try{
   assert.equal(events.size,110);
   const actual=[...events.values()].reduce((n,v)=>n+v.amountCents,0);
   const expected=Array.from({length:100},(_,i)=>i+1).reduce((a,b)=>a+b,0)+
    Array.from({length:10},(_,i)=>1000+i).reduce((a,b)=>a+b,0);
   assert.equal(actual,expected,'money preserved, not incrementally replayed');
   for(const [id,payload] of store.local.baseline)assert.deepEqual(events.get(id),payload,id);
   assert.equal(doc.store.pendingStructs,null);assert.equal(doc.store.pendingDs,null);
  }finally{doc.destroy();}
  assert.equal(store.count('f123_frozen_imports'),0,'nonempty union does not forge an empty-store import');
 }finally{store.destroy();}
});
test('cold reopen with source unavailable proves the same 110 financial facts without rewriting them',async()=>{
 const store=sqlStore(),source=frozen();
 try{
  assert.equal((await openExistingStore({env,storage:store.storage,source})).opened,true);
  const reopened=store.reopen();
  const r=await openExistingStore({env,storage:reopened,source:undefined});
  assert.equal(r.opened,true,JSON.stringify(r));
  assert.equal(r.already,true);
  const {doc,events}=await exported({...store,storage:reopened});
  try{assert.equal(events.size,110);}finally{doc.destroy();}
 }finally{store.destroy();}
});
test('same frozen source retry before restart is idempotent: no double journal or money',async()=>{
 const store=sqlStore(),source=frozen();
 try{
  assert.equal((await openExistingStore({env,storage:store.storage,source})).opened,true);
  const priorJournal=store.count('diario');
  const r=await openExistingStore({env,storage:store.storage,source});
  assert.equal(r.opened,true,JSON.stringify(r));assert.equal(r.already,true);
  assert.equal(store.count('diario'),priorJournal,'no duplicate SQL append');
 }finally{store.destroy();}
});
test('conflicting same-opId amount is rejected and original SQL bytes remain untouched',async()=>{
 const store=sqlStore({overlap:true,collision:true}),source=frozen();
 try{
  const before=await exported(store);const initial=sha(before.x.bytes);before.doc.destroy();
  const journal=store.count('diario');
  const r=await openExistingStore({env,storage:store.storage,source});
  assert.equal(r.opened,false,'conflicting economic fact must never ACK');
  assert.match(r.failback,/conflict|opId|event/i);
  const after=await exported(store);
  assert.equal(sha(after.x.bytes),initial);
  after.doc.destroy();
  assert.equal(store.count('diario'),journal);
 }finally{store.destroy();}
});
test('identical same-opId collision must deduplicate without losing the other 9 local sales',async()=>{
 const store=sqlStore({overlap:true,collision:false}),source=frozen();
 try{
  const r=await openExistingStore({env,storage:store.storage,source});
  assert.equal(r.opened,true,JSON.stringify(r));
  const {doc,events}=await exported(store);
  try{assert.equal(events.size,109);assert.equal(events.get('historical-003').amountCents,4);}finally{doc.destroy();}
 }finally{store.destroy();}
});
test('SQL injection failure during union commit must roll back all cert and journal mutations',async()=>{
 const store=sqlStore(),source=frozen(),real=store.storage;
 let thrown=false;
 const broken={...real,sql:{exec(sql,...args){
  if(sql.includes('INSERT INTO f123_frozen_unions')&&!thrown){thrown=true;throw Error('synthetic SQLITE_FULL');}
  return real.sql.exec(sql,...args);
 }}};
 try{
  const journal=store.count('diario');
  const r=await openExistingStore({env,storage:broken,source});
  assert.equal(r.opened,false,JSON.stringify(r));
  assert.equal(store.count('diario'),journal);
  assert.equal(store.storage.sql.exec("SELECT name FROM sqlite_master WHERE name='f123_frozen_unions'").toArray().length,0);
 }finally{store.destroy();}
});
test('flag OFF leaves nonempty SQL and revenue unchanged',async()=>{
 const store=sqlStore(),source=frozen();
 try{
  const journal=store.count('diario');
  const r=await openExistingStore({env:{WS_OPEN_EXISTING_QA:'0'},storage:store.storage,source});
  assert.equal(r.opened,false);assert.equal(store.count('diario'),journal);
 }finally{store.destroy();}
});
