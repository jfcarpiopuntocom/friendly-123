'use strict';
// Test the exact production retry implementation, independent of PWA bootstrap
// saves that can legitimately recover between browser assertions.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../docs/mock-backend.js'),'utf8');
const begin=source.indexOf('  var _reintentoGuardadoSilencioso = null');
const end=source.indexOf('  /* SOLO CONSOLA',begin);
assert.ok(begin>=0&&end>begin,'find current production failure/retry functions');
function fixture(){
 const pending=[],all=[],notices=[];
 const ctx={window:{},console:{warn(){}},
  setTimeout(fn,ms){const item={fn,ms,cancelled:false};pending.push(item);all.push(item);return item;},
  clearTimeout(item){item.cancelled=true;},
  avisoMemoriaLlena(){notices.push('quota');}};
 vm.createContext(ctx);
 vm.runInContext(source.slice(begin,end)+'\nthis.fail=_falloGuardadoLocal;this.success=_guardadoLocalExitoso;',ctx);
 ctx.guardarEstadoLocal=()=>{ctx.fail({name:'AbortError'});return false;};
 return {ctx,pending,all,notices};
}
test('persistent non-quota failure retries 3/6/12/24/48s, at most 5, no fake quota notices',()=>{
 const f=fixture();
 f.ctx.fail({name:'AbortError'});
 for(let i=0;i<10;i++){
  const next=f.pending.find(t=>!t.cancelled);
  if(!next)break;
  f.pending.splice(f.pending.indexOf(next),1);
  next.fn();
 }
 assert.deepEqual(f.all.map(t=>t.ms),[3000,6000,12000,24000,48000]);
 assert.equal(f.notices.length,0);
});
test('genuine successful save resets next backoff to 3s',()=>{
 const f=fixture();f.ctx.fail({name:'AbortError'});
 f.ctx.success();f.ctx.fail({name:'AbortError'});
 assert.deepEqual(f.all.map(t=>t.ms),[3000,3000]);
 assert.equal(f.all[0].cancelled,true);
});
test('real quota classification displays alert and does not schedule silent retries',()=>{
 const f=fixture();f.ctx.fail({name:'QuotaExceededError'});
 assert.deepEqual(f.notices,['quota']);assert.equal(f.all.length,0);
});
