'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const src=require('./helpers/page-source.cjs').readFileSync(path.join(__dirname,'../docs/index.html'),'utf8');
const ver=JSON.parse(fs.readFileSync(path.join(__dirname,'../docs/version.json'),'utf8'));
const active=ver.shell;
const canonical=active+'-'+ver.cacheGeneration;
const floor=src.slice(src.indexOf('(function verificarPisoVersion() {'),src.indexOf('/* ACTUALIZACION SOLA',src.indexOf('(function verificarPisoVersion() {')));
const compat=src.slice(src.indexOf('(function verificarCompatibilidadVersion() {'),src.indexOf('/* PISO DE VERSIÓN AUTORITATIVO',src.indexOf('(function verificarCompatibilidadVersion() {')));
const forced=src.slice(src.indexOf('(async function () {',src.indexOf('// CONTROL DE VERSION FORZADO')),src.indexOf('/* COMPATIBILIDAD DE VERSIÓN',src.indexOf('// CONTROL DE VERSION FORZADO')));
const helperStart=src.indexOf('// 4D: compare the PUBLIC shell');
const helper=helperStart<0?'':src.slice(helperStart,src.indexOf('// CONTROL DE VERSION FORZADO',helperStart));
const tick=async()=>{for(let i=0;i<16;i++)await new Promise(r=>setImmediate(r));};
function mk({pathname='/friendly-123/',cacheNames=[canonical,canonical+'-next',canonical+'-previo'],served=active,stored='1.0|'+active}={}){
 const e={reloadMarks:0,deleted:[],updateRegs:0,reads:0};
 const storage={getItem(k){return k==='f123_version_vista'?stored:null},setItem(){},removeItem(){}};
 const caches={keys:()=>{e.reads++;return Promise.resolve(cacheNames)},delete:(n)=>{e.deleted.push(n);return Promise.resolve(true)}};
 const c={window:{}, location:{pathname},console,localStorage:storage,caches,Date,Promise,JSON,BroadcastChannel:class{postMessage(){}close(){}},setTimeout:()=>0,
 fetch:()=>Promise.resolve({ok:true,json:()=>Promise.resolve({version:'1.0',shell:served})}),navigator:{serviceWorker:{getRegistrations:()=>Promise.resolve([])}},sessionStorage:{setItem(){}},_recargarSeguroVersion:()=>{e.reloadMarks++}};
 c.window.caches=caches;return {e,c};
}
test('D3 healthy current golden stable should not trigger reload (floor)',async()=>{const {c,e}=mk();vm.runInNewContext(helper+floor,c);await tick();assert.equal(e.reloadMarks,0)});
test('D3 older v565 golden stable must signal reload (floor)',async()=>{const {c,e}=mk({cacheNames:['f123-shell-v565-golden127']});vm.runInNewContext(helper+floor,c);await tick();assert.equal(e.reloadMarks,1)});
test('D3 native stored plain shell must be parsed and used (compatibility)',async()=>{const {c,e}=mk({cacheNames:['f123-shell-v565-golden127']});vm.runInNewContext(helper+compat,c);await tick();assert.equal(e.reads,1);assert.equal(e.reloadMarks,1)});
test('D2 version discovery leaves stable and neighboring caches to SW activation',async()=>{const {c,e}=mk({stored:'1.0|f123-shell-v565',cacheNames:['f123-shell-v565-golden127','f123-shell-v565-golden127-next','f123-shell-v565-golden127-previo']});vm.runInNewContext(helper+forced,c);await tick();assert.deepEqual(e.deleted,[])});

test('D3 next current cache must not trigger false reload from stable cache',async()=>{const {c,e}=mk({pathname:'/friendly-123/next/',cacheNames:['f123-shell-v565-golden127',canonical+'-next']});vm.runInNewContext(helper+floor,c);await tick();assert.equal(e.reloadMarks,0)});
test('D3 previo current cache must not trigger false reload from next cache',async()=>{const {c,e}=mk({pathname:'/friendly-123/previo/',cacheNames:[canonical+'-next',canonical+'-previo']});vm.runInNewContext(helper+floor,c);await tick();assert.equal(e.reloadMarks,0)});
test('D2 next version discovery leaves offline caches to SW activation',async()=>{const {c,e}=mk({pathname:'/friendly-123/next/',stored:'1.0|f123-shell-v565',cacheNames:['f123-shell-v565-golden127','f123-shell-v565-golden127-next','f123-shell-v565-golden127-previo']});vm.runInNewContext(helper+forced,c);await tick();assert.deepEqual(e.deleted,[])});

test('D2 rejected SW update preserves the offline cache',async()=>{const {c,e}=mk({stored:'1.0|f123-shell-v565'});c.navigator.serviceWorker.getRegistrations=async()=>[{update:async()=>{e.updateRegs++;throw Error('update rejected')}}];vm.runInNewContext(helper+forced,c);await tick();assert.equal(e.updateRegs,1);assert.deepEqual(e.deleted,[])});
test('D2 full-quota version cleanup does not remove caches',async()=>{const {c,e}=mk({stored:'1.0|f123-shell-v565'});c.localStorage.getItem=()=>{throw Object.assign(Error('quota'),{name:'QuotaExceededError'})};vm.runInNewContext(helper+forced,c);await tick();assert.deepEqual(e.deleted,[])});
