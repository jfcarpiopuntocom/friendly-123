'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const src = fs.readFileSync(path.join(__dirname,'../docs/estado-idb.js'),'utf8');

function fixture({failure='quota', cacheNames=['f123-shell-v650-golden120','f123-shell-v679-golden223'], takeover=false}={}) {
  const memory = {_rev:7, ventas:[]};
  let stored = memory, tries=0, deletes=[], beforeRetry=0;
  const old = new Set(cacheNames);
  const caches = {
    keys: async () => Array.from(old),
    delete: async name => {
      deletes.push(name);
      const removed=old.delete(name);
      if(takeover) stored={_rev:9,ventas:[{id:'other-tab-sale'}]};
      return removed;
    }
  };
  const db = {
    objectStoreNames:{contains:()=>true},
    transaction(){
      tries++;
      const thisAttempt=tries;
      let pending=null;
      const tx = {
        error:null,
        objectStore(){return {
          get(){
            const req={result:stored};
            queueMicrotask(()=>{
              req.onsuccess();
              queueMicrotask(()=>{
                if(thisAttempt===1 && failure!=='none' && pending){
                  const error=new Error(failure);error.name=failure==='quota'?'QuotaExceededError':'AbortError';
                  tx.error=error;
                  tx.onabort();
                } else {
                  if(pending)stored=pending;
                  tx.oncomplete();
                }
              });
            });
            return req;
          },
          put(snapshot){pending=structuredClone(snapshot);}
        };}
      };
      return tx;
    }
  };
  const indexedDB={open(){
    const req={result:db};
    queueMicrotask(()=>req.onsuccess());
    return req;
  }};
  const window={indexedDB,caches};
  vm.runInNewContext(src,{window,indexedDB,navigator:{storage:{}},console,Promise,setTimeout,clearTimeout,queueMicrotask,structuredClone});
  return {idb:window.OCEstadoIDB,get state(){return stored},get tries(){return tries},get removed(){return deletes},get remaining(){return Array.from(old)}};
}

test('QuotaExceededError on strict sale releases only obsolete shell cache then retries exact CAS',async()=>{
  const f=fixture();
  const ok=await f.idb.guardarConRevision({_rev:8,ventas:[{id:'synthetic-sale'}]},7);
  assert.equal(ok,true,'sale must finish only after a real IDB commit');
  assert.equal(f.tries,2,'one and only one retry after actual quota');
  assert.deepEqual(f.removed,['f123-shell-v650-golden120']);
  assert.equal(f.remaining.includes('f123-shell-v679-golden223'),true,'never delete active offline shell');
  assert.equal(f.state._rev,8);
  assert.equal(f.state.ventas[0].id,'synthetic-sale');
});

test('non-quota failure does not delete caches or retry',async()=>{
  const f=fixture({failure:'abort'});
  assert.equal(await f.idb.guardarConRevision({_rev:8},7),false);
  assert.equal(f.tries,1);
  assert.equal(f.removed.length,0);
});

test('quota with no obsolete shell cache remains failure, never optimistic ACK',async()=>{
  const f=fixture({cacheNames:['f123-shell-v679-golden223']});
  assert.equal(await f.idb.guardarConRevision({_rev:8},7),false);
  assert.equal(f.tries,1);
});

test('a foreign sale between cleanup and retry rejects stale CAS without overwriting',async()=>{
  const f=fixture({takeover:true});
  assert.equal(await f.idb.guardarConRevision({_rev:8,ventas:[{id:'own-sale'}]},7),false);
  assert.equal(f.tries,2);
  assert.equal(f.state._rev,9);
  assert.equal(f.state.ventas[0].id,'other-tab-sale');
});

test('stale revision without quota never deletes caches',async()=>{
  const f=fixture({failure:'none'});
  const ok=await f.idb.guardarConRevision({_rev:7},6);
  assert.equal(ok,false);
  assert.equal(f.removed.length,0);
});
