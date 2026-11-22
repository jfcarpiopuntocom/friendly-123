'use strict';
// C166: All-period commission totals first; grouping only by explicit choice, in BOTH UIs.
// Read-only projector. These checks do not alter any payment or inventory operation.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
const report=require('../docs/core/commission-history.js');
const vm=require('node:vm');
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
 assert.match(app,/data-commissions-open-month/,'monthly settlement remains available on demand');
 const allTimeStart=app.indexOf('if (!_ocMesComisiones) {',app.indexOf('async function cargarComisiones()'));
 const nextBranch=app.indexOf('  let filas, ranking, ventasTodas, meses, cuadreMes;',allTimeStart);
 assert.ok(allTimeStart>0&&nextBranch>allTimeStart);
 assert.doesNotMatch(app.slice(allTimeStart,nextBranch),/liquidaciones\\/meses/,
   'opening total must not recompute monthly settlements in parallel on Safari');
 assert.match(dash,/\["total",es\?"Total general"/);
 assert.match(app,/_ocMesComisiones = null/);
 assert.match(dash,/cmMes = null/);
});

test('C166 Safari: total from real sales makes ONLY ONE history request; monthly payout read is lazy',async()=>{
 const source=read('src/app/app-inline-01.js');
 const start=source.indexOf('async function cargarComisiones(){');
 const end=source.indexOf('  let filas, ranking, ventasTodas, meses, cuadreMes;',start);
 assert.ok(start>0 && end>start,'extract the actual all-dates production branch');
 const executable=source.slice(start,end)+'}';
 async function exercise(){
   const container={innerHTML:''};
   const calls=[];
   const context={
     document:{documentElement:{lang:'es'},getElementById(id){assert.equal(id,'listaComisiones');return container;}},
     window:{OCCommissionHistory:report},
     API:'/api',_ocMesComisiones:null,_ocComisionesSolicitud:0,
     renderGestionPromotoras(){},t(){return 'Retry';},
     barraComisionesHtml(months){return '<div>periods:'+months.length+'</div>';},
     setTimeout(fn){queueMicrotask(fn);return 1;},
     fetch(url){calls.push(url);
       if(url.includes('/ventas/todas'))return Promise.resolve({ok:true,json:async()=>sales});
       if(url.includes('/liquidaciones/meses'))throw Error('P0 Safari: unexpected costly monthly recomputation on entry');
       throw Error('unexpected API '+url);
     }
   };
   vm.runInNewContext(executable,context,{filename:'app-c166-real-all-dates.js'});
   await context.cargarComisiones();
   assert.deepEqual(calls,['/api/ventas/todas?ubicacionId=todas']);
   assert.match(container.innerHTML,/Comisiones registradas/);
   assert.match(container.innerHTML,/\$35[,.]00/);
   assert.match(container.innerHTML,/periods:0/);
 }
 await exercise(); // no /liquidaciones/meses request exists to block Safari/commissions
});
test('C166: failures of the PRIMARY sales endpoint fail visibly, not as fabricated $0',async()=>{
 const source=read('src/app/app-inline-01.js');
 const start=source.indexOf('async function cargarComisiones(){');
 const end=source.indexOf('  let filas, ranking, ventasTodas, meses, cuadreMes;',start);
 const container={innerHTML:''};
 const context={document:{documentElement:{lang:'es'},getElementById(){return container;}},
   window:{OCCommissionHistory:report},API:'/api',_ocMesComisiones:null,_ocComisionesSolicitud:0,
   renderGestionPromotoras(){},t(){return 'Reintentar';},barraComisionesHtml(){return '';},
   setTimeout(fn){queueMicrotask(fn);return 1;},
   fetch(url){if(url.includes('/liquidaciones/meses'))throw Error('monthly read unexpectedly triggered');return Promise.reject(Error('sales offline'));}
 };
 vm.runInNewContext(source.slice(start,end)+'}',context,{filename:'app-c166-fail-closed.js'});
 await context.cargarComisiones();
 assert.match(container.innerHTML,/No se pudo cargar el historial completo/);
 assert.doesNotMatch(container.innerHTML,/\$0\.00/);
});
