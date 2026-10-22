'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {browser}=require('./helpers/browser.cjs');

test('E1b-3: failed session claim notifies listeners AFTER pending clears',async()=>{
  const src=fs.readFileSync(path.resolve(__dirname,'../docs/tab-session.js'),'utf8');
  const begin=src.indexOf(' async function claim(){');
  const end=src.indexOf("\n try{channel=new BroadcastChannel(",begin);
  assert.ok(begin>=0&&end>begin,'extract actual claim() production code');
  const changes=[];
  const state={
    window:{OC_AUTH_SESSION_EPOCH:0},
    localStorage:{getItem:()=>null},
    TextEncoder,crypto:{subtle:{digest:async()=>{throw Error('Synthetic digest failure')}}},
    pending:false,claimed:false,suspendida:false,scopeKey:'',
    clearPanel(){},epoch(){this.OC_AUTH_SESSION_EPOCH=(this.OC_AUTH_SESSION_EPOCH||0)+1;},
    avisarSync(){changes.push(state.pending);}
  };
  // epoch reads the global window, as in the actual production closure.
  state.epoch=()=>{state.window.OC_AUTH_SESSION_EPOCH++;};
  vm.createContext(state);
  vm.runInContext(src.slice(begin,end)+'\nthis.claim=claim;',state);
  await state.claim();
  assert.equal(state.pending,false,'failed claim is not left pending');
  assert.deepEqual(changes,[true,false],
    'listeners must get the restored state, otherwise all Yjs channels remain paused');
});

test('E4: Yjs authoritative owner name converges on equal revision despite local future clock',()=>{
  const device=browser();
  const apply=(name,rev,ts,yjs=false)=>device.OCSync.aplicarCatalogo({
    nombreNegocio:name,nombreNegocioRev:rev,nombreNegocioTs:ts,
    ...(yjs?{_nombreDesdeYjs:true}:{})
  },'dueno');
  apply('My small shop USA',7,999999);
  assert.equal(device.catalog().nombreNegocio,'My small shop USA');
  apply('17 de Septiembre',7,1000,true);
  assert.equal(device.catalog().nombreNegocio,'17 de Septiembre',
    'shared Yjs owner name must win equal revision; no local timestamp authority');
  apply('My small shop USA',7,9999999);
  assert.equal(device.catalog().nombreNegocio,'17 de Septiembre',
    'legacy equal-revision timestamps cannot resurrect old names');
  apply('Explicit newer owner rename',8,1001);
  assert.equal(device.catalog().nombreNegocio,'Explicit newer owner rename');
  const sync=fs.readFileSync(path.resolve(__dirname,'../docs/sync-yjs.js'),'utf8');
  assert.match(sync,/_nombreDesdeYjs:\s*true/,
    'Yjs bridge must mark metadata as owner-authoritative');
});
