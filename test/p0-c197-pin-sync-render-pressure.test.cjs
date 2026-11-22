'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');

const source=fs.readFileSync(path.join(__dirname,'../src/app/app-inline-01.js'),'utf8');
const start=source.indexOf('window.OCSyncRender = (function () {');
const end=source.indexOf('\n})();',start);
assert.ok(start>=0 && end>start,'real app view-render coordinator must exist');
const realCoordinator=source.slice(start,end+'\n})();'.length);

function fixture(gateDisplay='flex') {
  const bus=new Map(), docBus=new Map();
  const gate={style:{display:gateDisplay}};
  const view={classList:{contains:kind=>kind==='activa'}};
  let dashboardReads=0;
  const window={
    addEventListener:(event,callback)=>{const a=bus.get(event)||[];a.push(callback);bus.set(event,a);},
    cargarHoy:async()=>{dashboardReads++;return true;},
    OCI18n:{getLang:()=> 'en'}
  };
  const document={
    visibilityState:'visible',activeElement:null,
    addEventListener:(event,callback)=>{const a=docBus.get(event)||[];a.push(callback);docBus.set(event,a);},
    removeEventListener:()=>{},
    getElementById:id=>id==='oc-gate'?gate:id==='vista-hoy'?view:null,
    querySelectorAll:q=>q==='[id^="vista-"].activa'?[view]:[]
  };
  vm.runInNewContext(realCoordinator,{window,document,queueMicrotask,setTimeout,clearTimeout,Promise,Array});
  const emit=(event,detail)=>{for(const fn of bus.get(event)||[])fn({detail:detail||{actualizados:1}});};
  return {window,gate,emit,reads:()=>dashboardReads};
}
const tick=()=>new Promise(resolve=>setTimeout(resolve,15));

test('C197 cold-join: 500 Sync3 merges on visible PIN never render the hidden Today dashboard',async()=>{
  const f=fixture('flex');
  for(let i=0;i<500;i++)f.emit('oc-sync-merge');
  await tick();
  assert.equal(f.reads(),0,'all store updates must remain visual-only deferred');
  f.gate.style.display='none';
  f.emit('oc-login');
  await tick();
  assert.equal(f.reads(),1,'login resumes one coalesced render with latest data');
});

test('C197 unlocked users still render promptly on real remote update',async()=>{
  const f=fixture('none');
  f.emit('oc-sync-merge',{ventas:1});
  await tick();
  assert.equal(f.reads(),1);
});

test('C197 logout relocks visual work and next login resumes without losing the refresh',async()=>{
  const f=fixture('none');
  f.gate.style.display='flex';
  for(let i=0;i<50;i++)f.emit('oc-sync-merge');
  await tick();
  assert.equal(f.reads(),0);
  f.gate.style.display='none';
  f.emit('oc-login');
  await tick();
  assert.equal(f.reads(),1);
});
