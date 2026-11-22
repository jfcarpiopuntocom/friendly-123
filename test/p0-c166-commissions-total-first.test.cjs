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

test('C166: ALL totals read real authenticated business sales; missing coverage never masquerades as zero',()=>{
 const app=read('src/app/app-inline-01.js'),dash=read('src/dashboard/dashboard-main.js');
 const route=app.slice(app.indexOf('async function cargarComisiones(){'),app.indexOf('async function cargarComisiones(){')+3600);
 assert.ok(route.includes('/ventas/todas?ubicacionId=todas'),'live business API, not hardcoded demo sales');
 assert.ok(route.includes('Array.isArray(sales)'),'validate authenticated sales response');
 assert.ok(route.includes('OCCommissionHistory.render({sales:sales'));
 assert.ok(route.includes('barraComisionesHtml([],actions)+report'),'show real total before optional months request finishes');
 assert.ok(dash.includes('autorizado && ultimoDato>0 && Array.isArray(datos.ventas)'),'dashboard requires authenticated notebook');
 assert.ok(dash.includes('datos.cobertura.ventas===true'),'dashboard cannot display incomplete cover as zero');
 assert.ok(dash.includes('Ventas pendientes de sincronizar'),'explicit pending instead of false $0');
});


test('C167 Safari formatter reuse: all authentic receipts, two time zones, exact money',()=>{
 const vm=require('node:vm');
 const source=read('docs/core/commission-history.js');
 let constructors=0;
 const sandboxIntl={DateTimeFormat:function(...args){
   constructors++;
   return new Intl.DateTimeFormat(...args);
 }};
 const sandbox={window:{},Intl:sandboxIntl,Date};
 vm.runInNewContext(source,sandbox,{filename:'commission-history.js',timeout:2000});
 const projection=sandbox.window.OCCommissionHistory;
 const sales=Array.from({length:150},(_,i)=>({
   id:'real-receipt-'+i,
   fecha:'2026-11-'+String(i%20+1).padStart(2,'0')+'T18:00:00Z',
   cantidad:1,precioUnit:10,comisionAsociado:2
 }));
 const local=projection.project({sales,zone:'America/Guayaquil'});
 assert.equal(local.totals.count,150);
 assert.equal(local.totals.gross,1500);
 assert.equal(local.totals.commission,300);
 assert.equal(local.groups.length,0);
 assert.equal(constructors,1,'do not allocate an Intl.DateTimeFormat twice per receipt');
 const other=projection.project({sales,zone:'Europe/Paris'});
 assert.equal(other.totals.commission,300);
 assert.equal(constructors,2,'one formatter per actual business zone, not per sale');
});

test('C166 Safari: opening total from REAL business API never invokes the expensive monthly ledger',async()=>{
 const vm=require('node:vm'),source=read('src/app/app-inline-01.js');
 const start=source.indexOf('async function cargarComisiones(){');
 const end=source.indexOf('  let filas, ranking, ventasTodas, meses, cuadreMes;',start);
 assert.ok(start>0&&end>start,'execute the production all-time branch');
 assert.ok(source.includes('data-commissions-open-month'),'operators retain explicit monthly settlement access');
 const container={innerHTML:''},calls=[];
 const ctx={
  document:{documentElement:{lang:'es'},getElementById(id){assert.equal(id,'listaComisiones');return container;}},
  window:{OCCommissionHistory:report},
  _ocMesComisiones:null,_ocComisionesSolicitud:0,API:'/api',
  renderGestionPromotoras(){},t(){return 'Retry';},
  barraComisionesHtml(){return '<div data-commissions-open-month>month-on-demand</div>';},
  fetch(url){calls.push(url);
    if(url==='/api/ventas/todas?ubicacionId=todas')return Promise.resolve({ok:true,json:async()=>sales});
    throw Error('unexpected payout reconstruction '+url);
  }
 };
 vm.runInNewContext(source.slice(start,end)+'}',ctx,{filename:'C166-real-app-source.js'});
 await ctx.cargarComisiones();
 assert.deepEqual(calls,['/api/ventas/todas?ubicacionId=todas']);
 assert.match(container.innerHTML,/Total de comisiones/);
 assert.match(container.innerHTML,/\$26[.,]00/);
 assert.doesNotMatch(container.innerHTML,/data-comm-history-group/);
});
test('C166 Safari: real sales unavailable is visible error, never a fake zero business',async()=>{
 const vm=require('node:vm'),source=read('src/app/app-inline-01.js');
 const start=source.indexOf('async function cargarComisiones(){'),end=source.indexOf('  let filas, ranking, ventasTodas, meses, cuadreMes;',start);
 const container={innerHTML:''};
 const ctx={
  document:{documentElement:{lang:'es'},getElementById(){return container;}},
  window:{OCCommissionHistory:report},API:'/api',
  _ocMesComisiones:null,_ocComisionesSolicitud:0,t(){return 'Retry';},
  fetch(){return Promise.reject(Error('synthetic offline'));}
 };
 vm.runInNewContext(source.slice(start,end)+'}',ctx,{filename:'C166-offline-app-source.js'});
 await ctx.cargarComisiones();
 assert.match(container.innerHTML,/No se pudo cargar el historial completo/);
 assert.doesNotMatch(container.innerHTML,/\$0[.,]00/);
});
