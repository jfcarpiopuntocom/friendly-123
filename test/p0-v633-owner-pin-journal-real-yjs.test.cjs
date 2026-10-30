'use strict';
// P0 R3: real bundled Yjs, synthetic IndexedDB transaction outcomes. No client data.
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {browser}=require('./helpers/browser.cjs');
const source=fs.readFileSync(path.join(__dirname,'../docs/sync-yjs.js'),'utf8');
const start=source.indexOf('    API.confirmarPinOwnerDurable = function (nuevo, revision) {');
const end=source.indexOf('    // P0 v621: only an explicit change',start);
assert.ok(start>0&&end>start,'production PIN journal helper');
const fn=source.slice(start,end);
function fixture(){
  const w=browser();delete w.JSON;
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../docs/vendor/yjs-bundle.min.js'),'utf8'),w);
  const doc=new w.Y.Doc(),meta=doc.getMap('_meta');
  let committed=[],abort=false,hold=null;
  const db={objectStoreNames:{contains:key=>key==='updates'},transaction(names,kind){
    assert.equal(names[0],'updates');assert.equal(kind,'readonly');
    const tx={};tx.objectStore=()=>({getAll(){
      const req={};
      queueMicrotask(()=>{
        if(abort){tx.onabort?.();return;}
        req.result=committed.map(x=>new Uint8Array(x));req.onsuccess?.();
        if(hold){hold(tx);return;}
        queueMicrotask(()=>tx.oncomplete?.());
      });return req;
    }});return tx;
  }};
  const API={doc,meta,roomId:'synthetic-room',idb:{db},canal:{recuperando:false}};
  API.confirmarPinOwnerDurable=new Function('API','Y',fn+';return API.confirmarPinOwnerDurable;')(API,w.Y);
  const put=(pin,rev)=>doc.transact(()=>{meta.set('ownerPinConfirmado',pin);meta.set('ownerPinCambioRev',rev);meta.set('pinsRol',{owner:pin,emp:'583',acct:'914'})});
  return {w,doc,meta,API,put,commit:()=>{committed=[w.Y.encodeStateAsUpdate(doc)]},setAbort:v=>{abort=v},setHold:v=>{hold=v}};
}
test('P0 R3: RAM-only owner change cannot retire retry after crash',async()=>{
  const x=fixture();x.put('642',0);x.commit();x.put('731',1);
  assert.equal(await x.API.confirmarPinOwnerDurable('731',1),false);x.doc.destroy();
});
test('P0 R3: exact PIN+revision committed, mismatch rejected',async()=>{
  const x=fixture();x.put('642',0);x.put('731',1);x.commit();
  assert.equal(await x.API.confirmarPinOwnerDurable('731',1),true);
  assert.equal(await x.API.confirmarPinOwnerDurable('731',2),false);x.doc.destroy();
});
test('P0 R3: IndexedDB abort cannot certify an owner change',async()=>{
  const x=fixture();x.put('731',1);x.commit();x.setAbort(true);
  assert.equal(await x.API.confirmarPinOwnerDurable('731',1),false);x.doc.destroy();
});
test('P0 R2: concurrent newer PIN invalidates old journal read',async()=>{
  const x=fixture();x.put('731',1);x.commit();
  let release; x.setHold(tx=>{release=()=>tx.oncomplete?.();});
  const promise=x.API.confirmarPinOwnerDurable('731',1);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(typeof release,'function');
  x.put('842',2);release();assert.equal(await promise,false);
  x.doc.destroy();
});
