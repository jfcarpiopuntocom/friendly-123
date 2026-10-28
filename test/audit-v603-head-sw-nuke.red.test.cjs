'use strict';
// Test only: the legacy one-time SW cleanup executes in the HTML HEAD before
// Yjs/IDB startup. The release must not eject an already-authenticated shop.
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'../docs/index.html'),'utf8');
const a=html.indexOf('// SW nuke: flag va PRIMERO');
const b=html.indexOf('</script>',a);
assert(a>=0&&b>a,'actual SW cleanup block must exist');
const block=html.slice(a,b);
async function boot({flag=false,activeSession=true}){
 const stored=new Map(flag?[['f123_sw_nuke_v1','1']]:[]);
 const location={href:'https://example.test/friendly-123/index.html',reloads:0,
   reload(){this.reloads++;}};
 const scope=new URL('./',location.href).href;
 const swurl=new URL('./sw.js',location.href).href;
 let unregs=0,deletes=0;
 const registration={scope,active:{scriptURL:swurl},unregister(){unregs++;return Promise.resolve(true);}};
 const c={
  navigator:{serviceWorker:{getRegistrations:()=>Promise.resolve([registration])}},
  location,URL,Promise,
  localStorage:{getItem:k=>stored.get(k)||null,setItem:(k,v)=>stored.set(k,v)},
  sessionStorage:{getItem:k=>activeSession&&k==='f123_sesion'?'signed-in':null},
  caches:{keys:()=>Promise.resolve(['f123-shell-v603-golden149']),delete:()=>{deletes++;return Promise.resolve(true)}},
  setTimeout:(fn)=>{fn();return 1;}
 };
 vm.runInNewContext(block,c);
 await new Promise(resolve=>setImmediate(resolve));
 return {unregs,deletes,reloads:location.reloads,flag:stored.get('f123_sw_nuke_v1')};
}
test('P0: loading an active local notebook must never nuke its SW and reload before hydration',async()=>{
 const actual=await boot({activeSession:true});
 assert.equal(actual.unregs,0,'active session: never unregister live SW automatically');
 assert.equal(actual.deletes,0,'active session: never purge shell CacheStorage');
 assert.equal(actual.reloads,0,'active session: no surprise page reload before Yjs opens');
});
test('legacy nuke remains one-shot when it was already performed',async()=>{
 const actual=await boot({flag:true,activeSession:true});
 assert.equal(actual.unregs,0);
 assert.equal(actual.reloads,0);
});
