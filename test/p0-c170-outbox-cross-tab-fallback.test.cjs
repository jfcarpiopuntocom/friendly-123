'use strict';
// C170 RED→GREEN: source-executed cross-tab outbox race. No customer storage.
// A successful older IDB transaction may finish AFTER another tab persisted
// the newer encrypted queue in localStorage because its IndexedDB was unavailable.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../docs/sync-outbox.js'),'utf8');
const KEY='f123_sync_pending';

function fixture(){
  const local=new Map(),durable=new Map();
  let finishHeld=null;
  const storage={
    getItem(k){return local.get(k)||null;},
    setItem(k,v){local.set(k,v);},
    removeItem(k){local.delete(k);}
  };
  function tab(mode){
    const indexedDB={
      open(){
        const req={error:null};
        queueMicrotask(()=>{
          if(mode==='unavailable'){
            req.error=Object.assign(new Error('IDB unavailable on this tab'),{name:'NotReadableError'});
            req.onerror?.();return;
          }
          req.result={
            transaction(_store,kind){
              const tx={error:null};
              tx.objectStore=()=>({
                put(row){
                  if(mode==='held'){
                    finishHeld=()=>{durable.set(row.id,{...row});tx.oncomplete?.();};
                  }else{
                    queueMicrotask(()=>{durable.set(row.id,{...row});tx.oncomplete?.();});
                  }
                },
                get(k){
                  const request={};
                  queueMicrotask(()=>{request.result=durable.get(k);request.onsuccess?.();});
                  return request;
                }
              });
              return tx;
            }
          };
          req.onsuccess?.();
        });
        return req;
      }
    };
    const context={window:{},indexedDB,localStorage:storage,Date,Promise,console:{warn(){}}};
    vm.runInNewContext(source,context,{filename:'docs/sync-outbox.js'});
    return context.window.OCOutbox;
  }
  return {tab,local,durable,get finishHeld(){return finishHeld;}};
}
async function flush(){await new Promise(resolve=>setImmediate(resolve));}
test('C170 RED: delayed older IDB commit must NOT erase newer fallback written by another tab',async()=>{
  const f=fixture();
  const A=f.tab('held'),B=f.tab('unavailable');
  const pending=A.guardar('ciphertext:older');
  await flush();
  assert.equal(typeof f.finishHeld,'function','A has an IDB transaction waiting to commit');
  assert.equal(await B.guardar('ciphertext:newer-with-sale'),true,'B durable fallback ACK');
  assert.equal(f.local.get(KEY),'ciphertext:newer-with-sale');
  f.finishHeld();
  assert.equal(await pending,true,'A earlier IDB transaction also succeeds');
  assert.equal(f.durable.get(KEY).blob,'ciphertext:older','IDB has not been updated by B');
  assert.equal(f.local.get(KEY),'ciphertext:newer-with-sale','A must not destroy B newer fallback');
  assert.equal(await f.tab('normal').leer(),'ciphertext:newer-with-sale','cold reopen sees newer encrypted queue');
});
test('C170: unchanged OLD fallback still retired by a later successful IDB commit (C163 behavior)',async()=>{
  const f=fixture();
  const failed=f.tab('unavailable');
  assert.equal(await failed.guardar('ciphertext:old-fallback'),true);
  assert.equal(f.local.get(KEY),'ciphertext:old-fallback');
  const working=f.tab('normal');
  assert.equal(await working.guardar('ciphertext:newer-IDB'),true);
  assert.equal(f.local.has(KEY),false,'remove outdated fallback after successful commit');
  assert.equal(await f.tab('normal').leer(),'ciphertext:newer-IDB');
});
test('C170: matching duplicate fallback may be retired, never invent zero/empty outbox',async()=>{
  const f=fixture();
  const A=f.tab('held'),B=f.tab('unavailable');
  const pending=A.guardar('ciphertext:same');
  await flush();
  assert.equal(await B.guardar('ciphertext:same'),true);
  f.finishHeld();
  assert.equal(await pending,true);
  assert.equal(await f.tab('normal').leer(),'ciphertext:same');
});
