'use strict';
// P0 · verify the *actual* Sync3 movement import loop retries failed durable
// local commits WITHOUT a new network event. No inventory, PIN, or relay writes.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const src=fs.readFileSync(path.join(__dirname,'../docs/sync-yjs.js'),'utf8');
function extract(begin,end){
  const a=src.indexOf(begin),b=src.indexOf(end,a);
  assert.ok(a>=0 && b>a,'source extraction contract '+begin);
  return src.slice(a,b);
}
const retrySource=extract('  function reintentoLocalAplicacion(aplicar) {','  function conectarHechos() {');
const opsSource=extract('  function miDeviceId() {','  // ===================================================================\n  // B3');
function scenario(outcomes){
  const timers=new Map(),events=[],listeners=new Map();
  let clock=0,seq=0,attempts=0;
  const doc={isDestroyed:false,on(type,fn){listeners.set(type,fn)}};
  const op={opId:'synthetic-immutable-op-1',deviceId:'remote-actor',tipo:'ajuste',
    productoId:'synthetic-product'};
  const API={doc,opsMap:new Map([[op.opId,op]])};
  const window={
    OCSyncControl:{deviceIdActual:()=> 'local-actor'},
    OCSync:{aplicarOpRemota(){
      attempts++;
      const val=outcomes[Math.min(attempts-1,outcomes.length-1)];
      if(val==='throw')throw Error('transient disk exception');
      if(val==='reject')return Promise.reject(Error('transient IDB AbortError'));
      if(val==='sync-fail')return {ok:false};
      return Promise.resolve({ok:val==='ok',repetida:false});
    }},
    addEventListener(){},removeEventListener(){},
    dispatchEvent(ev){events.push(ev.type)}
  };
  const context={
    API,window,document:{hidden:false,addEventListener(){},removeEventListener(){}},
    localStorage:{getItem(k){return k==='f123_owned'?JSON.stringify({licenseCode:'SYNTHETIC'}):null}},
    CustomEvent:class{constructor(type){this.type=type}},
    log(){},Promise,JSON,Date,Object,String,Number,Math,
    setTimeout(fn,ms){const id=++seq;timers.set(id,{fn,due:clock+Number(ms||0)});return id},
    clearTimeout(id){timers.delete(id)}
  };
  vm.runInNewContext(retrySource+'\n'+opsSource+
    '\nthis.applyNow=procesarEventos;this.processed=()=>_opsProcesadas;',context);
  async function flush(){for(let i=0;i<8;i++)await Promise.resolve();}
  async function runTimer(){
    const next=[...timers.entries()].sort((a,b)=>a[1].due-b[1].due)[0];
    if(!next)return false;
    const [id,t]=next;timers.delete(id);clock=t.due;t.fn();await flush();return true;
  }
  return {context,API,doc,timers,events,apply:context.applyNow,flush,runTimer,
    get attempts(){return attempts}, get clock(){return clock},
    destroy(){doc.isDestroyed=true;listeners.get('destroy')?.()}}
}
for(const mode of ['promise-fail','reject','sync-fail','throw']){
  test('P0 RED: remote movement transient '+mode+' must retry without new relay packet',async()=>{
    const flow=scenario([mode,'ok']);
    flow.apply();await flow.flush();
    assert.equal(flow.attempts,1,'one initial delivery');
    assert.ok(flow.timers.size>0,'must schedule a bounded retry on failure');
    assert.ok([...flow.timers.values()].every(v=>v.due>=flow.clock+200),
      'failure may not cause a hot zero-delay retry loop');
    assert.equal(await flow.runTimer(),true);
    assert.equal(flow.attempts,2,'same immutable op retries automatically');
    assert.equal(flow.context.processed()['synthetic-immutable-op-1'],1);
    assert.deepEqual(flow.events,['oc-sync-op-remota'],'one visible event after actual durable acceptance');
    for(let i=0;i<3;i++)await flow.runTimer();
    assert.equal(flow.attempts,2,'replay must not produce duplicate adjustments or sales');
    flow.destroy();
  });
}
test('P0: retry must be cancelled on notebook destruction/identity switch',async()=>{
  const f=scenario(['promise-fail','ok']);
  f.apply();await f.flush();
  assert.ok(f.timers.size>0,'failed import pending');
  f.destroy();
  assert.equal(f.timers.size,0,'no future movement import into the wrong notebook');
  assert.equal(f.attempts,1);
});
