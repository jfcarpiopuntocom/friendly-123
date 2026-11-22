'use strict';
// C167: real SW install source-executed. The iPhone Safari jetsam P0 needs
// bounded simultaneous cache writes AND SHA-256 ArrayBuffers, not only fetches.
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../docs/sw.js'),'utf8');
const shell=source.match(/const SHELL = \[[\s\S]*?\];/);
const start=source.indexOf('self.addEventListener("install",');
const end=source.indexOf('self.addEventListener("activate",',start);
assert.ok(shell&&start>0&&end>start);
const code=shell[0]+'\n'+source.slice(start,end);
async function run(userAgent,broken){
 let active=0,peak=0,hashing=0,hashPeak=0,adds=0,activated=0,waited;
 const sampleFiles=['./index.html','./app-inline-01.min.js','./app-inline-02.min.js','./mock-backend.js','./estado-idb.js','./sync-yjs.js','./auth-ui.js','./dashboard.html'];
 const zeros='sha256-'+('00'.repeat(32));
 const files=Object.fromEntries(sampleFiles.map(n=>[n,zeros]));
 const cache={
   add(req){active++;adds++;peak=Math.max(peak,active);return new Promise((resolve,reject)=>setTimeout(()=>{
     active--;if(req.url===broken)reject(Error('synthetic 404'));else resolve();
   },1));},
   match(key){
     if(key==='./version-manifest.json')return Promise.resolve({json:()=>Promise.resolve({files})});
     if(!files[key])return Promise.resolve(null);
     return Promise.resolve({arrayBuffer(){hashing++;hashPeak=Math.max(hashPeak,hashing);return Promise.resolve(new Uint8Array(1).buffer);}});
   }
 };
 const fake={
   self:{navigator:{userAgent},addEventListener(name,fn){if(name==='install')fn({waitUntil(p){waited=p;}});},skipWaiting(){activated++;return Promise.resolve();}},
   caches:{open:async()=>cache},CACHE_LOCAL:'test-ios-safari',
   Request:class{constructor(url,opts){this.url=url;this.options=opts;}},
   crypto:{subtle:{digest(){return new Promise(resolve=>setTimeout(()=>{hashing--;resolve(new Uint8Array(32).buffer);},2));}}},
   Promise,Set,Uint8Array,Array,console:{warn(){}},setTimeout
 };
 vm.runInNewContext(code,fake,{filename:'docs/sw.js'});
 let error;try{await waited}catch(e){error=e}
 return {active,peak,hashPeak,adds,activated,error};
}
test('C167 RED: iPhone Safari installation keeps network AND SHA-256 in-flight memory <= 1',async()=>{
 const a=await run('Mozilla/5.0 (iPhone; CPU iPhone OS 26_4 like Mac OS X) AppleWebKit/605.1.15 Mobile');
 const count=(shell[0].match(/"\.\//g)||[]).length;
 assert.ok(count>=120);
 assert.equal(a.error,undefined);
 assert.equal(a.adds,count,'all offline assets still precached; no removal of coverage');
 assert.equal(a.activated,1);
 assert.ok(a.peak<=1,'Safari network/CacheStorage concurrency '+a.peak+' exceeds 1');
 assert.ok(a.hashPeak<=1,'Safari crypto ArrayBuffer concurrency '+a.hashPeak+' exceeds 1');
});
test('C167: non-iOS clients retain existing bounded 3 downloads / 4 verification workers',async()=>{
 const a=await run('Mozilla/5.0 (X11; Linux x86_64) Chrome/130 Safari/537.36');
 assert.equal(a.error,undefined);
 assert.ok(a.peak<=3);
 assert.ok(a.hashPeak<=4);
 assert.ok(a.peak>1,'desktop should not be throttled to Safari single worker');
 assert.ok(a.hashPeak>1,'desktop should preserve existing verification throughput');
});
test('C167: broken essential offline shell still cannot activate a half-version on Safari',async()=>{
 const a=await run('Mozilla/5.0 (iPhone; CPU iPhone OS 26_4)', './mock-backend.js');
 assert.ok(a.error);
 assert.equal(a.activated,0);
 assert.ok(a.peak<=1);
});
