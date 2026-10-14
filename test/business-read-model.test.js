const {test}=require('node:test'),assert=require('node:assert/strict');
const R=require('../docs/core/business-read-model.js');
test('unknown stock stays unknown; a recorded zero is a real zero',()=>{
 for(const v of [undefined,null,'',' ',false,[],NaN,Infinity,-1])assert.equal(R.stock({stockActual:v}).units,null);
 assert.deepEqual(R.stock({stockActual:0}),{known:true,units:0});
 assert.equal(R.stock({stockActual:7}).units,7);
});
test('inventory totals are exact cents and cannot claim completeness when stock/cost is missing',()=>{
 assert.deepEqual(R.inventory([{stockActual:3,costo:1.25},{stockActual:2,costo:2.5}]),{units:5,valueCents:875,unknownStock:0,unknownCost:0});
 const x=R.inventory([{stockActual:3,costo:1.25},{costo:2.5}]);assert.equal(x.units,null);assert.equal(x.valueCents,null);assert.equal(x.unknownStock,1);
 assert.equal(R.inventory([{stockActual:2}]).valueCents,null);
});
test('expiry is a validated calendar date, without UTC shifting a day',()=>{
 assert.equal(R.expiry({perecible:true,fechaCaducidad:'2026-10-14'}),'2026-10-14');
 assert.equal(R.expiry({perecible:true,fechaCaducidad:'2026-02-30'}),null);
 assert.equal(R.expiry({perecible:false,fechaCaducidad:'2026-10-14'}),null);
});

test('business dates keep calendar-only values and boundary movements in the business month',()=>{assert.equal(R.day('2026-10-01','America/Guayaquil'),'2026-10-01');assert.equal(R.day('2026-11-01T02:00:00Z','America/Guayaquil'),'2026-10-31');assert.equal(R.day('2026-02-30','America/Guayaquil'),'');});
test('unknown margins and unsafe inventory totals never claim zero or a reliable value',()=>{assert.equal(R.margin({precio:10,costo:null}),null);assert.equal(R.margin({precio:10,costo:''}),null);assert.equal(R.margin({precio:10,costo:0}),10);assert.equal(R.inventory([{stockActual:Number.MAX_SAFE_INTEGER,costo:0},{stockActual:Number.MAX_SAFE_INTEGER,costo:0}]).units,null);});

test('monthly return reverses its actual period and cost, not the original sale period',()=>{const sale={id:'a',productoId:'p',fecha:'2026-09-30',fechaDevolucion:'2026-10-01',devuelta:true,cantidad:2,precioUnit:10,costoUnit:3};assert.equal(R.monthly([sale],[],'2026-09','America/Guayaquil').netCents,2000);const oct=R.monthly([sale],[{fecha:'2026-10-01',monto:1}],'2026-10','America/Guayaquil');assert.equal(oct.returnedCents,2000);assert.equal(oct.netCents,-2000);assert.equal(oct.costCents,-600);assert.equal(oct.marginLessExpensesCents,-1500);assert.equal(R.monthly([{...sale,fechaDevolucion:null}],[],'2026-10').netCents,null);assert.equal(R.monthly([{...sale,devuelta:false,costoUnit:null}],[],'2026-09').costCents,null);});

test('unclassified inventory purchases cannot be deducted again as operating profit',()=>{const r=R.monthly([{id:'s',fecha:'2026-10-01',cantidad:1,precioUnit:10,costoUnit:3}],[{fecha:'2026-10-01',monto:3,categoria:'inventory'}],'2026-10');assert.equal(r.marginCents,700);assert.equal(r.expensesCents,300);assert.equal(r.inventoryExpenseUnclassified,true);assert.equal(r.marginLessExpensesCents,null);});

test('stabilization: daily unknown cost cannot become profit',()=>{const d=R.daily([{fecha:'2026-10-14',cantidad:1,precioUnit:10}], '2026-10-14','America/Guayaquil');assert.equal(d.entra,10);assert.equal(d.sale,null);assert.equal(d.gananciaHoy,null);});
test('stabilization: invalid expense day is visible and cannot mean zero expenses',()=>{const d=R.monthly([],[{id:'g',fecha:'invalid',monto:25}], '2026-10');assert.equal(d.expensesCents,null);assert.equal(d.undatedExpenses,1);assert.equal(d.unassignedExpenses.length,1);});
test('stabilization: invalid unrelated sales cannot block a different month',()=>{assert.equal(R.monthly([{id:'s',fecha:'2026-09-01',cantidad:1,precioUnit:null}],[],'2026-10').netCents,0);});
test('stabilization: nullable sums and zero quantity preserve missing information',()=>{assert.equal(R.sum([5,null]),null);assert.equal(R.sum([5,-2]),3);assert.equal(R.quantity(0),null);assert.equal(R.quantity(2),2);});

test('audit: daily returns reverse their recorded day and preserve the original sale day',()=>{const v={id:'s',fecha:'2026-10-13',fechaDevolucion:'2026-10-14',devuelta:true,cantidad:2,precioUnit:10,costoUnit:3};assert.equal(R.daily([v],'2026-10-13').entra,20);assert.equal(R.daily([v],'2026-10-14').entra,-20);assert.equal(R.daily([v],'2026-10-14').gananciaHoy,-14);assert.equal(R.daily([{...v,fecha:'2026-10-14'}],'2026-10-14').entra,0);});
test('audit: daily duplicate IDs do not duplicate money',()=>{const v={id:'s',fecha:'2026-10-14',cantidad:1,precioUnit:10,costoUnit:3};assert.equal(R.daily([v,v],'2026-10-14').entra,10);});
