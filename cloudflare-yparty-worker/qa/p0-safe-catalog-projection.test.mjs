import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import {projectPublicCatalog} from '../src/catalog-safe-projection.mjs';

const rows={
 product:{
  id:'p01',nombre:'Prueba Cañari',sku:'SKU-ONE',barcode:'7860001234',categoria:'Books',
  ubicacionId:'shelf-a',precio:19.99,stockActual:4,
  costo:1.23,stockPN:{secretDevice:10},comisionSocio:85,
  foto:'data:image/png;base64,SECRET_PHOTO_BYTES',
  detallePrivado:'SECRET_INTERNAL_NOTES',proveedor:'SECRET_SUPPLIER',clienteTelefono:'SECRET_PHONE'
 },
 shelf:{
  id:'shelf-a',nombre:'Percha principal',tipo:'propio',activa:true,
  promotorPIN:'SECRET_PERSON_PIN',comisionSocio:85,pagoSocio:109.99,telefono:'SECRET_PHONE'
 }
};
function privateDoc(){
 const doc=new Y.Doc();
 doc.getMap('productos').set('p01',structuredClone(rows.product));
 doc.getMap('ubicaciones').set('shelf-a',structuredClone(rows.shelf));
 doc.getMap('usuarios').set('employee',{pin:'SECRET_PIN_123',role:'empleado'});
 doc.getMap('clientes').set('customer',{telefono:'SECRET_PHONE',email:'SECRET_EMAIL'});
 doc.getMap('ventas').set('sale',{importe:19.99,cliente:'SECRET_CUSTOMER_SALE'});
 doc.getMap('_meta').set('pinsRol',{owner:'SECRET_OWNER_PIN',admin:'SECRET_ADMIN_PIN'});
 doc.getMap('promotoras').set('artist',{comisionBase:85,telefono:'SECRET_ARTIST_PHONE'});
 return doc;
}
function project(doc){return projectPublicCatalog({sourceDoc:doc,Y});}
function record(doc,map,id){return doc.getMap(map).get(id);}
const FORBIDDEN=['SECRET_PHOTO_BYTES','SECRET_INTERNAL_NOTES','SECRET_SUPPLIER','SECRET_PHONE','SECRET_PIN_123','SECRET_EMAIL','SECRET_OWNER_PIN','SECRET_ADMIN_PIN','SECRET_CUSTOMER_SALE','SECRET_ARTIST_PHONE'];
test('projected Y.Doc is distinct from private Y.Doc and uses only two allowlisted map names',()=>{
 const source=privateDoc(),result=project(source);
 assert.notEqual(result.doc,source);
 assert.deepEqual([...result.doc.share.keys()].sort(),['productos','ubicaciones']);
});
test('public products include display fields only; cost, PN facts and photos never transit',()=>{
 const source=privateDoc(),{doc}=project(source),p=record(doc,'productos','p01');
 assert.deepEqual(Object.keys(p).sort(),['barcode','categoria','id','nombre','precio','sku','stockActual','ubicacionId'].sort());
 assert.equal(p.nombre,'Prueba Cañari');assert.equal(p.precio,19.99);assert.equal(p.stockActual,4);
 assert.equal('costo' in p,false);assert.equal('stockPN' in p,false);assert.equal('foto' in p,false);
});
test('shelf view excludes commissions, PINs, money, contacts and artist links',()=>{
 const {doc}=project(privateDoc()),s=record(doc,'ubicaciones','shelf-a');
 assert.deepEqual(Object.keys(s).sort(),['activa','id','nombre','tipo'].sort());
 assert.equal('comisionSocio' in s,false);assert.equal('promotorPIN' in s,false);
});
test('Yjs binary of projected view contains zero secret strings and survives receiving client',()=>{
 const {doc,bytes}=project(privateDoc()),replica=new Y.Doc();
 assert.ok(bytes instanceof Uint8Array);Y.applyUpdate(replica,bytes);
 assert.deepEqual([...replica.share.keys()].sort(),['productos','ubicaciones']);
 assert.deepEqual(record(replica,'productos','p01'),record(doc,'productos','p01'));
 const encoded=Buffer.from(bytes).toString('utf8')+'\n'+JSON.stringify(record(replica,'productos','p01'))+JSON.stringify(record(replica,'ubicaciones','shelf-a'));
 for(const secret of FORBIDDEN)assert.equal(encoded.includes(secret),false,secret);
 replica.destroy();doc.destroy();
});
test('projection never adds metadata or changes private doc bytes',()=>{
 const source=privateDoc(),before=Y.encodeStateAsUpdate(source),keys=[...source.share.keys()].sort();
 const result=project(source);
 assert.deepEqual(Buffer.from(Y.encodeStateAsUpdate(source)),Buffer.from(before));
 assert.deepEqual([...source.share.keys()].sort(),keys);
 assert.equal(record(source,'productos','p01').costo,1.23);
 result.doc.destroy();source.destroy();
});
test('subsequent private data changes do not automatically flow into detached public snapshot',()=>{
 const source=privateDoc(),{doc}=project(source);
 source.getMap('usuarios').set('x',{pin:'SECRET_NEW_PIN'});
 source.getMap('productos').set('p01',{...rows.product,costo:0.02,stockActual:7});
 assert.equal(record(doc,'productos','p01').stockActual,4);
 assert.equal([...doc.share.keys()].includes('usuarios'),false);
 doc.destroy();source.destroy();
});
test('invalid price or stock cannot be silently converted to zero in public view',()=>{
 for(const override of [{precio:NaN},{precio:Infinity},{precio:-1},{precio:'19.99'},{stockActual:'4'},{stockActual:1.2}]){
  const source=privateDoc();source.getMap('productos').set('p01',{...rows.product,...override});
  assert.throws(()=>project(source),/invalid/i,JSON.stringify(override));
  source.destroy();
 }
});
test('product IDs and shelf IDs cannot be arbitrary script or path strings',()=>{
 for(const id of ['__proto__','../../x','<img src=x>','', 'a'.repeat(130)]){
  const source=privateDoc();source.getMap('productos').delete('p01');
  source.getMap('productos').set(id,{...rows.product,id});
  assert.throws(()=>project(source),/invalid/i,id);source.destroy();
 }
});
test('empty catalog has both empty public maps but no inherited private collections',()=>{
 const source=new Y.Doc();source.getMap('usuarios').set('a',{pin:'SECRET_PIN_123'});
 const {doc,bytes}=project(source);
 assert.deepEqual([...doc.share.keys()].sort(),['productos','ubicaciones']);
 assert.equal(doc.getMap('productos').size,0);assert.equal(doc.getMap('ubicaciones').size,0);
 assert.equal(Buffer.from(bytes).toString('utf8').includes('SECRET_PIN_123'),false);
});
test('reject >10000 products rather than deliver a partial misleading retail view',()=>{
 const source=new Y.Doc();
 for(let n=0;n<10001;n++)source.getMap('productos').set('p'+n,{id:'p'+n,nombre:'Test',precio:0,stockActual:0});
 assert.throws(()=>project(source),/too many|limit/i);
 source.destroy();
});
test('shelf data malformed with nested objects is rejected, not serialized into a Yjs document',()=>{
 const source=privateDoc();
 source.getMap('ubicaciones').set('shelf-a',{...rows.shelf,nombre:{secret:'SECRET_OWNER_PIN'}});
 assert.throws(()=>project(source),/invalid/i);
});
