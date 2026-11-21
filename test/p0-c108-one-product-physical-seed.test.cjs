'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const src = fs.readFileSync(path.join(__dirname,'../docs/sync-yjs.js'),'utf8');
const start=src.indexOf('    function sembrar() {');
const end=src.indexOf('\n    // Yjs -> store.',start);
assert(start>0 && end>start,'real Sync3 seed implementation must stay visible');
const fragment=src.slice(start,end);
function fixture() {
 const counts={read:0,transaction:0,pn:[],photos:0,sales:0,finances:0,activity:0};
 const records={productos:[{id:'target',stockActual:33,stockEpochId:'epoch-33',rev:{c:4,d:'A'}},{id:'other',stockActual:7,stockEpochId:'epoch-7',rev:{c:5,d:'B'}}],ventas:[{id:'sale-other',cantidad:1}],gastos:[{id:'expense-other',monto:99}],clientes:[{id:'client-other',nombre:'private'}],dispositivos:[{id:'device-other',rol:'dueno'}],nombreNegocio:'Synthetic real name',pinsRol:{owner:'123',emp:'456',acct:'357'}};
 const collections=['productos','ventas','gastos','clientes','dispositivos'];
 const mapas=Object.fromEntries(collections.map(name=>[name,new Map()]));
 const meta=new Map([['nombreNegocio','original shop'],['nombreEsDueno',true],['pinsRol',{owner:'private-old'}]]);
 const context={
   _aplicando:false,COLECCIONES_BATCH:collections,_productosSinCambios:new WeakMap(),
   API:{canal:{recuperando:false},doc:{transact(fn){counts.transaction++;fn();}},mapas,stockPNTestigos:new Map(),meta},
   window:{OCSync:{catalogoPropio(){counts.read++;return records;}},OCAuth:null},
   publicarTestigosStock(r){counts.pn.push(r.id);},
   publicarFotosLocales(){counts.photos++;},sembrarVentasAlRelay(){counts.sales++;},
   sembrarFinanzas(){counts.finances++;},sembrarActividad(){counts.activity++;},
   log(){},console
 };
 vm.runInNewContext(`(function(){\n${fragment}\nthis.actualSeed=sembrar;\n}).call(this);`,context);
 return {context,records,mapas,meta,counts,seed:context.actualSeed};
}
test('C108 RED: committed count seeds strictly one product without all-shop Yjs, money/photo or PIN fanout',()=>{
 const f=fixture();
 f.context.window.OCSync.catalogoPropio=()=>{throw Error('must reuse already confirmed catalogue, no second read')};
 f.seed('target',f.records);
 assert.deepEqual([...f.mapas.productos.keys()],['target']);
 assert.equal(f.mapas.productos.get('target').stockActual,33);
 for(const k of ['ventas','gastos','clientes','dispositivos'])assert.equal(f.mapas[k].size,0,k+' must not be reseeded');
 assert.equal(f.meta.get('nombreNegocio'),'original shop');
 assert.deepEqual(f.meta.get('pinsRol'),{owner:'private-old'});
 assert.deepEqual({photos:f.counts.photos,sales:f.counts.sales,finances:f.counts.finances,activity:f.counts.activity},{photos:0,sales:0,finances:0,activity:0});
 assert.deepEqual(f.counts.pn,['target'],'only target PN witnesses touched');
 assert.equal(f.counts.transaction,1);
});
test('C108: ordinary scheduled full seed remains unchanged and sees all collections',()=>{
 const f=fixture();f.seed();
 assert.deepEqual([...f.mapas.productos.keys()],['target','other']);
 for(const k of ['ventas','gastos','clientes','dispositivos'])assert.equal(f.mapas[k].size,1,k);
 assert.equal(f.counts.read,1,'normal seed reads its own catalog');
 assert.equal(f.counts.photos,1);
 assert.equal(f.counts.sales,1);
 assert.equal(f.counts.finances,1);
 assert.equal(f.counts.activity,1);
});
test('C108: strictly committed epoch passes same preverified catalog, no second full-scan and no transport change',()=>{
 assert.match(src,/API\.sembrarConteoConfirmado\s*=\s*function/);
 assert.match(src,/sembrar\(productoId,\s*cat\)/);
 assert.match(src,/if \(!p \|\| String\(p\.stockEpochId \|\| ""\) !== String\(epoca\)\) return false/);
 assert.match(src,/Number\(shared\.stockActual\) === Number\(p\.stockActual\)/);
 const backend=fs.readFileSync(path.join(__dirname,'../docs/mock-backend.js'),'utf8');
 const start=backend.indexOf('const _opIdAjuste =',backend.indexOf('/api/productos/'));
 const end=backend.indexOf('if ((m = path.match(/^\\/api\\/productos\\/([^/]+)\\/etiqueta',start);
 assert(start>=0 && end>start);
 const section=backend.slice(start,end);
 assert(section.indexOf('window.OCYjs.sembrarConteoConfirmado') < section.lastIndexOf('_drenarCatalogosPendientes()'), 'durable count before merge');
 assert.match(section,/if \(guardado && _epocaFisicaConfirmada/);
});
