"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const src=fs.readFileSync(path.join(__dirname,"../docs/mock-backend.js"),"utf8");
const a=src.indexOf("  function _prepararOpStock(payload, idOperacion) {");
const b=src.indexOf("  function emitirOpStock(tipo, payload, preparado = false) {",a);
assert.ok(a>0&&b>a,"real stock source located");
function fixture(initial, now) {
  const productos=[{id:"synthetic",nombre:"Test",stockActual:initial.stockActual,stockTs:initial.stockTs,
    stockBase:initial.stockBase,stockPN:initial.stockPN}];
  const ctx={productos,window:{OCLatencia:{ahoraRelay:()=>now}},localStorage:{getItem:()=>null,setItem:()=>{}},
    uuid:()=> "synthetic-uuid",Date,Math,Number,Object,console};
  vm.createContext(ctx);
  vm.runInContext(src.slice(a,b)+"\nthis.stamp=_prepararOpStock;",ctx);
  return {p:productos[0],stamp:ctx.stamp};
}
test("P0: two physical sales within one millisecond have distinct increasing shared stock timestamps",()=>{
  const now=40000000000;
  const {p,stamp}=fixture({stockActual:9,stockTs:now},now);
  stamp({productoId:p.id,delta:-1},"sale1");
  const first=p.stockTs;
  assert.equal(first,now+1);
  p.stockActual=8;
  stamp({productoId:p.id,delta:-1},"sale2");
  assert.equal(p.stockTs,first+1);
  assert.equal(p.stockBase,10);
  assert.equal(p.stockPN.sale1.sub,1);
  assert.equal(p.stockPN.sale2.sub,1);
});
test("P0: clock from impossible future does not poison later valid owner correction",()=>{
  const now=40000000000;
  const {p,stamp}=fixture({stockActual:4,stockTs:now+900000},now);
  stamp({productoId:p.id,delta:1},"ownerCorrection");
  assert.equal(p.stockTs,now);
  assert.equal(p.stockPN.ownerCorrection.add,1);
});
