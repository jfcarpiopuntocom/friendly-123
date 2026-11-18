'use strict';
// Actual LIVE module inside VM, synthetic browser storage only.
// The early onblocked error may later be followed by onsuccess: close that
// orphan connection so another Safari/PWA tab can upgrade IndexedDB safely.
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../docs/sync-outbox.js'),'utf8');
test('late onsuccess after onblocked closes orphan IndexedDB connection',async()=>{
  let closed=0;const reqs=[];
  const db={close(){closed++;},transaction(){throw Error('orphan DB cannot be used');}};
  const local=new Map();
  const root={window:{},console:{warn(){}},Date,Promise,
    indexedDB:{open(){const r={result:db};reqs.push(r);
      queueMicrotask(()=>r.onblocked?.());return r;}},
    localStorage:{getItem:k=>local.get(k)||null,setItem:(k,v)=>local.set(k,v),
      removeItem:k=>local.delete(k)}
  };
  vm.runInNewContext(source,root,{filename:'sync-outbox.js'});
  assert.equal(await root.window.OCOutbox.guardar('synthetic-blob'),true,
    'blocked open must fall back to encrypted legacy storage');
  assert.equal(local.get('f123_sync_pending'),'synthetic-blob');
  reqs[0].onsuccess();
  assert.equal(closed,1,'late connection must close, not leak');
});
