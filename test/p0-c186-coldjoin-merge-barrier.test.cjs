'use strict';
// C186: execute the REAL remote merge/visible-receipt listeners from docs/sync-yjs.js.
// No customers, network, PIN, Yjs dependency or synthetic business writes.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('docs/sync-yjs.js','utf8');

function sliceExact(begin,end) {
  const a=source.lastIndexOf(begin), b=source.indexOf(end,a);
  assert.ok(a>=0 && b>a,'production fragment must exist: '+begin);
  return source.slice(a,b);
}
const remoteListener=sliceExact(
  '    API.doc.on("update", function (update, origin) {',
  '\n    // Arranque:');
const visibleReceipt=sliceExact(
  '    API.confirmarCatalogoVisible = function () {',
  '    function aplicar() {');

function liveHarness({recovering=true,access=false}={}) {
  const timers=[];
  let handler=null,merges=0;
  const API={
    _catalogoRevision:0,
    canal:{recuperando:recovering,accesoListo:()=>access},
    doc:{on(type,fn){assert.equal(type,'update'); handler=fn;}}
  };
  const ctx={API,_otroRemoto:false,_tAplica:null,
    origenCatalogoRemoto:origin=>origin==='red',
    setTimeout(fn){const id=timers.length+1;timers.push(fn);return id;},
    aplicar(){merges++;}
  };
  vm.runInNewContext(remoteListener,ctx);
  assert.equal(typeof handler,'function','actual Y.Doc handler is installed');
  return {API,ctx,update(){handler(Uint8Array.of(1),'red');},
    flush(){for(const fn of timers.splice(0))fn();},
    merges:()=>merges, pending:()=>timers.length};
}
test('C186 RED: 100 cold encrypted Yjs updates must not merge incomplete business catalog 100 times',()=>{
  const h=liveHarness({recovering:true,access:false});
  for(let i=0;i<100;i++){h.update();h.flush();}
  assert.equal(h.API._catalogoRevision,100,'every inbound Yjs event is observed');
  assert.equal(h.merges(),0,'no unsafe full OCSync.aplicarCatalogo in unverified cold replay');
  assert.equal(h.pending(),0,'no stale work to execute after access changes');
  h.API.canal.recuperando=false;
  h.update();h.flush();
  assert.equal(h.merges(),1,'next regular remote update still applies immediately');
});
test('C186: verified access while relay is still catching up retains immediate live convergence',()=>{
  const h=liveHarness({recovering:true,access:true});
  h.update();h.flush();
  assert.equal(h.merges(),1,'the pre-authorized local-first store still receives remote changes');
});
test('C186 RED: visibility measurement never forces an unverified cold full-store merge',async()=>{
  let merges=0,clears=0;
  const API={_catalogoRevision:1,
    canal:{recuperando:true,accesoListo:()=>false},
    hechosListos:()=>true};
  const ctx={API,_tAplica:123,ultimaAplicacionVisible:Promise.resolve(true),
    clearTimeout(){clears++;},
    aplicar(){merges++;ctx._tAplica=null;}};
  vm.runInNewContext(visibleReceipt,ctx);
  assert.equal(await API.confirmarCatalogoVisible(),false,'partial history cannot certify visibility');
  assert.equal(merges,0,'a latency receipt cannot trigger a full catalog write while recovering');
  assert.equal(clears,0,'a pending timer is not synchronously drained');
  API.canal.recuperando=false;
  assert.equal(await API.confirmarCatalogoVisible(),true,'normal visible ACK retained after recovery');
  assert.equal(merges,1,'pending normal merge applied once');
});
