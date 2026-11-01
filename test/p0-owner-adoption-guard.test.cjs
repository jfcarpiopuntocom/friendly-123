'use strict';
// Synthetic isolated tests of the EXACT central-PIN verifier extracted from
// docs/auth-ui.js. No customer identity, network, Cloudflare or PIN is used.
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../docs/auth-ui.js'),'utf8');
const start=source.indexOf('  async function verificarPinOwnerCentral(code) {');
const end=source.indexOf('  // A deliberate Owner rotation',start);
assert.ok(start>0&&end>start,'Owner verifier must remain accessible for real-function tests');
const actual=source.slice(start,end),LICENSE='F123-SYNTHETIC-OWNER-01';
function harness({status=200,adopt=true,seen=null,changeIdentity=false}={}){
 const db=new Map([['f123_owned',JSON.stringify({licenseCode:LICENSE,instanceId:'synthetic-device-12345'})]]);
 if(seen)db.set('f123_pin_central_seen:'+LICENSE,JSON.stringify(seen));
 const localStorage={getItem:k=>db.get(k)||null,setItem:(k,v)=>db.set(k,String(v))};
 let calls=0;
 const window={OCTienda:{licenciaActual:()=>LICENSE},OCSecure:{
   adoptarPinOwnerCentralVerificado:async()=>{
     calls++;
     if(changeIdentity)db.set('f123_owned',JSON.stringify({licenseCode:'F123-SYNTHETIC-OTHER',instanceId:'synthetic-device-12345'}));
     return adopt;
   }
 }};
 const env={localStorage,window,OC_WORKER_URL:'https://friendly123-licencias.jfcarpio.workers.dev',
   location:{hostname:'jfcarpiopuntocom.github.io'},URL,AbortController,
   setTimeout:()=>0,clearTimeout(){},
   fetch:async()=>({status,json:async()=>({ok:status===200,revision:4})}),Date,JSON,Number,String};
 const verify=vm.runInNewContext('(function(){'+actual+'\nreturn verificarPinOwnerCentral;})()',env);
 return {verify,db,getCalls:()=>calls};
}
test('Owner central 200 cannot unlock if local credential adoption is denied',async()=>{
 const h=harness({adopt:false});
 assert.equal(await h.verify('123'),'needs-recovery');
 assert.equal(h.getCalls(),1);
 assert.equal(h.db.has('f123_pin_central_seen:'+LICENSE),false);
});
test('Owner central 200 opens only after durable local verifier is adopted',async()=>{
 const h=harness();
 assert.equal(await h.verify('123'),'owner');
 assert.equal(JSON.parse(h.db.get('f123_pin_central_seen:'+LICENSE)).revision,4);
});
test('previously observed central revision cannot roll back on 409 unconfigured authority',async()=>{
 const h=harness({status:409,seen:{revision:3,at:0}});
 assert.equal(await h.verify('123'),'unavailable');
 assert.equal(h.getCalls(),0);
});
test('first unconfigured legacy client stays legacy until a real JFC census',async()=>{
 const h=harness({status:409});
 assert.equal(await h.verify('123'),'unconfigured');
});
test('license switch while verifier adopts cannot unlock the previous shop',async()=>{
 const h=harness({changeIdentity:true});
 assert.equal(await h.verify('123'),'unavailable-identity');
 assert.equal(h.db.has('f123_pin_central_seen:'+LICENSE),false);
});
