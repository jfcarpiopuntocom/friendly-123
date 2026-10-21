'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');

const source=fs.readFileSync(path.join(__dirname,'../docs/vista-perchas.js'),'utf8');
const start=source.indexOf('  function esperarConPlazo(');
const end=source.indexOf('  async function cargar() {',start);
assert.ok(start>0&&end>start,'bounded shelf reads are present');
function adapter(fetchMock){
  return vm.runInNewContext('(function(){const API="/api";'+source.slice(start,end)+';return {esperarConPlazo,consultarVista};})()',{
    fetch:fetchMock,Promise,Error,Array,setTimeout,clearTimeout,console
  });
}

test('shelves: HTTP 503 never becomes an empty list of user shelves',async()=>{
  const x=adapter(async()=>({ok:false,status:503,json:async()=>({error:'unavailable'})}));
  await assert.rejects(x.consultarVista('/ubicaciones',null,true,true),/HTTP 503/);
});

test('shelves: malformed HTTP 200 response cannot say there are zero shelves',async()=>{
  const x=adapter(async()=>({ok:true,status:200,json:async()=>({error:'wrong schema'})}));
  await assert.rejects(x.consultarVista('/ubicaciones',null,true,true),/invalid list/);
});

test('shelves: optional financial read failure does not block shelf list or invent profits',async()=>{
  const x=adapter(async(url)=>url.endsWith('/ubicaciones')
    ? {ok:true,status:200,json:async()=>[{id:'u-synthetic',nombre:'Gallery'}]}
    : {ok:false,status:503,json:async()=>({error:'service unavailable'})});
  const shelves=await x.consultarVista('/ubicaciones',null,true,true);
  const reporting=await x.consultarVista('/reporting/corte',null,false,false);
  assert.equal(shelves[0].nombre,'Gallery');
  assert.equal(reporting,null,'unknown reporting stays unknown, not zero');
});

test('shelves: a never-resolving IndexedDB read must stop blocking the UI',async()=>{
  const x=adapter(async()=>({ok:true,status:200,json:async()=>[]}));
  await assert.rejects(x.esperarConPlazo(new Promise(()=>{}),'photos-synthetic',12),/timeout: photos-synthetic/);
  assert.match(source,/id="vp-reintentar"/,'loading error offers a retry button');
  assert.match(source,/if \(estaCarga !== cargaEnCurso\) return/,'stale fetch does not overwrite a later load');
  assert.match(source,/await esperarConPlazo\(precargarFotos\(\),'shelf photos'\)/,'photo read has bounded wait');
});
