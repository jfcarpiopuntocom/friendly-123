'use strict';
// RED oracle for #434 reader compatibility, synthetic snapshots only.
// This checks a shipped source function, NOT a client's storage or the private v585 candidate.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const source=fs.readFileSync(path.resolve(__dirname,'../docs/dashboard.html'),'utf8');
const begin=source.indexOf('  function leerEstadoLocal() {');
const end=source.indexOf('  /* Read the complete IndexedDB mirror',begin);
assert.ok(begin>=0&&end>begin,'extract exact Dashboard notebook reader');
const reader=source.slice(begin,end);
const base='f123_estado_v4';
const valid=(id)=>JSON.stringify({_rev:4,productos:[{id:'synthetic-'+id}]});

function run({suf='',a,b,ptr='A'}){
  const state=new Map([
    ['f123_owned','{"instanceId":"synthetic-owner"}'],
    ['f123_tienda_activa',suf],
    [base+suf+'_ptr',ptr],
    ...(a===undefined?[]:[[base+suf+'_A',a]]),
    ...(b===undefined?[]:[[base+suf+'_B',b]])
  ]);
  const context={
    K_ESTADO:base,window:{},
    localStorage:{getItem:key=>state.has(key)?state.get(key):null},
    sufijoTienda:()=>suf,
  };
  vm.createContext(context);
  vm.runInContext(reader+';this.leerEstadoLocal=leerEstadoLocal;',context);
  return context.leerEstadoLocal();
}

test('control: active valid snapshot remains authoritative',()=>{
  const x=run({a:valid('A'),b:valid('B')});
  assert.equal(x&&x.productos[0].id,'synthetic-A');
});
test('1AAA RED: corrupt active JSON must fall back to previously valid B',()=>{
  const x=run({a:'{synthetic-corrupt',b:valid('B')});
  assert.equal(x&&x.productos[0].id,'synthetic-B');
});
test('1AAA RED: same fallback must respect joined notebook suffix',()=>{
  const x=run({suf:'::synthetic-joined',a:'{synthetic-corrupt',b:valid('B')});
  assert.equal(x&&x.productos[0].id,'synthetic-B');
});
// Review in private v585 alongside estado-ab.js before treating these as GREEN:
// no candidate newer than its durable commit may be selected by this fallback.
