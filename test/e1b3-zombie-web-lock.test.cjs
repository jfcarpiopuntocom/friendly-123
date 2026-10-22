"use strict";
const {test}=require("node:test"),assert=require("node:assert/strict");
const fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const src=fs.readFileSync(path.join(__dirname,"../docs/mock-backend.js"),"utf8");
const tabs=fs.readFileSync(path.join(__dirname,"../docs/tab-session.js"),"utf8");
const a=src.indexOf("  let _colaEscriturasLocal = Promise.resolve();");
const b=src.indexOf("  const _fetchInterno = async function",a);
assert.ok(a>0&&b>a);
function fixture(locks) {
 let calls=0,id=0;const timers=new Map(),notices=[];
 const document={body:{appendChild(node){notices.push(node)}},getElementById(){return null},
  createElement:()=>({style:{},setAttribute(){},remove(){}})};
 const ctx={navigator:{locks},document,Response,URL,Promise,AbortController,
  setTimeout(fn,delay){let key=++id;timers.set(key,{fn,delay});return key;},
  clearTimeout(key){timers.delete(key);},_negadoPorRol:()=>null,_payoutPendiente:null,
  _rolLocal:()=> "dueno",_recargarSiOtraPestanaEscribio:()=>{},
  _fetchInterno:()=>{calls++;return Promise.resolve(new Response('{"ok":true}',{status:200}))},
  window:{location:{origin:"https://example.com"},OC_AUTH_SESSION_EPOCH:0,
   OCTabSession:{isCurrent:()=>true},OCI18n:{getLang:()=>"es"}}};
 const wrap=vm.runInNewContext("(function(){"+src.slice(a,b)+";return _fetchConCandado;})",ctx);
 return {fetch:wrap(),timers,notices,get calls(){return calls},ctx};
}
const post={method:"POST",body:"{}"};
test("E1b-3 S1 RED: never granted lock times out without executing a sale",async()=>{
 let captured;
 const f=fixture({request(_name,opts,fn){captured={opts,fn};return new Promise(()=>{});}});
 const call=f.fetch("/api/ventas",post);
 const timeout=[...f.timers.values()].find(t=>t.delay===10000);
 assert.ok(timeout,"10s acquisition timeout must be scheduled");
 timeout.fn();
 const outcome=await Promise.race([call,new Promise(resolve=>setImmediate(()=>resolve(Symbol("pending"))))]);
 assert.notEqual(typeof outcome,"symbol","pending lock must resolve to a clear error response");
 assert.equal(outcome.status,503);
 assert.equal(f.calls,0,"never execute an ungranted sale");
 assert.equal(captured.opts.signal.aborted,true,"abort queued Web Lock");
 assert.match(JSON.stringify(f.notices),/No se guardó|guard[oó]/);
});
test("E1b-3 S1 RED: late callback after abort is fenced, never records sale",async()=>{
 let delayed;
 const f=fixture({request(_name,opts,fn){
   delayed={opts,fn};return new Promise((resolve,reject)=>{
     opts.signal?.addEventListener("abort",()=>reject(Object.assign(new Error("aborted"),{name:"AbortError"})));
   });
 }});
 const call=f.fetch("/api/ventas",post);
 const timeout=[...f.timers.values()].find(t=>t.delay===10000);
 assert.ok(timeout);timeout.fn();
 const response=await call;assert.equal(response.status,503);
 if(delayed.fn)await delayed.fn();
 assert.equal(f.calls,0,"late grant must not record the timed-out sale");
});
test("E1b-3 S1 RED: normal grant and single-tab login need no zombie waiting",async()=>{
 const f=fixture({request(_name,opts,fn){assert.ok(opts.signal);return fn()}});
 const res=await f.fetch("/api/ventas",post);
 assert.equal(res.status,200);assert.equal(f.calls,1);
 assert.doesNotMatch(tabs,/navigator\.locks\.request\('f123-escrituras',take\)/,
  "tab lease must never queue behind a zombie sales write");
});
