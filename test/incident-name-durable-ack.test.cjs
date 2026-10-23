'use strict';
// E4 / 1AAA: test the actual POST handler, with synthetic data and disk failures.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const src=fs.readFileSync(path.join(__dirname,'../docs/mock-backend.js'),'utf8');
const start=src.indexOf('      if (path === "/api/instancia/nombre" && opts && opts.method === "POST") {');
const end=src.indexOf('      /* DIAGNOSTICO FORENSE DE RELOJ',start);
assert.ok(start>=0 && end>start,'extract the real business-name route');
const handle=new Function('ctx','body',`with(ctx){const path="/api/instancia/nombre",opts={method:"POST"};return (async()=>{${src.slice(start,end)}})()}`);

function fixture(storage){
  const events=[], writes=[], state={nombreNegocio:'Original fixture',nombreNegocioTs:20,nombreNegocioRev:7};
  const owned={nombreNegocio:'Original fixture',nombreNegocioTs:20,nombreNegocioRev:7};
  const ctx={...state,Date,localStorage:{
    getItem:k=>k==='f123_owned'?JSON.stringify(owned):null,
    setItem:(k,v)=>{writes.push([k,v]);if(k==='f123_owned')Object.assign(owned,JSON.parse(v));}
  },guardarEstadoLocal:storage,window:{dispatchEvent:e=>events.push(e.type)},
    CustomEvent:class{constructor(type){this.type=type;}},avisarCatalogoCambiado:()=>events.push('catalogo'),
    J:(data,status)=>({status:status||200,...data})};
  return {ctx,owned,events,writes,request:(name)=>handle(ctx,{nombre:name})};
}
test('E4: failed localStorage+IndexedDB confirmation keeps prior name, metadata, sidecar and events',async()=>{
  for(const storage of [()=>false,()=>Promise.resolve(false),()=>Promise.reject(Error('synthetic quota'))]){
    const f=fixture(storage);
    const r=await f.request('New unconfirmed fixture');
    assert.equal(r.status,507);assert.notEqual(r.ok,true);
    assert.equal(f.ctx.nombreNegocio,'Original fixture');
    assert.equal(f.ctx.nombreNegocioRev,7);assert.equal(f.ctx.nombreNegocioTs,20);
    assert.equal(f.owned.nombreNegocio,'Original fixture');
    assert.equal(f.writes.length,0);
    assert.deepEqual(f.events,[]);
  }
});
test('E4: local and IndexedDB durability each permit one confirmed rename',async()=>{
  for(const storage of [()=>true,()=>Promise.resolve(true)]){
    const f=fixture(storage);
    const r=await f.request('Confirmed fixture');
    assert.equal(r.status,200);assert.equal(r.ok,true);
    assert.equal(f.ctx.nombreNegocio,'Confirmed fixture');
    assert.equal(f.owned.nombreNegocio,'Confirmed fixture');
    assert.equal(f.writes.filter(([k])=>k==='f123_owned').length,1);
    assert.deepEqual(f.events,['oc-negocio-actualizado','catalogo']);
  }
});
test('E4: failure does not roll back a different name received during pending save',async()=>{
  let finish;const pending=new Promise(resolve=>{finish=resolve;});
  const f=fixture(()=>pending);
  const request=f.request('Failed local attempt');
  await Promise.resolve();
  f.ctx.nombreNegocio='Yjs owner later';
  f.ctx.nombreNegocioRev=9;f.ctx.nombreNegocioTs=333;
  finish(false);
  const r=await request;
  assert.equal(r.status,507);
  assert.equal(f.ctx.nombreNegocio,'Yjs owner later');
  assert.equal(f.ctx.nombreNegocioRev,9);
  assert.equal(f.ctx.nombreNegocioTs,333);
  assert.equal(f.owned.nombreNegocio,'Original fixture');
  assert.deepEqual(f.events,[]);
});
