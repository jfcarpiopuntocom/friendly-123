'use strict';
// C174 P0: execute real read-only Commissions projector as loaded by app,
// Dashboard and app CSV. The dashboard passes a zone, app/CSV use browser zone.
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..');
const source=fs.readFileSync(path.join(root,'docs/core/commission-history.js'),'utf8');
const sale={id:'sale-midnight',fecha:'2026-11-21T01:12:44.000Z',productoNombre:'Art',cantidad:1,precioUnit:20,comisionAsociado:5};
function load(browser){
 const context={module:{exports:{}},Intl,Map,Set,Date};
 if(browser!==undefined)context.window=browser;
 vm.runInNewContext(source,context,{filename:'docs/core/commission-history.js'});
 return context.module.exports;
}
test('C174 RED: app and CSV without zone must use configured business timezone, not hardcoded Ecuador',()=>{
 const browser={Intl,localStorage:{getItem(k){assert.equal(k,'f123_timezone');return 'UTC';}}};
 const report=load(browser);
 const app=report.project({sales:[sale],group:'mes',from:'2026-11-21',to:'2026-11-21'});
 assert.equal(app.totals.count,1,'configured UTC sale is November 21, not Guayaquil November 20');
 assert.equal(app.rows[0].day,'2026-11-21');
 assert.equal(app.totals.commission,5);
 const csv=report.project({sales:[sale],group:'mes'});
 assert.equal(csv.rows[0].day,'2026-11-21','CSV uses same projector and business zone');
 assert.equal(csv.totals.commission,5);
});
test('C174: dashboard explicit authenticated zone overrides browser setting',()=>{
 const report=load({Intl,localStorage:{getItem(){return 'UTC';}}});
 const dashboard=report.project({sales:[sale],zone:'America/Guayaquil',group:'mes',
   from:'2026-11-20',to:'2026-11-20'});
 assert.equal(dashboard.totals.count,1);
 assert.equal(dashboard.rows[0].day,'2026-11-20');
 assert.equal(dashboard.totals.commission,5);
 assert.equal(report.project({sales:[sale],from:'2026-11-21',zone:'America/Guayaquil'}).totals.count,0);
});
test('C174: browser automatic device zone when setting absent; no browser preserves previous fallback',()=>{
 const browser={Intl:{DateTimeFormat:function(...args){
   if(!args.length)return {resolvedOptions:()=>({timeZone:'UTC'})};
   return new Intl.DateTimeFormat(...args);
 }},localStorage:{getItem(){return null;}}};
 const auto=load(browser).project({sales:[sale]});
 const node=load(undefined).project({sales:[sale]});
 assert.equal(auto.rows[0].day,'2026-11-21');
 assert.equal(node.rows[0].day,'2026-11-20');
 assert.equal(auto.totals.commission,node.totals.commission);
});
test('C174: inaccessible localStorage does not blank Commissions or invent money',()=>{
 const report=load({Intl:{DateTimeFormat:function(...args){
   if(!args.length)return {resolvedOptions:()=>({timeZone:'UTC'})};
   return new Intl.DateTimeFormat(...args);
 }},localStorage:{getItem(){throw Error('blocked');}}});
 const result=report.project({sales:[sale],group:'mes'});
 assert.equal(result.rows[0].day,'2026-11-21');
 assert.equal(result.totals.commission,5);
});
test('C174: fechaLocal calendar-only dates remain immutable, app and dashboard code paths retained',()=>{
 const report=load({Intl,localStorage:{getItem(){return 'UTC';}}});
 const local={...sale,fechaLocal:'2026-11-20'};
 assert.equal(report.project({sales:[local]}).rows[0].day,'2026-11-20');
 const app=fs.readFileSync(path.join(root,'src/app/app-inline-01.js'),'utf8');
 const dash=fs.readFileSync(path.join(root,'src/dashboard/dashboard-main.js'),'utf8');
 assert.match(app,/OCCommissionHistory\.project\(\{sales:sales,group:group,lang:/,'global Commissions continues to use exact shared business-zone projector');
 assert.match(app,/OCCommissionHistory\.project\(\{sales,from:/);
 assert.match(dash,/lang:es\?"es":"en",zone:zonaNegocioDashboard\(\)/);
});
