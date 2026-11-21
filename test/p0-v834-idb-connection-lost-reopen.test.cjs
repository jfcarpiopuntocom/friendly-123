'use strict';
// P0 v834 RED-first (WebKit 273827/235579): iOS Safari aborts an IDB transaction with
// UnknownError "Connection to Indexed Database server lost". The aborted transaction committed
// nothing, so the strict CAS must reopen ONCE and retry the exact same revision. Synthetic data.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../docs/estado-idb.js'),'utf8');

function fixture(abortFirstWith,abortSecondWith=null){
 let opens=0,puts=0,closed=0,txs=0;
 const saved={actual:{_rev:4,productos:[],ventas:[]}};
 const indexedDB={open(){
   const req={},attempt=++opens;
   const db={
     objectStoreNames:{contains:()=>true},
     close(){closed++},
     transaction(){
       const n=++txs;const failWith=n===1?abortFirstWith:abortSecondWith;
       let candidate,aborted=false;
       const tx={error:null,objectStore(){return {
         get(key){const get={};queueMicrotask(()=>{get.result=saved[key];get.onsuccess?.();
           queueMicrotask(()=>{
             if(failWith){aborted=true;tx.error=new DOMException('Connection to Indexed Database server lost. Refresh the page to try again',failWith);tx.onerror?.();tx.onabort?.();return;}
             if(aborted)return;if(candidate)saved[key]=candidate;tx.oncomplete?.();});});return get;},
         put(next){candidate=next;puts++;}
       }},abort(){aborted=true;queueMicrotask(()=>tx.onabort?.())}};
       return tx;
     }
   };
   queueMicrotask(()=>{req.result=db;req.onsuccess?.()});
   return req;
 }};
 const window={indexedDB};
 new Function('window','indexedDB','navigator','setTimeout','clearTimeout','console',source)(
   window,indexedDB,{onLine:false},setTimeout,clearTimeout,{error(){},warn(){}}
 );
 return {api:window.OCEstadoIDB,stats:()=>({opens,puts,closed,txs,saved})};
}

test('P0 v834 RED: UnknownError "connection lost" abort reopens IDB ONCE and commits the exact strict CAS',async()=>{
 const f=fixture('UnknownError');
 const sale={_rev:5,productos:[{id:'p',stockActual:3}],ventas:[{id:'v1'}]};
 assert.equal(await f.api.guardarConRevision(sale,4),true,'lost connection is recoverable without a false ACK');
 const s=f.stats();
 assert.equal(s.opens,2,'reopen exactly once');assert.equal(s.closed,1,'old handle closed');
 assert.equal(s.saved.actual._rev,5,'exact revision committed after reopen');
});

test('P0 v834: a second UnknownError fails closed (no ACK, no third attempt)',async()=>{
 const f=fixture('UnknownError','UnknownError');
 assert.equal(await f.api.guardarConRevision({_rev:5,productos:[],ventas:[]},4),false);
 const s=f.stats();assert.equal(s.opens,2);assert.equal(s.txs,2);assert.equal(s.saved.actual._rev,4,'nothing committed');
});
