'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../docs/mock-backend.js'),'utf8');
function fixture(origin){
 const start=source.indexOf('  function _actividadClave('),end=source.indexOf('  /* Aviso de "el equipo cambio"',start);
 assert.ok(start>=0&&end>start,'shared activity must preserve origins instead of merging local seals');
 const hash=source.slice(source.indexOf('  function selloHash('),source.indexOf('  function _actividadClave('));
 const canonical=source.slice(source.indexOf('  function _serializarMergeCanonico('),source.indexOf('  function _huellaEstadoMerge('));
 const ctx={instanceId:origin,movimientos:[],actividadCompartida:[],selloUltimo:'',clonar:x=>JSON.parse(JSON.stringify(x))};
 vm.createContext(ctx);vm.runInContext(hash+canonical+source.slice(start,end),ctx);
 return ctx;
}
function append(ctx,id,seal=true){const row={id,tipo:'venta',detalle:{total:20},fecha:'2026-10-26T00:00:00Z',usuarioId:'synthetic',prevSello:ctx.selloUltimo};if(seal){row.sello=ctx.selloHash(ctx.movHuella(row));ctx.selloUltimo=row.sello;}ctx.movimientos.push(row);return row;}
const same=(a,b)=>assert.equal(JSON.stringify(a),JSON.stringify(b));
test('activity from distinct origins keeps exact seals, merges idempotently and survives a snapshot restart',()=>{
 const a=fixture('synthetic-a'),b=fixture('synthetic-b');const original=append(a,'m-a');append(b,'m-b');
 const wire=a._actividadExportable();b.actividadCompartida=b._actividadUnir(b.actividadCompartida,wire);
 const once=JSON.stringify(b._actividadExportable());b.actividadCompartida=b._actividadUnir(b.actividadCompartida,wire);
 assert.equal(JSON.stringify(b._actividadExportable()),once);assert.equal(b._actividadEstado(b._actividadExportable()).ok,true);
 same(b._actividadVista().find(row=>row.id==='m-a'),original);assert.equal(b.movimientos.length,1,'remote events never enter the local seal chain');
 const reopened=fixture('synthetic-b');reopened.actividadCompartida=JSON.parse(once);reopened.movimientos=JSON.parse(JSON.stringify(b.movimientos));reopened.selloUltimo=b.selloUltimo;
 same(reopened._actividadVista(),b._actividadVista());assert.equal(reopened._actividadEstado(reopened._actividadExportable()).ok,true);
});
test('a child without its parent stays incomplete and resolves without replacing original bytes',()=>{
 const a=fixture('synthetic-a'),b=fixture('synthetic-b');const parent=append(a,'parent');append(a,'child');const wire=a._actividadExportable();
 b.actividadCompartida=wire.filter(entry=>!(entry.clase==='evento'&&entry.versiones[0].id==='parent'));
 assert.equal(b._actividadEstado(b._actividadExportable()).completa,false);
 b.actividadCompartida=b._actividadUnir(b.actividadCompartida,wire);
 assert.equal(b._actividadEstado(b._actividadExportable()).ok,true);same(b._actividadVista().find(row=>row.id==='parent'),parent);
});
test('edits, missing certified tails and conflicting copies cannot receive an integrity success',()=>{
 const a=fixture('synthetic-a'),b=fixture('synthetic-b');append(a,'first');append(a,'last');const wire=a._actividadExportable();
 const edited=JSON.parse(JSON.stringify(wire));edited.find(entry=>entry.clase==='evento').versiones[0].detalle.total=99;
 assert.equal(b._actividadEstado(edited).ok,false);
 const trimmed=wire.filter(entry=>!(entry.clase==='evento'&&entry.versiones[0].id==='last'));
 assert.equal(b._actividadEstado(trimmed).completa,false);
 const conflict=b._actividadUnir(wire,edited);assert.equal(b._actividadEstado(conflict).ok,false);
 assert.equal(conflict.find(entry=>entry.clase==='evento'&&entry.versiones[0].id==='first').versiones.length,2);
});
test('legacy unsealed history remains historical, and a multi-peer cycle creates no new envelopes',()=>{
 const a=fixture('synthetic-a'),b=fixture('synthetic-b'),c=fixture('synthetic-c');const legacy=append(a,'legacy',false);append(a,'sealed');
 b.actividadCompartida=b._actividadUnir([],a._actividadExportable());c.actividadCompartida=c._actividadUnir([],b._actividadExportable());
 const before=JSON.stringify(a._actividadExportable());a.actividadCompartida=a._actividadUnir([],c._actividadExportable());
 assert.equal(JSON.stringify(a._actividadExportable()),before);same(c._actividadVista().find(row=>row.id==='legacy'),legacy);
 assert.equal(c._actividadEstado(c._actividadExportable()).historicos,1);
});
test('removing shared map entries never deletes previously accepted activity; rejected local snapshots are pure',()=>{
 const a=fixture('synthetic-a'),b=fixture('synthetic-b');append(a,'confirmed');const confirmed=a._actividadExportable();
 b.actividadCompartida=b._actividadUnir([],confirmed);b.actividadCompartida=b._actividadUnir(b.actividadCompartida,[]);
 assert.equal(b._actividadVista().length,1);
 const committed=JSON.stringify(a.actividadCompartida);append(a,'unconfirmed');a._actividadExportable();
 assert.equal(JSON.stringify(a.actividadCompartida),committed,'export cannot retain a sale later rejected by storage');
});
test('two restored writers sharing a seal seed preserve both descendant branches',()=>{
 const a=fixture('synthetic-restored'),b=fixture('synthetic-restored');const root=append(a,'root');
 b.movimientos=JSON.parse(JSON.stringify(a.movimientos));b.selloUltimo=root.sello;
 const baseline=a._actividadExportable();a.actividadCompartida=a._actividadUnir([],baseline);b.actividadCompartida=b._actividadUnir([],baseline);
 append(a,'branch-a');append(b,'branch-b');
 const combined=a._actividadUnir(a._actividadExportable(),b._actividadExportable());a.actividadCompartida=combined;b.actividadCompartida=combined;
 assert.equal(a._actividadEstado(combined).ok,true);assert.equal(a._actividadVista().length,3);same(a._actividadVista(),b._actividadVista());
});
test('the authentic bridge withholds durable peer acknowledgement while origin history is incomplete',async()=>{
 const sync=fs.readFileSync(path.join(__dirname,'../docs/sync-yjs.js'),'utf8');
 const start=sync.indexOf('    var ultimaAplicacionVisible ='),end=sync.indexOf('    // Cambios locales del catálogo',start);
 let complete=false,commits=0;
 const ctx={Promise,Map,API:{meta:new Map(),get:()=>({one:{id:'entry'}}),hechosListos:()=>true},COLECCIONES:['actividad'],_aplicando:false,_tAplica:null,
    _primerMergeAceptado:false,_otroRemoto:false,_productosRemotos:new Set(),_actividadRemota:new Set(),
    _reintentoAplicar:null,_fallosAplicar:0,_MAX_FALLOS_APLICAR:5,
  window:{OCSync:{aplicarCatalogo:()=>({ok:true,actividadCompleta:complete,pinsConfirmados:Promise.resolve(true)}),confirmarCatalogoDurable(){commits++;return Promise.resolve(true);}}},log(){},clearTimeout(){},setTimeout(){return 1;}};
 vm.createContext(ctx);vm.runInContext(sync.slice(start,end)+'\nthis.apply=aplicar;',ctx);
 ctx.apply();assert.equal(await ctx.API.confirmarCatalogoDurable(),false);assert.equal(commits,0);
 complete=true;ctx.apply();assert.equal(await ctx.API.confirmarCatalogoDurable(),true);assert.equal(commits,1);
});
test('a pure activity merge while an unchanged save awaits its Web Lock does not invent a local audit action',async()=>{
 const {browser}=require('./helpers/browser.cjs');const b=browser();
 assert.equal(await b.OCSync.confirmarCatalogoDurable(),true);
 const original=b.catalog();assert.ok(original);
 const foreign=fixture('synthetic-foreign');append(foreign,'foreign-sale');
 const incoming=JSON.parse(JSON.stringify(original));incoming.actividad=b.OCSync.unirActividad(incoming.actividad,foreign._actividadExportable());
 const queued=[];b.navigator.locks={request(name,options,fn){return new Promise((resolve,reject)=>queued.push(()=>Promise.resolve().then(fn).then(resolve,reject)));}};
 const repeated=b.OCSync.confirmarCatalogoDurable();await Promise.resolve();
 const before=(await b.request('/api/actividad')).filter(row=>row.tipo==='merge-catalogo').length;
 try{
  assert.ok(b.catalog(),'confirmed unchanged RAM remains externally publishable before the merge');
  b.OCSync.aplicarCatalogo(incoming,null,true);
  const after=(await b.request('/api/actividad')).filter(row=>row.tipo==='merge-catalogo').length;
  assert.equal(after,before,'metadata publication gate is not a business-change oracle');
 }finally{while(queued.length){queued.shift()();await Promise.resolve();}await repeated;}
});
test('the partial employee backup includes shared activity through the existing safe field whitelist',async()=>{
 const {browser}=require('./helpers/browser.cjs'),a=browser(),b=browser();a.OCAuth={rolActual:()=> 'dueno'};b.OCAuth={rolActual:()=> 'dueno'};
 const product=await a.request('/api/productos','POST',{nombre:'Synthetic history product',barcode:'SYN-HISTORY',stockInicial:2,precio:20,costo:8});
 await a.request('/api/productos/'+product.id+'/venta','POST',{cantidad:1});
 const original=(await a.request('/api/actividad')).find(row=>row.tipo==='venta');assert.ok(original);
 b.receive(a);b.OCAuth={rolActual:()=> 'empleado'};const partial=await b.request('/api/respaldo/exportar');
 assert.equal(partial.parcial,true);assert.ok(partial.movimientos.some(row=>row.id===original.id));
 assert.equal(partial.actividadCompartida,undefined);assert.equal(partial.clientes,undefined);
 assert.ok(partial.movimientos.every(row=>row.detalle===undefined&&row.sello===undefined));
});
