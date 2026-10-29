'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {browser}=require('./helpers/browser.cjs');

test('a rejected import preserves the complete notebook and never auto-saves its provisional state',async()=>{
  const w=browser();
  const original=await w.request('/api/respaldo/exportar');
  original.nombreNegocio='Original';
  original.productos=[{id:'original-product',nombre:'Original',precio:10,costo:4,stockActual:7}];
  assert.equal((await w.request('/api/respaldo/importar','POST',original)).ok,true);
  const before=await w.request('/api/respaldo/exportar');
  const incoming=JSON.parse(JSON.stringify(before));
  incoming.nombreNegocio='Rejected';incoming.nombreNegocioTs=900;incoming.nombreNegocioRev=900;
  incoming.productos=[{id:'rejected-product',nombre:'Rejected',precio:8,costo:3,stockActual:19}];
  incoming.configuracion.impuesto={id:'impuesto',activo:true,tasa:15,nombre:'Rejected tax'};
  const originalSet=w.localStorage.setItem.bind(w.localStorage);let writes=0;
  w.localStorage.setItem=(key,value)=>{
    if(key.startsWith('f123_estado_v4')&&!key.endsWith('_preimport')){writes++;throw new Error('synthetic storage rejected');}
    originalSet(key,value);
  };
  const response=await w.fetch('/api/respaldo/importar',{method:'POST',body:JSON.stringify(incoming)});
  assert.equal(response.status,507);
  const after=await w.request('/api/respaldo/exportar');
  assert.deepEqual(after,before,'all business data and nullable settings remain unchanged');
  assert.equal(writes,1,'the rejected operation has no second write in finally');
  assert.deepEqual(JSON.parse(w.localStorage.getItem('f123_estado_v4_preimport')),before,'independent pre-import evidence is retained');
});

test('reads, background snapshots and incoming catalog wait until a pending import rolls back',async()=>{
  const w=browser(),other=browser();
  const before=await w.request('/api/respaldo/exportar');
  const incoming=JSON.parse(JSON.stringify(before));incoming.nombreNegocio='Provisional import';
  incoming.productos=[{id:'provisional',nombre:'Provisional',precio:8,costo:3,stockActual:19}];
  const remoteProduct=await other.request('/api/productos','POST',{nombre:'Remote survivor',barcode:'REMOTE-IMPORT-ROLLBACK',precio:3,costo:1,stockInicial:4});
  const remote=other.catalog();
  const originalSet=w.localStorage.setItem.bind(w.localStorage);let release,pending=true;
  w.localStorage.setItem=(key,value)=>{
    if(key.startsWith('f123_estado_v4')&&!key.endsWith('_preimport'))throw new Error('synthetic local storage full');
    originalSet(key,value);
  };
  w.OCEstadoIDB={guardar:()=>pending?new Promise(resolve=>{release=resolve;}):Promise.resolve(false)};
  let responded=false;
  const response=w.fetch('/api/respaldo/importar',{method:'POST',body:JSON.stringify(incoming)}).then(r=>{responded=true;return r;});
  for(let i=0;i<8&&!release;i++)await new Promise(setImmediate);
  assert.equal(typeof release,'function');
  assert.equal(responded,false,'HTTP success or failure requires the real storage result');
  assert.equal(w.OCSync.catalogoPropio(),null,'provisional import never leaves through sync');
  let readDone=false;const read=w.request('/api/respaldo/exportar').then(r=>{readDone=true;return r;});
  const background=w.OCSync.confirmarCatalogoDurable();
  assert.equal(w.OCSync.aplicarCatalogo(remote,null),false,'incoming catalog is queued by the shared rollback fence');
  await new Promise(setImmediate);assert.equal(readDone,false);
  pending=false;release(false);
  assert.equal((await response).status,507);
  const after=await read;await background;
  assert.notEqual(after.nombreNegocio,'Provisional import');
  assert.equal(after.productos.some(p=>p.id==='provisional'),false,'rejected import cannot survive a later snapshot');
  assert.ok(after.productos.some(p=>p.id===remoteProduct.id),'concurrent remote product survives local rollback');
});
