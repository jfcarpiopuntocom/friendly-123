'use strict';
// RED-ONLY P0 test. Synthetic demo beer, no real client / license / relay.
const {test}=require('node:test'), assert=require('node:assert/strict');
const {browser}=require('./helpers/browser.cjs');
const state=w=>w.request('/api/respaldo/exportar');
const patch=(w,body)=>w.fetch('/api/productos/p24',{method:'PATCH',body:JSON.stringify(body)});
async function sample(){
 const w=browser();
 await w.request('/api/productos/p24','PATCH',{tipoProducto:'bar',servingMl:50});
 const p=(await state(w)).productos.find(p=>p.id==='p24');
 assert.equal(p.stockActual,80);assert.equal(p.servingMl,50);
 w.localStorage.setItem('f123_device_id','fixture-device-A');
 return w;
}
test('RED: bar rescale must not report success or emit stock when LS/IDB reject',async()=>{
 const w=await sample(),before=await state(w);
 let emitted=0,idbRejected=0;
 w.OCSyncEmit=()=>{emitted++;return true};
 const setter=w.localStorage.setItem;
 w.localStorage.setItem=()=>{throw Error('QuotaExceededError')};
 w.OCEstadoIDB={guardar:async()=>{idbRejected++;return false}};
 const res=await patch(w,{servingMl:100});
 w.localStorage.setItem=setter;delete w.OCEstadoIDB;
 const after=await state(w);
 assert.equal(idbRejected>0,true);
 assert.equal(res.status,507,'no false HTTP200 on both failed stores');
 assert.equal(after.productos.find(p=>p.id==='p24').stockActual,80);
 assert.equal(after.productos.find(p=>p.id==='p24').servingMl,50);
 assert.equal(after.ventas.length,before.ventas.length);
 assert.equal(emitted,0,'no outgoing conversion before ACK');
});
test('RED: incoming merge/GET/Yjs outbound must wait for bar conversion ACK',async()=>{
 const w=await sample();
 let release,firstSnapshot,emitted=0;
 w.OCSyncEmit=()=>{emitted++;return true};
 w.OCEstadoIDB={guardar:s=>{firstSnapshot=JSON.parse(JSON.stringify(s));return new Promise(resolve=>{release=resolve;});}};
 w.localStorage.setItem=()=>{throw Error('QuotaExceededError')};
 const job=patch(w,{servingMl:100});
 for(let n=0;n<100&&!release;n++)await Promise.resolve();
 assert.ok(release,'strict durable bar save started');
 const p=firstSnapshot.productos.find(p=>p.id==='p24');
 assert.equal(p.stockActual,40);
 assert.equal(p.stockPN['fixture-device-A'].sub,40);
 assert.equal(emitted,0,'no outgoing announcement before durable ACK');
 assert.equal(w.OCSync.catalogoPropio(),null,'no provisional Yjs snapshot');
 assert.equal(w.OCSync.aplicarCatalogo({ubicaciones:[],productos:[{id:'fixture-peer',nombre:'remote item',stockActual:4,precio:1,ubicacionId:'bar'}]},null),false,'remote merge queued');
 let readDone=false;const read=state(w).then(x=>{readDone=true;return x});
 await Promise.resolve();await Promise.resolve();
 assert.equal(readDone,false,'GET must not read provisional bar conversion');
 release(true);const res=await job,after=await read;
 assert.equal(res.status,200);assert.equal(emitted,1);
 assert.ok(after.productos.some(p=>p.id==='fixture-peer'));
});
