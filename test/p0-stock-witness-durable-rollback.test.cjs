'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const src=fs.readFileSync(path.join(__dirname,'..','docs','mock-backend.js'),'utf8');
const start=src.indexOf('  function _fundirHechoStock(p, w) {');
const end=src.indexOf('  /* v515: quien gana',start);
assert.ok(start>0&&end>start,'real PN projector exists');
const ctx=vm.createContext({});
vm.runInContext(src.slice(start,end),ctx);
function merge(p,w){ctx.p=p;ctx.w=w;return vm.runInContext('_fundirHechoStock(p,w)',ctx);}
const from=src.indexOf('      const witness = op.payload && op.payload.stockPNHecho;');
const to=src.indexOf('      /* NEUTRALIZADO',from);
assert.ok(from>0&&to>from,'real witness receiver branch exists');
const branch=src.slice(from,to);
const receiver=new Function('op','window','productos','guardarEstadoLocal','_fundirHechoStock','clonar','_marcarOpAplicada','avisarCatalogoCambiado',branch);
const witness={base:13,epoch:'E',actor:'phone',add:0,sub:1};
const op={opId:'sale-1',payload:{productoId:'spray',stockPNHecho:witness}};
function make(saved){
 const p={id:'spray',stockBase:13,stockEpochId:'E',stockActual:13,stockPN:{},stockDeficit:0};
 const ack=[];const notify=[];
 const persist=()=>saved instanceof Error?Promise.reject(saved):Promise.resolve(saved);
 const run=()=>receiver(op,{OCYjs:{esLicenciaPruebaJfc:true}},[p],persist,merge,x=>JSON.parse(JSON.stringify(x)),x=>ack.push(x),()=>notify.push(1));
 return {p,ack,notify,run};
}
test('Spray de la verdad 13→12 converges despite repeated/out-of-order witness',()=>{
 const a=make(true),b=make(true);
 assert.equal(merge(a.p,witness),true);assert.equal(merge(b.p,witness),true);
 assert.equal(merge(b.p,witness),true);assert.equal(a.p.stockActual,12);assert.equal(b.p.stockActual,12);
});
test('durable success applies exactly once before op ACK',async()=>{
 const a=make(true);assert.deepEqual(await a.run(),{ok:true});
 assert.equal(a.p.stockActual,12);assert.deepEqual(a.ack,['sale-1']);assert.equal(a.notify.length,1);
});
test('durable refusal restores stock and retains opId for retry',async()=>{
 const a=make(false);assert.deepEqual(await a.run(),{ok:false,error:'stock-not-durable'});
 assert.equal(a.p.stockActual,13);assert.deepEqual(a.p.stockPN,{});assert.equal(a.ack.length,0);
});
test('durable rejection restores stock and retains opId for retry',async()=>{
 const a=make(new Error('quota'));assert.deepEqual(await a.run(),{ok:false,error:'stock-commit-failed'});
 assert.equal(a.p.stockActual,13);assert.deepEqual(a.p.stockPN,{});assert.equal(a.ack.length,0);
});
