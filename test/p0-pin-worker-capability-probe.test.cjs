'use strict';
// Exact shipping Owner verification + rotation logic, synthetic license/PIN only.
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../docs/auth-ui.js'),'utf8');
const start=source.indexOf('  // The older deployed license Worker');
const end=source.indexOf('  // PHASE 1: one reported local Owner',start);
assert.ok(start>0&&end>start,'production route helpers and rotation must be loaded exactly');
const code=source.slice(start,end);
const license='F123-SYNTHETIC-OPERA',instanceId='synthetic_browser_42';
function fixture(postStatus,postBody,getStatus=404){
 const local=new Map([['f123_owned',JSON.stringify({licenseCode:license,instanceId})]]);
 const calls=[],adopted=[];
 const ctx={location:{hostname:'friendly123.com'},OC_WORKER_URL:'https://friendly123-licencias.jfcarpio.workers.dev',
 URL,AbortController,setTimeout,clearTimeout,
 localStorage:{getItem:k=>local.get(k)||null,setItem:(k,v)=>local.set(k,String(v))},
 window:{OCTienda:{licenciaActual:()=>license},OCSecure:{adoptarPinOwnerCentralVerificado:async(...args)=>{adopted.push(args);return true}}},
 fetch:async(url,options)=>{
  calls.push({url,method:options.method,body:options.body});
  const get=options.method==='GET';
  return {status:get?getStatus:postStatus,ok:(get?getStatus:postStatus)>=200&&(get?getStatus:postStatus)<300,
   json:async()=>get?{}:postBody};
 }};
 vm.createContext(ctx);
 vm.runInContext(code,ctx);
 return {verify:ctx.window.F123CentralPin.verificar,rotate:ctx.window.F123CentralPin.rotar,local,calls,adopted};
}
test('legacy Worker 404/404 retains locally verified Owner during initial census regardless error text',async()=>{
 const f=fixture(404,{error:'upstream-unknown-error'});
 assert.equal(await f.verify('909'),'unconfigured');
 assert.deepEqual(f.calls.map(c=>c.method),['POST','GET']);
 assert.equal(f.calls[1].body,undefined,'capability probe NEVER sends PIN');
});
test('never downgrade after this browser adopted authenticated central PIN revision',async()=>{
 const f=fixture(404,{message:'not found'});
 f.local.set('f123_pin_central_seen:'+license,JSON.stringify({revision:2}));
 assert.equal(await f.verify('909'),'unavailable');
});
test('explicit Worker device/license mismatch always denies before probing',async()=>{
 const f=fixture(404,{ok:false,reason:'license-instance-mismatch'});
 assert.equal(await f.verify('909'),'unavailable-identity');
 assert.equal(f.calls.length,1);
});
test('current Worker 405 GET means POST 404 cannot bypass central authority',async()=>{
 const f=fixture(404,{foo:'different-format'},405);
 assert.equal(await f.verify('909'),'unavailable');
});
test('unexpected GET results fail closed instead of guessing legacy mode',async()=>{
 const f=fixture(404,{error:'upstream'},503);
 assert.equal(await f.verify('909'),'unavailable');
});
test('central invalid PIN and rate limiting remain authoritative',async()=>{
 assert.equal(await fixture(401,{reason:'invalid-pin'}).verify('909'),'wrong');
 assert.equal(await fixture(429,{reason:'rate-limited'}).verify('909'),'locked');
});
test('central success adopts its revision locally; no central status changes on login',async()=>{
 const f=fixture(200,{ok:true,revision:3});
 assert.equal(await f.verify('909'),'owner');
 assert.equal(f.adopted.length,1);
 assert.equal(JSON.parse(f.local.get('f123_pin_central_seen:'+license)).revision,3);
});
test('legacy Worker missing route retains local Owner rotation when not centrally enrolled',async()=>{
 const f=fixture(404,{error:'any body'});
 const r=await f.rotate('909','919');
 assert.equal(r.ok,true);assert.equal(r.unconfigured,true);
 assert.deepEqual(f.calls.map(c=>c.method),['POST','GET']);
 assert.equal(f.calls[1].body,undefined);
});
test('once centrally provisioned, missing route cannot roll back Owner rotation',async()=>{
 const f=fixture(404,{error:'any body'});
 f.local.set('f123_pin_central_seen:'+license,JSON.stringify({revision:3}));
 const r=await f.rotate('909','919');
 assert.equal(r.ok,false);assert.equal(r.reason,'central-authority-unavailable');
});
