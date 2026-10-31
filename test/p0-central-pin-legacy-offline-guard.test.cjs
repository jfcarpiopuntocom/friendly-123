'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const src=fs.readFileSync(path.join(__dirname,'../docs/auth-ui.js'),'utf8');
const start=src.indexOf('  async function rotarPinOwnerCentral(oldPin,newPin){');
const end=src.indexOf('\n  window.F123CentralPin=',start);
assert.ok(start>=0&&end>start,'single central rotation method');
const functionSource=src.slice(start,end);
const lic='F123-SYNTHETIC-ALPHA',instanceId='synthetic_device_123';
function fixture({reply=503,seen=false,offline=false}={}){
 const data=new Map([['f123_owned',JSON.stringify({licenseCode:lic,instanceId})]]);
 if(seen)data.set('f123_pin_central_seen:'+lic,JSON.stringify({revision:2,at:1}));
 const calls=[];
 const ctx={location:{hostname:'friendly123.com'},OC_WORKER_URL:'https://friendly123-licencias.jfcarpio.workers.dev',URL,
  localStorage:{getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,String(v))},
  fetch:async(url,options)=>{calls.push({url,options});if(offline)throw Error('synthetic network down');return {status:reply,ok:reply===200,json:async()=>({ok:false})}}};
 vm.runInNewContext(functionSource+'\nthis.rotate=rotarPinOwnerCentral;',ctx);
 return {rotate:ctx.rotate,calls,data};
}
test('new Worker deployment cannot block existing owner PIN edits while unconfigured',async()=>{
 const f=fixture({reply:503});
 const r=await f.rotate('123','384');
 assert.equal(r.ok,true);assert.equal(r.unconfigured,true);
 assert.equal(f.calls.length,1);
});
test('temporary Worker outage cannot lock out never-enrolled legacy PIN rotation',async()=>{
 const f=fixture({offline:true});
 const r=await f.rotate('123','384');
 assert.equal(r.ok,true);assert.equal(r.unconfigured,true);
});
test('once a central revision is adopted an outage must NOT silently downgrade authority',async()=>{
 for(const scenario of [{reply:503,seen:true},{offline:true,seen:true}]){
  const f=fixture(scenario),r=await f.rotate('123','384');
  assert.equal(r.ok,false);assert.equal(r.reason,'central-authority-unavailable');
 }
});
test('the configured server rejecting a current PIN cannot be treated as unconfigured',async()=>{
 const f=fixture({reply:401});
 const r=await f.rotate('123','384');
 assert.equal(r.ok,false);assert.equal(r.reason,'current-pin-rejected');
});
