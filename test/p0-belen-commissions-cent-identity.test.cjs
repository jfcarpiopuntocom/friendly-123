'use strict';
// C141: test the actual shared Commissions projection, not a mock of a renderer.
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const report=require('../docs/core/commission-history.js');
const accounting=require('../docs/core/business-read-model.js');
const sale=(id,price,comm,extra={})=>({
 id,fecha:'2026-11-21T16:00:00Z',productoId:'book',productoNombre:'Libro',
 ubicacionId:'rack',ubicacionNombre:'Estante',promotoraId:'a1',asociadoNombre:'Belén',
 cantidad:1,precioUnit:price,comisionAsociado:comm,...extra
});
test('C141: monetary totals and grouped amounts sum in integer cents, not binary float',()=>{
 const sales=[sale('one',140.4,0.1),sale('two',0.03,0.2),sale('three',0,0.3)];
 const x=report.project({sales,group:'producto',lang:'es'});
 assert.equal(x.totals.grossCents,14043);
 assert.equal(x.totals.commissionCents,60);
 assert.equal(x.totals.gross,140.43);
 assert.equal(x.totals.commission,0.6);
 assert.equal(x.groups[0].grossCents,14043);
 assert.equal(x.groups[0].commissionCents,60);
 assert.equal(x.groups[0].gross,140.43);
 assert.equal(x.rows.reduce((sum,r)=>sum+Math.round(r.gross*100),0),14043);
 for(const s of sales)assert.equal(Math.round(s.precioUnit*100),accounting.saleAmounts(s).amountCents);
});
test('C141: replayed receipts with same sale id cannot double the count, stock-derived gross or commissions',()=>{
 const v=sale('op-123',12.34,2.47), sales=[v,JSON.parse(JSON.stringify(v))];
 const x=report.project({sales,lang:'es'});
 assert.equal(x.totals.count,1);assert.equal(x.totals.duplicates,1);
 assert.equal(x.totals.grossCents,1234);assert.equal(x.totals.commissionCents,247);
 assert.equal(x.rows.length,1);
 assert.equal(sales.length,2,'read-only projection never deletes or mutates the originals');
 assert.equal(sales[0].id,sales[1].id);
});
test('C141: conflicting copies of same sale id fail visibly without arbitrarily choosing an economic value',()=>{
 const a=sale('same',12,2),b=sale('same',99,10);
 const x=report.project({sales:[a,b],lang:'es'});
 assert.equal(x.totals.conflicts,1);
 assert.equal(x.totals.count,0);
 assert.equal(x.totals.unknownGross,1);assert.equal(x.totals.unknownCommission,1);
 const html=report.render({sales:[a,b],lang:'es'});
 assert.match(html,/role="alert"/);
 assert.match(html,/Por verificar/);
 assert.deepEqual([a.precioUnit,b.precioUnit],[12,99]);
});
test('C141: date-only local calendar dates and optional From/To filters respect Ecuador business day',()=>{
 const a=sale('local-date',1,0,{fecha:'2026-11-21',fechaLocal:'2026-11-21'});
 const b=sale('utc-midnight',2,0,{fecha:'2026-11-21T00:15:00Z'}); // Ecuador Nov 20
 const selected=report.project({sales:[a,b],from:'2026-11-21',to:'2026-11-21',lang:'es'});
 assert.equal(selected.totals.count,1);assert.equal(selected.rows[0].id,'local-date');
 assert.equal(report.day('2026-11-21','America/Guayaquil'),'2026-11-21');
 assert.equal(report.day('2026-11-21T00:15:00Z','America/Guayaquil'),'2026-11-20');
});
test('C141: split commission groups preserve the same cents as frozen sale amount',()=>{
 const s=sale('split',25,0.3,{reparto:[{promotoraId:'a1',monto:0.1},{promotoraId:'a2',monto:0.2}],
   asociadoNombre:'Belén',asistenteNombre:'Lucía'});
 const x=report.project({sales:[s],group:'comisionista',lang:'es'});
 assert.equal(x.totals.commissionCents,30);
 assert.equal(x.groups.reduce((sum,g)=>sum+g.commissionCents,0),30);
 assert.equal(x.totals.count,1);
 assert.equal(x.groups.length,2);
});
test('C141: both the app Commissions and Dashboard Commissions still use the same read-only model',()=>{
 const src=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
 const a=src('src/app/app-inline-01.js'),d=src('src/dashboard/dashboard-main.js');
 const shell=src('docs/index.html'),dash=src('docs/dashboard.html');
 assert.match(a,/OCCommissionHistory\.render/);
 assert.match(d,/OCCommissionHistory\.render/);
 assert.match(shell,/core\/commission-history\.js/);
 assert.match(dash,/core\/commission-history\.js/);
 assert.match(report.render({sales:[sale('one',10,1)],lang:'es'}),/Historial completo/);
});
