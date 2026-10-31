'use strict';
// Local, synthetic regression for phase-1 Owner PIN census: no real license or PIN.
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../docs/auth-ui.js'),'utf8');
const begin=source.indexOf('  function registrarPinOwnerExistente(pin){');
const end=source.indexOf('\n  async function validar(code) {',begin);
assert.ok(begin>=0&&end>begin,'census function exists once');
assert.equal(source.indexOf('  function registrarPinOwnerExistente(pin){',begin+1),-1);
const fn=source.slice(begin,end);
const base=1800000000000;
function fixture(host='friendly123-licencias.jfcarpio.workers.dev'){
  let now=base,calls=[],outcomes=[{status:503},{status:200,ok:true}];
  const data=new Map([['f123_owned',JSON.stringify({licenseCode:'F123-SYNTHETICCASE',instanceId:'synthetic_device_123'})]]);
  const storage={getItem:k=>data.has(k)?data.get(k):null,setItem:(k,v)=>data.set(k,String(v))};
  const ctx={location:{hostname:'friendly123.com'},localStorage:storage,
    OC_WORKER_URL:'https://'+host+'/other-path',
    Date:{now:()=>now},AbortController,
    setTimeout:()=>123,clearTimeout:()=>{},
    fetch:(url,opt)=>{
      calls.push({url,opt});
      const outcome=outcomes.shift()||{status:200,ok:true};
      return Promise.resolve({ok:outcome.status===200,
        json:()=>Promise.resolve({ok:outcome.ok===true})});
    }};
  vm.runInNewContext(fn+'\nthis.runCensus=registrarPinOwnerExistente;',ctx,{filename:'auth-census.js'});
  return {run:ctx.runCensus,calls,data,storage,setClock:n=>{now=n},setOutcomes:o=>{outcomes=o}};
}
const flush=async()=>{for(let i=0;i<4;i++)await Promise.resolve()};
test('failed report is never marked successful; retry after six hours without rapid traffic',async()=>{
  const x=fixture(),mark='f123_pin_census:F123-SYNTHETICCASE:synthetic_device_123';
  x.run('123');await flush();
  assert.equal(x.calls.length,1);
  assert.equal(x.storage.getItem(mark+':ok'),null,'503 is not a confirmed census');
  x.setClock(base+3600000);x.run('123');await flush();
  assert.equal(x.calls.length,1,'do not flood Worker on every Owner login');
  x.setClock(base+21600001);x.run('123');await flush();
  assert.equal(x.calls.length,2,'retry eventually succeeds');
  assert.equal(Number(x.storage.getItem(mark+':ok')),base+21600001);
  x.setClock(base+21600001+82800000);x.run('123');await flush();
  assert.equal(x.calls.length,2,'successful report is stable for 24h');
  x.setClock(base+21600001+86400001);x.run('123');await flush();
  assert.equal(x.calls.length,3,'recensus after a full day');
  assert.ok(![...x.data.values()].some(v=>v==='123'),'never persist raw PIN');
  assert.equal(x.calls[0].url,'https://friendly123-licencias.jfcarpio.workers.dev/pin/report');
  assert.equal(x.calls[0].opt.credentials,'omit');
});
test('a HTTP 200 with ok:false does not certify report; invalid origin receives no PIN',async()=>{
  const x=fixture();
  x.setOutcomes([{status:200,ok:false},{status:200,ok:true}]);
  x.run('123');await flush();
  assert.equal([...x.data.keys()].filter(k=>k.endsWith(':ok')).length,0);
  x.setClock(base+21600001);x.run('123');await flush();
  assert.equal([...x.data.keys()].filter(k=>k.endsWith(':ok')).length,1);
  const other=fixture('example.invalid');
  other.run('123');await flush();
  assert.equal(other.calls.length,0);
  assert.ok(![...other.data.keys()].some(k=>k.startsWith('f123_pin_census:')));
});
