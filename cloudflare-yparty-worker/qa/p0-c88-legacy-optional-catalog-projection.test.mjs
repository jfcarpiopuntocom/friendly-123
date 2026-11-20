// C88: real 1.0 optional empty/null catalog display fields must not block frozen 2.0.
 // Executed against the actual OSS Yjs and product projection source; no customer data.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import {projectPublicCatalog,assertPublicCatalogTransportDoc}
 from '../src/catalog-safe-projection.mjs';

const room='a'.repeat(32)+'-cat';
const frozenHead='firebase-frozen-c88';
const required={id:'p01',nombre:'Libro local',precio:18,stockActual:4};
function makeSource(optional){
 const doc=new Y.Doc();
 doc.getMap('productos').set('p01',{...required,costo:6.7,clienteTelefono:'SECRET_CONTACT',...optional});
 doc.getMap('ubicaciones').set('u01',{id:'u01',nombre:'Percha Norte',tipo:'',promotorPIN:'SECRET_PIN'});
 doc.getMap('_meta').set('owner',{pin:'SECRET_OWNER_PIN'});
 return doc;
}
function project(doc){return projectPublicCatalog({sourceDoc:doc,Y,room,channel:'cat',frozenHead});}

test('real legacy empty optional strings/null are omitted, not rejected, in detached public Yjs and R2 projection',()=>{
 const source=makeSource({sku:'',barcode:'',categoria:null,ubicacionId:null});
 let projected,replica;
 try{
  projected=project(source);
  const row=projected.doc.getMap('productos').get('p01');
  const shelf=projected.doc.getMap('ubicaciones').get('u01');
  assert.deepEqual(row,required);
  assert.deepEqual(shelf,{id:'u01',nombre:'Percha Norte'});
  assert.equal(assertPublicCatalogTransportDoc({doc:projected.doc,room}),true);
  replica=new Y.Doc();Y.applyUpdate(replica,projected.bytes);
  assert.deepEqual(replica.getMap('productos').get('p01'),required);
  assert.deepEqual([...replica.share.keys()].sort(),['productos','ubicaciones']);
  const wire=Buffer.from(projected.bytes).toString('utf8');
  for(const secret of ['SECRET_CONTACT','SECRET_PIN','SECRET_OWNER_PIN'])
   assert.equal(wire.includes(secret),false,secret);
  // Clean public projection must NEVER rewrite the private historical records.
  assert.equal(source.getMap('productos').get('p01').sku,'');
  assert.equal(source.getMap('productos').get('p01').categoria,null);
 }finally{replica?.destroy();projected?.doc.destroy();source.destroy();}
});

test('optional field null, empty and missing are semantically the same public display view',()=>{
 const sourceA=makeSource({sku:null,barcode:'',categoria:null,ubicacionId:undefined});
 const sourceB=makeSource({});
 let a,b;
 try{
  a=project(sourceA);b=project(sourceB);
  assert.deepEqual(a.doc.getMap('productos').get('p01'),b.doc.getMap('productos').get('p01'));
  assert.equal(Buffer.from(a.bytes).toString('hex'),Buffer.from(b.bytes).toString('hex'));
 }finally{a?.doc.destroy();b?.doc.destroy();sourceA.destroy();sourceB.destroy();}
});

test('only exactly absent markers are omitted; wrong optional types and malformed strings still fail closed',()=>{
 for(const optional of [{sku:0},{sku:42},{barcode:['oops']},{categoria:{private:'x'}},
                        {ubicacionId:0},{sku:' '},{sku:' A '},{sku:'bad\\nfield'}]){
  const doc=makeSource(optional);
  try{assert.throws(()=>project(doc),/invalid/i,JSON.stringify(optional));}
  finally{doc.destroy();}
 }
 for(const requiredBad of [{precio:null},{stockActual:null},{nombre:''},{nombre:null}]){
  const doc=makeSource(requiredBad);
  try{assert.throws(()=>project(doc),/invalid/i,JSON.stringify(requiredBad));}
  finally{doc.destroy();}
 }
});

test('public transport boundary refuses unsanitized null/empty optional fields',()=>{
 const source=makeSource({});
 let projected;
 try{
  projected=project(source);
  const map=projected.doc.getMap('productos');
  for(const optional of [{sku:''},{sku:null},{categoria:''},{ubicacionId:null}]){
   map.set('p01',{...required,...optional});
   assert.throws(()=>assertPublicCatalogTransportDoc({doc:projected.doc,room}),/invalid/i);
  }
 }finally{projected?.doc.destroy();source.destroy();}
});
