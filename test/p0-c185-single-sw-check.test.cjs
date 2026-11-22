'use strict';
// C185 RED on v875: the old version probe must not enumerate every SW
// registration and explicitly update them during a cold Safari startup.
// C181's single updater remains responsible for mismatch detection/adoption.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const root=path.join(__dirname,'..');
const src=fs.readFileSync(path.join(root,'src/app/app-inline-03.js'),'utf8');
const begin=src.indexOf('(async function () {');
const end=src.indexOf('/* COMPATIBILIDAD DE VERSIÓN',begin);
assert.ok(begin>=0 && end>begin,'real legacy version probe must exist');
test('C185 RED: legacy version probe does not independently trigger extra SW update',async()=>{
  let enumerations=0,explicitUpdates=0,broadcasts=0;
  const store=new Map([['f123_version_vista','v0.8.75|f123-shell-v875']]);
  const session=new Map();
  const ctx={
    navigator:{serviceWorker:{controller:{},
      getRegistrations:async()=>{enumerations++;return [{update:async()=>{explicitUpdates++;}}]}}},
    localStorage:{getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,String(v))},
    sessionStorage:{getItem:k=>session.get(k)??null,setItem:(k,v)=>session.set(k,String(v))},
    fetch:async()=>({ok:true,json:async()=>({version:'v0.8.76',shell:'f123-shell-v876'})}),
    BroadcastChannel:class{postMessage(){broadcasts++;}close(){}},
    setTimeout:()=>0,
    Date:{now:()=>123456},
    window:{__f123PrimerShellCargado:null}
  };
  const code=src.slice(begin,end).replace('(async function () {','globalThis.__legacyProbe = (async function () {');
  vm.runInNewContext(code,ctx);
  await ctx.__legacyProbe;
  assert.equal(store.get('f123_version_vista'),'v0.8.76|f123-shell-v876','release fingerprint still changes');
  assert.equal(broadcasts,1,'cross-tab release notification preserved');
  assert.equal(enumerations,0,'version probe does not enumerate registrations during startup');
  assert.equal(explicitUpdates,0,'version probe does not launch an overlapping install');
  assert.equal(session.get('f123_reload_al_entrar'),'1','existing deferred-notification contract preserved');
});
test('C185: C181 updater remains wired to one scoped registration update',()=>{
  const updater=src.slice(src.indexOf('(function actualizacionSola()'),src.indexOf('// Microcirugia 5'));
  assert.match(updater,/navigator\.serviceWorker\.getRegistration\(\)/);
  assert.match(updater,/await reg\.update\(\)/);
  assert.match(updater,/function enPantallaPIN\(\)/);
  assert.match(updater,/function seguro\(\) \{ return enPantallaPIN\(\) && seguroCon\(false\); \}/);
  assert.match(src,/navigator\.serviceWorker\.register\("\.\/sw\.js", \{ updateViaCache: "none" \}\)/);
});
