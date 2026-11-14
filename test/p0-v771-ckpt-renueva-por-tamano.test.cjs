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
// v776: the size trigger is REVERTED (Safari on iPhone killed the tab after sales). A large tail with few frames no longer renews.
test('v776: a large tail with few frames does NOT renew (size trigger off)',()=>{
  const c=armar();
  for(let k=0;k<10;k++) c.contar(400*1024);
  assert.equal(c.pedidos,0);
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

// v779 («Resumen al día», JFC 13 nov 2026): size trigger back ONLY on a computer; never within 30 s of a sale.
const PC = { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36', maxTouchPoints: 0 };
const IPHONE = { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 Version/18.1 Mobile/15E148 Safari/604.1', maxTouchPoints: 5 };
const IPAD = { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.1 Safari/605.1.15', maxTouchPoints: 5 };
test('v779: a computer renews once the tail passes 384 KiB (few frames)', () => {
  const c = armar({ navigator: PC, window: {} });
  for (let k = 0; k < 5; k++) c.contar(64 * 1024); // 320 KiB: not yet
  assert.equal(c.pedidos, 0);
  c.contar(80 * 1024); // 400 KiB
  assert.equal(c.pedidos, 1);
});
test('v779: the 6 h spacing still holds after a size renewal on a computer', () => {
  const c = armar({ navigator: PC, window: {} });
  c.contar(400 * 1024); assert.equal(c.pedidos, 1);
  c.contar(400 * 1024); assert.equal(c.pedidos, 1);
});
test('v779: iPhone and iPad never take the size trigger', () => {
  for (const nav of [IPHONE, IPAD]) {
    const c = armar({ navigator: nav, window: {} });
    for (let k = 0; k < 10; k++) c.contar(400 * 1024);
    assert.equal(c.pedidos, 0, nav.userAgent.slice(13, 30));
  }
});
test('v779: no renewal within 30 s of a sale; it renews on the next frame after', () => {
  const w = { __f123UltimaVentaMs: Date.now() };
  const c = armar({ navigator: PC, window: w });
  c.contar(400 * 1024); assert.equal(c.pedidos, 0, 'sale just happened');
  w.__f123UltimaVentaMs = Date.now() - 31000;
  c.contar(100); assert.equal(c.pedidos, 1, 'after the pause');
});
test('v779: the 1024-frame renewal also waits for a recent sale', () => {
  const w = { __f123UltimaVentaMs: Date.now() };
  const c = armar({ navigator: IPHONE, window: w });
  for (let k = 0; k < 1024; k++) c.contar(100);
  assert.equal(c.pedidos, 0);
  w.__f123UltimaVentaMs = 0; c.contar(100); assert.equal(c.pedidos, 1);
});
