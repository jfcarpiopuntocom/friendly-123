'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {browser}=require('./helpers/browser.cjs');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function waitForCount(items,count){for(let i=0;i<150&&items.length<count;i++)await tick();assert.ok(items.length>=count,`expected ${count} durable ACKs, observed ${items.length}`);}
async function setup(){
 const w=browser();
 const p=await w.request('/api/productos','POST',{nombre:'Synthetic bar',barcode:'SYN-BAR-ACK',tipoProducto:'bar',stockInicial:80,servingMl:50,botellaMl:750,precio:5,costo:1,ubicacionId:'bar'});
 const events={stock:[],catalog:0};
 w.OCSyncEmit=(kind,payload)=>{events.stock.push({kind,payload});return true;};
 w.addEventListener('oc-catalogo-cambiado',()=>events.catalog++);
 return {w,p,events};
}
test('bar conversion: rejected stores restore all product fields without success or outgoing facts',async()=>{
 const {w,p,events}=await setup(),before=await w.request('/api/productos/'+p.id);
 const originalSet=w.localStorage.setItem.bind(w.localStorage);let writes=0;
 w.localStorage.setItem=()=>{throw Error('synthetic quota');};
 w.OCEstadoIDB={guardar:async()=>{writes++;return false;}};
 const r=await w.fetch('/api/productos/'+p.id,{method:'PATCH',body:JSON.stringify({servingMl:100,botellaMl:900,nombre:'Unsaved name'})});
 assert.equal(r.status,507,'a rejected conversion must never report success');
 assert.deepEqual(await w.request('/api/productos/'+p.id),before);
 assert.equal(events.stock.length,0);assert.equal(events.catalog,0);assert.equal(writes,1,'no automatic finally retry');
 w.localStorage.setItem=originalSet;
 assert.deepEqual(await browser(w.localStorage).request('/api/productos/'+p.id),before);
});
test('bar conversion: first durable ACK contains PN and waits before reads, seed and notifications',async()=>{
 const {w,p,events}=await setup();let snapshot,ack;
 w.localStorage.setItem=()=>{throw Error('synthetic quota');};
 w.OCEstadoIDB={guardar:s=>{snapshot=JSON.parse(JSON.stringify(s));return new Promise(resolve=>{ack=resolve;});}};
 let done=false;
 const request=w.fetch('/api/productos/'+p.id,{method:'PATCH',body:JSON.stringify({servingMl:100})}).then(r=>{done=true;return r;});
 await tick();assert.equal(done,false);assert.equal(events.stock.length,0);assert.equal(events.catalog,0);
 assert.equal(w.OCSync.catalogoPropio(),null,'provisional data cannot be seeded');
 let readDone=false;const read=w.request('/api/productos/'+p.id).then(r=>{readDone=true;return r;});
 await tick();assert.equal(readDone,false);
 const durable=snapshot.productos.find(x=>x.id===p.id);
 assert.equal(durable.servingMl,100);assert.equal(durable.stockActual,40);
 assert.equal(durable.stockBase,80);
 assert.equal(Object.values(durable.stockPN).reduce((sum,x)=>sum+(x.sub||0)-(x.add||0),0),40);
 ack(true);assert.equal((await request).status,200);assert.equal((await read).stockActual,40);
 assert.equal(events.stock.length,1);assert.equal(events.stock[0].kind,'conversion-bar');
 assert.notEqual(w.OCSync.catalogoPropio(),null);
});
test('bar conversion: durable success survives restart and repeated same measure does not rescale twice',async()=>{
 const {w,p,events}=await setup();
 await w.request('/api/productos/'+p.id,'PATCH',{servingMl:100});
 await w.request('/api/productos/'+p.id,'PATCH',{servingMl:100});
 const reopened=await browser(w.localStorage).request('/api/productos/'+p.id);
 assert.equal(reopened.stockActual,40);assert.equal(reopened.servingMl,100);
 assert.equal(events.stock.length,1);
});
test('bar conversion: rejected IndexedDB promise releases waiting reads with prior state',async()=>{
 const {w,p,events}=await setup();let reject;
 w.localStorage.setItem=()=>{throw Error('synthetic quota');};
 w.OCEstadoIDB={guardar:()=>new Promise((resolve,no)=>{reject=no;})};
 const request=w.fetch('/api/productos/'+p.id,{method:'PATCH',body:JSON.stringify({servingMl:100})});
 await tick();const read=w.request('/api/productos/'+p.id);
 reject(Error('synthetic IDB abort'));
 assert.equal((await request).status,507);assert.equal((await read).stockActual,80);
 assert.equal(events.stock.length,0);assert.equal(events.catalog,0);
});
for(const accepted of [false,true])test(`bar conversion: remote catalog waits through ${accepted?'accepted':'rejected'} ACK without being rolled back`,async()=>{
 const {w,p,events}=await setup(),acks=[];
 w.localStorage.setItem=()=>{throw Error('synthetic quota');};
 w.OCEstadoIDB={guardar:(s,strict)=>strict?new Promise(resolve=>acks.push({snapshot:JSON.parse(JSON.stringify(s)),resolve})):Promise.resolve(false)};
 const request=w.fetch('/api/productos/'+p.id,{method:'PATCH',body:JSON.stringify({servingMl:100})});
 await waitForCount(acks,1);
 let ready=false;const confirmed=w.OCSync.catalogoConfirmado().then(c=>{ready=true;return c;});
 const remote={ubicaciones:[],productos:[{id:'synthetic-remote-bar-ack',nombre:'Remote product',ubicacionId:'bar',stockActual:4,precio:1}]};
 assert.equal(w.OCSync.aplicarCatalogo(remote,null),false,'incoming merge waits for rollback or commit');
 await tick();assert.equal(ready,false);assert.equal(events.stock.length,0);
 acks[0].resolve(accepted);assert.equal((await request).status,accepted?200:507);
 await waitForCount(acks,2);
 assert.ok(acks[1].snapshot.productos.some(x=>x.id==='synthetic-remote-bar-ack'),'second durable snapshot contains replayed remote catalog');
 assert.equal(acks[1].snapshot.productos.find(x=>x.id===p.id).stockActual,accepted?40:80);
 acks[1].resolve(true);
 const catalog=await confirmed;
 assert.ok(catalog.productos.some(x=>x.id==='synthetic-remote-bar-ack'),'remote change survives queue drain');
 assert.equal(catalog.productos.find(x=>x.id===p.id).stockActual,accepted?40:80);
 assert.equal(events.stock.length,accepted?1:0);
});
for(const missingPointer of [false,true])test(`bar conversion: failed COMMITTED journal write preserves logical preimage${missingPointer?' without a prior pointer':''} and rejects without IDB ACK`,async()=>{
 const {w,p,events}=await setup(),storage=w.localStorage;
 if(missingPointer)storage.removeItem('f123_estado_v4_ptr');
 const ab=()=>w.OCEstadoAB.crear({storage,claveBase:'f123_estado_v4'});
 const before=ab().leer().buffers,originalSet=storage.setItem.bind(storage);
 storage.setItem=(k,v)=>{if(k==='f123_estado_v4_journal'){try{if(JSON.parse(v).phase==='COMMITTED')throw Error('synthetic COMMITTED journal failure');}catch(e){if(e.message==='synthetic COMMITTED journal failure')throw e;}}return originalSet(k,v);};
 w.OCEstadoIDB={guardar:async()=>false};
 const r=await w.fetch('/api/productos/'+p.id,{method:'PATCH',body:JSON.stringify({servingMl:100})});
 assert.equal(r.status,507);assert.equal(events.stock.length,0);assert.equal(events.catalog,0);
 assert.deepEqual(ab().leer().buffers,before,'WAL readback exposes the exact logical preimage');
 storage.setItem=originalSet;
 const reopened=await browser(storage).request('/api/productos/'+p.id);
 assert.equal(reopened.stockActual,80);assert.equal(reopened.servingMl,50);
});
test('bar conversion: pointer hint failure after COMMITTED journal remains a durable success',async()=>{
 const {w,p,events}=await setup(),storage=w.localStorage,originalSet=storage.setItem.bind(storage);
 storage.setItem=(k,v)=>{if(k==='f123_estado_v4_ptr')throw Error('synthetic legacy pointer hint failure');return originalSet(k,v);};
 const r=await w.fetch('/api/productos/'+p.id,{method:'PATCH',body:JSON.stringify({servingMl:100})});
 assert.equal(r.status,200);assert.equal(events.stock.length,1);
 storage.setItem=originalSet;
 const reopened=await browser(storage).request('/api/productos/'+p.id);
 assert.equal(reopened.stockActual,40);assert.equal(reopened.servingMl,100);
});
