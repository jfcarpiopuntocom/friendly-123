'use strict';
const {test}=require('node:test'), assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../src/dashboard/dashboard-main.js'),'utf8');
const a=source.indexOf('  function verificarAdminVigente(');
const b=source.indexOf('  /* El PIN en modo local',a);
assert.ok(a>0&&b>a,'extract real central Owner and live Admin authorization functions');
const fns=source.slice(a,b);
const LICENSE='F123-TEST-1234-1234-12345', INSTANCE='synthetic-device-123';
function env({status=200,payload={ok:true,revision:7},ownedLicense=LICENSE,activeLicense=LICENSE,instanceId=INSTANCE}={}){
 const sent=[],saved=new Map(),adopt=[];
 saved.set('f123_owned',JSON.stringify({licenseCode:ownedLicense,instanceId}));
 const sandbox={
  window:{OCSecure:{adoptarPinOwnerCentralVerificado:async(...a)=>adopt.push(a)}},
  localStorage:{getItem:(k)=>saved.get(k)||null,setItem:(k,v)=>saved.set(k,v)},
  normalizarCodigo:x=>String(x||''),codigoLocalActivo:()=>activeLicense,
  fetch:async(url,options)=>{sent.push({url,options});return{status,json:async()=>payload};},
  navigator:{onLine:true},AbortController,setTimeout,clearTimeout,Date,Number,JSON
 };
 vm.runInNewContext(fns,sandbox);
 return {sandbox,sent,saved,adopt};
}
test('central Owner 200 is the sole canonical Owner grant, no PIN authority mutation',async()=>{
 const e=env(),result=await e.sandbox.verificarOwnerCentralDashboard('111',LICENSE);
 assert.equal(result,'owner');
 assert.equal(e.sent.length,1);
 assert.equal(e.sent[0].url,'https://friendly123-licencias.jfcarpio.workers.dev/pin/verify');
 assert.equal(e.sent[0].options.method,'POST');
 assert.equal(e.sent[0].options.credentials,'omit');
 const req=JSON.parse(e.sent[0].options.body);
 assert.equal(req.pinTs,0,'login cannot report/rotate current Owner revision');
 assert.equal(req.instanceId,INSTANCE);
 assert.equal(req.pin,'111');
 assert.equal(e.adopt.length,1,'use the same verified Owner adoption used by the app');
 assert.equal(e.saved.has('f123_pin_central_seen:'+LICENSE),true);
});
for(const [status,payload,expected] of [
 [401,{ok:false,reason:'invalid-pin'},'wrong'],
 [429,{ok:false,reason:'rate-limited'},'locked'],
 [404,{ok:false,reason:'license-instance-mismatch'},'unavailable-identity'],
 [409,{ok:false,reason:'unconfigured'},'unconfigured'],
 [503,{ok:false,reason:'authority-unavailable'},'unavailable']
]){
 test('canonical Owner response '+status+' maps to '+expected+' without credential adoption',async()=>{
  const e=env({status,payload});
  assert.equal(await e.sandbox.verificarOwnerCentralDashboard('111',LICENSE),expected);
  assert.equal(e.adopt.length,0);
  assert.equal(e.saved.has('f123_pin_central_seen:'+LICENSE),false);
 });
}
test('cross-tenant or missing device identity never sends the PIN to a worker',async()=>{
 for(const x of [{ownedLicense:'F123-OTHER-1111-2222'},{activeLicense:'F123-OTHER-1111-2222'},{instanceId:''}]){
  const e=env(x);
  assert.equal(await e.sandbox.verificarOwnerCentralDashboard('111',LICENSE),'unavailable');
  assert.equal(e.sent.length,0);
 }
});
test('only current, active, non-deleted Admin of the notebook is an Admin',()=>{
 const e=env(),s=e.sandbox;
 assert.equal(s.verificarAdminVigente('222',{usuarios:[{rol:'admin',pin:'222',activo:true}]}),true);
 for(const u of [{rol:'admin',pin:'222',activo:false},{rol:'admin',pin:'222',borrado:true},{rol:'empleado',pin:'222',activo:true}]){
   assert.equal(s.verificarAdminVigente('222',{usuarios:[u]}),false);
 }
 assert.equal(s.verificarAdminVigente('222',{usuarios:[]}),false);
});
