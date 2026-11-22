'use strict';
// C165: exercise the ACTUAL production Service Worker install handler with its
// entire 134-file shell. Safari WebContent must not process 134 concurrent cache.add's.
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../docs/sw.js'),'utf8');
const shellDecl=source.match(/const SHELL = \[[\s\S]*?\];/);
const start=source.indexOf('self.addEventListener("install",');
const end=source.indexOf('self.addEventListener("activate",start);
assert.ok(shellDecl&&start>0&&end>start,'use actual SW shell and install handler');
const runCode=shellDecl[0]+'\n'+source.slice(start,end);
async function simulatedInstall(failPath){
 let active=0,peak=0,attempts=0,successes=0,activated=0,waited=null;
 const cache={
  add(req){
   active++;peak=Math.max(peak,active);attempts++;
   return new Promise((resolve,reject)=>setTimeout(()=>{
     active--;
     if(req.url===failPath)reject(new Error('synthetic 404 '+req.url));
     else {successes++;resolve();}
   },2));
  },
  match(){return Promise.resolve(null);}
 };
 const context={
  caches:{open:async()=>cache},
  CACHE_LOCAL:'f123-shell-test',
  Request:class{constructor(url,options){this.url=url;this.options=options;}},
  self:{
   addEventListener(type,callback){if(type==='install')callback({waitUntil(p){waited=p;}});},
   skipWaiting(){activated++;return Promise.resolve();}
  },
  console:{warn(){}},Promise,Set,setTimeout
 };
 vm.runInNewContext(runCode,context,{filename:'sw.js'});
 assert.ok(waited,'actual SW install handler must register waitUntil');
 let error=null;try{await waited;}catch(e){error=e;}
 return{peak,attempts,successes,activated,error};
}
test('C165 RED: 134 production precache requests must never run at once on iPhone',async()=>{
 const actual=source.slice(source.indexOf('const SHELL = ['),source.indexOf('];',source.indexOf('const SHELL = ['))+2);
 const count=(actual.match(/"\.\//g)||[]).length;
 assert.ok(count>=120,'production SW includes a large shell; test the actual file');
 const result=await simulatedInstall();
 assert.equal(result.error,null,'valid install succeeds');
 assert.equal(result.attempts,count,'all 134 resources remain precached, never silently dropped');
 assert.equal(result.successes,count);
 assert.equal(result.activated,1);
 assert.ok(result.peak<=3,'Safari prefetch concurrency cap must be <=3, actual peak '+result.peak);
});
test('C165: missing OPTIONAL asset cannot delete offline shell or block installation',async()=>{
 const r=await simulatedInstall('./inspector-ui.js');
 assert.equal(r.error,null);
 assert.equal(r.activated,1);
 assert.ok(r.successes>=120);
 assert.ok(r.peak<=3);
});
test('C165: missing ESSENTIAL asset must preserve previous shell (never skipWaiting)',async()=>{
 const r=await simulatedInstall('./mock-backend.js');
 assert.ok(r.error,'essential failure must reject install');
 assert.equal(r.activated,0,'do not activate broken new shell');
 assert.ok(r.peak<=3);
});
test('C165: bounded install retains SHA256 manifest verification and no cache deletions',()=>{
 assert.match(source,/const pendientes = Object\.keys\(man\.files\)/);
 assert.match(source,/const workers = \[\]/);
 assert.match(source,/const verificarRel =/);
 assert.match(source,/Precarga de arranque incompleta; preservar shell anterior/);
 assert.doesNotMatch(source.slice(start,end),/caches\.delete\(/);
});
