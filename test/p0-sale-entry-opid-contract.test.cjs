'use strict';
// JFC P0: every actual sale entry point must reuse a durable opId after a
// lost HTTP acknowledgement, rather than creating two economic events.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const app=fs.readFileSync(path.join(__dirname,'../src/app/app-inline-01.js'),'utf8');
const min=fs.readFileSync(path.join(__dirname,'../docs/app-inline-01.min.js'),'utf8');
const start=app.indexOf('const _ocVentaIntentosRAM = new Map();');
const end=app.indexOf('let _sellando = false;',start);
assert.ok(start>=0&&end>start,'sale intent helper must exist in production source');
const helper=app.slice(start,end);
test('P0: quick, modal CONFIRM and basket send matching crash-safe opId, not just backend-generated IDs',()=>{
 assert.equal((app.match(/_ocVentaOpPendiente\(/g)||[]).length,4,
   'helper plus three distinct user sale entry points');
 assert.equal((app.match(/opId:\s*intento\.opId/g)||[]).length,3,
   'all three sale POST bodies carry the same opId');
 assert.equal((app.match(/_ocVentaIntentoConfirmado\(intento\)/g)||[]).length,3,
   'three actual sale paths and helper definition clear only after receipt');
 assert.match(min,/f123_sale_intent_v1/,
   'generated minified production JS must include this code, not only src/app');
});
test('P0: pending opId survives fresh JS context, then matching receipt retires it',()=>{
 const saved=new Map(),store={
   getItem:k=>saved.has(k)?saved.get(k):null,
   setItem:(k,v)=>{saved.set(k,String(v));},
   removeItem:k=>saved.delete(k)
 };
 let counter=0;
 const script=helper+'\n({make:_ocVentaOpPendiente,ack:_ocVentaIntentoConfirmado})';
 function fresh(){
   const cryptoApi={randomUUID:()=>('00000000-0000-4000-8000-'+String(++counter).padStart(12,'0'))};
   return vm.runInNewContext(script,{
     localStorage:store,
     crypto:cryptoApi,globalThis:{crypto:cryptoApi},
     Date,JSON,Map,Math,String,Number
   });
 }
 const first=fresh(),input={cantidad:1,info:{formaPago:'cash'}};
 const a=first.make('confirm','synthetic-product',input);
 const b=fresh().make('confirm','synthetic-product',input);
 assert.equal(b.opId,a.opId,'reopened UI must retry the exact opId');
 first.ack(a);
 const c=fresh().make('confirm','synthetic-product',input);
 assert.notEqual(c.opId,a.opId,'later genuine sale gets a new opId after ACK');
 const d=fresh().make('confirm','synthetic-product',{cantidad:2,info:{formaPago:'cash'}});
 assert.notEqual(d.opId,c.opId,'changed intent cannot replay another sale');
});
