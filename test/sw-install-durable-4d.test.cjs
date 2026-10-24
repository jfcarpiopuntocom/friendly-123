'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const src=fs.readFileSync(path.join(__dirname,'../docs/sw.js'),'utf8');
const install=src.slice(src.indexOf('self.addEventListener("install"'),src.indexOf('self.addEventListener("activate"'));
const activate=src.slice(src.indexOf('self.addEventListener("activate"'),src.indexOf('self.addEventListener("fetch"'));
const shell=/^const CACHE = "([^"]+)";/m.exec(src)?.[1],gen=/^const CACHE_GENERACION = "([^"]+)";/m.exec(src)?.[1];
assert.match(shell,/^f123-shell-v\d+$/);assert.match(gen,/^-golden\d+$/);
const current=shell+gen;
function run(fail) {
 const previous='f123-shell-v567-golden128';
 const stores=new Map([[previous,new Set(['./index.html'])]]), handlers={}, actions=[];
 const caches={
  open(name){if(!stores.has(name))stores.set(name,new Set());return Promise.resolve({
   add(req){if(fail==='all'||(fail==='optional'&&req.url==='./manual.html'))return Promise.reject(Object.assign(Error('quota'),{name:'QuotaExceededError'}));stores.get(name).add(req.url);return Promise.resolve()},
   match(u){return Promise.resolve(stores.get(name).has(u)?{ok:true,json:()=>Promise.resolve({files:{}})}:null)}
  })},
  keys(){return Promise.resolve([...stores.keys()])},
  delete(name){actions.push('deleted:'+name);stores.delete(name);return Promise.resolve(true)}
 };
 const self={addEventListener(k,fn){handlers[k]=fn},skipWaiting(){actions.push('skipWaiting');return Promise.resolve()},clients:{claim(){},matchAll(){return Promise.resolve([])}}};
 const declarations='const CACHE='+JSON.stringify(shell)+',CACHE_GENERACION='+JSON.stringify(gen)+',CACHE_LOCAL=CACHE+CACHE_GENERACION,SHELL=["./index.html","./estado-idb.js","./mock-backend.js","./manual.html"];function esDeMiCanal(n){return n.startsWith("f123-shell-v")&&!/-(next|previo)$/.test(n)};function broadcastActualizacion(){};';
 vm.runInNewContext(declarations+install+activate,{self,caches,Request:class{constructor(url){this.url=url}},console:{warn(){}},Promise,TextEncoder,crypto:{subtle:{}}},{timeout:1000});
 return {stores,handlers,actions,event:()=>({waitUntil(p){this.promise=Promise.resolve(p)}}),previous};
}
test('quota rejects critical shell precache; old offline cache stays',async()=>{
 const h=run('all'),ev=h.event();h.handlers.install(ev);
 await assert.rejects(ev.promise,/Precarga de arranque incompleta/);
 assert.equal(h.actions.includes('skipWaiting'),false);
 assert.equal(h.stores.has(h.previous),true);
});
test('successful critical precache can activate and retire old cache',async()=>{
 const h=run('none'),ev=h.event();h.handlers.install(ev);await ev.promise;
 assert.equal(h.actions.includes('skipWaiting'),true);
 const ac=h.event();h.handlers.activate(ac);await ac.promise;
 assert.equal(h.stores.has(current),true);assert.equal(h.stores.has(h.previous),false);
});
test('missing optional asset keeps resilient install behavior',async()=>{
 const h=run('optional'),ev=h.event();h.handlers.install(ev);await ev.promise;
 assert.equal(h.actions.includes('skipWaiting'),true);
 assert.equal(h.stores.get(current).has('./manual.html'),false);
});
