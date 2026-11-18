'use strict';
// RED-first proof against LIVE docs/sync-yjs.js v2 outbox functions.
// No replacement outbox algorithm: 2 VM browser tabs run source-extracted code
// against the SAME actual fake-indexeddb IDB transactions and named Web Lock.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {indexedDB,IDBKeyRange}=require('fake-indexeddb');
const source=fs.readFileSync(path.join(__dirname,'../docs/sync-yjs.js'),'utf8');
const begin=source.indexOf('    var _v2DB = null, _v2Ready = null, _v2Cache = null');
const end=source.indexOf('    var _durableQueue = leerOutbox()',begin);
assert.ok(begin>0&&end>begin,'extract real v2 IDB + mutarOutbox Web Locks');
const actual=source.slice(begin,end);
const key='f123_relay_outbox_v1-y',meta='f123_relay_outbox_v2-y:meta';
let seq=0;
async function open(){
 const name='f123-v2-concurrent-'+(++seq);
 return new Promise((resolve,reject)=>{
  const req=indexedDB.open(name,1);
  req.onupgradeneeded=()=>req.result.createObjectStore('custom');
  req.onsuccess=()=>resolve(req.result);
  req.onerror=()=>reject(req.error);
 });
}
function storage(db){
 const get=k=>new Promise((resolve,reject)=>{
  const tx=db.transaction('custom','readonly'),req=tx.objectStore('custom').get(k);
  req.onsuccess=()=>resolve(req.result);
  req.onerror=tx.onabort=()=>reject(req.error||tx.error||Error('read failed'));
 });
 const set=(k,v)=>new Promise((resolve,reject)=>{
  const tx=db.transaction('custom','readwrite');tx.objectStore('custom').put(v,k);
  tx.oncomplete=resolve;tx.onabort=tx.onerror=()=>reject(tx.error||Error('write failed'));
 });
 return{db,_db:Promise.resolve(db),get,set};
}
function lockManager(){
 const pending=new Map();let entered=0,maxConcurrent=0,visits=0;
 return{locks:{
  request(name,fn){
   assert.match(name,/^f123-relay-outbox-synthetic-room-y$/);
   const prior=pending.get(name)||Promise.resolve();
   const next=prior.then(async()=>{
    entered++;visits++;maxConcurrent=Math.max(maxConcurrent,entered);
    try{return await fn();}finally{entered--;}
   });
   pending.set(name,next.catch(()=>{}));
   return next;
  }
 },stats(){return{visits,maxConcurrent}}};
}
function tab(db,locks,opts={}){
 const unsaved=[],groupAcks=new Set(),durableSignals=[];
 const ctx=vm.createContext({
  API:{rollout:{outboxV2:true},roomId:'synthetic-room'},
  suffix:'-y',persistencia:opts.persistencia||storage(db),IDBKeyRange,navigator:locks?{locks}:undefined,
  localStorage:{getItem(){return null},setItem(){}},
  _outboxKey:key,_outbox:{pending:[],confirmed:[],checkpoint:''},
  _unsaved:unsaved,_groupAcks:groupAcks,avisarDurable(){durableSignals.push(1)},
  log(){},Promise,JSON,Map,Set,Array,Object,Number,Error,
 });
 vm.runInContext(actual+`
  this.outboxRead=()=>leerOutbox();
  this.outboxQueue=async(entry)=>{_unsaved.push(entry);await mutarOutbox(function(){});};
  this.outboxAck=async(id)=>mutarOutbox(function(){
   _outbox.pending=_outbox.pending.filter(entry=>entry.id!==id);
   if(!_outbox.confirmed.includes(id))_outbox.confirmed.push(id);
  });
  this.outboxLockAvailable=()=>typeof navigator!=='undefined' && !!navigator.locks;
  `,ctx);
 return{read:()=>ctx.outboxRead(),queue:x=>ctx.outboxQueue(x),ack:id=>ctx.outboxAck(id),signals:durableSignals,lockAvailable:ctx.outboxLockAvailable,unsaved:()=>ctx._unsaved};
}
const item=id=>({k:'op',id,c:'synthetic-ciphertext-'+id,group:id,fingerprint:'hash-'+id});
const ids=queue=>Array.from(queue.pending,e=>String(e.id)).sort();

test('two actual v2 IDB tab writers under one named Web Lock keep BOTH independent opIds and a third tab cold-reads them',async()=>{
 const db=await open(),lock=lockManager();
 try{
  await storage(db).set(key,{pending:[],confirmed:[],checkpoint:''});
  const a=tab(db,lock.locks),b=tab(db,lock.locks);
  await a.read();await b.read();
  await Promise.all([a.queue(item('op-A')),b.queue(item('op-B'))]);
  const c=tab(db,lock.locks);
  assert.deepEqual(ids(await c.read()),['op-A','op-B']);
  assert.equal((await storage(db).get(meta)).v,2);
  assert.equal((await storage(db).get('f123_relay_outbox_v2-y:op:op-A')).id,'op-A');
  assert.equal((await storage(db).get('f123_relay_outbox_v2-y:op:op-B')).id,'op-B');
  assert.equal(lock.stats().maxConcurrent,1,'mutations must be mutually exclusive across VM tabs');
  assert.ok(lock.stats().visits>=2,'real source must acquire the shared lock');
 }finally{db.close();}
});

