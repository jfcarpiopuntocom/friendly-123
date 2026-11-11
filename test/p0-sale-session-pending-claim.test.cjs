'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const src=fs.readFileSync(path.join(__dirname,'../docs/mock-backend.js'),'utf8');
const start=src.indexOf('      // A PIN claim can be pending while this mutation waits in the FIFO.');
const end=src.indexOf('      const negado=cambio ?',start);
assert(start>=0&&end>start);
const block=src.slice(start,end);
async function run({pending,epoch=7,role='owner',changeEpoch=false,loseLease=false}){
 let calls=0, store=new Map(), now=epoch, isPending=pending;
 const tab={get pending(){return isPending;},isCurrent(){return !loseLease;}};
 const ctx={document:{visibilityState:'visible'},_p0ColaInicio:Date.now()-40,window:{OCTabSession:tab,get OC_AUTH_SESSION_EPOCH(){return now;}},rolAlPedir:role,epocaAlPedir:epoch,_rolLocal:()=>role,ventaConcurrente:true,localStorage:{getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v)},setTimeout:fn=>{calls++;isPending=false;if(changeEpoch)now++;fn();},Date,JSON,Promise};
 vm.createContext(ctx);
 const result=await vm.runInContext('(async()=>{'+block+';return {cambio,rolCambio,epocaCambio,tabActual};})()',ctx);
 return {result,calls,trace:JSON.parse(store.get('f123_p0_sale_session_fence_trace_v1')||'[]')};
}
(async()=>{
 let x=await run({pending:true});assert.equal(x.result.cambio,false);assert.equal(x.calls,1);
 x=await run({pending:true,changeEpoch:true});assert.equal(x.result.cambio,true);assert.equal(x.result.epocaCambio,true);assert.equal(x.trace.length,1);assert.equal(x.trace[0].isSale,true);assert.equal(x.trace[0].visibilityHidden,false);assert.ok(x.trace[0].queueWaitMs>=0);
 x=await run({pending:false,loseLease:true});assert.equal(x.result.cambio,true);assert.equal(x.result.tabActual,false);assert.equal(x.trace.length,1);
 x=await run({pending:false});assert.equal(x.result.cambio,false);
 console.log('P0 bounded PIN claim settlement: PASS');
})().catch(e=>{console.error(e);process.exitCode=1;});
