import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import * as Y from 'yjs';
import path from 'node:path';
import {createPublicCatalogBridge} from '../../src/port2-public-catalog-bridge.mjs';

const room='c'.repeat(32)+'-cat',head='frozen-head-c9-20261119';
const shim=`export class WebsocketProvider {connect(){}}
export default class YProvider {
 constructor(host,room,doc,options){
  globalThis.__f123BaseCount=(globalThis.__f123BaseCount||0)+1;
  this.doc=doc;this.room=room;this.ws=null;this.url='wss://worker.invalid';
  this.events={};this.id='qa-client';this.shouldConnect=false;
 }
 on(k,f){this.events[k]=f}
 off(k){delete this.events[k]}
 emit(){}
 disconnect(){}
 destroy(){}
}`;
async function realProvider(){
 const code=(await build({
  entryPoints:[path.join(import.meta.dirname,'../../src/authorized-yprovider.mjs')],
  bundle:true,write:false,format:'esm',platform:'browser',
  plugins:[{name:'YPartyQA',setup(b){
   b.onResolve({filter:new RegExp('^y-partyserver/provider},()=>({path:'yparty-stub',namespace:'qa'}));
   b.onLoad({filter:/.*/,namespace:'qa'},()=>({contents:shim,loader:'js'}));
  }}]
 })).outputFiles[0].text;
 return (await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'))).default;
}
function raw(){
 const d=new Y.Doc();
 d.getMap('productos').set('sku',{id:'sku',nombre:'Book',precio:15,stockActual:2,costo:7,ownerPin:'PRIVATE_PIN'});
 d.getMap('ubicaciones').set('shelf',{id:'shelf',nombre:'Shelf',activa:true});
 d.getMap('_meta').set('pinsRol',{owner:'123'});
 d.getMap('hechos_financieros').set('sale',{amountCents:15});
 return d;
}
const params=async()=>({cap:'qa-only'});
test('RED: raw private catalog refused before superclass constructs socket',async()=>{
 const P=await realProvider(),d=raw();globalThis.__f123BaseCount=0;
 try{assert.throws(()=>new P('host',room,d,{params}),/private|public|catalog|transport/i);
 assert.equal(globalThis.__f123BaseCount,0)}finally{d.destroy()}
});
test('RED: hidden cost even in productos fails before super',async()=>{
 const P=await realProvider(),d=new Y.Doc();globalThis.__f123BaseCount=0;
 try{d.getMap('productos').set('sku',{id:'sku',nombre:'Book',precio:15,stockActual:2,costo:7});
 assert.throws(()=>new P('host',room,d,{params}),/private|public|catalog|transport/i);
 assert.equal(globalThis.__f123BaseCount,0)}finally{d.destroy()}
});
test('isolated public C8 doc enters genuine provider and private one does not',async()=>{
 const P=await realProvider(),d=raw();globalThis.__f123BaseCount=0;
 try{
  let transport;
  const bridge=createPublicCatalogBridge({privateDoc:d,Y,room,frozenHead:head,
   qaEnabled:true,localReady:true,isOwner:()=>true,
   createProvider:({doc,room})=>{transport=new P('host',room,doc,{params});return transport}});
  assert.equal(globalThis.__f123BaseCount,1);
  assert.notEqual(transport.doc,d);
  assert.deepEqual([...transport.doc.share.keys()].sort(),['productos','ubicaciones']);
  bridge.close();
 }finally{d.destroy()}
});
test('empty private root is still a forbidden catalog root',async()=>{
 const P=await realProvider(),d=new Y.Doc();globalThis.__f123BaseCount=0;
 try{d.getMap('productos').set('sku',{id:'sku',nombre:'Book',precio:1,stockActual:1});d.getMap('_meta');
 assert.throws(()=>new P('host',room,d,{params}),/private|public|catalog|transport/i);
 assert.equal(globalThis.__f123BaseCount,0)}finally{d.destroy()}
});
test('previous separate ops and private room semantics remain unchanged',async()=>{
 const P=await realProvider(),a=new Y.Doc(),b=new Y.Doc();globalThis.__f123BaseCount=0;
 try{
  a.getMap('eventos').set('event',{amountCents:99});
  b.getMap('_meta').set('owned',true);
  new P('host','c'.repeat(32)+'-ops',a,{params});
  new P('host','c'.repeat(32)+'-priv',b,{params});
  assert.equal(globalThis.__f123BaseCount,2);
 }finally{a.destroy();b.destroy()}
});
test('missing Yjs causal parent never allows public catalog provider',async()=>{
 const P=await realProvider(),a=new Y.Doc(),b=new Y.Doc(),updates=[];globalThis.__f123BaseCount=0;
 try{
  a.clientID=200;a.on('update',u=>updates.push(u));
  a.getMap('productos').set('first',{id:'first',nombre:'One',precio:1,stockActual:1});
  a.getMap('productos').set('second',{id:'second',nombre:'Two',precio:2,stockActual:1});
  Y.applyUpdate(b,updates[1]);assert.ok(b.store.pendingStructs);
  assert.throws(()=>new P('host',room,b,{params}),/pending|catalog|public|private|transport/i);
  assert.equal(globalThis.__f123BaseCount,0);
 }finally{a.destroy();b.destroy()}
});)},()=>({path:'yparty-stub',namespace:'qa'}));
   b.onLoad({filter:/.*/,namespace:'qa'},()=>({contents:shim,loader:'js'}));
  }}]
 })).outputFiles[0].text;
 return (await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'))).default;
}
function raw(){
 const d=new Y.Doc();
 d.getMap('productos').set('sku',{id:'sku',nombre:'Book',precio:15,stockActual:2,costo:7,ownerPin:'PRIVATE_PIN'});
 d.getMap('ubicaciones').set('shelf',{id:'shelf',nombre:'Shelf',activa:true});
 d.getMap('_meta').set('pinsRol',{owner:'123'});
 d.getMap('hechos_financieros').set('sale',{amountCents:15});
 return d;
}
const params=async()=>({cap:'qa-only'});
test('RED: raw private catalog refused before superclass constructs socket',async()=>{
 const P=await realProvider(),d=raw();globalThis.__f123BaseCount=0;
 try{assert.throws(()=>new P('host',room,d,{params}),/private|public|catalog|transport/i);
 assert.equal(globalThis.__f123BaseCount,0)}finally{d.destroy()}
});
test('RED: hidden cost even in productos fails before super',async()=>{
 const P=await realProvider(),d=new Y.Doc();globalThis.__f123BaseCount=0;
 try{d.getMap('productos').set('sku',{id:'sku',nombre:'Book',precio:15,stockActual:2,costo:7});
 assert.throws(()=>new P('host',room,d,{params}),/private|public|catalog|transport/i);
 assert.equal(globalThis.__f123BaseCount,0)}finally{d.destroy()}
});
test('isolated public C8 doc enters genuine provider and private one does not',async()=>{
 const P=await realProvider(),d=raw();globalThis.__f123BaseCount=0;
 try{
  let transport;
  const bridge=createPublicCatalogBridge({privateDoc:d,Y,room,frozenHead:head,
   qaEnabled:true,localReady:true,isOwner:()=>true,
   createProvider:({doc,room})=>{transport=new P('host',room,doc,{params});return transport}});
  assert.equal(globalThis.__f123BaseCount,1);
  assert.notEqual(transport.doc,d);
  assert.deepEqual([...transport.doc.share.keys()].sort(),['productos','ubicaciones']);
  bridge.close();
 }finally{d.destroy()}
});
test('empty private root is still a forbidden catalog root',async()=>{
 const P=await realProvider(),d=new Y.Doc();globalThis.__f123BaseCount=0;
 try{d.getMap('productos').set('sku',{id:'sku',nombre:'Book',precio:1,stockActual:1});d.getMap('_meta');
 assert.throws(()=>new P('host',room,d,{params}),/private|public|catalog|transport/i);
 assert.equal(globalThis.__f123BaseCount,0)}finally{d.destroy()}
});
test('previous separate ops and private room semantics remain unchanged',async()=>{
 const P=await realProvider(),a=new Y.Doc(),b=new Y.Doc();globalThis.__f123BaseCount=0;
 try{
  a.getMap('eventos').set('event',{amountCents:99});
  b.getMap('_meta').set('owned',true);
  new P('host','c'.repeat(32)+'-ops',a,{params});
  new P('host','c'.repeat(32)+'-priv',b,{params});
  assert.equal(globalThis.__f123BaseCount,2);
 }finally{a.destroy();b.destroy()}
});
test('missing Yjs causal parent never allows public catalog provider',async()=>{
 const P=await realProvider(),a=new Y.Doc(),b=new Y.Doc(),updates=[];globalThis.__f123BaseCount=0;
 try{
  a.clientID=200;a.on('update',u=>updates.push(u));
  a.getMap('productos').set('first',{id:'first',nombre:'One',precio:1,stockActual:1});
  a.getMap('productos').set('second',{id:'second',nombre:'Two',precio:2,stockActual:1});
  Y.applyUpdate(b,updates[1]);assert.ok(b.store.pendingStructs);
  assert.throws(()=>new P('host',room,b,{params}),/pending|catalog|public|private|transport/i);
  assert.equal(globalThis.__f123BaseCount,0);
 }finally{a.destroy();b.destroy()}
});