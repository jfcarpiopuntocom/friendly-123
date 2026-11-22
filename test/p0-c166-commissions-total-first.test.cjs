'use strict';
// C166: All-period commission totals first; grouping only by explicit choice, in BOTH UIs.
// Read-only projector. These checks do not alter any payment or inventory operation.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
const report=require('../docs/core/commission-history.js');
const sales=[
 {id:'sep',fechaLocal:'2026-09-12',productoId:'p1',productoNombre:'Libro',clienteId:'c1',clienteNombre:'Ana',promotoraId:'a1',asociadoNombre:'Belén',cantidad:1,precioUnit:80,comisionAsociado:20},
 {id:'nov',fechaLocal:'2026-11-13',productoId:'p2',productoNombre:'Arte',clienteId:'c2',clienteNombre:'Luis',promotoraId:'a2',asociadoNombre:'Lucía',cantidad:2,precioUnit:30,comisionAsociado:15},
 {id:'void',fechaLocal:'2026-10-13',productoId:'p3',cantidad:1,precioUnit:99,comisionAsociado:50,anulada:true}
];
test('C166 RED: default total spans months, counts each valid commission exactly once, no breakdown',()=>{
 const view=report.project({sales,lang:'es'});
 assert.equal(view.group,'total');
 assert.equal(view.totals.count,2);
 assert.equal(view.totals.cancelled,1);
 assert.equal(view.totals.commission,35);
 assert.equal(view.totals.gross,140);
 assert.equal(view.groups.length,1,'single global total before user chooses a breakdown');
 const html=report.render({sales,lang:'es'});
 assert.match(html,/Comisiones registradas/);
 assert.match(html,/\$35[,.]00/);
 assert.doesNotMatch(html,/data-comm-history-group/,'initial screen shows TOTAL, not rows of grouped commissions');
});
test('C166: grouping remains optional by month, product, client and associate',()=>{
 for(const [group,expected] of [['mes',2],['producto',2],['cliente',2],['comisionista',2]]){
   const v=report.project({sales,group,lang:'es'});
   assert.equal(v.groups.length,expected,group);
   assert.equal(v.totals.commission,35,group);
   assert.match(report.render({sales,group,lang:'es'}),/data-comm-history-group/);
 }
 const nov=report.project({sales,from:'2026-11-01',to:'2026-11-30',lang:'es'});
 assert.equal(nov.group,'total');assert.equal(nov.totals.commission,15);
});
test('C166: the primary app AND dashboard explicitly default to total, not product or a calendar month',()=>{
 const app=read('src/app/app-inline-01.js');
 const dash=read('src/dashboard/dashboard-main.js');
 assert.match(app,/\["total","producto","percha","cliente","comisionista","mes"\]/);
 assert.match(app,/_ocComHistoryGroup\|\|"total"/);
 assert.match(app,/\["total",es\?"Total general"/);
 assert.match(dash,/cmGrupo = "total"/);
 assert.match(dash,/\["total",es\?"Total general"/);
 assert.match(app,/_ocMesComisiones = null/);
 assert.match(dash,/cmMes = null/);
});
