'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const sync=fs.readFileSync(path.join(__dirname,'../docs/sync-yjs.js'),'utf8');
const mock=fs.readFileSync(path.join(__dirname,'../docs/mock-backend.js'),'utf8');
const vendor=fs.readFileSync(path.join(__dirname,'../docs/vendor/yjs-bundle.min.js'),'utf8');
test('S3: read-only audit reports numeric sizes without source records',()=>{
 const at=sync.indexOf('  function _medirDocumentoYjs(Y, doc, nombre, canal, idb, permiteCkpt) {');
 const end=sync.indexOf('\n  var API = {',at);
 assert.ok(at>0&&end>at,'size audit must exist');
 const ctx=vm.createContext({window:{},Uint8Array,JSON,Math,TextEncoder,TextDecoder,crypto:require('crypto').webcrypto});
 vm.runInContext(vendor,ctx);vm.runInContext(sync.slice(at,end),ctx);
 vm.runInContext("var cat=new Y.Doc(),ops=new Y.Doc(),fotos=new Y.Doc();"+ 
   "cat.getMap('productos').set('synthetic-product',{id:'synthetic-product',fotoHash:'synthetic-hash'});"+
   "ops.getMap('eventos').set('synthetic-sale',{opId:'synthetic-sale',cantidad:2});"+
   "fotos.getMap('blobs').set('synthetic-hash','data:image/png;base64,AAA');",ctx);
 const Y=ctx.Y,cat=ctx.cat,ops=ctx.ops,fotos=ctx.fotos;
 const read=(doc,name,ckpt)=>vm.runInContext('_medirDocumentoYjs(Y,__doc,__name,{recuperando:false},{synced:true},__ckpt)',Object.assign(ctx,{__doc:doc,__name:name,__ckpt:ckpt}));
 const a=read(cat,'catalogo',true),b=read(ops,'operaciones',true),c=read(fotos,'fotos',false);
 for(const item of [a,b,c]){
   assert.ok(item.bytesPlano>0);
   assert.equal(item.bytesCifrados,item.bytesPlano+29);
   assert.equal(item.entradas,1);
   assert.equal(item.hidratado,true);
   assert.doesNotMatch(JSON.stringify(item),/synthetic-product|synthetic-hash|synthetic-sale|AAA/);
 }
 assert.equal(a.dataImageInline,0);assert.equal(b.dataImageInline,0);
 assert.equal(c.dataImageInline,1);assert.equal(c.checkpoint,false);
});
test('S3: product export whitelist strips inline photo from remote product',()=>{
 const start=mock.indexOf('productos: productos.filter((p) =>');
 const end=mock.indexOf('/* EL EQUIPO VIAJA',start);
 assert.ok(start>0&&end>start);
 const expression=mock.slice(start,end).trim();
 const ctx=vm.createContext({productos:[{id:'synthetic',foto:'data:image/png;base64,ABC',fotoHash:'hash-only'}],
  _demoLocal:null,_estaEnSemillaDemoSeleccionada:()=>false,
  precioOpcional:x=>x,normPctAsociado:x=>x,Number,JSON,Math});
 const result=vm.runInContext('({'+expression+'})',ctx);
 assert.equal(result.productos.length,1);
 assert.equal(result.productos[0].fotoHash,'hash-only');
 assert.equal(Object.hasOwn(result.productos[0],'foto'),false);
 assert.doesNotMatch(JSON.stringify(result),/data:image\//);
});
