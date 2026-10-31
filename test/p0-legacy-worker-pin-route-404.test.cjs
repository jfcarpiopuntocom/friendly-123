'use strict';
// Exact production Owner PIN verification function, exercised without customer secrets or live auth attempts.
const {test}=require('node:test'), assert=require('node:assert/strict');
const fs=require('node:fs'), vm=require('node:vm'), path=require('node:path');
const src=fs.readFileSync(path.join(__dirname,'../docs/auth-ui.js'),'utf8');
const from=src.indexOf('  async function verificarPinOwnerCentral(code) {');
const to=src.indexOf('  // A deliberate Owner rotation',from);
assert.ok(from>=0&&to>from,'production central verify function must remain discoverable');
const extracted=src.slice(from,to);
const license='F123-SYNTHETIC-OPERA', device='synthetic_opera_123';
function fixture({status,body}){
 const state=new Map([['f123_owned',JSON.stringify({licenseCode:license,instanceId:device})]]);
 const calls=[];
 const ctx={
  location:{hostname:'friendly123.com'}, OC_WORKER_URL:'https://friendly123-licencias.jfcarpio.workers.dev',
  URL, AbortController, setTimeout, clearTimeout,
  localStorage:{getItem:k=>state.get(k)||null,setItem:(k,v)=>state.set(k,String(v))},
  window:{OCTienda:{licenciaActual:()=>license},OCSecure:{adoptarPinOwnerCentralVerificado:async()=>true}},
  fetch:async(url,options)=>{calls.push({url,options});return {status,json:async()=>body}}
 };
 vm.runInNewContext(extracted+'\nthis.verify=verificarPinOwnerCentral;',ctx);
 return {verify:ctx.verify,calls,state};
}
test('P0: the currently deployed legacy Worker generic 404 must not revoke a locally verified existing Owner',async()=>{
 const f=fixture({status:404,body:{error:'Not found'}});
 assert.equal(await f.verify('672'),'unconfigured');
 assert.equal(f.calls.length,1);
 assert.match(f.calls[0].url,/\/pin\/verify$/);
});
test('P0: newer Worker 404 license-instance-mismatch still blocks unauthorized device',async()=>{
 const f=fixture({status:404,body:{ok:false,reason:'license-instance-mismatch'}});
 assert.equal(await f.verify('672'),'unavailable-identity');
});
test('P0: a central invalid PIN response remains authoritative and never falls back',async()=>{
 const f=fixture({status:401,body:{ok:false,reason:'invalid-pin'}});
 assert.equal(await f.verify('672'),'wrong');
});
test('P0: deliberately unconfigured central authority retains legacy credentials',async()=>{
 const f=fixture({status:409,body:{ok:false,reason:'unconfigured'}});
 assert.equal(await f.verify('672'),'unconfigured');
});
test('P0: other/unknown 404 responses must not silently grant legacy login',async()=>{
 const f=fixture({status:404,body:{ok:false}});
 assert.equal(await f.verify('672'),'unavailable');
});
