'use strict';
// C182: JFC's original Commissions visual language, all historical dates by default,
// with only a view switch. Monthly settlements remain a separate explicit choice.
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..');
const source=fs.readFileSync(path.join(root,'src/app/app-inline-01.js'),'utf8');
const history=require('../docs/core/commission-history.js');
const sales=[
 {id:'sep',fechaLocal:'2026-09-12',mes:'2026-09',productoId:'p1',productoNombre:'Book',clienteId:'c1',clienteNombre:'Ana',promotoraId:'a1',asociadoNombre:'Belén',cantidad:1,precioUnit:80,comisionAsociado:20},
 {id:'nov',fechaLocal:'2026-11-13',mes:'2026-11',productoId:'p1',productoNombre:'Book',clienteId:'c2',clienteNombre:'Luis',promotoraId:'a2',asociadoNombre:'Lucía',cantidad:2,precioUnit:30,comisionAsociado:15}
];
function render(view){
 const a=source.indexOf('function renderComisionesHistoricasApp(');
 const b=source.indexOf('async function cargarComisiones(){',a);
 assert.ok(a>=0 && b>a,'real app visual adapter must exist before cargarComisiones');
 const sandbox={};
 vm.runInNewContext('const escHtml=v=>String(v).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");\n'+
  source.slice(a,b)+'\nthis.render=renderComisionesHistoricasApp;',sandbox);
 return sandbox.render(view);
}
test('C182: default all-history products use original tag-card/stats/rotulo/cifra visual components',()=>{
 const projected=history.project({sales,group:'producto',lang:'en'});
 const html=render(projected);
 assert.equal(projected.totals.count,2);
 assert.equal(projected.totals.gross,140);
 assert.equal(projected.totals.commission,35);
 assert.match(html,/data-comm-history-report/);
 assert.match(html,/data-comm-history-group/);
 assert.match(html,/tag-card/);
 assert.match(html,/class="stats"/);
 assert.match(html,/class="rotulo"/);
 assert.match(html,/class="cifra"/);
 assert.match(html,/Book/);
 assert.match(html,/140\.00/);
 assert.match(html,/35\.00/);
 assert.doesNotMatch(html,/Full sales and commissions history|Read-only view across dates|Settle month/);
 assert.doesNotMatch(html,/data-comm-pay-|data-month-pay|onclick="marcarComisionPagada/,'all-period view must never invent a cross-month payout');
});
test('C182: product, customer, associate, month and rack use same compact visual card, never month cutoff',()=>{
 for(const group of ['producto','cliente','comisionista','mes','percha']){
  const v=history.project({sales,group,lang:'es'});
  const html=render(v);
  assert.equal(v.totals.count,2);
  assert.equal(v.totals.commission,35);
  assert.match(html,/data-comm-history-group/,group);
  assert.doesNotMatch(html,/Historial completo de ventas y comisiones|Vista de consulta de todas las fechas/,group);
 }
});
test('C182: uncertain financial amounts remain unverified, never silently become zero',()=>{
 const view=history.project({sales:[{id:'unknown',fechaLocal:'2026-10-01',productoNombre:'Gift',cantidad:1,precioUnit:15}],group:'producto',lang:'es'});
 const html=render(view);
 assert.equal(view.totals.unknownCommission,1);
 assert.match(html,/Por verificar/);
 assert.doesNotMatch(html,/Comisiones[^<]*<\/div>\s*<div[^>]*>\$0\.00/);
});
test('C182: production global entry renders compact groups, reads full sales once and no monthly financial endpoint',async()=>{
 const a=source.indexOf('async function cargarComisiones(){'),b=source.indexOf('  let filas, ranking, ventasTodas, meses, cuadreMes;',a);
 assert.ok(a>=0&&b>a);
 const app={innerHTML:''},calls=[];
 const context={document:{documentElement:{lang:'en'},getElementById(){return app;}},
  window:{OCCommissionHistory:history,_ocComHistoryGroup:'producto'},
  _ocComisionesSolicitud:0,_ocMesComisiones:null,API:'/api',
  renderGestionPromotoras(){},t(){return 'Retry';},
  barraComisionesHtml(){return '<div data-commissions-toolbar>toolbar</div>';},
  renderComisionesHistoricasApp:render,
  fetch(url){calls.push(url);if(url.endsWith('/ventas/todas?ubicacionId=todas'))return Promise.resolve({ok:true,json:async()=>sales});throw Error('unexpected '+url);}
 };
 vm.runInNewContext(source.slice(a,b)+'}',context);
 await context.cargarComisiones();
 assert.deepEqual(calls,['/api/ventas/todas?ubicacionId=todas']);
 assert.match(app.innerHTML,/tag-card/);
 assert.match(app.innerHTML,/data-comm-history-group/);
 assert.doesNotMatch(app.innerHTML,/Full sales and commissions history|Read-only view across dates/);
});
test('C182: view selector is compact, defaults to product, and date controls appear only when period chosen',()=>{
 const a=source.indexOf('function selectorRangoComisionesGlobalHtml(){');
 const b=source.indexOf('function selectorMesComisionesHtml(',a);
 assert.ok(a>=0&&b>a);
 const context={window:{_ocComHistoryGroup:'producto'},document:{documentElement:{lang:'en'}},
  escHtml:v=>String(v),cargarComisiones(){},_ocMesComisiones:null};
 vm.runInNewContext(source.slice(a,b)+'\nthis.render=selectorRangoComisionesGlobalHtml;',context);
 const html=context.render();
 for(const label of ['Product','Customer','Associate','Period'])assert.match(html,new RegExp(label));
 assert.match(html,/value="producto" selected/);
 assert.doesNotMatch(html,/type="date"/,'no From/To controls imposed on ordinary product view');
 context.window._ocComHistoryGroup='mes';
 const periods=context.render();
 assert.match(periods,/value="mes" selected/);
 assert.match(periods,/type="date"/,'date range is optional only in period view');
});