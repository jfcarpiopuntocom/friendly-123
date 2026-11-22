'use strict';
// C175 P0: a reversed date window is invalid, never a valid $0
// commission projection, empty CSV, or silently filtered business sale.
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const mod=require('../docs/core/commission-history.js');
const sales=[{id:'sale-1',fechaLocal:'2026-11-21',cantidad:1,precioUnit:20,comisionAsociado:5,productoNombre:'Arte'}];

test('C175 RED: reversed period never renders false $0 in app OR Dashboard',()=>{
 const view=mod.project({sales,from:'2026-11-22',to:'2026-11-20',lang:'es'});
 assert.equal(view.invalidRange,true);
 assert.equal(view.totals,null,'undefined financial values are NOT exact zero');
 assert.equal(view.rows.length,0);
 for(const lang of ['es','en']){
   const html=mod.render({sales,lang,from:'2026-11-22',to:'2026-11-20'});
   assert.match(html,/data-comm-history-invalid-range="1"/);
   assert.match(html,/role="alert"/);
   assert.doesNotMatch(html,/\$0[.,]00/,'no invented exact $0 KPI');
   assert.match(html,lang==='es'?/Rango de fechas inválido/:/Invalid date range/);
 }
});

test('C175: proper dates, empty filters, honest zero, group and business timezone remain unchanged',()=>{
 const cases=[
   [{from:'2026-11-21',to:'2026-11-21',lang:'es'},5],
   [{from:'2026-11-20',to:'2026-11-22',lang:'en'},5],
   [{from:'2026-11-22',lang:'es'},0],
   [{to:'2026-11-20',lang:'es'},0],
   [{lang:'es',group:'producto'},5],
   [{lang:'en',group:'comisionista'},5],
   [{lang:'es',zone:'America/Guayaquil'},5]
 ];
 for(const [opts,commission] of cases){
   const x=mod.project({...opts,sales});
   assert.notEqual(x.invalidRange,true,JSON.stringify(opts));
   assert.equal(x.totals.commission,commission,JSON.stringify(opts));
   const html=mod.render({...opts,sales});
   assert.doesNotMatch(html,/data-comm-history-invalid-range/);
 }
});

for(const file of ['src/app/app-inline-01.js','docs/app-inline-01.min.js']){
 test('C175: '+file+' refuses invalid commission CSV BEFORE fetch/download',async()=>{
   const src=read(file);
   const start=src.indexOf('async function exportarComisionesTotalCSV(){');
   const end=src.indexOf('async function exportarComisionesCSV(){',start);
   assert.ok(start>=0&&end>start,file+' export function exists');
   const code=src.slice(start,end);
   const notices=[];
   let fetches=0,downloads=0;
   const context={
     window:{_ocComHistoryFrom:'2026-11-22',_ocComHistoryTo:'2026-11-20',_ocComHistoryGroup:'total',OCCommissionHistory:mod},
     document:{documentElement:{lang:'es'},body:{appendChild(){}},createElement(){return {click(){downloads++},remove(){}}}},
     alert:t=>notices.push(t),
     fetch(){fetches++;throw Error('invalid range must skip network')},
     _ocMesComisiones:null,
     URL:{createObjectURL(){return 'blob:fake'},revokeObjectURL(){}},
     Blob,
     setTimeout(){},
     API:'/api'
   };
   vm.runInNewContext(code+'\nthis.exportCSV=exportarComisionesTotalCSV;',context,{filename:file});
   await context.exportCSV();
   assert.equal(fetches,0,'rejected before real sales read');
   assert.equal(downloads,0,'no empty financial export');
   assert.match(notices.join(' '),/Rango de fechas inválido/);
 });
}

test('C175: app and compiled guard same valid CSV selected dates and can download real commissions',async()=>{
 for(const file of ['src/app/app-inline-01.js','docs/app-inline-01.min.js']){
   const src=read(file),start=src.indexOf('async function exportarComisionesTotalCSV(){'),end=src.indexOf('async function exportarComisionesCSV(){',start);
   const code=src.slice(start,end);
   let blob=null,downloads=0,fetches=0;
   const context={
     window:{_ocComHistoryFrom:'2026-11-21',_ocComHistoryTo:'2026-11-21',_ocComHistoryGroup:'total',OCCommissionHistory:mod},
     document:{documentElement:{lang:'es'},body:{appendChild(){}},createElement(){return {click(){downloads++},remove(){}}}},
     alert:t=>{throw Error('unexpected alert '+t)},
     fetch:async()=>{fetches++;return {ok:true,json:async()=>sales}},
     _ocMesComisiones:null,API:'/api',Blob,
     URL:{createObjectURL(b){blob=b;return 'blob:fake'},revokeObjectURL(){}},
     setTimeout(){}
   };
   vm.runInNewContext(code+'\nthis.exportCSV=exportarComisionesTotalCSV;',context,{filename:file});
   await context.exportCSV();
   assert.equal(fetches,1);
   assert.equal(downloads,1);
   assert.ok(blob);
   const data=await blob.text();
   assert.match(data,/sale-1/);
   assert.match(data,/5\.00/);
 }
});
