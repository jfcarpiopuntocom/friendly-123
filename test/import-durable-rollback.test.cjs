'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {browser}=require('./helpers/browser.cjs');

function faultBrowser(){
  const fs=require('node:fs'),read=fs.readFileSync;
  fs.readFileSync=function(file,...args){
    const source=read.call(this,file,...args);
    if(!String(file).endsWith('mock-backend.js'))return source;
    return source.replace('  function avisarCatalogoCambiado() {',
      '  function avisarCatalogoCambiado() { if(window.__noticeThrows) throw Error("synthetic postcommit notice");')
      .replaceAll('    const _demoRemoto = _seleccionarSemillaDemoPura(remoto);',
      '    if(window.__queueFailure === "throw") throw Error("synthetic queued apply"); if(window.__queueFailure === "false") return {ok:false};\n    const _demoRemoto = _seleccionarSemillaDemoPura(remoto);')
      .replace('    const negocioDespues = _huellaEstadoMerge();',
      '    if(window.__queueFailure === "partial") throw Error("synthetic failure after business mutation");\n    const negocioDespues = _huellaEstadoMerge();');
  };
  try{return browser();}finally{fs.readFileSync=read;}
}

test('a postcommit notification failure cannot undo an imported notebook or return a false HTTP failure',async()=>{
  const w=faultBrowser(),backup=await w.request('/api/respaldo/exportar');
  backup.nombreNegocio='Committed import';backup.productos=[{id:'committed-import',nombre:'Committed',precio:7,costo:2,stockActual:10}];
  w.__noticeThrows=true;
  const response=await w.fetch('/api/respaldo/importar',{method:'POST',body:JSON.stringify(backup)});
  assert.equal(response.status,200,'the actual durable commit defines HTTP success');
  assert.equal((await response.json()).ok,true);
  const live=await w.request('/api/respaldo/exportar');
  assert.equal(live.nombreNegocio,'Committed import');assert.equal(live.productos[0].stockActual,10);
  const reopened=browser(w.localStorage),saved=await reopened.request('/api/respaldo/exportar');
  assert.equal(saved.nombreNegocio,live.nombreNegocio);assert.deepEqual(saved.productos,live.productos);
});

for(const failure of ['throw','false','partial'])test('queued catalog '+failure+' after import commit preserves the result and retries without dropping its head',async()=>{
  const w=faultBrowser(),remote=browser();
  const product=await remote.request('/api/productos','POST',{nombre:'Queued survivor',barcode:'QUEUE-'+failure,precio:3,costo:1,stockInicial:4});
  const sale=await remote.request('/api/productos/'+product.id+'/venta','POST',{cantidad:1});
  const catalog=remote.catalog(),backup=await w.request('/api/respaldo/exportar');
  backup.nombreNegocio='Committed despite remote '+failure;
  let release,started;const ready=new Promise(resolve=>{started=resolve;});
  // Import awaits the atomic IndexedDB CAS, not the retired A/B Web Lock.
  w.OCEstadoIDB={guardarConRevision:(snapshot,priorRev)=>{
    assert.ok(snapshot._rev>priorRev,'import advances a durable revision');
    return new Promise(resolve=>{release=()=>resolve(true);started();});
  }};
  const result=w.fetch('/api/respaldo/importar',{method:'POST',body:JSON.stringify(backup)});
  await ready;
  assert.equal(w.OCSync.aplicarCatalogo(catalog,null),false);
  w.__queueFailure=failure;release();
  const response=await result;
  assert.equal(response.status,200,'remote drain cannot turn a confirmed import into an HTTP error');
  assert.equal((await w.request('/api/respaldo/exportar')).nombreNegocio,backup.nombreNegocio);
  w.__queueFailure=null;delete w.OCEstadoIDB;
  const empty={...catalog,productos:[]};
  assert.equal(w.OCSync.aplicarCatalogo(empty,null).ok,true,'a later source replay drains retained work first');
  await w.OCSync.confirmarCatalogoDurable();
  const once=await w.request('/api/respaldo/exportar');
  assert.equal(once.productos.filter(p=>p.id===product.id).length,1,'the failed queue head survives until real application');
  assert.equal(once.productos.find(p=>p.id===product.id).stockActual,3,'one physical sale changes stock once');
  assert.equal(once.ventas.filter(v=>v.id===sale.ventaId).length,1,'partial application and replay retain the same sale ID');
  w.OCSync.aplicarCatalogo(catalog,null);await w.OCSync.confirmarCatalogoDurable();
  const twice=await w.request('/api/respaldo/exportar');
  const comparable=items=>items.map(p=>({...p,stockDeficit:Number(p.stockDeficit)||0}));
  assert.deepEqual(comparable(twice.productos),comparable(once.productos),'replay is idempotent for stock, PN and product identity (missing deficit means zero)');
  assert.deepEqual(twice.ventas,once.ventas,'sale and money are not appended twice');
  assert.deepEqual(twice.movimientos,once.movimientos,'retry cannot append a duplicate merge audit');
});

test('a newer complete source projection can supply the missing parent of retained incomplete history',async()=>{
  const w=browser(),remote=browser();
  const product=await remote.request('/api/productos','POST',{nombre:'History survivor',barcode:'QUEUE-HISTORY',precio:9,costo:2,stockInicial:4});
  const sale=await remote.request('/api/productos/'+product.id+'/venta','POST',{cantidad:1});
  const complete=remote.catalog(),events=complete.actividad.filter(entry=>entry.clase==='evento');
  assert.ok(events.length>=2,'the actual sealed source has a parent and child');
  const parent=events[events.length-2],incomplete={...complete,actividad:complete.actividad.filter(entry=>entry!==parent)};
  const backup=await w.request('/api/respaldo/exportar');
  let release,started;const ready=new Promise(resolve=>{started=resolve;});
  // Import awaits the atomic IndexedDB CAS, not the retired A/B Web Lock.
  w.OCEstadoIDB={guardarConRevision:(snapshot,priorRev)=>{
    assert.ok(snapshot._rev>priorRev,'import advances a durable revision');
    return new Promise(resolve=>{release=()=>resolve(true);started();});
  }};
  const imported=w.fetch('/api/respaldo/importar',{method:'POST',body:JSON.stringify(backup)});
  await ready;assert.equal(w.OCSync.aplicarCatalogo(incomplete,null,true),false);release();
  assert.equal((await imported).status,200);
  delete w.OCEstadoIDB;
  const recovered=w.OCSync.aplicarCatalogo(complete,null,true);
  assert.equal(recovered.ok,true,'retained incomplete data cannot block a newer complete Yjs projection');
  assert.equal(recovered.actividadCompleta,true);
  await w.OCSync.confirmarCatalogoDurable();
  const snapshot=await w.request('/api/respaldo/exportar');
  assert.equal(snapshot.ventas.filter(v=>v.id===sale.ventaId).length,1);
  assert.equal(snapshot.productos.find(p=>p.id===product.id).stockActual,3);
  const history=await w.request('/api/actividad');
  assert.equal(history.filter(entry=>entry.id===parent.versiones[0].id).length,1,'the authentic parent arrives once');
});

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
  w.OCEstadoIDB={guardarConRevision:(snapshot,priorRev)=>{assert.ok(snapshot._rev>priorRev);return pending?new Promise(resolve=>{release=resolve;}):Promise.resolve(false)},guardar:async()=>false};
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
