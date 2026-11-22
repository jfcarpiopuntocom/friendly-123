'use strict';
// C180 source-executed RED → GREEN: an installed Safari PWA on f123-shell-v861
// must actually reload after the NEW SW takes control (not merely show pending).
// No user data, credentials, stores, or caches are altered by this test.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../src/app/app-inline-03.js'),'utf8');
const begin=source.indexOf('const _ocActSolaOn = true;');
const end=source.indexOf('// Microcirugia 5',begin);
assert.ok(begin>0&&end>begin,'real deployed auto-update module located');
const actual=source.slice(begin,end);

function fixture({active='f123-shell-v873',target='f123-shell-v873',logged=true,gate=false,pinDigits=0,busy=false}={}){
 const session=new Map(),local=new Map(),listeners=new Map(),nav=[],calls=[];
 if(logged)session.set('f123_sesion',JSON.stringify({rol:'dueno'}));
 session.set('f123_act_sola_pendiente','1');
 const storage=map=>({getItem:k=>map.has(k)?map.get(k):null,setItem:(k,v)=>map.set(k,String(v)),removeItem:k=>map.delete(k)});
 const sw={
   controller:{postMessage(payload){if(payload.tipo==='que-shell')queueMicrotask(()=>emit('message',{data:{tipo:'shell-actual',shell:active}}));}},
   addEventListener(type,cb){if(!listeners.has(type))listeners.set(type,new Set());listeners.get(type).add(cb);},
   removeEventListener(type,cb){listeners.get(type)?.delete(cb);},
   getRegistration:async()=>({update:async()=>{calls.push('update')},waiting:null})
 };
 function emit(type,event){for(const fn of [...(listeners.get(type)||[])])fn(event);}
 const gateEl={style:{display:gate?'block':'none'}};
 const padEl={_ocTeclado:{entrada:()=>Array(pinDigits).fill(1)}};
 const elements={'oc-gate':gateEl,'oc-pad':padEl};
 const document={
   visibilityState:'visible',activeElement:null,
   getElementById:id=>elements[id]||null,
   querySelectorAll:()=>[],
   addEventListener:()=>{}
 };
 const location={href:'https://example.com/friendly-123/?biz=1#home',replace:url=>{nav.push(String(url));}};
 let clock=100000;
 const win={OCYjs:null,addEventListener(type,fn){if(!listeners.has('window:'+type))listeners.set('window:'+type,new Set());listeners.get('window:'+type).add(fn);},__f123MarcarRecarga:null};
 if(busy)win.__f123AltaClientePendiente=true;
 const context={window:win,document,navigator:{serviceWorker:sw},sessionStorage:storage(session),
  localStorage:storage(local),location,URL,Date:{now:()=>clock},console:{warn(){}},
  fetch:async()=>({ok:true,json:async()=>({shell:target,version:'v0.8.73'})}),
  setInterval:()=>1,setTimeout:()=>1,clearTimeout:()=>{},getComputedStyle:()=>({display:'block'})};
 vm.runInNewContext(actual,context,{filename:'src/app/app-inline-03.js'});
 clock=210000; // 110 seconds idle after opening
 return {ctx:context,win,session,nav,calls,padEl,gateEl,sw,
   setActive(x){active=x},setTime(x){clock=x},
   login(){for(const fn of [...(listeners.get('window:oc-login')||[])])fn({type:'oc-login'});}
 };
}
test('C180 RED: a newer controlling SW must cause exactly one safe navigation, not a no-op',async()=>{
 const f=fixture();
 await f.win._ocActSola.intentar();
 assert.equal(f.nav.length,1,'real update proceeds after verified SW takeover');
 assert.match(f.nav[0],/_f123_v=/,'navigation cache-bust avoids stale HTML cache');
 assert.equal(f.session.has('f123_act_sola_pendiente'),false);
 await f.win._ocActSola.intentar();
 assert.equal(f.nav.length,1,'no repeated reload for one shell');
});
test('C180: NEVER reload while previous f123-shell-v861 still controls page',async()=>{
 const f=fixture({active:'f123-shell-v861'});
 await f.win._ocActSola.intentar();
 assert.equal(f.nav.length,0);
 assert.equal(f.session.get('f123_act_sola_pendiente'),'1','pending survives failed takeover');
 f.setActive('f123-shell-v873');
 await f.win._ocActSola.intentar();
 assert.equal(f.nav.length,1);
});
test('C180: a partially typed PIN is never interrupted, idle untouched gate can update',async()=>{
 const f=fixture({logged:false,gate:true,pinDigits:2});
 await f.win._ocActSola.intentar();
 assert.equal(f.nav.length,0,'unfinished PIN protected');
 f.padEl._ocTeclado.entrada=()=>[];
 await f.win._ocActSola.intentar();
 assert.equal(f.nav.length,1,'empty idle login gate is safe for an update');
});
test('C180: active sale/client form blocks navigation and preserves pending update',async()=>{
 const f=fixture({busy:true});
 await f.win._ocActSola.intentar();
 assert.equal(f.nav.length,0);
 assert.equal(f.session.get('f123_act_sola_pendiente'),'1');
});
test('C180: post-login event retries deferred update after PIN gate closes',async()=>{
 const f=fixture({gate:true,logged:true});
 f.setTime(100001); // still typing, not safe
 await f.win._ocActSola.intentar();
 assert.equal(f.nav.length,0);
 f.gateEl.style.display='none';
 f.login();
 for(let i=0;i<12;i++)await Promise.resolve();
 assert.equal(f.nav.length,1);
});
