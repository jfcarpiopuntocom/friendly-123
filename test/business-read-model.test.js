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
