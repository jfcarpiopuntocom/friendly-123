'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const src=fs.readFileSync(path.join(__dirname,'../src/app/app-inline-01.js'),'utf8');
const core=require('../docs/core/commission-history.js');
const sales=[
{id:'oct',fechaLocal:'2026-10-12',productoId:'p',productoNombre:'Libro',ubicacionId:'r',ubicacionNombre:'Galería',clienteNombre:'Ana',asociadoNombre:'Belén',cantidad:1,precioUnit:100,comisionAsociado:20},
{id:'nov',fechaLocal:'2026-11-12',productoId:'p',productoNombre:'Libro',ubicacionId:'r',ubicacionNombre:'Galería',clienteNombre:'Luis',asociadoNombre:'Belén',cantidad:1,precioUnit:50,comisionAsociado:10}];
function presenter(group){
 const a=src.indexOf('function resumenComisionesGlobalHtml('),b=src.indexOf('async function cargarComisiones(){',a);
 assert.ok(a>0&&b>a,'compact presenter exists');
 const ctx={window:{OCCommissionHistory:core,_ocComHistoryGroup:group},document:{documentElement:{lang:'en'}},escHtml:s=>String(s),fmtMoney:v=>'$'+v.toFixed(2)};
 vm.runInNewContext(src.slice(a,b)+';this.present=resumenComisionesGlobalHtml;',ctx);
 return ctx.present;
}
test('C182 default product view across ALL months, compact original cards',()=>{
 const html=presenter('producto')(sales);
 assert.match(html,/data-commissions-summary="all"/);
 assert.match(html,/data-commissions-current-view="producto"/);
 assert.match(html,/Libro/);
 assert.match(html,/\$150\.00/);
 assert.match(html,/\$30\.00/);
 assert.doesNotMatch(html,/Full sales and commissions history|Read-only view across dates|Settle month/);
});
test('C182 only five view tabs; NO date inputs or forced month in any view',()=>{
 const a=src.indexOf('function selectorRangoComisionesGlobalHtml(){'),b=src.indexOf('function selectorMesComisionesHtml(',a);
 assert.ok(a>0&&b>a);
 const ctx={window:{_ocComHistoryGroup:'producto'},document:{documentElement:{lang:'en'}}};
 vm.runInNewContext(src.slice(a,b)+';this.toolbar=selectorRangoComisionesGlobalHtml;',ctx);
 let html=ctx.toolbar();
 for(const group of ['producto','percha','cliente','comisionista','mes'])
  assert.match(html,new RegExp('data-commissions-view-global="'+group+'"'),group);
 assert.doesNotMatch(html,/type="month"|type="date"|Settle month/);
 ctx.window._ocComHistoryGroup='mes';html=ctx.toolbar();
 assert.doesNotMatch(html,/type="date"|type="month"|data-commissions-open-month/);
 assert.equal((html.match(/data-commissions-view-global=/g)||[]).length,5,'period is a view switch, not a form');
});
test('C182 no verbose history render, no settlement ledger read in all-history route',()=>{
 const a=src.indexOf('async function cargarComisiones(){'),b=src.indexOf('  let filas, ranking, ventasTodas, meses, cuadreMes;',a);
 const section=src.slice(a,b);assert.ok(a>0&&b>a);
 assert.match(section,/resumenComisionesGlobalHtml\(sales\)/);
 assert.doesNotMatch(section,/OCCommissionHistory\.render\(|liquidaciones\/meses/);
});
test('C182 show unknown commission without inventing zero; client and associate grouping remain real',()=>{
 const html=presenter('cliente')([...sales,{id:'uncertain',fechaLocal:'2026-11-13',productoNombre:'Print',clienteNombre:'Ana',cantidad:1,precioUnit:12}]);
 assert.match(html,/Needs review/);assert.match(html,/Ana/);assert.match(html,/Luis/);
 assert.match(presenter('comisionista')(sales),/Belén/);
 assert.match(presenter('mes')(sales),/2026-10/);
 assert.match(presenter('mes')(sales),/2026-11/);
});
test('C182 period cards open only an explicitly selected month, without an imposed month cut',()=>{
 const html=presenter('mes')(sales);
 assert.match(html,/2026-10/);assert.match(html,/2026-11/);
 assert.match(html,/data-commissions-open-month="2026-10"/);
 assert.match(html,/data-commissions-open-month="2026-11"/);
 assert.match(html,/cambiarMesComisiones\(this\.dataset\.commissionsOpenMonth\)/);
 assert.doesNotMatch(html,/type="date"/);
});
test('C182 product cards expand their receipt breakdown without a forced calendar filter',()=>{
 const html=presenter('producto')(sales);
 assert.match(html,/<details data-comm-history-group/);
 assert.match(html,/<summary[^>]*>/);
 assert.match(html,/class="stats"/);
 assert.match(html,/2026-10-12/);
 assert.match(html,/2026-11-12/);
 assert.doesNotMatch(html,/type="date"|type="month"/);
});
