'use strict';
// v771: the checkpoint is also renewed when the tail since the last cut passes 384 KiB (not only after 1024 frames).
// Runs the REAL contarColaCkpt block from docs/sync-yjs.js with stubs. Synthetic data only, no network.
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const src=fs.readFileSync(path.join(__dirname,'../docs/sync-yjs.js'),'utf8');
const i=src.indexOf('    var CKPT_RENUEVA_FRAMES'),j=src.indexOf('    var _tCkpt = null;',i);
assert.ok(i>=0&&j>i,'contarColaCkpt block');
const bloque=src.slice(i,j);
function armar(over){
  const ctx=vm.createContext(Object.assign({Date,Number,Promise,pedidos:0,
    permiteCkpt:true,persistencia:null,suffix:'',nombre:'catalogo',log(){},_soloMemoria:false,API:{clave:{}},
    _appliedPullCursor:{rev:3,seq:1},deudaPendiente:()=>false},over||{}));
  ctx.canal={recuperando:false,ws:{readyState:1,peerOnly:false}};
  ctx._currentPullState={enCurso:false};
  ctx.pedirPagina=(s,e)=>{ctx.pedidos++;assert.equal(e.renovarCkpt,true);};
  vm.runInContext(bloque+'\nthis.contar=contarColaCkpt;',ctx);
  return ctx;
}
test('a large tail (few frames) renews once it passes 384 KiB',()=>{
  const c=armar();
  for(let k=0;k<5;k++) c.contar(64*1024); // 320 KiB in 5 frames: not yet
  assert.equal(c.pedidos,0);
  c.contar(80*1024); // 400 KiB
  assert.equal(c.pedidos,1);
});
test('the 6 h spacing still holds after a size renewal',()=>{
  const c=armar();
  c.contar(400*1024); assert.equal(c.pedidos,1);
  c.contar(400*1024); assert.equal(c.pedidos,1);
});
test('small frames still renew at 1024 frames, not before',()=>{
  const c=armar();
  for(let k=0;k<1023;k++) c.contar(100);
  assert.equal(c.pedidos,0);
  c.contar(100); assert.equal(c.pedidos,1);
});
test('an incomplete device never renews, whatever the tail size',()=>{
  const c=armar({deudaPendiente:()=>true});
  c.contar(2*1024*1024); assert.equal(c.pedidos,0);
});
