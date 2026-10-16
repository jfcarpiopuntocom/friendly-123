'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const LG=require('../docs/core/ledger.js');
const PL=require('../docs/core/payout-ledger.js');
const locations=[{id:'rack',promotoraId:'synthetic-person'}];
const sale=(id,extra={})=>({id,productoId:'synthetic-product',ubicacionId:'rack',fecha:'2026-09-10',cantidad:1,precioUnit:100,direccionComision:'asociadoPaga',split:{montoComisionSocio:40,montoNetoDueno:60},...extra});
const payment={id:'synthetic-payment',opId:'synthetic-payment',status:'paid',payeeId:'synthetic-person',amountCents:1000,items:[{kind:'sale',sourceId:'associate',payeeId:'synthetic-person',amountCents:1000}]};
function sheet(sales,payouts=[]){return LG.productSheet({sales,payouts,productId:'synthetic-product',ledger:LG.buildLedger({ventas:sales,payouts,ubicaciones:locations})});}

test('product statement preserves associate earnings and only offers unpaid house-collected sales',()=>{
 const sales=[sale('associate'),sale('house',{direccionComision:'casaPaga'})];
 const s=sheet(sales);
 assert.equal(s.totals.earnedCents,8000);
 assert.equal(s.totals.dueCents,4000);
 assert.deepEqual(s.people[0].bySale.map(v=>[v.saleId,v.dueCents]),[['associate',0],['house',4000]]);
});
test('direction review preserves actual partial money and its reversal',()=>{
 const sales=[sale('associate')],s=sheet(sales,[payment]);
 assert.equal(s.totals.earnedCents,4000);assert.equal(s.totals.paidCents,1000);assert.equal(s.totals.dueCents,0);assert.equal(s.needsReview,true);
 const reversed=sheet(sales,[payment,{...payment,id:'synthetic-reversal',opId:'synthetic-reversal',reversalOf:payment.id}]);
 assert.equal(reversed.totals.paidCents,0);assert.equal(reversed.totals.dueCents,0);assert.equal(reversed.needsReview,false);
});
test('associate paid cancellation retains recovery across months and backwards-compatible payout items',()=>{
 const sales=[sale('associate',{anulada:true,anuladaEn:'2026-10-01'}),sale('house',{fecha:'2026-10-02',direccionComision:'casaPaga'})];
 const plan=PL.planPayout({sales,locations,payouts:[payment],month:'2026-10',payeeId:'synthetic-person',id:'synthetic-next',opId:'synthetic-next'}).payout;
 assert.equal(sheet(sales,[payment]).totals.dueCents,3000);
 for(const payouts of [[payment,plan],PL.compatiblePayouts([payment,plan])]){
  assert.equal(sheet(sales,payouts).totals.dueCents,0);
  const reversal={...plan,id:'synthetic-next-reversed',opId:'synthetic-next-reversed',reversalOf:plan.id};
  assert.equal(sheet(sales,payouts.concat(reversal)).totals.dueCents,3000);
 }
});
test('returned associate-collected sales keep zero house payable and paid history for review',()=>{
 const s=sheet([sale('associate',{devuelta:true,fechaDevolucion:'2026-10-01'})],[payment]);
 assert.equal(s.totals.earnedCents,0);assert.equal(s.totals.paidCents,1000);assert.equal(s.totals.dueCents,0);assert.equal(s.needsReview,true);
});
