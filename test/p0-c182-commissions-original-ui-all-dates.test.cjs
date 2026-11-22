'use strict';
// C182 JFC: original Commissions card visual, no date limit on overall view.
// Real shared projector, no mutations of ledger/payment, 5 explicit view switches.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../src/app/app-inline-01.js'),'utf8');
const history=require('../docs/core/commission-history.js');
const sales=[
 {id:'sep',fechaLocal:'2026-09-12',mes:'2026-09',productoId:'p1',productoNombre:'Book',ubicacionId:'r1',ubicacionNombre:'Rack',clienteId:'c1',clienteNombre:'Ana',promotoraId:'a1',asociadoNombre:'Belén',cantidad:1,precioUnit:80,comisionAsociado:20},
 {id:'nov',fechaLocal:'2026-11-13',mes:'2026-11',productoId:'p1',productoNombre:'Book',ubicacionId:'r1',ubicacionNombre:'Rack',clienteId:'c2',clienteNombre:'Luis',promotoraId:'a2',asociadoNombre:'Lucía',cantidad:2,precioUnit:30,comisionAsociado:15}
];
function present(sales,group='producto',lang='en'){
 const start=source.indexOf('function resumenComisionesGlobalHtml(');
 const end=source.indexOf('async function cargarComisiones(){',start);
 assert.ok(start>=0&&end>start);
 const ctx={window:{OCCommissionHistory:history,_ocComHistoryGroup:group},
 document:{documentElement:{lang}},escHtml:v=>String(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'),
 fmtMoney:v=>'$'+Number(v).toFixed(2)};
 vm.runInNewContext(source.slice(start,end)+';this.present=resumenComisionesGlobalHtml;',ctx);
 return ctx.present(sales);
}
test('C182 original product cards with existing tag-card/stats/rotulo/cifra, across ALL months',()=>{
 const html=present(sales);
 const view=history.project({sales,group:'producto',lang:'en'});
 assert.equal(view.totals.gross,140);
 assert.equal(view.totals.commission,35);
 assert.match(html,/data-comm-history-group/);
 assert.match(html,/data-comm-product-card/);
 assert.match(html,/class="tag-card"/);
 assert.match(html,/class="stats"/);
 assert.match(html,/class="rotulo"/);
 assert.match(html,/class="cifra"/);
 assert.match(html,/Book/);
 assert.match(html,/\$140\.00/);
 assert.match(html,/\$35\.00/);
 assert.doesNotMatch(html,/Full sales and commissions history|Read-only view across dates|Settle month/);
 assert.doesNotMatch(html,/data-month-pay|data-comm-pay-from-product|onclick="marcarComisionPagada/);
});
test('C182 grouped views preserve all dates, same old cards for customer/associate/period/rack',()=>{
 for(const group of ['producto','cliente','comisionista','mes','percha']){
  const view=history.project({sales,group,lang:'es'});
  assert.equal(view.totals.count,2);
  assert.equal(view.totals.gross,140);
  assert.equal(view.totals.commission,35);
  const html=present(sales,group,'es');
  assert.match(html,/data-comm-history-group/);
  assert.match(html,/class="stats"/);
  assert.doesNotMatch(html,/Historial completo de ventas y comisiones|Vista de consulta de todas las fechas/);
 }
});
test('C182 no false zero for unknown amounts',()=>{
 const html=present([{id:'uncertain',fechaLocal:'2026-11-01',productoId:'u',productoNombre:'Gift',cantidad:1,precioUnit:15}], 'producto','es');
 assert.match(html,/Por verificar/);
 assert.doesNotMatch(html,/<div class="cifra">\$0\.00<\/div>/);
});
test('C182 5 view switches, never mandatory month or date filter',()=>{
 const start=source.indexOf('function selectorRangoComisionesGlobalHtml(){');
 const end=source.indexOf('function selectorMesComisionesHtml(',start);
 assert.ok(start>=0&&end>start);
 const ctx={window:{_ocComHistoryGroup:'producto'},document:{documentElement:{lang:'en'}}};
 vm.runInNewContext(source.slice(start,end)+';this.render=selectorRangoComisionesGlobalHtml;',ctx);
 for(const view of ['producto','percha','cliente','comisionista','mes']){
  const html=ctx.render();
  assert.match(html,new RegExp('data-commissions-view-global="'+view+'"'));
  assert.equal((html.match(/data-commissions-view-global=/g)||[]).length,5);
  assert.doesNotMatch(html,/type="month"|type="date"|Settle month/);
  ctx.window._ocComHistoryGroup=view;
 }
});
test('C182 sales history single fetch, no opening the monthly settlement ledger',async()=>{
 const start=source.indexOf('async function cargarComisiones(){');
 const end=source.indexOf('  let filas, ranking, ventasTodas, meses, cuadreMes;',start);
 assert.ok(start>=0&&end>start);
 const calls=[],container={innerHTML:''};
 const ctx={document:{documentElement:{lang:'en'},getElementById(){return container;}},
 window:{OCCommissionHistory:history,_ocComHistoryGroup:'producto'},_ocComisionesSolicitud:0,_ocMesComisiones:null,API:'/api',
 renderGestionPromotoras(){},t(){return 'Retry';},
 resumenComisionesGlobalHtml:rows=>present(rows),
 barraComisionesHtml(){return '<div data-commissions-toolbar></div>';},
 fetch(url){calls.push(url);if(url.includes('/ventas/todas'))return Promise.resolve({ok:true,json:async()=>sales});throw Error('unexpected '+url)}
 };
 vm.runInNewContext(source.slice(start,end)+'}',ctx);
 await ctx.cargarComisiones();
 assert.deepEqual(calls,['/api/ventas/todas?ubicacionId=todas']);
 assert.match(container.innerHTML,/data-comm-product-card/);
 assert.doesNotMatch(container.innerHTML,/Full sales and commissions history/);
});