'use strict';
// C172: execute real Commissions projection with instrumented Intl. Safari
// must not allocate 2 * receipt-count formatters just to build the same report.
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../docs/core/commission-history.js'),'utf8');

function reportWithCount(){
 let constructions=0;
 const wrappedIntl={DateTimeFormat:function(...args){
   constructions++;
   return new Intl.DateTimeFormat(...args);
 }};
 const ctx={module:{exports:{}},window:undefined,Intl:wrappedIntl,Date,Map,Set};
 vm.runInNewContext(source,ctx,{filename:'docs/core/commission-history.js'});
 return {report:ctx.module.exports,get constructions(){return constructions;}};
}
function receipts(count){
 return Array.from({length:count},(_,i)=>({
   id:'sale-'+i,fecha:'2026-11-21T01:12:44.000Z',
   productoId:'product-'+(i%5),productoNombre:'Arte '+(i%5),
   cantidad:1,precioUnit:20,comisionAsociado:2
 }));
}

test('C172 RED: 700 ISO dates do not construct 1400 Intl formatters when Commissions opens',()=>{
 const {report,...rest}=reportWithCount();
 const sales=receipts(700);
 const global=report.project({sales,zone:'America/Guayaquil',lang:'es'});
 assert.equal(global.group,'total');
 assert.equal(global.totals.count,700);
 assert.equal(global.totals.gross,14000);
 assert.equal(global.totals.commission,1400);
 assert.equal(global.rows[0].day,'2026-11-20');
 assert.equal(rest.constructions,1,'only one immutable timezone formatter despite two passes over 700 receipts');
});

test('C172: repeated filters and grouping reuse timezone formatter, without caching money',()=>{
 const f=reportWithCount(),sales=receipts(700);
 const all=f.report.project({sales,group:'total',zone:'America/Guayaquil'});
 assert.equal(all.totals.commission,1400);
 const filtered=f.report.project({sales,group:'producto',from:'2026-11-20',to:'2026-11-20',zone:'America/Guayaquil'});
 assert.equal(filtered.groups.length,5);
 assert.equal(filtered.totals.commission,1400);
 const excluded=f.report.project({sales,group:'total',from:'2026-11-21',zone:'America/Guayaquil'});
 assert.equal(excluded.totals.commission,0,'same sales but different date filter must not reuse the amount');
 assert.equal(f.constructions,1,'formatter cache is reused across renders in same zone');
});

test('C172: calendar day boundaries remain correct for UTC vs Guayaquil and literal local dates',()=>{
 const f=reportWithCount(),sales=receipts(1);
 const ec=f.report.project({sales,zone:'America/Guayaquil'});
 const utc=f.report.project({sales,zone:'UTC'});
 assert.equal(ec.rows[0].day,'2026-11-20');
 assert.equal(utc.rows[0].day,'2026-11-21');
 assert.equal(f.constructions,2,'one per timezone, no cross-zone contamination');
 const local=f.report.project({sales:[{id:'local-day',fechaLocal:'2026-11-21',cantidad:1,precioUnit:40,comisionAsociado:4}],zone:'America/Guayaquil'});
 assert.equal(local.rows[0].day,'2026-11-21');
 assert.equal(local.totals.commission,4);
 assert.equal(f.constructions,2,'literal business dates bypass ISO parser and Intl');
});
