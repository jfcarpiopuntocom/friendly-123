'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../docs/auth-ui.js'),'utf8');
const start=source.indexOf('  // A central Owner PIN belongs to the business license');
const end=source.indexOf('  // PHASE 1: one reported local Owner credential',start);
assert.ok(start>=0&&end>start,'actual shipped central Owner functions are under test');
const code=source.slice(start,end);
const lic='F123-SYNTHETIC-SHOP';
function fixture({legacy=false,instanceId='new_browser_pwa_01',resolved=200,identity=lic,
  adoptedRevision=2,active=lic,ownLicense=lic,hasSeen=false,hangResolve=false,adoptionOk=true,verifyStatus=404}={}){
 const entries=new Map([['f123_owned',JSON.stringify({licenseCode:ownLicense,...(instanceId?{instanceId}:{})})]]);
 if(hasSeen)entries.set('f123_pin_central_seen:'+lic,JSON.stringify({revision:1}));
 const calls=[],adoptions=[];
 const ctx={
  location:{hostname:'friendly123.com'},OC_WORKER_URL:'https://friendly123-licencias.jfcarpio.workers.dev',
  URL,AbortController,setTimeout,clearTimeout,Date,
  localStorage:{getItem:k=>entries.get(k)||null,setItem:(k,v)=>entries.set(k,String(v))},
  window:{OCTienda:{licenciaActual:()=>active},
   OCSecure:{adoptarPinOwnerCentralVerificado:async(...args)=>{adoptions.push(args);return adoptionOk&&args[2]===ownLicense}}},
  fetch:async (url,opts)=>{
   const u=new URL(url);calls.push({pathname:u.pathname,method:opts.method,body:opts.body});
   let status,body;
   if(u.pathname==='/pin/resolve'&&hangResolve){
    return new Promise((resolve,reject)=>{
      opts.signal.addEventListener('abort',()=>reject(Error('synthetic network timeout')),{once:true});
    });
   }
   if(u.pathname==='/pin/verify'){
    status=opts.method==='GET'?(legacy?404:405):verifyStatus;
    body=status===200?{ok:true,revision:adoptedRevision}:(legacy?{error:'not found'}:{ok:false,reason:status===409?'unconfigured':'license-instance-mismatch'});
   }else if(u.pathname==='/pin/resolve'){
    status=resolved;body=status===200?
      {ok:true,role:'owner',businessId:identity,revision:adoptedRevision}:
      {ok:false,reason:status===409?'unconfigured':'invalid-pin'};
   }else throw Error('unexpected endpoint '+u.pathname);
   return {status,ok:status>=200&&status<300,json:async()=>body};
  }
 };
 vm.createContext(ctx);vm.runInContext(code,ctx);
 return {verify:ctx.window.F123CentralPin.verificar,rotate:ctx.window.F123CentralPin.rotar,
  calls,adoptions,entries};
}
test('P0 legacy Worker 404/404 keeps old local verification available before census',async()=>{
 const f=fixture({legacy:true});
 assert.equal(await f.verify('909'),'unconfigured');
 assert.deepEqual(f.calls.map(c=>c.method),['POST','GET']);
 assert.equal(f.calls[1].body,undefined,'GET capability check must never send PIN or license');
});
test('P0 Worker route 404 never downgrades a centrally adopted Owner PIN',async()=>{
 const f=fixture({legacy:true,hasSeen:true});
 assert.equal(await f.verify('909'),'unavailable');
});
test('P0 current Worker resolves valid Owner PIN to same business for an unregistered PWA',async()=>{
 const f=fixture();
 assert.equal(await f.verify('909'),'owner');
 assert.equal(f.adoptions.length,1);
 assert.equal(f.calls.map(c=>c.method).join(','),'POST,GET,POST');
 assert.equal(f.calls[2].pathname,'/pin/resolve');
 const submitted=JSON.parse(f.calls[2].body);
 assert.deepEqual(Object.keys(submitted).sort(),['licenseCode','pin']);
 assert.equal(submitted.licenseCode,lic);
 assert.equal(JSON.parse(f.entries.get('f123_pin_central_seen:'+lic)).revision,2);
});
test('P0 brand-new replica without an instance ID can validate a centrally active Owner PIN',async()=>{
 const f=fixture({instanceId:null,adoptionOk:false});
 assert.equal(await f.verify('909'),'needs-recovery');
 assert.deepEqual(f.calls.map(c=>c.method),['GET','POST']);
});
test('P0 joined PWA resolves active license but NEVER adopts the unrelated owned-device credentials',async()=>{
 const f=fixture({active:'F123-ANOTHER-SHOP',identity:'F123-ANOTHER-SHOP'});
 assert.equal(await f.verify('909'),'needs-recovery','must recover this shop before Owner access');
 assert.equal(f.adoptions.length,1);
 assert.equal(f.adoptions[0][2],'F123-ANOTHER-SHOP');
 assert.deepEqual(f.calls.map(c=>c.pathname),['/pin/verify','/pin/resolve']);
 assert.equal(JSON.parse(f.calls[1].body).licenseCode,'F123-ANOTHER-SHOP');
});
test('P0 incorrect central PIN and rate-limited PIN remain denied to new browser',async()=>{
 assert.equal(await fixture({resolved:401}).verify('909'),'wrong');
 assert.equal(await fixture({resolved:429}).verify('909'),'locked');
});
test('P0 pre-census modern Worker returns to local verifier without changing client PIN',async()=>{
 const f=fixture({resolved:409});
 assert.equal(await f.verify('909'),'unconfigured');
 assert.equal(f.adoptions.length,0);
 assert.equal(f.entries.has('f123_pin_central_seen:'+lic),false);
});
test('P0 identity mismatch in a nominal 200 response is rejected and does not change PIN',async()=>{
 const f=fixture({identity:'F123-WRONG-SHOP'});
 assert.equal(await f.verify('909'),'unavailable');
 assert.equal(f.adoptions.length,0);
});
test('P0 old Worker permits legacy local PIN editing, current authority cannot be bypassed',async()=>{
 const old=fixture({legacy:true});
 const r=await old.rotate('909','919');
 assert.equal(r.ok,true);assert.equal(r.unconfigured,true);
 assert.deepEqual(old.calls.map(c=>c.method),['POST','GET']);
 const modern=fixture();
 const denied=await modern.rotate('909','919');
 assert.equal(denied.ok,false);assert.equal(denied.reason,'current-pin-rejected');
 const adopted=fixture({legacy:true,hasSeen:true});
 assert.equal((await adopted.rotate('909','919')).ok,false);
});

