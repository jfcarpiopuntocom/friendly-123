'use strict';
// C179: execute the REAL production Service Worker activate handler. Before
// C179 the old source called clients.claim synchronously, before caches.keys()
// and before retired shell deletion, outside event.waitUntil.
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../docs/sw.js'),'utf8');
const start=source.indexOf('self.addEventListener("activate",');
const end=source.indexOf('self.addEventListener("fetch"',start);
assert.ok(start>0&&end>start,'real production activate handler found');
const code=source.slice(start,end);
const flush=async()=>{for(let i=0;i<10;i++)await Promise.resolve();};

function fixture({failDelete=false}={}){
 let callback, resolveKeys,resolveClaim;
 const keyPromise=new Promise(resolve=>{resolveKeys=resolve});
 const claimPromise=new Promise(resolve=>{resolveClaim=resolve});
 const history=[],deleted=[],warnings=[];
 let waitUntil,waitSettled=false,claims=0,notifications=0;
 const self={
   addEventListener(type,fn){if(type==='activate')callback=fn},
   clients:{claim(){claims++;history.push('claim');return claimPromise}}
 };
 const context={
  self,Promise,
  CACHE_LOCAL:'f123-shell-v872-golden408',
  esDeMiCanal:n=>String(n).startsWith('f123-shell-')&&!String(n).endsWith('-next')&&!String(n).endsWith('-previo'),
  broadcastActualizacion(){notifications++;history.push('broadcast')},
  caches:{
   keys(){history.push('keys');return keyPromise},
   delete(name){history.push('delete:'+name);deleted.push(name);return failDelete?Promise.reject(new Error('cache deletion failed')):Promise.resolve(true)}
  },
  console:{warn(...args){warnings.push(args.map(String).join(' '))}}
 };
 vm.runInNewContext(code,context,{filename:'docs/sw.js'});
 assert.equal(typeof callback,'function');
 callback({waitUntil(p){history.push('waitUntil');waitUntil=p;p.then(()=>{waitSettled=true})}});
 return {history,deleted,warnings,get claims(){return claims},get notifications(){return notifications},get settled(){return waitSettled},resolveKeys,resolveClaim,get waitUntil(){return waitUntil}};
}

test('C179 RED: clients.claim must NOT run before pending cache enumeration/deletion',async()=>{
 const f=fixture();
 assert.deepEqual(f.history,['keys','waitUntil'],'old source claimed clients immediately here');
 f.resolveKeys(['f123-shell-v871-golden407','f123-shell-v872-golden408','f123-shell-v870-golden406-next','other-app']);
 await flush();
 assert.deepEqual(f.deleted,['f123-shell-v871-golden407'],'only same-channel previous shell removed');
 assert.deepEqual(f.history,['keys','waitUntil','delete:f123-shell-v871-golden407','broadcast','claim']);
 assert.equal(f.claims,1);
 assert.equal(f.notifications,1);
 assert.equal(f.settled,false,'waitUntil MUST include actual clients.claim promise');
 f.resolveClaim();await f.waitUntil;
 assert.equal(f.settled,true);
});
test('C179: if same-channel cache cleanup fails, no early takeover, existing offline shell retained',async()=>{
 const f=fixture({failDelete:true});
 f.resolveKeys(['f123-shell-v871-golden407']);
 await f.waitUntil;
 assert.equal(f.claims,0,'failed cache cleanup cannot claim users before safe transition');
 assert.equal(f.notifications,0);
 assert.ok(f.warnings.some(x=>x.includes('cache deletion failed')));
});
test('C179: no stale cache still claims once and waitUntil owns promise',async()=>{
 const f=fixture();
 f.resolveKeys(['f123-shell-v872-golden408','f123-shell-v870-golden406-next','unrelated']);
 await flush();
 assert.deepEqual(f.deleted,[]);
 assert.equal(f.claims,1);assert.equal(f.notifications,1);assert.equal(f.settled,false);
 f.resolveClaim();await f.waitUntil;assert.equal(f.settled,true);
});
