'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const report=require('../docs/core/commission-history.js');
function sale(id,price,overrides={}){
 return {id,fecha:'2026-11-21',productoId:'p1',ubicacionId:'rack',
  cantidad:1,precioUnit:price,comisionAsociado:2,productoNombre:'Libro',
  ...overrides};
}
test('C142: identical replayed sale receipts remain one read-only economic event',()=>{
 const v=sale('id-1',30);
 const x=report.project({sales:[v,{...v}],lang:'es'});
 assert.equal(x.totals.count,1);
 assert.equal(x.totals.gross,30);
 assert.equal(x.totals.commission,2);
 assert.equal(x.totals.conflicts,0);
});
test('C142: different prices under the same id are ambiguous; never pick arbitrary first copy',()=>{
 const a=sale('id-1',10),b=sale('id-1',99);
 const before=JSON.stringify([a,b]);
 for(const sales of [[a,b],[b,a]]){
  const x=report.project({sales,lang:'es'});
  assert.equal(x.totals.conflicts,1);
  assert.equal(x.totals.count,0);
  assert.equal(x.totals.unknownGross,1);
  assert.equal(x.totals.unknownCommission,1);
  assert.match(report.render({sales,lang:'es'}),/role="alert"/);
  assert.match(report.render({sales,lang:'es'}),/Por verificar/);
 }
 assert.equal(JSON.stringify([a,b]),before,'the original economic record is immutable');
});
test('C142: split payout disagreement is a conflict, not the first payload observed',()=>{
 const a=sale('split',80,{reparto:[{promotoraId:'seller',monto:1},{promotoraId:'assistant',monto:1}]});
 const b=sale('split',80,{reparto:[{promotoraId:'seller',monto:0.5},{promotoraId:'assistant',monto:1.5}]});
 const x=report.project({sales:[a,b],group:'comisionista',lang:'es'});
 assert.equal(x.totals.conflicts,1);
 assert.equal(x.totals.count,0);
 assert.equal(x.groups.length,0);
});
test('C142: explicit cancellation duplicates are counted once',()=>{
 const v=sale('void',12,{anulada:true});
 const x=report.project({sales:[v,{...v}],lang:'es'});
 assert.equal(x.totals.count,0);assert.equal(x.totals.cancelled,1);
 assert.equal(x.totals.conflicts,0);
});
test('C142: business-calendar-only date does not shift to previous day in Ecuador',()=>{
 assert.equal(report.day('2026-11-21','America/Guayaquil'),'2026-11-21');
 assert.equal(report.day('2026-11-21T00:15:00Z','America/Guayaquil'),'2026-11-20');
 const v=sale('dateonly',3,{fecha:'2026-11-21',fechaLocal:'2026-11-21'});
 const before=report.project({sales:[v],from:'2026-11-21',to:'2026-11-21'});
 assert.equal(before.totals.count,1);assert.equal(before.rows[0].day,'2026-11-21');
 const empty=report.project({sales:[v],from:'2026-11-20',to:'2026-11-20'});
 assert.equal(empty.totals.count,0);
});
test('C142: conflict warning scoped to selected range, anonymous distinct sales stay independent',()=>{
 const a=sale('conflict',12,{fecha:'2026-09-15'}),b=sale('conflict',14,{fecha:'2026-09-15'});
 const nov=sale('nov',20,{fecha:'2026-11-21'});
 const novReport=report.project({sales:[a,b,nov],from:'2026-11-01',to:'2026-11-30'});
 assert.equal(novReport.totals.count,1);assert.equal(novReport.totals.conflicts,0);
 const x=report.project({sales:[sale(null,1),sale(null,2)]});
 assert.equal(x.totals.count,2);assert.equal(x.totals.gross,3);
});
test('C142: app and dashboard share this projector and monthly payments remain separate',()=>{
 const root=path.join(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
 assert.match(read('src/app/app-inline-01.js'),/OCCommissionHistory\.render/);
 assert.match(read('src/dashboard/dashboard-main.js'),/OCCommissionHistory\.render/);
 assert.match(read('docs/index.html'),/core\/commission-history\.js/);
 assert.match(read('docs/dashboard.html'),/core\/commission-history\.js/);
 assert.match(read('docs/core/commission-history.js'),/if\(receiptId&&conflictingIds\.has\(receiptId\)\)/);
});
