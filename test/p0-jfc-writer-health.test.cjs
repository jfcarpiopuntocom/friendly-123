'use strict';
// JFC private health: metrics are device-only numeric counters, never business
// data. Real health-app.js VM, not string matching / mocked result shape.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../docs/salud-app.js'),'utf8');

function fixture(store=new Map()){
 const listeners=new Map();
 const ctx={
   localStorage:{getItem(k){return store.has(k)?store.get(k):null;},
     setItem(k,v){store.set(k,String(v));},removeItem(k){store.delete(k);}},
   addEventListener(k,fn){const a=listeners.get(k)||[];a.push(fn);listeners.set(k,a);},
   dispatchEvent(e){for(const f of listeners.get(e.type)||[])f(e);},
   location:{pathname:'/friendly-123/'},
   performance:{getEntriesByType:()=>[{type:'reload'}]},
   fetch:async()=>({ok:true,json:async()=>({shell:'f123-shell-v726'})}),
   setTimeout,clearTimeout,console:{log(){},warn(){},error(){}}
 };
 ctx.window=ctx;
 vm.createContext(ctx);
 vm.runInContext(source,ctx,{filename:'salud-app.js'});
 return {ctx,store};
}
test('writer counter allowlist strips even explicitly supplied money/customer/PIN identifiers',async()=>{
 const {ctx}=fixture();
 assert.equal(ctx.OCSalud.escritorEvento('fallbackLocal',{monto:999,cliente:'Secret customer'}),true);
 assert.equal(ctx.OCSalud.escritorEvento('strictFailure',{pin:'999'}),true);
 assert.equal(ctx.OCSalud.escritorEvento('venta',{monto:999}),false);
 ctx.dispatchEvent({type:'oc-relay-durable',detail:{canal:'catalogo',pendientes:4,monto:999,
   cliente:'Secret customer',licenseCode:'F123-SECRET'}});
 const w=ctx.OCSalud.resumen().escritor;
 assert.equal(w.fallbackLocal,1);
 assert.equal(w.strictFailure,1);
 assert.equal(w.pendientesRelay,4);
 assert.equal(w.initCount,1);
 assert.equal(w.navigation,'reload');
 assert.deepEqual(Object.keys(w).sort(),['fallbackLocal','initCount','navigation','pendientesRelay','strictFailure']);
 for(const forbidden of ['Secret customer','999','F123-SECRET','monto','pin','producto','licenseCode'])
   assert.ok(!JSON.stringify(w).includes(forbidden),'writer telemetry may not contain '+forbidden);
});
test('reload preserves ONLY counters; never invent lost operations from unknown pending state',async()=>{
 const store=new Map(),first=fixture(store);
 first.ctx.OCSalud.escritorEvento('fallbackLocal');
 first.ctx.dispatchEvent({type:'oc-relay-durable',detail:{canal:'ops',pendientes:7}});
 const second=fixture(store);
 const w=second.ctx.OCSalud.resumen().escritor;
 assert.equal(w.initCount,2);
 assert.equal(w.fallbackLocal,1);
 assert.equal(w.pendientesRelay,null,
   'after reload, no durable relay count has been observed: unknown is not healthy/zero');
});
test('channel names and arbitrary event data are never serialized',()=>{
 const {ctx}=fixture();
 ctx.dispatchEvent({type:'oc-relay-durable',detail:{
   canal:'F123-private-license-code',pendientes:12,price:777}});
 assert.equal(ctx.OCSalud.resumen().escritor.pendientesRelay,null);
});
