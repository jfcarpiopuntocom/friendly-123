'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const src=fs.readFileSync(path.join(__dirname,'../src/app/app-inline-01.js'),'utf8');
const min=fs.readFileSync(path.join(__dirname,'../docs/app-inline-01.min.js'),'utf8');
const ledger=require('../docs/core/payout-ledger.js');
const testSale=(id,fecha)=>({id,fecha,ubicacionId:'rack',productoId:'event',promotoraId:'associate',split:{montoComisionSocio:12.75,montoBruto:15,montoNetoDueno:2.25}});
const past=testSale('oct-23','2026-10-23T15:00:00.000Z'),current=testSale('nov-06','2026-11-06T22:55:00.000Z');
const historicPayout={id:'payout-oct',opId:'oct-paid-once',status:'paid',amountCents:1275,
  payeeId:'associate',locationId:'rack',period:'2026-10',items:[{kind:'sale',sourceId:'oct-23',payeeId:'associate',amountCents:1275}]};
test('real ledger does not inherit October PAID onto a NEW November sale of same event product',()=>{
  const input={sales:[past,current],locations:[{id:'rack',promotoraId:'associate'}],payouts:[historicPayout],payoutConflicts:[]};
  const obs=ledger.buildObligations(input).filter(o=>o.kind==='sale');
  const old=obs.find(o=>o.sourceId==='oct-23');
  const fresh=obs.find(o=>o.sourceId==='nov-06');
  assert.equal(old.paidCents,1275);
  assert.equal(old.dueCents,0);
  assert.equal(fresh.paidCents,0,'the previous payout MUST NOT mark the new sale paid');
  assert.equal(fresh.dueCents,1275,'the new sale remains payable');
});
function periodFixture({currentSales=true,auto=true,explicit=false}={}){
  const begin=src.indexOf('const _mesVigenteConVentas = ');
  const end=src.indexOf('/* v442 (JFC',begin);
  assert.ok(begin>=0&&end>begin,'the real automatic-period guard is executable');
  const logic=src.slice(begin,end);
  let loads=0;
  const ctx={window:{_ocMesAuto:auto?'2026-10':null,_ocMesAutoHecho:true},_ocMesComisiones:explicit?'2026-10':'2026-10',
    meses:[{mes:'2026-10',actual:false},{mes:'2026-11',actual:true}],
    ventasTodas:currentSales?[{id:'nov-06',mes:'2026-11',productoId:'event'}]:[{id:'oct-23',mes:'2026-10',productoId:'event'}],
    cargarComisiones:()=>{loads++;return true}};
  vm.runInNewContext('(function(){'+logic+'})()',ctx);
  return {ctx,loads};
}
test('automatic October selection returns to current month on new sale',()=>{
  const x=periodFixture();
  assert.equal(x.ctx._ocMesComisiones,null);
  assert.equal(x.ctx.window._ocMesAuto,null);
  assert.equal(x.loads,1,'refresh commissions exactly once');
});
test('automatic old month stays visible while current month has no sale',()=>{
  const x=periodFixture({currentSales:false});
  assert.equal(x.ctx._ocMesComisiones,'2026-10');
  assert.equal(x.loads,0);
});
test('manual choice wins over any automatic current-month switch',()=>{
  const start=src.indexOf('function cambiarMesComisiones(mes){');
  const end=src.indexOf('function selectorMesComisionesHtml',start);
  assert.ok(start>0&&end>start);
  const x=periodFixture({auto:false});
  const ctx=x.ctx;let calls=0;
  ctx.cargarComisiones=()=>{calls++};
  vm.runInNewContext(src.slice(start,end)+';cambiarMesComisiones("2026-10");',ctx);
  assert.equal(ctx.window._ocMesAuto,null);
  assert.equal(ctx.window._ocMesAutoHecho,true);
  assert.equal(ctx._ocMesComisiones,'2026-10');
  assert.equal(calls,1);
  const y=periodFixture({auto:false});
  assert.equal(y.loads,0);
});
test('published minified runtime contains current-month return and manual guard',()=>{
  assert.match(min,/window\._ocMesAuto=null/);
  assert.match(min,/_mesVigenteConVentas/);
  assert.match(min,/v\.mes===_mesVigenteConVentas\.mes/);
});
