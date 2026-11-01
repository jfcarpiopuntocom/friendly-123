'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {webcrypto}=require('node:crypto'),{setTimeout:delay}=require('node:timers/promises');
const {browser}=require('./helpers/browser.cjs');
async function fixture(){
 const w=browser();delete w.JSON;
 Object.assign(w,{crypto:webcrypto,TextEncoder,TextDecoder,
  WebSocket:class{constructor(){throw Error('no network')}},
  BroadcastChannel:class{constructor(){throw Error('no cross-device bus')}}});
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../docs/vendor/yjs-bundle.min.js'),'utf8'),w);
 w.IndexeddbPersistence=class{once(){}};
 w.localStorage.setItem('f123_owned',JSON.stringify({licenseCode:'F123-SYNTHETIC-ONLY'}));
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../docs/sync-yjs.js'),'utf8'),w);
 for(let i=0;i<120&&w.OCYjs.estado!=='activo';i++)await delay(10);
 assert.equal(w.OCYjs.estado,'activo');
 const api=w.OCYjs;
 w.OCTienda.licenciaActual=()=>api.licenciaCodigo;
 w.OCAuth={rolActual:()=> 'dueno'};
 const first=vm.runInContext('JSON.parse('+JSON.stringify(JSON.stringify({
  opId:'phone-opaque-event-1',deviceId:'phone',tipo:'ajuste',
  payload:{productoId:'synthetic-product',delta:-1}
 })) +')',w);
 api.opsMap.set(first.opId,first);
 const update=w.Y.encodeStateAsUpdate(api.opsDoc);
 let begins=0,reads=0;
 const db={
  objectStoreNames:{contains:k=>k==='updates'},
  transaction:(name,mode)=>{
   begins++;assert.equal(name,'updates');assert.equal(mode,'readonly');
   return {objectStore:k=>{
    assert.equal(k,'updates');return {openCursor:()=>{
     const req={};let i=0,arr=[update];
     function tick(){reads++;req.onsuccess({target:{result:i<arr.length?
      {value:arr[i++],continue:()=>queueMicrotask(tick)}:null}})}
     queueMicrotask(tick);return req;
    }};
   }}
  }
 };
 api.opsIdb={whenSynced:Promise.resolve(),db};
 return {w,api,counts:()=>({begins,reads}),original:first};
}
test('persisted Yjs ops are reconstructed read-only, exact IDs and digest; RAM agrees',async()=>{
 const {api,counts}=await fixture(),before=JSON.stringify(api.opsMap.toJSON());
 const report=await api.exportarOpsForenses();
 assert.equal(report.ok,true,JSON.stringify(report));
 assert.equal(report.roomId,api.roomId);
 assert.equal(report.PRIVATE_LOCAL_ONLY,true);
 assert.equal(report.source,'indexeddb-yjs-ops-updates');
 assert.equal(report.eventsCount,1);
 assert.equal(report.indexeddbUpdates,1);
 assert.equal(report.durableMatchesMemory,true);
 assert.equal(report.ramVsDurableMismatch,0);
 assert.equal(report.sha256.length,64);
 assert.equal(report.eventos[0].opId,'phone-opaque-event-1');
 assert.equal(report.eventos[0].event.payload.delta,-1);
 assert.deepEqual(counts(),{begins:1,reads:2});
 assert.equal(JSON.stringify(api.opsMap.toJSON()),before,'no business write');
});
test('anonymous, mismatched store and missing IndexedDB cannot claim proof',async()=>{
 const {w,api}=await fixture();
 w.OCAuth.rolActual=()=> 'empleado';
 assert.equal((await api.exportarOpsForenses()).reason,'owner-required');
 w.OCAuth.rolActual=()=> 'dueno';
 w.OCTienda.licenciaActual=()=> 'F123-ANOTHER-SHOP';
 assert.equal((await api.exportarOpsForenses()).reason,'notebook-or-local-crypto-unavailable');
 w.OCTienda.licenciaActual=()=>api.licenciaCodigo;
 api.opsIdb={};
 assert.equal((await api.exportarOpsForenses()).reason,'indexeddb-hydration-unverified');
});
test('Yjs RAM-only operation after local hydration is detected, not quietly certified',async()=>{
 const {w,api}=await fixture();
 const extra=vm.runInContext('JSON.parse('+JSON.stringify(JSON.stringify({
  opId:'unpersisted-2',deviceId:'pc',tipo:'ajuste',payload:{productoId:'synthetic-product',delta:1}
 })) +')',w);
 api.opsMap.set(extra.opId,extra);
 const report=await api.exportarOpsForenses();
 assert.equal(report.ok,true);
 assert.equal(report.eventsCount,1);
 assert.equal(report.durableMatchesMemory,false);
 assert.ok(report.ramVsDurableMismatch>0);
});
