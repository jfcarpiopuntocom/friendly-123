'use strict';
// C166 Belén P0: Commissions MUST open with a grand total, grouping opt-in.
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
const report=require('../docs/core/commission-history.js');
const sales=[
 {id:'s1',fechaLocal:'2026-09-12',productoId:'a',productoNombre:'Libro',clienteNombre:'Ana',promotoraId:'b',asociadoNombre:'Belén',cantidad:2,precioUnit:40,comisionAsociado:16},
 {id:'s2',fechaLocal:'2026-11-04',productoId:'b',productoNombre:'Café',clienteNombre:'Luis',promotoraId:'b',asociadoNombre:'Belén',cantidad:1,precioUnit:50,comisionAsociado:10},
 {id:'void',fechaLocal:'2026-10-04',productoId:'b',cantidad:1,precioUnit:999,comisionAsociado:999,anulada:true}
];
test('C166 RED: default shows a single TOTAL of all commissions without product/month breakdown',()=>{
 const v=report.project({sales,lang:'es'});
 assert.equal(v.group,'total');
 assert.equal(v.totals.count,2);
 assert.equal(v.totals.gross,130);
 assert.equal(v.totals.commission,26);
 assert.equal(v.totals.cancelled,1);
 assert.equal(v.groups.length,0);
 assert.equal(v.rows.length,2,'CSV still retains sales rows');
 const html=report.render({sales,lang:'es'});
 assert.match(html,/Total de comisiones/);
 assert.doesNotMatch(html,/data-comm-history-group/);
 assert.doesNotMatch(html,/<h4[^>]*>Producto/);
});
test('C166: breakdown is optional by mes/producto/cliente/comisionista and totals never change',()=>{
 for(const group of ['mes','producto','cliente','comisionista']){
  const v=report.project({sales,lang:'es',group});
  assert.equal(v.totals.commission,26);
  assert.equal(v.totals.gross,130);
  assert.equal(v.totals.count,2);
  assert.ok(v.groups.length>0,'group '+group+' returns a real breakdown');
  assert.match(report.render({sales,lang:'es',group}),/data-comm-history-group/);
 }
});
test('C166: total and any grouped view honor optional dates; both UIs default to total',()=>{
 const v=report.project({sales,from:'2026-11-01',to:'2026-11-30'});
 assert.equal(v.group,'total');
 assert.equal(v.totals.commission,10);
 assert.equal(v.totals.count,1);
 const app=read('src/app/app-inline-01.js'),dash=read('src/dashboard/dashboard-main.js');
 assert.match(app,/window\._ocComHistoryGroup\|\|"total"/);
 assert.match(dash,/var cmDesde = "", cmHasta = "", cmGrupo = "total"/);
 assert.match(app,/\["total",es\?"Total general":"Grand total"\]/);
 assert.match(dash,/\["total",es\?"Total general":"Grand total"\]/);
 assert.match(app,/if \(!_ocMesComisiones\)/);
 assert.match(dash,/if \(cmMes === null\)/);
});