test('ACK of A races a newly queued C in a second tab: B and C survive, and A is not resurrected after reload',async()=>{
 const db=await open(),lock=lockManager();
 try{
  await storage(db).set(key,{pending:[],confirmed:[],checkpoint:''});
  const a=tab(db,lock.locks),b=tab(db,lock.locks);
  await a.read();await b.read();
  await Promise.all([a.queue(item('op-A')),b.queue(item('op-B'))]);
  await Promise.all([a.ack('op-A'),b.queue(item('op-C'))]);
  const fresh=tab(db,lock.locks),stored=await fresh.read();
  assert.deepEqual(ids(stored),['op-B','op-C']);
  assert.deepEqual(Array.from(stored.confirmed),['op-A']);
  assert.equal((await storage(db).get('f123_relay_outbox_v2-y:op:op-A')),undefined);
  assert.equal(lock.stats().maxConcurrent,1);
 }finally{db.close();}
});

test('a failed IDB commit propagates and does not emit a durable-success signal',async()=>{
 const db=await open(),lock=lockManager();
 try{
  await storage(db).set(key,{pending:[],confirmed:[],checkpoint:''});
  const a=tab(db,lock.locks);
  await a.read();
  db.close();
  await assert.rejects(a.queue(item('op-uncommitted')));
  assert.equal(a.signals.length,0);
 }finally{try{db.close();}catch(_){}}
});

test('when Web Locks are absent the approved safety contract requires explicit single-tab failback, not silent run()',async()=>{
 // This exact source test should be RED until the Opus-required fallback
 // is visibly enforced. Do not award any of the 5 points while it fails.
 const fallback=actual.slice(actual.indexOf('    function mutarOutbox(change)'));
 assert.match(fallback,/navigator\.locks\.request/,'real Web Locks branch exists');
 assert.doesNotMatch(fallback,/\? navigator\.locks\.request\([^\n]+\) : run\(\)/,
  'no-lock browser must not silently perform unsynchronised shared IDB mutations');
});

test('P0 no Web Locks: two actual IDB tabs durably append independent opIds under shared storage',{timeout:9000},async()=>{
 const db=await open();
 try{
  await storage(db).set(key,{pending:[],confirmed:[],checkpoint:''});
  const a=tab(db,undefined),b=tab(db,undefined);
  await a.read();await b.read();
  assert.equal(a.lockAvailable(),false);assert.equal(b.lockAvailable(),false);
  await Promise.all([a.queue(item('nolock-A')),b.queue(item('nolock-B'))]);
  const cold=tab(db,undefined),saved=await cold.read();
  assert.deepEqual(ids(saved),['nolock-A','nolock-B'],'both records must survive without Web Locks');
  assert.equal(a.unsaved().length,0);assert.equal(b.unsaved().length,0);
 }finally{db.close();}
});
test('P0 no Web Locks: a stale writer may NEVER erase ACK tombstones while another appends',{timeout:9000},async()=>{
 const db=await open();
 try{
  await storage(db).set(key,{pending:[],confirmed:[],checkpoint:''});
  const seed=tab(db,undefined);await seed.read();await seed.queue(item('nolock-A'));await seed.queue(item('nolock-B'));
  const a=tab(db,undefined),b=tab(db,undefined);await a.read();await b.read();
  const barrier=(()=>{
   let active=false,count=0,resolve;
   const promise=new Promise(r=>resolve=r);
   return{enable(){active=true;},async awaitBoth(){if(!active)return;count++;if(count===2)resolve();await promise;}};
  })();
  const readMeta=()=>{
   const native=storage(db);
   return{...native,async get(k){const old=await native.get(k);if(k===meta)await barrier.awaitBoth();return old;}};
  };
  // Recreate browser tabs with a synchronized stale-meta read. With a broken
  // RMW algorithm both see the same revision and one ACK tombstone gets lost.
  const left=tab(db,undefined,{persistencia:readMeta()});
  const right=tab(db,undefined,{persistencia:readMeta()});
  await left.read();await right.read();
  barrier.enable();
  await Promise.all([left.ack('nolock-A'),right.queue(item('nolock-C'))]);
  const saved=await tab(db,undefined).read();
  assert.deepEqual(ids(saved),['nolock-B','nolock-C']);
  assert.deepEqual(Array.from(saved.confirmed),['nolock-A'],
   'ACK tombstone must not be lost or silently resuscitate a paid operation');
 }finally{db.close();}
});
test('P0 no Web Locks: failed IDB write cannot claim durable opId or erase local pending',{timeout:9000},async()=>{
 const db=await open();
 const a=tab(db,undefined);await a.read();
 db.close();
 await assert.rejects(a.queue(item('nolock-failed')));
 assert.equal(a.signals.length,0);
 assert.deepEqual(a.unsaved().map(x=>x.id),['nolock-failed']);
});
