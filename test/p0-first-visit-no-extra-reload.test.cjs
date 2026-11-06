'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('src/app/app-inline-03.js','utf8');
const start=source.indexOf('(async function () {',source.indexOf('// CONTROL DE VERSION FORZADO'));
const end=source.indexOf('})();',start);
assert.ok(start>0&&end>start,'existing first-load version check found');
const code=source.slice(start,end+5);
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function run(previous,serverVersion={version:'shell v675',shell:'f123-shell-v675'},controller=null,claimOnFetch=false){
  const local=new Map(),session=new Map(),events=[];
  if(previous!==null)local.set('f123_version_vista',previous);
  const storage=m=>({
    getItem:k=>m.has(k)?m.get(k):null,
    setItem:(k,v)=>m.set(k,String(v)),
    removeItem:k=>m.delete(k)
  });
  class BroadcastChannel{
    constructor(name){events.push('channel:'+name)}
    postMessage(m){events.push('broadcast:'+m.tipo)}
    close(){}
  }
  const sw={controller,getRegistrations:async()=>[{update:async()=>{events.push('sw-update')}}]};
  const ctx={
    window:{},
    fetch:async()=>{if(claimOnFetch)sw.controller={id:'newly-installed-sw'};return {ok:true,json:async()=>serverVersion};},
    localStorage:storage(local),sessionStorage:storage(session),
    navigator:{serviceWorker:sw},
    BroadcastChannel,setTimeout:()=>0,Date,JSON
  };
  vm.runInNewContext(code,ctx);
  for(let i=0;i<5;i++)await tick();
  return {local,session,events};
}
test('fresh origin registers public shell but does NOT arm deferred login reload',async()=>{
  const r=await run(null);
  assert.equal(r.local.get('f123_version_vista'),'shell v675|f123-shell-v675');
  assert.equal(r.session.get('f123_reload_al_entrar'),undefined);
  assert.deepEqual(r.events,[],'first visit must not broadcast update or force unnecessary SW update');
});
test('same shell returns without another reload',async()=>{
  const r=await run('shell v675|f123-shell-v675');
  assert.equal(r.session.get('f123_reload_al_entrar'),undefined);
  assert.deepEqual(r.events,[]);
});
test('real upgrade preserves safe deferred reload and shell update',async()=>{
  const r=await run('shell v670|f123-shell-v670');
  assert.equal(r.session.get('f123_reload_al_entrar'),'1');
  assert.equal(r.local.get('f123_version_vista'),'shell v675|f123-shell-v675');
  assert.ok(r.events.includes('sw-update'));
  assert.ok(r.events.includes('broadcast:recargar'));
});

test('missing marker but EXISTING SW controller still requests safe update',async()=>{
  const r=await run(null,undefined,{id:'previous-shell'});
  assert.equal(r.session.get('f123_reload_al_entrar'),'1');
  assert.ok(r.events.includes('sw-update'));
});

test('fresh SW may claim control DURING version fetch without triggering an unnecessary reload',async()=>{
  const r=await run(null,undefined,null,true);
  assert.equal(r.session.get('f123_reload_al_entrar'),undefined);
  assert.deepEqual(r.events,[]);
});
