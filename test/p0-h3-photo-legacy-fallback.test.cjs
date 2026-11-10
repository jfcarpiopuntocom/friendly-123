'use strict';
// H3: preserve historical localStorage-only hashed photo evidence even when
// indexedDB exists. Exercises exact production API function bodies in vm.
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const src=fs.readFileSync(path.join(__dirname,'../docs/idb-fotos.js'),'utf8');
const from=src.indexOf('  function leerHashLegado(hash) {') >= 0
  ? src.indexOf('  function leerHashLegado(hash) {')
  : src.indexOf('  async function leerPorHash(hash) {');
const to=src.indexOf('  // v449:',from);
assert.ok(from>=0&&to>from,'must test real read and hash enumeration functions');
function fixture(opts={}){
 const ls=new Map([
   ['f123_fotoblob_legacy-only','data:image/png;base64,TEVHQUNZ'],
   ['f123_fotoblob_db-only','data:image/png;base64,U1RBTEU='],
   ['unrelated','secret']
 ]);
 const dbMap=new Map([
   ['db-only','data:image/png;base64,REItU0FWRUQ='],
   ['same-in-both','data:image/png;base64,REItT1JJR0lO']
 ]);
 ls.set('f123_fotoblob_same-in-both','data:image/png;base64,T0xE');
 const ctx={SOPORTADO:true,STORE_BLOBS:'blobs',console,
   claveBlob:h=>'f123_fotoblob_'+h,
   localStorage:{get length(){return ls.size;},key:i=>[...ls.keys()][i],
     getItem:key=>ls.get(key)||null,setItem:(key,v)=>ls.set(key,String(v)),removeItem:key=>ls.delete(key)},
   abrirDB:async()=>({
     transaction:()=>({objectStore:()=>({
       getAllKeys:()=>{const req={};queueMicrotask(()=>{req.result=[...dbMap.keys()];req.onsuccess();});return req;},
       get:h=>{const req={};queueMicrotask(()=>{req.result=dbMap.get(h)||undefined;req.onsuccess();});return req;}
     })})
   })
 };
 vm.createContext(ctx);
 vm.runInContext(src.slice(from,to)+'\nthis.read=leerPorHash;this.keys=hashesGuardados;',ctx);
 return {ctx,ls,dbMap};
}
test('H3 RED: with IndexedDB available hashesGuardados includes legacy orphan keys too',async()=>{
 const {ctx,ls,dbMap}=fixture();
 const all=[...(await ctx.keys())].sort();
 assert.deepEqual(all,['db-only','legacy-only','same-in-both'].sort());
 assert.equal(ls.size,4,'read-only scan cannot delete old evidence');
 assert.equal(dbMap.size,2,'read-only scan cannot alter IndexedDB');
});
test('H3 RED: IDB miss falls back to original localStorage hashed bytes',async()=>{
 const {ctx}=fixture();
 assert.equal(await ctx.read('legacy-only'),'data:image/png;base64,TEVHQUNZ');
 assert.equal(await ctx.read('db-only'),'data:image/png;base64,REItU0FWRUQ=');
 assert.equal(await ctx.read('same-in-both'),'data:image/png;base64,REItT1JJR0lO',
   'newer IDB bytes always take precedence on identical hash keys');
 assert.equal(await ctx.read('unavailable'),null);
});
test('H3: fallback retains hashes when IDB opening fails',async()=>{
 const {ctx}=fixture();
 ctx.abrirDB=async()=>{throw Error('synthetic blocked IDB')};
 assert.deepEqual([...(await ctx.keys())].sort(),['db-only','legacy-only','same-in-both'].sort());
 assert.equal(await ctx.read('legacy-only'),'data:image/png;base64,TEVHQUNZ');
});
test('H3 RED: raw legacy rescue must copy photo into IDB even when fallback can read it',async()=>{
 const hash='a'.repeat(64),bytes='data:image/png;base64,QUJD',dbMap=new Map();
 const from=src.indexOf('  async function rescatarLocalStoragePreAislamiento() {');
 const to=src.indexOf('  async function diagnosticoRecuperacion()',from);
 assert.ok(from>=0&&to>from,'exercise actual G10b rescue function');
 let writes=0;
 const ctx={console,SOPORTADO:true,
  window:{AMG:{Aislamiento:{leerFotosLocalStoragePreAislamiento:()=>({perchas:{},blobs:{[hash]:bytes}})}}},
  leerPorHash:async()=>bytes, // synthetic legacy fallback already sees the bytes
  leerHashSoloIdb:async h=>dbMap.get(h)||null,
  guardarPorHash:async(h,b)=>{writes++;dbMap.set(h,b);return true;},
  hashDeDataUrl:async()=>hash
 };
 vm.createContext(ctx);
 vm.runInContext(src.slice(from,to)+'\nthis.rescue=rescatarLocalStoragePreAislamiento;',ctx);
 const result=await ctx.rescue();
 assert.equal(result.blobs,1,'copy-only rescue counts one IDB copy');
 assert.equal(result.blobsPendientes,0);
 assert.equal(dbMap.get(hash),bytes,'bytes really persisted to IDB');
 assert.equal(writes,1);
});
test('H3 RED: a failed raw-legacy IDB copy stays pending and is retryable',async()=>{
 const hash='b'.repeat(64),bytes='data:image/png;base64,REVG',dbMap=new Map();
 const from=src.indexOf('  async function rescatarLocalStoragePreAislamiento() {');
 const to=src.indexOf('  async function diagnosticoRecuperacion()',from);
 let attempts=0;
 const ctx={console,SOPORTADO:true,
  window:{AMG:{Aislamiento:{leerFotosLocalStoragePreAislamiento:()=>({perchas:{},blobs:{[hash]:bytes}})}}},
  leerPorHash:async()=>bytes,
  leerHashSoloIdb:async h=>dbMap.get(h)||null,
  guardarPorHash:async(h,b)=>{attempts++;if(attempts===1)return false;dbMap.set(h,b);return true;},
  hashDeDataUrl:async()=>hash
 };
 vm.createContext(ctx);
 vm.runInContext(src.slice(from,to)+'\nthis.rescue=rescatarLocalStoragePreAislamiento;',ctx);
 const first=await ctx.rescue();
 assert.equal(first.blobsPendientes,1,'quota failures remain pending and are never silently ACKed');
 assert.equal(dbMap.has(hash),false);
 const second=await ctx.rescue();
 assert.equal(second.blobs,1,'subsequent attempt resumes copy');
 assert.equal(dbMap.get(hash),bytes);
});
