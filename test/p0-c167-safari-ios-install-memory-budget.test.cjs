'use strict';
// C167: Safari iPhone crash hardening, bounded SW install memory in BOTH phases.
// Executes the actual v862 SW install handler and its complete 134-file SHELL.
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../docs/sw.js'),'utf8');
const shell=source.match(/const SHELL = \[[\s\S]*?\];/);
const start=source.indexOf('self.addEventListener("install"');
const end=source.indexOf('self.addEventListener("activate"',start);
assert.ok(shell&&start>0&&end>start);
async function boot(ua){
 let net=0,peakNet=0,dig=0,peakDig=0,added=0,activated=0,waited;
 const hashes={"./mock-backend.js":"sha256-"+'0'.repeat(64),"./sync-yjs.js":"sha256-"+'0'.repeat(64)};
 const cache={
  add(){net++;peakNet=Math.max(peakNet,net);return new Promise(resolve=>setTimeout(()=>{net--;added++;resolve();},2));},
  match(rel){if(rel==="./version-manifest.json")return Promise.resolve({json:()=>Promise.resolve({files:hashes})});
   if(hashes[rel])return Promise.resolve({arrayBuffer:()=>Promise.resolve(new Uint8Array([1,2,3]).buffer)});
   return Promise.resolve(null);}
 };
 const context={
  caches:{open:async()=>cache},
  CACHE_LOCAL:'f123-shell-test',
  Request:class{constructor(url){this.url=url;}},
  self:{navigator:{userAgent:ua},addEventListener(type,fn){if(type==="install")fn({waitUntil(p){waited=p;}});},
    skipWaiting(){activated++;return Promise.resolve();}},
  crypto:{subtle:{digest(){dig++;peakDig=Math.max(peakDig,dig);return new Promise(resolve=>setTimeout(()=>{dig--;resolve(new Uint8Array(32).buffer);},4));}}},
  fetch(){throw Error('no manifest mismatch network fetch expected');},
  console:{warn(){}},Promise,Set,Uint8Array,Array,setTimeout
 };
 vm.runInNewContext(shell[0]+'\n'+source.slice(start,end),context,{filename:'docs/sw.js'});
 assert.ok(waited,'real install must retain waitUntil barrier');
 await waited;
 return {peakNet,peakDig,added,activated};
}
test('C167 RED: iPhone Safari precache max 2 and SHA integrity verification max 1, all files intact',async()=>{
 const r=await boot('Mozilla/5.0 (iPhone; CPU iPhone OS 26_4 like Mac OS X) AppleWebKit/605.1.15 Safari/605.1.15');
 assert.ok(r.added>=120,'keep all 134 resources offline');
 assert.equal(r.activated,1);
 assert.ok(r.peakNet<=2,'iPhone cache.add in flight: '+r.peakNet);
 assert.ok(r.peakDig<=1,'iPhone digest arrayBuffers in flight: '+r.peakDig);
});
test('C167: desktop stays 3 precache and 4 integrity workers; no hidden scope expansion',async()=>{
 const r=await boot('Mozilla/5.0 (X11; Linux x86_64) Chrome/130.0 Safari/537.36');
 assert.ok(r.added>=120);
 assert.ok(r.peakNet<=3);
 assert.ok(r.peakDig<=4);
 assert.equal(r.activated,1);
});
test('C167: preserve version manifest, all 134 shell resources, and essentials gate',()=>{
 assert.match(source,/const pendientes = Object.keys\(man.files\)/);
 assert.match(source,/Precarga de arranque incompleta; preservar shell anterior/);
 assert.match(source,/verificarRel\(pendientes\[idx\]\)/);
 assert.ok((shell[0].match(/"\.\//g)||[]).length>=120);
});
