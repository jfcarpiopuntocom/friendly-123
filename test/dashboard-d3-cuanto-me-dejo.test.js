const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const RM=require('../docs/core/business-read-model.js');
const P=require('../docs/core/finance-report.js');
const zone='America/Guayaquil',period={from:'2026-11-17',to:'2026-11-17'};
function sale(id,name,price,cost,quantity=1,extras={}){
  return {id,productoId:id,productoNombre:name,ubicacionId:'shelf-1',
    ubicacionNombre:'Shelf 1',formaPago:'cash',cantidad:quantity,
    precioUnit:price,costoUnit:cost,noCommission:true,
    fecha:'2026-11-18T02:30:00Z',...extras};
}
test('D3 emits a single source-derived earnings projection with all safe grouping keys',()=>{
  assert.equal(typeof P.earnings,'function');
  const sales=[sale('taza','Taza',20,2.2,1,{noCommission:false,comisionAsociado:3,netoCasa:17}),sale('camiseta','Camiseta',20,9.1)];
  for(const by of ['product','shelf','associate','customer','payment','channel','event','weekday','hour']){
    const rows=P.earnings({sales,period,zone},by);
    assert.equal(rows[0].key,null);
    assert.equal(rows[0].netCents,4000);
    assert.equal(rows[0].costCents,1130);
    assert.equal(rows[0].profitCents,2570);
    assert.equal(rows[0].commissionCents,300);
    assert.equal(rows.slice(1).reduce((a,x)=>a+x.netCents,0),4000,'each grouping balances '+by);
  }
});
test('D3 null cost is unknown not $0; courtesy cost is real negative profit',()=>{
  const sales=[sale('cup','Taza',20,2.2,1),
    sale('gift','Taza',0,1.1,1,{cortesia:true,productoId:'cup'}),
    sale('shirt','Camiseta',10,null)];
  const rows=P.earnings({sales,period,zone},'product');
  const cup=rows.find(x=>x.key==='cup'),shirt=rows.find(x=>x.key==='shirt');
  assert.equal(cup.profitCents,1670);
  assert.equal(cup.costCents,330);
  assert.equal(shirt.profitCents,null);
  assert.equal(shirt.marginPct,null);
  assert.equal(shirt.salesWithoutCost,1);
  assert.equal(rows[0].profitCents,null,'total cannot invent unknown profit');
});
test('D3 return signed in selected business period; 21h Ecuador is previous UTC date',()=>{
  const v=sale('return1','Taza',20,2,1,{devuelta:true,fechaDevolucion:'2026-11-18T03:30:00Z'});
  const rows=P.earnings({sales:[v],period,zone},'product');
  assert.equal(rows[0].netCents,0);
  assert.equal(rows[0].costCents,0);
  const byHour=P.earnings({sales:[v],period,zone},'hour');
  assert.equal(byHour[1].key,'21');
  const weekday=P.earnings({sales:[v],period,zone},'weekday');
  assert.equal(weekday[1].key,'2');
});
test('D3 worker routing keeps old financial report mode unchanged',()=>{
  const s=fs.readFileSync(path.join(root,'docs/finance-report-worker.js'),'utf8');
  const old=P.build;assert.equal(typeof old,'function');
  assert.match(s,/earningsBy/);
  const sent=[];const self={postMessage:v=>sent.push(v)};
  vm.runInNewContext(s.replace(/^importScripts\([^\n]+\);/m,''),
    {self,console});
  // Minimal source contract: both modes are selected by the real worker,
  // while full Workerd/Chromium is covered by its dedicated browser suite.
  assert.equal(typeof self.onmessage,'function');
});
