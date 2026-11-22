'use strict';
// C179: execute the ACTUAL app and esbuild output CSV handler with the real
// read-only Commissions projection. No client backend, payment or storage writes.
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const report=require('../docs/core/commission-history.js');
const root=path.resolve(__dirname,'..');
function csvHandler(file,group,sales){
  const src=fs.readFileSync(path.join(root,file),'utf8');
  const start=src.indexOf('async function exportarComisionesTotalCSV(){');
  const end=src.indexOf('async function exportarComisionesCSV(){',start);
  assert.ok(start>=0&&end>start,'source-executed handler exists in '+file);
  const alerts=[],captures=[],fetchCalls=[];
  let labelPasses=0,downloads=0;
  const wrapped={
    project(opts){
      const result=report.project({...opts,sales});
      assert.equal(result.group,group);
      const gs=result.groups;
      const originalMap=gs.map.bind(gs);
      gs.map=fn=>{labelPasses++;return originalMap(fn)};
      gs.find=()=>{throw Error('O(NxM) group scan forbidden; index group once')};
      return result;
    }
  };
  const env={
    window:{_ocComHistoryFrom:'',_ocComHistoryTo:'',_ocComHistoryGroup:group,OCCommissionHistory:wrapped},
    _ocMesComisiones:'',exportarComisionesCSV(){throw Error('unexpected monthly branch')},
    API:'/mock',fetch:async url=>{fetchCalls.push(url);return{ok:true,json:async()=>sales}},
    alert:v=>alerts.push(v),
    document:{documentElement:{lang:'es'},body:{appendChild(){}},
      createElement(){return{click(){downloads++},remove(){}}}},
    Blob:class{constructor(parts){captures.push(parts.join(''))}},
    URL:{createObjectURL(){return'blob:c179'},revokeObjectURL(){}},
    setTimeout(){ }
  };
  const handler=new Function(...Object.keys(env),src.slice(start,end)+'\nreturn exportarComisionesTotalCSV;')(...Object.values(env));
  return {run:handler,alerts,captures,fetchCalls,get labelPasses(){return labelPasses},get downloads(){return downloads}};
}
const sales=Array.from({length:700},(_,i)=>({
 id:'sale-'+i,fechaLocal:'2026-11-21',productoId:'p'+i,
 productoNombre:'Producto '+i,cantidad:1,precioUnit:15.23,comisionAsociado:3.05
}));
for(const file of ['src/app/app-inline-01.js','docs/app-inline-01.min.js']){
 test('C179 '+file+' exports 700 genuine distinct product groups in ONE index pass, preserves CSV money',async()=>{
  const f=csvHandler(file,'producto',sales);await f.run();
  assert.deepEqual(f.alerts,[],'no hidden failure');
  assert.equal(f.downloads,1);
  assert.deepEqual(f.fetchCalls,['/mock/ventas/todas?ubicacionId=todas']);
  assert.equal(f.labelPasses,1,'at most one group map; not 245350 comparisons');
  const text=f.captures[0].replace(/^\uFEFF/,'');
  assert.equal(text.split('\n').length,701,'all 700 receipts exported once');
  for(const i of [0,350,699]){
    assert.ok(text.includes('sale-'+i+',Producto '+i+',15.23,3.05'),
      'authentic label and exact economic values for sale '+i);
  }
 });
 test('C179 '+file+' keeps default overall total semantics with 700 real receipts',async()=>{
  const f=csvHandler(file,'total',sales);await f.run();
  assert.deepEqual(f.alerts,[]);
  assert.equal(f.downloads,1);
  assert.equal(f.labelPasses,1);
  const text=f.captures[0];
  assert.equal(text.trim().split('\n').length,701);
  assert.ok(text.includes('Total general,15.23,3.05'));
 });
}
