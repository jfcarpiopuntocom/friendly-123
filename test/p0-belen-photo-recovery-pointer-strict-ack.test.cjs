'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const src=fs.readFileSync(path.join(__dirname,'../docs/vista-perchas.js'),'utf8');
const a=src.indexOf('  async function recuperarFotosPerchas(perchasVisibles, estaCarga) {');
const b=src.indexOf('  async function cargar() {',a);
assert.ok(a>0&&b>a&&b-a>2000,'extract exact production photo adapter');
const block=src.slice(a,b);
async function run({response={ok:true},switchDuringFetch=false,switchBeforeFetch=false}={}){
 const writes=[],observed=[];let shop='synthetic-shop-A';
 const ctx={window:{
  OCTienda:{licenciaActual:()=>shop},OCAuth:{rolActual:()=> 'dueno'},
  OCYjs:{get:()=>{if(switchBeforeFetch)shop='synthetic-shop-B';return {};},fotosMap:{get:()=>null}},
  OCFotos:{leerPorHash:async()=>null,leerFoto:async()=>null,guardarPorHash:async()=>true,guardarFoto:async()=>true,hashDeDataUrl:async()=> 'abc'},
  OCSalud:{fallo:()=>{}},
  F123Application:{recoverShelfPhoto:async(shelf,ports)=>{observed.push(await ports.setPointer(shelf.id,'synthetic-hash'));return {pointerChanged:observed[0],pointerHash:'synthetic-hash'};}}
 },API:'/api',fetch:async(url,req)=>{writes.push({url,body:JSON.parse(req.body)});if(switchDuringFetch)shop='synthetic-shop-B';if(response instanceof Error)throw response;return response;},
 historialFotosExacto:async()=>({}),historialFotosCheckpointsExacto:async()=>({}),fotoCache:{},cargaEnCurso:1,console};
 vm.runInNewContext(block+'\nglobalThis.__run=recuperarFotosPerchas;',vm.createContext(ctx));
 await ctx.__run([{id:'synthetic-shelf',fotoHash:'prior-photo'}],1);
 return {ack:observed[0],writes,shop};
}
test('P0 RED: null response must not count as pointer ACK',async()=>{const x=await run({response:null});assert.equal(x.ack,false);assert.equal(x.writes.length,1);});
test('P0 RED: response lacking ok must not count as pointer ACK',async()=>{const x=await run({response:{status:500}});assert.equal(x.ack,false);assert.equal(x.writes.length,1);});
test('P0: explicit HTTP error refuses pointer',async()=>{const x=await run({response:{status:500,ok:false}});assert.equal(x.ack,false);});
test('P0: HTTP 200 with ok:true accepts pointer',async()=>{const x=await run({response:{status:200,ok:true}});assert.equal(x.ack,true);assert.equal(x.writes[0].body.fotoHash,'synthetic-hash');});
test('P0 RED: shop switch mid-flight refuses stale photo ACK',async()=>{const x=await run({response:{status:200,ok:true},switchDuringFetch:true});assert.equal(x.ack,false);});
test('P0 RED: shop switch before fetch cannot publish old pointer',async()=>{const x=await run({response:{status:200,ok:true},switchBeforeFetch:true});assert.equal(x.ack,false);assert.equal(x.writes.length,0);});
