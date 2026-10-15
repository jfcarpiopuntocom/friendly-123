const {test}=require('node:test');
const assert=require('node:assert/strict');
const R=require('../docs/core/business-read-model.js');
const sale=(extra={})=>({id:'s1',fecha:'2026-10-15',cantidad:1,precioUnit:100,costoUnit:10,
  modoComision:'acuerdo',comisionAsociado:80,netoCasa:20,comisionPendiente:50,
  direccionComision:'casaPaga',...extra});
const expense=(extra={})=>({id:'e1',fecha:'2026-10-15',monto:5,categoria:'services',...extra});
const report=(sales=[sale()],expenses=[expense()],extra={})=>R.businessResult({sales,expenses,month:'2026-10',zone:'America/Guayaquil',...extra});

test('house result separates earned share, direct costs and expense from payments',()=>{
  const r=report();
  assert.equal(r.netCents,10000);
  assert.equal(r.artistShareCents,8000);
  assert.equal(r.houseShareCents,2000);
  assert.equal(r.costCents,1000);
  assert.equal(r.houseAfterExpensesCents,500);
  assert.equal(r.cashCents,null,'the report has no complete cash ledger');
  assert.equal(report([sale({comisionPendiente:80,liquidada:false})]).houseAfterExpensesCents,500);
  assert.equal(report([sale({comisionPendiente:0,liquidada:true})]).houseAfterExpensesCents,500);
});
test('associate-collected sale earns house share but does not invent cash received',()=>{
  const r=report([sale({direccionComision:'asociadoPaga',comisionPendiente:0})]);
  assert.equal(r.houseShareCents,2000); assert.equal(r.houseAfterExpensesCents,500);
  assert.equal(r.cashCents,null);
});
test('dated returns reverse economic shares in the return month, not in sale month',()=>{
  const v=sale({fecha:'2026-09-30',devuelta:true,fechaDevolucion:'2026-10-02'});
  const sept=report([v],[],{month:'2026-09'}),oct=report([v],[]);
  assert.equal(sept.houseShareCents,2000);assert.equal(sept.houseAfterExpensesCents,1000);
  assert.equal(oct.houseShareCents,-2000);assert.equal(oct.artistShareCents,-8000);
  assert.equal(oct.costCents,-1000);assert.equal(oct.houseAfterExpensesCents,-1000);
});
test('missing split, price, cost or return date never fabricates a house result',()=>{
  for(const patch of [{comisionAsociado:null,netoCasa:null},{precioUnit:null},{costoUnit:null},
    {devuelta:true,fechaDevolucion:null}])assert.equal(report([sale(patch)]).houseAfterExpensesCents,null);
});
test('recorded zero commission is valid and counter sales still keep their stored commission',()=>{
  assert.equal(report([sale({comisionAsociado:0,netoCasa:100})]).houseAfterExpensesCents,8500);
  assert.equal(report([sale({modoComision:'counter'})]).houseAfterExpensesCents,500);
});
test('identical operations are idempotent, contradictory IDs are order-independent pending',()=>{
  const a=sale(),b=sale({precioUnit:110,netoCasa:30});
  assert.equal(report([a,{...a}],[expense(),expense()]).houseAfterExpensesCents,500);
  for(const records of [[a,b],[b,a]]){
    const r=report(records);assert.equal(r.netCents,null);assert.equal(r.houseAfterExpensesCents,null);
    assert.ok(r.warnings.includes('conflicting-sale'));
  }
  for(const records of [[expense(),expense({monto:9})],[expense({monto:9}),expense()]]){
    const r=report([a],records);assert.equal(r.expensesCents,null);assert.equal(r.houseAfterExpensesCents,null);
  }
});
test('split disagreement and unsafe aggregate cannot be made into an attractive margin',()=>{
  assert.equal(report([sale({netoCasa:21})]).houseAfterExpensesCents,null);
  assert.equal(report([sale({precioUnit:1e14,netoCasa:1e14,comisionAsociado:0})]).houseAfterExpensesCents,null);
});
test('general costs are not silently allocated to an event; exact occurrence IDs are preserved',()=>{
  const sales=[sale({eventoId:'class-am'}),sale({id:'s2',eventoId:'class-pm'})];
  const expenses=[expense({eventoId:'class-am'}),expense({id:'rent',monto:30,categoria:'rent',ubicacionId:'todas'})];
  const a=report(sales,expenses,{scope:{eventOccurrenceId:'class-am'}});
  const b=report(sales,expenses,{scope:{eventOccurrenceId:'class-pm'}});
  assert.equal(a.houseShareCents,2000);assert.equal(a.directExpensesCents,500);
  assert.equal(a.contributionCents,500);assert.equal(a.generalExpensesCents,3000);
  assert.equal(a.houseAfterExpensesCents,null,'no allocation policy exists for common costs');
  assert.equal(b.contributionCents,1000);
});
test('inventory expenses, missing coverage and undated expenses remain unreconciled',()=>{
  assert.equal(report([sale()],[expense({categoria:'inventory'})]).houseAfterExpensesCents,null);
  assert.equal(report([sale()],[],{coverage:{expenses:false}}).houseAfterExpensesCents,null);
  assert.equal(report([sale()],[expense({fecha:'invalid'})]).houseAfterExpensesCents,null);
  assert.equal(report([sale()],[],{coverage:{sales:false}}).houseAfterExpensesCents,null);
});
test('quarter and annual ranges use the same business timezone and operation rules',()=>{
  const sales=[sale({fecha:'2026-11-01T02:00:00Z'}),sale({id:'s2',fecha:'2026-11-01T05:00:00Z'})];
  assert.equal(report(sales,[],{month:'2026-10'}).houseShareCents,2000);
  assert.equal(report(sales,[],{month:null,period:{from:'2026-10-01',to:'2026-12-31'}}).houseShareCents,4000);
  assert.equal(report(sales,[],{month:null,period:{from:'2026-01-01',to:'2026-12-31'}}).houseShareCents,4000);
});
test('manual commission adjustments and their reversals change the economic house result exactly once',()=>{
  const adjustment={id:'adj1',fecha:'2026-10-15',ventaId:'s1',tipo:'ajuste-manual',montoBruto:0,montoComisionSocio:2,montoNetoDueno:-2};
  assert.equal(report(undefined,undefined,{adjustments:[adjustment]}).houseAfterExpensesCents,300);
  assert.equal(report(undefined,undefined,{adjustments:[adjustment,{...adjustment}]}).houseAfterExpensesCents,300);
  assert.equal(report(undefined,undefined,{adjustments:[adjustment,{...adjustment,id:'adj2',montoComisionSocio:-2,montoNetoDueno:2}]}).houseAfterExpensesCents,500);
  const r=report(undefined,undefined,{coverage:{adjustments:false}});assert.equal(r.houseAfterExpensesCents,null);
});
test('a dated return adjustment already represented by the sale reversal is not deducted twice',()=>{
  const v=sale({devuelta:true,fechaDevolucion:'2026-10-16'});
  const a={id:'return1',fecha:'2026-10-16',ventaId:'s1',tipo:'devolucion',montoBruto:-100,montoComisionSocio:-80,montoNetoDueno:-20};
  assert.equal(report([v],[],{adjustments:[a]}).houseAfterExpensesCents,0);
});
test('a retroactive split netted across a later return cannot rewrite a single historical period',()=>{
  const v=sale({fecha:'2026-09-30',devuelta:true,fechaDevolucion:'2026-10-02',comisionAjusteRetroIncluido:true,comisionAsociado:0,netoCasa:100});
  assert.equal(report([v],[]).houseAfterExpensesCents,null);
});
test('daily, monthly and house reports use the same cent rounding and conflict decision',()=>{
  const v=sale({precioUnit:1.005,costoUnit:0,comisionAsociado:0,netoCasa:1.005});
  assert.equal(R.daily([v],'2026-10-15').entra,1.01);
  assert.equal(R.monthly([v],[],'2026-10').netCents,101);
  assert.equal(report([v],[]).netCents,101);
  const other={...v,precioUnit:2,netoCasa:2};
  for(const list of [[v,other],[other,v]]){
   assert.equal(R.daily(list,'2026-10-15').entra,null);
   assert.equal(R.monthly(list,[],'2026-10').netCents,null);
  }
});
