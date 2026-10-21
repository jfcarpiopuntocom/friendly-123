"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const path=require("node:path");
const src=fs.readFileSync(path.join(__dirname,"../docs/sync-yjs.js"),"utf8");
function staleProductProjection(prev,remote,clock) {
  const a=src.indexOf("              // Una réplica rezagada no debe volver a publicar");
  const b=src.indexOf("              var js = JSON.stringify(r);",a);
  assert.ok(a>0&&b>a,"stock metadata/ledger guard present");
  const ctx={prev,r:remote,col:"productos",window:{OCLatencia:{ahoraRelay:()=>clock}}};
  vm.createContext(ctx);
  vm.runInContext(src.slice(a,b)+"\nthis.result=r;",ctx);
  return ctx.result;
}
const current={id:"p",nombre:"Current",rev:{c:12,d:"pc"},stockActual:7,stockTs:1500};
test("P0 stale metadata and zero stock MUST NOT replace current positive stock",()=>{
  const actual=staleProductProjection(current,{id:"p",nombre:"Old",rev:{c:2,d:"cel"},stockActual:0,stockTs:100},3000);
  assert.equal(actual.nombre,"Current");
  assert.equal(actual.stockActual,7);
  assert.equal(actual.stockTs,1500);
});
test("P0 stale metadata and old positive stock MUST NOT replace newer valid stock",()=>{
  const actual=staleProductProjection(current,{id:"p",nombre:"Old",rev:{c:2,d:"cel"},stockActual:3,stockTs:100},3000);
  assert.equal(actual.stockActual,7);
});
test("P0 valid independent newer manual correction must still propagate despite old metadata",()=>{
  const actual=staleProductProjection(current,{id:"p",nombre:"Old",rev:{c:2,d:"cel"},stockActual:6,stockTs:2000},3000);
  assert.equal(actual.nombre,"Current");
  assert.equal(actual.stockActual,6);
});
test("P0 new zero from proven PN ledger must still propagate",()=>{
  const first={id:"p",rev:{c:12,d:"pc"},stockActual:7,stockTs:1500,
    stockBase:8,stockPN:{pc:{add:0,sub:1}}};
  const newer={id:"p",rev:{c:2,d:"cel"},stockActual:0,stockTs:2000,
    stockBase:8,stockPN:{pc:{add:0,sub:1},cel:{add:0,sub:7}}};
  const actual=staleProductProjection(first,newer,3000);
  assert.equal(actual.stockActual,0);
  assert.equal(actual.stockPN.cel.sub,7);
});
test("P0 same stock base with merged PN must not lose counters despite metadata version",()=>{
  const first={id:"p",rev:{c:12,d:"pc"},stockActual:7,stockTs:4000,
    stockBase:8,stockPN:{pc:{add:0,sub:1}}};
  const merged={id:"p",rev:{c:2,d:"cel"},stockActual:6,stockTs:2000,
    stockBase:8,stockPN:{pc:{add:0,sub:1},cel:{add:0,sub:1}}};
  const actual=staleProductProjection(first,merged,5000);
  assert.equal(actual.stockActual,6);
  assert.equal(actual.stockPN.cel.sub,1);
});
test("P0 future-dated, non-ledger remote stock cannot override current",()=>{
  const actual=staleProductProjection(current,{id:"p",nombre:"Old",rev:{c:2,d:"cel"},
    stockActual:20,stockTs:999999},3000);
  assert.equal(actual.stockActual,7);
});
test("P0 legacy zero never masks positive stock without a trusted ledger",()=>{
  const actual=staleProductProjection(current,{id:"p",nombre:"Old",rev:{c:2,d:"cel"},
    stockActual:0,stockTs:2000},3000);
  assert.equal(actual.stockActual,7);
});

function seedWith(name,rev,recovering) {
  const a=src.indexOf("    function sembrar() {"),b=src.indexOf("\n    // Yjs -> store.",a);
  assert.ok(a>0&&b>a,"actual Yjs local seed found");
  const meta=new Map([["nombreNegocio","Recent real shop"],["nombreRev",10],["nombreTs",1000],["nombreEsDueno",true]]);
  const API={canal:{recuperando:recovering},doc:{transact:(fn)=>fn()},meta,mapas:{}};
  const cat={nombreNegocio:name,nombreNegocioRev:rev,nombreNegocioTs:2000,productos:[{id:"local"}],
    ubicaciones:[],ventas:[],clientes:[]};
  const win={OCSync:{catalogoPropio:()=>cat,hashearFotosProductos:async()=>{}},
    OCAuth:{rolActual:()=> "dueno"}};
  const ctx={API,window:win,OCAuth:win.OCAuth,COLECCIONES_BATCH:[],_aplicando:false,
    log:()=>{},publicarFotosLocales:()=>{},sembrarVentasAlRelay:()=>{},
    sembrarFinanzas:()=>{}};
  vm.createContext(ctx);
  vm.runInContext(src.slice(a,b)+"\nthis.invoke=sembrar;",ctx);
  ctx.invoke();
  return Object.fromEntries(meta);
}
test("P0 old local shop name cannot overwrite shared owner name during first pull",()=>{
  const actual=seedWith("My Small Shop",999,true);
  assert.equal(actual.nombreNegocio,"Recent real shop");
  assert.equal(actual.nombreRev,10);
});
test("P0 legitimate owner rename still works after full recovery",()=>{
  const actual=seedWith("New verified name",11,false);
  assert.equal(actual.nombreNegocio,"New verified name");
  assert.equal(actual.nombreRev,11);
});
