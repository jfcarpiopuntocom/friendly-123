// PORT2 C8: source-executed browser bridge keeps raw private Y.Doc out of YParty.
// Uses the EXACT production server projection allowlist; no shadow writers.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import {createPublicCatalogBridge} from '../../src/port2-public-catalog-bridge.mjs';

const room='a'.repeat(32)+'-cat',frozenHead='certified-catalog-head-20261119';
function privateDoc(){
 const doc=new Y.Doc();doc.clientID=314;
 doc.getMap('productos').set('sku-1',{id:'sku-1',nombre:'Book',sku:'B-101',
  precio:19.95,stockActual:2,costo:5.33,ownerPin:'PRIVATE_PIN_MUST_NOT_LEAK'});
 doc.getMap('ubicaciones').set('shelf-1',{id:'shelf-1',nombre:'Main shelf',activa:true,
  notes:'PRIVATE_CUSTOMER_MUST_NOT_LEAK'});
 doc.getMap('_meta').set('pinsRol',{owner:'123',team:'456'});
 doc.getMap('hechos_financieros').set('sale-1',{amountCents:1995,account:'PRIVATE_ACCOUNT'});
 doc.getMap('clientes').set('c-1',{phone:'PRIVATE_PHONE'});
 doc.getMap('fotos_refs').set('sha-1','PRIVATE_PHOTO_REFERENCE');
 return doc;
}
function authorized(){
 const docs=[],calls=[],provider={destroyed:false,destroy(){this.destroyed=true;}};
 return {
  docs,calls,provider,
  createProvider(arg){docs.push(arg.doc);calls.push({room:arg.room,channel:arg.channel});
    return provider;}
 };
}
const setup=(overrides={})=>{
 const doc=privateDoc(),transport=authorized();
 const args={privateDoc:doc,Y,room,frozenHead,qaEnabled:true,
  localReady:true,isOwner:()=>true,createProvider:transport.createProvider,
  ...overrides};
 return {doc,transport,args,dispose(){doc.destroy()}};
};
test('client publishes ONLY a detached whitelist Y.Doc, never private reference or structs',()=>{
 const c=setup();
 try{
  const bridge=createPublicCatalogBridge(c.args);
  assert.ok(bridge);
  assert.equal(c.transport.docs.length,1);
  const doc=c.transport.docs[0];
  assert.notEqual(doc,c.doc,'raw private Y.Doc must not be passed');
  assert.notEqual(doc.clientID,c.doc.clientID,'raw source writer must not be reused');
  assert.deepEqual([...doc.share.keys()].sort(),['productos','ubicaciones']);
  const item=doc.getMap('productos').get('sku-1');
  assert.deepEqual(item,{id:'sku-1',nombre:'Book',sku:'B-101',precio:19.95,stockActual:2});
  const loc=doc.getMap('ubicaciones').get('shelf-1');
  assert.deepEqual(loc,{id:'shelf-1',nombre:'Main shelf',activa:true});
  const bytes=Y.encodeStateAsUpdate(doc);
  const text=Array.from(bytes).map(n=>String.fromCharCode(n)).join('');
  for(const secret of ['PRIVATE_PIN_MUST_NOT_LEAK','PRIVATE_CUSTOMER_MUST_NOT_LEAK',
   'PRIVATE_ACCOUNT','PRIVATE_PHONE','PRIVATE_PHOTO_REFERENCE','pinsRol','hechos_financieros','clientes'])
    assert.equal(text.includes(secret),false,secret);
  bridge.close();
  assert.equal(doc.isDestroyed,true);
  assert.equal(c.transport.provider.destroyed,true);
 }finally{c.dispose()}
});
test('previously frozen deterministic projection clientID is not reused for a live publisher',()=>{
 const c=setup();
 try{
  const bridge=createPublicCatalogBridge(c.args);
  const projectedClientId=bridge.frozenProjectionClientID;
  const live=c.transport.docs[0];
  assert.notEqual(live.clientID,projectedClientId);
  assert.notEqual(live,c.doc);
  bridge.close();
 }finally{c.dispose()}
});
test('private updates after one-shot snapshot never get forwarded to YParty',()=>{
 const c=setup();
 try{
  const bridge=createPublicCatalogBridge(c.args);
  const before=Y.encodeStateAsUpdate(c.transport.docs[0]);
  c.doc.getMap('_meta').set('newPin','NEW_PRIVATE_PIN');
  c.doc.getMap('hechos_financieros').set('sale-2',{amountCents:1234});
  c.doc.getMap('productos').get('sku-1').ownerPin='SENSITIVE_CHANGE';
  assert.deepEqual(Y.encodeStateAsUpdate(c.transport.docs[0]),before);
  bridge.close();
 }finally{c.dispose()}
});
test('QA disabled or non-owner / incomplete local source never constructs transport',()=>{
 for(const replacement of [
  {qaEnabled:false},{isOwner:()=>false},{localReady:false},
  {isOwner:()=>{throw Error('not logged in')}}
 ]){
  const c=setup(replacement);
  try{
   assert.equal(createPublicCatalogBridge(c.args),null);
   assert.equal(c.transport.docs.length,0);
  }finally{c.dispose()}
 }
});
test('wrong room, missing grant or insecure source doc refuses without connecting',()=>{
 for(const override of [
  {room:'b'.repeat(32)+'-ops'},
  {room:'invalid'},
  {frozenHead:'..'},
  {createProvider:null},
  {isOwner:null}
 ]){
  const c=setup(override);
  try{
   assert.throws(()=>createPublicCatalogBridge(c.args),/catalog|scope|grant|provider|room|owner|head/i);
   assert.equal(c.transport.docs.length,0);
  }finally{c.dispose()}
 }
});
test('invalid product fields or >10000 products cannot enter public channel',()=>{
 const c=setup();
 try{
  c.doc.getMap('productos').set('sku-2',{id:'sku-2',nombre:'Other',precio:NaN,stockActual:2});
  assert.throws(()=>createPublicCatalogBridge(c.args),/invalid/i);
  assert.equal(c.transport.docs.length,0);
 }finally{c.dispose()}
 const d=setup();
 try{
  const map=d.doc.getMap('productos');
  d.doc.transact(()=>{
   for(let i=0;i<10001;i++){
    const id='p'+i;map.set(id,{id,nombre:'Book',precio:1,stockActual:1});
   }
  });
  assert.throws(()=>createPublicCatalogBridge(d.args),/too many/i);
  assert.equal(d.transport.docs.length,0);
 }finally{d.dispose()}
});
test('incomplete Yjs ancestry refuses before a provider sees a document',()=>{
 const c=setup(),other=new Y.Doc();other.clientID=234;
 const delta=[];other.on('update',u=>delta.push(u));
 other.getMap('eventos').set('first',{amountCents:1});
 other.getMap('eventos').set('second',{amountCents:2});
 try{
  Y.applyUpdate(c.doc,delta[1]);
  assert.ok(c.doc.store.pendingStructs);
  assert.throws(()=>createPublicCatalogBridge(c.args),/pending|causal|ancestor|incomplete/i);
  assert.equal(c.transport.docs.length,0);
 }finally{c.dispose();other.destroy()}
});
test('provider factory failure leaves no live Y.Doc retained or listener on the private source',()=>{
 const c=setup({createProvider:()=>{throw Error('network unavailable')}});
 let events=0;
 c.doc.on('update',()=>{events++});
 try{
  assert.throws(()=>createPublicCatalogBridge(c.args),/unavailable/);
  c.doc.getMap('_meta').set('new','still private');
  assert.equal(events,1);
 }finally{c.dispose()}
});
