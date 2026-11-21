'use strict';
// Belén 1AAA 2026-11-21. Pure read-only full-history report in BOTH interfaces.
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..');
const src=p=>fs.readFileSync(path.join(root,p),'utf8');
const report=require('../docs/core/commission-history.js');
const sales=[
 {id:'sep',fecha:'2026-09-12T15:00:00Z',mes:'2026-09',productoId:'book',productoNombre:'Libro',ubicacionId:'rack1',ubicacionNombre:'Estante',
  clienteId:'c1',clienteNombre:'María',promotoraId:'a1',asociadoNombre:'Belén',cantidad:2,precioUnit:40,comisionAsociado:16},
 {id:'nov',fecha:'2026-11-04T15:00:00Z',mes:'2026-11',productoId:'book',productoNombre:'Libro',ubicacionId:'rack1',ubicacionNombre:'Estante',
  clienteId:'c2',clienteNombre:'Ana',promotoraId:'a1',asociadoNombre:'Belén',cantidad:1,precioUnit:50,comisionAsociado:10},
 {id:'nov-own',fecha:'2026-11-05T15:00:00Z',mes:'2026-11',productoId:'gift',productoNombre:'Regalo',ubicacionId:'rack2',ubicacionNombre:'Casa',
  clienteNombre:'Ana',cantidad:1,precioUnit:5,noCommission:true},
 {id:'void',fecha:'2026-10-12T15:00:00Z',mes:'2026-10',productoId:'book',cantidad:1,precioUnit:999,comisionAsociado:200,anulada:true}
];
test('C136 1AAA: default across September and November; no forced month, correct totals and cancelled exclusion',()=>{
 const x=report.project({sales,lang:'es',group:'producto',zone:'America/Guayaquil'});
 assert.equal(x.totals.count,3);
 assert.equal(x.totals.cancelled,1);
 assert.equal(x.totals.gross,135);
 assert.equal(x.totals.commission,26);
 assert.equal(x.groups.length,2);
 const book=x.groups.find(g=>g.label==='Libro');
 assert.equal(book.count,2);assert.equal(book.gross,130);assert.equal(book.commission,26);
 assert.match(report.render({sales,lang:'es'}),/Historial completo/);
 assert.match(report.render({sales,lang:'es'}),/\$135[,.]00/);
});
test('C136: inclusive from/to works across years, plus optional customer, rack, associate and month grouping',()=>{
 const input={sales,from:'2026-11-01',to:'2026-11-30',lang:'es'};
 for(const group of ['producto','percha','cliente','comisionista','mes']){
   const x=report.project({...input,group});
   assert.equal(x.totals.count,2);
   assert.equal(x.totals.gross,55);
   assert.ok(x.groups.length>=1);
 }
 const sep=report.project({sales,from:'2026-09-12',to:'2026-09-12'});
 assert.equal(sep.totals.count,1,'both endpoints inclusive on a business-local date');
 assert.equal(sep.rows[0].id,'sep');
 const none=report.project({sales,from:'2026-10-01',to:'2026-10-30'});
 assert.equal(none.totals.count,0,'cancelled receipts cannot invent sales');
});
test('C136: incomplete money stays explicitly unverified instead of a fabricated $0',()=>{
 const missing=[{id:'m',fecha:'2026-11-21T10:00:00Z',productoNombre:'Crédito',cantidad:1,precioUnit:20}];
 const x=report.project({sales:missing,lang:'es'});
 assert.equal(x.totals.unknownCommission,1);
 assert.match(report.render({sales:missing,lang:'es'}),/Por verificar/);
});
test('C136: both published pages load same verified projection and default to all dates',()=>{
 const app=src('src/app/app-inline-01.js'),dash=src('src/dashboard/dashboard-main.js');
 const appHtml=src('docs/index.html'),dashHtml=src('docs/dashboard.html');
 for(const html of [appHtml,dashHtml])assert.match(html,/core\/commission-history\.js/);
 assert.ok(app.indexOf('if (!_ocMesComisiones) {')>app.indexOf('async function cargarComisiones()'),
  'app must use all-period read-only branch before settlement reads');
 assert.match(app,/OCCommissionHistory\.render\(\{sales:sales/);
 assert.match(app,/Todo el historial/);
 assert.match(app,/function cambiarRangoComisionesGlobal\(/);
 assert.match(app,/window\._ocComHistoryGroup/);
 assert.match(dash,/if \(cmMes === null\) \{ pintarComisionesTodas\(\); return; \}/);
 assert.match(dash,/OCCommissionHistory\.render\(\{sales:datos\.ventas/);
 assert.match(dash,/var cmDesde = "", cmHasta = "", cmGrupo = "producto"/);
 // Keep actual settlement writes period-scoped, with original backend API intact.
 assert.match(app,/fetch\(\x60\$\{API\}\/liquidaciones\?mes=\$\{encodeURIComponent\(_mesSolicitud \|\| ""\)\}\x60\)/);
 assert.match(dash,/&mes=' \+ encodeURIComponent\(cmMes \|\| actual\)/);
});

test('C136: split commissions are attributed once to each real associate, never duplicated',()=>{
 const split=[{id:'split-1',fecha:'2026-11-17T11:00:00Z',productoNombre:'Print',cantidad:1,precioUnit:100,
   comisionAsociado:30,asociadoNombre:'Belén',asistenteNombre:'Lucía',
   reparto:[{promotoraId:'belen',monto:20},{promotoraId:'lucia',monto:10}]}];
 const x=report.project({sales:split,group:'comisionista',lang:'es'});
 assert.equal(x.totals.count,1);
 assert.equal(x.totals.gross,100);
 assert.equal(x.totals.commission,30);
 assert.equal(x.groups.length,2);
 assert.equal(x.groups.find(v=>v.label==='Belén').commission,20);
 assert.equal(x.groups.find(v=>v.label==='Lucía').commission,10);
 assert.doesNotMatch(report.render({sales:split,group:'comisionista',lang:'es'}),/Ventas brutas: \$100/,'no per-associate duplicate gross');
});
