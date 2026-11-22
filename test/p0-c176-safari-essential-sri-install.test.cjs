'use strict';
// C176: run the ACTUAL Service Worker install handler, including the full shell.
// A corrupted essential entry that still fails SHA256 after one network reload
// must NOT call skipWaiting and replace the last known-good offline app.
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const src=fs.readFileSync(path.join(__dirname,'../docs/sw.js'),'utf8');
const shell=src.match(/const SHELL = \[[\s\S]*?\];/);
const start=src.indexOf('self.addEventListener("install",');
const stop=src.indexOf('self.addEventListener("activate",',start);
assert.ok(shell&&start>0&&stop>start);
const code=shell[0]+'\n'+src.slice(start,stop);
const zero='sha256-'+('00'.repeat(32));

async function install({asset='./index.html',essential=true,freshByte=0x22,brokenByte=0x11}={}){
 let active=0,peak=0,activated=0,waited,refetches=0,cachePuts=0;
 const contents=new Map([[asset,brokenByte]]);
 function resp(byte){return {
   ok:true,clone(){return resp(byte);},
   arrayBuffer(){return Promise.resolve(new Uint8Array([byte]).buffer);}
 };}
 const cache={
   add(req){active++;peak=Math.max(peak,active);
     return Promise.resolve().then(()=>{active--;});
   },
   match(rel){
     if(rel==='./version-manifest.json')return Promise.resolve({
       json(){return Promise.resolve({files:{[asset]:zero}});}
     });
     return Promise.resolve(contents.has(rel)?resp(contents.get(rel)):null);
   },
   put(rel,r){cachePuts++;return r.arrayBuffer().then(bytes=>{contents.set(rel,new Uint8Array(bytes)[0]);});}
 };
 const context={
   CACHE_LOCAL:'f123-shell-fixture',
   Request:class{constructor(url,opts){this.url=url;this.options=opts;}},
   caches:{open:async()=>cache},Promise,Array,Set,Uint8Array,
   crypto:{subtle:{digest(_alg,bytes){return Promise.resolve(new Uint8Array(32).fill(new Uint8Array(bytes)[0]).buffer);}}},
   fetch(req){refetches++;return Promise.resolve(resp(freshByte));},
   self:{navigator:{userAgent:'Mozilla/5.0 (iPhone; Mobile Safari)'},
     addEventListener(name,cb){if(name==='install')cb({waitUntil(p){waited=p;}});},
     skipWaiting(){activated++;return Promise.resolve();}
   },
   console:{warn(){}}
 };
 vm.runInNewContext(code,context,{filename:'docs/sw.js'});
 assert.ok(waited,'actual install must hold the lifecycle event');
 let error;try{await waited;}catch(e){error=e;}
 return {asset,essential,activated,error,refetches,cachePuts,peak,cachedByte:contents.get(asset)};
}

test('C176 RED: essential index.html with wrong cached AND network hash must preserve old service worker',async()=>{
 const a=await install();
 assert.equal(a.refetches,1,'one bounded reload attempted');
 assert.equal(a.cachePuts,0);
 assert.ok(a.error,'invalid essential SHA prevents new installation');
 assert.equal(a.activated,0,'never skipWaiting a known-corrupt essential shell');
 assert.equal(a.cachedByte,0x11,'do not delete previous shell or damage existing data');
 assert.ok(a.peak<=1,'Safari network precache still serial');
});
test('C176: valid network re-fetch heals essential SHA and allows activation',async()=>{
 const a=await install({freshByte:0x00});
 assert.equal(a.error,undefined);
 assert.equal(a.refetches,1);
 assert.equal(a.cachePuts,1);
 assert.equal(a.cachedByte,0x00);
 assert.equal(a.activated,1);
});
test('C176: mismatch in optional asset cannot brick offline shell',async()=>{
 const a=await install({asset:'./inspector-ui.js'});
 assert.equal(a.error,undefined);
 assert.equal(a.activated,1);
 assert.equal(a.refetches,1);
 assert.ok(a.peak<=1);
});
test('C176: essential commissions projection mismatch must not activate partial business shell',async()=>{
 const a=await install({asset:'./core/commission-history.js'});
 assert.ok(a.error);
 assert.equal(a.activated,0);
 assert.equal(a.refetches,1);
});