test('P0 unresolved network obeys the 2400 ms gate timeout (no stuck PIN screen)',async()=>{
 const f=fixture({hangResolve:true});
 const begin=Date.now();
 const result=await Promise.race([
   f.verify('909'),
   new Promise((_,reject)=>setTimeout(()=>reject(Error('PIN deadline was accidentally cleared')),3400))
 ]);
 assert.equal(result,'unavailable');
 assert.ok(Date.now()-begin<3400,'network must settle before gate ceiling');
});

test('P0 valid central PIN cannot falsely open Owner when local durable adoption fails',async()=>{
 const f=fixture({adoptionOk:false});
 assert.equal(await f.verify('909'),'needs-recovery');
 assert.equal(f.adoptions.length,1);
 assert.equal(JSON.parse(f.entries.get('f123_pin_central_seen:'+lic)).revision,2,
  'retain central revision so stale PIN is not accepted after a Worker outage');
 assert.match(source,/central==="needs-recovery"/);
});

test('P0 registered browser: verified central identity cannot grant access without durable PIN adoption',async()=>{
 const f=fixture({verifyStatus:200,adoptionOk:false});
 assert.equal(await f.verify('909'),'needs-recovery');
 assert.equal(f.adoptions.length,1);
});
test('P0 registered browser: central 409 cannot revive a stale previously superseded verifier',async()=>{
 const f=fixture({verifyStatus:409,hasSeen:true});
 assert.equal(await f.verify('909'),'unavailable');
});
