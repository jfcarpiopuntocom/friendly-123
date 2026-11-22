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
 assert.match(app,/const report=resumenComisionesGlobalHtml\(sales\)/);
 assert.match(app,/Todo el historial/);
 assert.match(app,/function cambiarRangoComisionesGlobal\(/);
 assert.match(app,/window\._ocComHistoryGroup/);
 assert.match(dash,/if \(cmMes === null\) \{ pintarComisionesTodas\(\); return; \}/);
 assert.match(dash,/OCCommissionHistory\.render\(\{sales:datos\.ventas/);
 assert.match(dash,/var cmDesde = "", cmHasta = "", cmGrupo = "total"/);
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

test('C141 RED: real-money projections add integer cents, never binary floats',()=>{
 const x=report.project({sales:[
  {id:'fraction-A',fecha:'2026-11-21T10:00:00Z',productoId:'p',productoNombre:'Café',cantidad:1,precioUnit:0.1,comisionAsociado:0.1},
  {id:'fraction-B',fecha:'2026-11-21T11:00:00Z',productoId:'p',productoNombre:'Café',cantidad:1,precioUnit:0.2,comisionAsociado:0.2},
  {id:'round-C',fecha:'2026-11-21T12:00:00Z',productoId:'p',productoNombre:'Café',cantidad:1,precioUnit:0.105,comisionAsociado:0.105}
 ],group:'producto',lang:'es'});
 assert.equal(x.totals.gross,0.41,'0.10 + 0.20 + rounded 0.105 = 0.41');
 assert.equal(x.totals.commission,0.41);
 assert.equal(x.groups[0].gross,0.41);
 assert.equal(x.groups[0].commission,0.41);
 assert.equal(x.totals.unknownGross,0);
});
test('C141 RED: duplicate committed receipt id cannot count sales or payees twice',()=>{
 const first={id:'sale-one-opId',fecha:'2026-11-21T10:00:00Z',productoId:'p',productoNombre:'Print',cantidad:1,precioUnit:35,
   comisionAsociado:12,asociadoNombre:'Belén',asistenteNombre:'Lucía',
   reparto:[{promotoraId:'belen',monto:8},{promotoraId:'lucia',monto:4}]};
 const x=report.project({sales:[first,{...first}, {id:'sale-two',fecha:'2026-11-21T11:00:00Z',
  productoId:'p',productoNombre:'Print',cantidad:1,precioUnit:5,comisionAsociado:1}],group:'comisionista',lang:'es'});
 assert.equal(x.totals.count,2,'same sale id returned twice by sync is one economic receipt');
 assert.equal(x.totals.gross,40);
 assert.equal(x.totals.commission,13);
 assert.equal(x.groups.find(v=>v.label==='Belén').commission,8);
 assert.equal(x.groups.find(v=>v.label==='Lucía').commission,4);
 assert.equal(x.rows.filter(v=>v.id==='sale-one-opId').length,2,'one row per genuine payee, not per duplicate receipt');
});
test('C141 RED: anonymous distinct receipts stay distinct and unsafe cent values stay unverified',()=>{
 const x=report.project({sales:[
  {fecha:'2026-11-21T10:00:00Z',productoNombre:'Anon',cantidad:1,precioUnit:2,comisionAsociado:0},
  {fecha:'2026-11-21T11:00:00Z',productoNombre:'Anon',cantidad:1,precioUnit:3,comisionAsociado:0},
  {id:'overflow',fecha:'2026-11-21T12:00:00Z',productoNombre:'Anon',cantidad:1,precioUnit:Number.MAX_SAFE_INTEGER,comisionAsociado:0}
 ]});
 assert.equal(x.totals.count,3);
 assert.equal(x.totals.gross,5);
 assert.equal(x.totals.unknownGross,1,'unsafe money never becomes invented amount');
});
