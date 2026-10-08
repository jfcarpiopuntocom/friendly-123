const {test}=require('node:test');
const assert=require('node:assert/strict');
const L=require('../docs/core/payout-ledger.js');
const {browser}=require('./helpers/browser.cjs');
const LG=require('../docs/core/ledger.js');
const fs=require('node:fs'),vm=require('node:vm');
const loc=[{id:'rack',promotoraId:'alice'}];
const sale=(id,fecha,extra={})=>({id,fecha,ubicacionId:'rack',split:{montoComisionSocio:40,comisionPct:40,montoBruto:100,montoNetoDueno:60},...extra});
const first={id:'paid',opId:'paid',status:'paid',payeeId:'alice',amountCents:4000,items:[{kind:'sale',sourceId:'old',payeeId:'alice',amountCents:4000}]};
const input={sales:[sale('old','2026-09-01T12:00:00Z',{anulada:true,anuladaEn:'2026-09-20T12:00:00Z'}),sale('new','2026-10-02T12:00:00Z',{split:{montoComisionSocio:80}})],locations:loc,payouts:[first]};
test('unconsumed paid void carries forward, but never into a period before cancellation',()=>{
 assert.equal(L.balancesByPayee({...input,month:'2026-10'})[0].dueCents,4000);
 assert.equal(L.balancesByPayee({...input,month:'2026-10',sourceIds:['new']})[0].dueCents,4000);
 assert.equal(L.buildObligations({...input,month:'2026-08'}).length,0);
 const p=L.planPayout({...input,month:'2026-10',payeeId:'alice',id:'next',opId:'next'}).payout;
 assert.equal(p.amountCents,4000);
 assert.equal(L.balancesByPayee({...input,month:'2026-10',payouts:[first,p]})[0].dueCents,0);
 const rev={...p,id:'rev',opId:'rev',reversalOf:p.id};
 assert.equal(L.balancesByPayee({...input,month:'2026-10',payouts:[first,p,rev]})[0].dueCents,4000);
});
test('legacy paid flag becomes a recovery; a recorded partial payout supersedes that flag',()=>{
 const sales=[sale('old','2026-09-01',{anulada:true,liquidada:true,anuladaEn:'2026-09-20'})];
 assert.equal(L.balancesByPayee({sales,locations:loc,payouts:[],month:'2026-10'})[0].dueCents,-4000);
 const partial={...first,amountCents:1000,items:[{...first.items[0],amountCents:1000}]};
 assert.equal(L.balancesByPayee({sales,locations:loc,payouts:[partial],month:'2026-10'})[0].dueCents,-1000);
});
test('reversing the original payment after recovery creates a refund due, and paying it clears that due',()=>{
 const p=L.planPayout({...input,payeeId:'alice',id:'next',opId:'next'}).payout;
 const reversed={...first,id:'original-reversed',opId:'original-reversed',reversalOf:first.id};
 const b={...input,payouts:[first,p,reversed],payeeId:'alice',id:'refund',opId:'refund'};
 assert.equal(L.balancesByPayee(b)[0].dueCents,4000);
 const refund=L.planPayout(b).payout;
 assert.equal(refund.amountCents,4000);
 assert.equal(L.balancesByPayee({...b,payouts:[...b.payouts,refund]})[0].dueCents,0);
 const wire=L.compatiblePayouts([...b.payouts,refund]);
 assert.equal(L.balancesByPayee({...b,payouts:wire})[0].dueCents,0);
});
test('wire view keeps old item kinds and round-trips void offsets and their reversals without changing facts',()=>{
 const p=L.planPayout({...input,payeeId:'alice',id:'next',opId:'next'}).payout;
 const raw=[first,p,{...p,id:'rev',opId:'rev',reversalOf:p.id}];
 const before=JSON.stringify(raw),wire=L.compatiblePayouts(raw);
 assert.ok(wire.flatMap(p=>p.items).every(i=>['sale','adjustment'].includes(i.kind)));
 assert.equal(JSON.stringify(raw),before);
 assert.equal(L.balancesByPayee({...input,payouts:wire})[0].dueCents,L.balancesByPayee({...input,payouts:raw})[0].dueCents);
 assert.deepEqual(L.ledgerAnomalies(wire),L.ledgerAnomalies(raw));
 assert.deepEqual(L.compatiblePayouts(wire),wire);
});
test('recovery and refund reversals commute across sync arrival orders',()=>{
 const recovered=L.planPayout({...input,payeeId:'alice',id:'next',opId:'next'}).payout;
 const reversed={...first,id:'rev-first',opId:'rev-first',reversalOf:first.id};
 const refund=L.planPayout({...input,payouts:[first,recovered,reversed],payeeId:'alice',id:'refund',opId:'refund'}).payout;
 const revRecovery={...recovered,id:'rev-next',opId:'rev-next',reversalOf:recovered.id};
 const revRefund={...refund,id:'rev-refund',opId:'rev-refund',reversalOf:refund.id};
 for(const raw of [[first,recovered,reversed,refund,revRecovery,revRefund],[revRefund,refund,reversed,revRecovery,recovered,first]]){
  for(const payouts of [raw,L.compatiblePayouts(raw)]){
   assert.deepEqual(L.ledgerAnomalies(payouts),[]);
   assert.equal(L.balancesByPayee({...input,payouts})[0].dueCents,8000);
  }
 }
});
test('cancelled legacy payment remains cash paid in the financial book',()=>{
 const sales=[{...sale('old','2026-09-01',{anulada:true,liquidada:true,anuladaEn:'2026-09-20'}),productoId:'p',cantidad:1,precioUnit:100}];
 const book=LG.buildLedger({ventas:sales,ubicaciones:loc});
 assert.deepEqual(book.errors,[]);
 assert.equal(book.balances.byPerson.alice,-4000);
 assert.equal(book.balances.accounts['1000'].balanceCents,-4000);
});
test('product statement reflects recovered void, including the compatible wire representation',()=>{
 const sales=input.sales.map(v=>({...v,productoId:'p',cantidad:1,precioUnit:100}));
 const p=L.planPayout({...input,payeeId:'alice',id:'next',opId:'next'}).payout;
 for(const payouts of [[first,p],L.compatiblePayouts([first,p])]){
  const ledger=LG.buildLedger({ventas:sales,payouts,ubicaciones:loc});
  const sheet=LG.productSheet({ledger,payouts,sales,productId:'p'});
  assert.equal(sheet.people.find(x=>x.personId==='alice').dueCents,0);
 }
});
test('local dashboard agrees with held obligations and the local day, including UTC midnight',()=>{
 const html=fs.readFileSync(require.resolve('../docs/dashboard.html'),'utf8');
 const start=html.includes('  function fechaLocalDashboard(') ? html.indexOf('  function fechaLocalDashboard(') : html.indexOf('  function mesLocalDe(');
 const chunk=html.slice(start,html.indexOf('  function estadoSimon('));
 class Clock extends Date{constructor(...a){super(...(a.length?a:['2026-10-08T01:00:00Z']));}}
 const ctx={window:{OCPayoutLedger:L},localStorage:{getItem:()=> 'America/Guayaquil'},Date:Clock,Intl,sufijoTienda:()=>'',estadoSimon:()=> 'verde'};
 vm.createContext(ctx);vm.runInContext(chunk,ctx);
 const d=ctx.datosDesdeLocal({ventas:[{...sale('v','2026-10-08T00:30:00Z'),productoId:'p',cantidad:1,precioUnit:100}],productos:[{id:'p'}],ubicaciones:loc,configuracion:{retencion:{dias:7}}});
 assert.equal(d.resumen.resumenDia.entra,100);
 assert.equal(d.liquidaciones[0].stillDue,0);
 assert.equal(d.liquidaciones[0].held,40);
 assert.equal(d.liquidaciones[0].estado,'pendiente');
});
test('API consumes earlier void on the next monthly payment and exports backwards-readable facts',async()=>{
 const app=browser();app.OCAuth={rolActual:()=> 'dueno'};
 const a=await app.request('/api/promotoras','POST',{nombre:'Synthetic',comisionBase:40});
 const r=await app.request('/api/ubicaciones','POST',{nombre:'Synthetic rack',tipo:'socio'});
 await app.request('/api/ubicaciones/'+r.id,'PUT',{promotoraId:a.id});
 const p=await app.request('/api/productos','POST',{nombre:'Synthetic',sku:'RCV',barcode:'RCV',precio:100,costo:20,stockInicial:10,ubicacionId:r.id});
 await app.request('/api/productos/'+p.id+'/venta','POST',{cantidad:1});
 await app.request('/api/liquidaciones/'+r.id+'/marcar-pagado','POST',{payeeId:a.id,mes:'2026-10',opId:'first'});
 const b=await app.request('/api/respaldo/exportar');
 b.ventas.filter(v=>v.ubicacionId===r.id).forEach(v=>Object.assign(v,{fecha:'2026-09-10T12:00:00Z',anulada:true,canceladaExPostEn:'2026-09-20T12:00:00Z'}));
 await app.request('/api/respaldo/importar','POST',b);
 await app.request('/api/productos/'+p.id+'/venta','POST',{cantidad:2});
 const now=await app.request('/api/respaldo/exportar');
 now.ventas.filter(v=>v.ubicacionId===r.id&&!v.anulada).forEach(v=>v.fecha='2026-10-02T12:00:00Z');
 await app.request('/api/respaldo/importar','POST',now);
 const rows=await app.request('/api/liquidaciones?mes=2026-10');
 assert.equal(rows.find(x=>x.ubicacionId===r.id).stillDue,40);
 const pay=await app.request('/api/liquidaciones/'+r.id+'/marcar-pagado','POST',{payeeId:a.id,mes:'2026-10',opId:'next'});
 assert.equal(pay.amount ?? pay.payout.amount,40);
 const exported=await app.request('/api/respaldo/exportar');
 assert.ok(exported.payouts.flatMap(p=>p.items).every(i=>['sale','adjustment'].includes(i.kind)));
 assert.ok(app.catalog().payouts.flatMap(p=>p.items).every(i=>['sale','adjustment'].includes(i.kind)));
 await app.request('/api/respaldo/importar','POST',exported);
 assert.equal((await app.request('/api/liquidaciones?mes=2026-10')).find(x=>x.ubicacionId===r.id).stillDue,0);
 await app.request('/api/config/retencion','PUT',{dias:7});
 await app.request('/api/productos/'+p.id+'/venta','POST',{cantidad:1});
 const held=(await app.request('/api/liquidaciones?mes=2026-10')).find(x=>x.ubicacionId===r.id);
 assert.equal(held.held,40,'remote dashboard must receive the same held total as the local view');
 const view=(await app.request('/api/ventas/todas')).filter(v=>v.productoId===p.id).pop();
 assert.equal(view.comisionRetenida,40);
 assert.equal(view.comisionPendiente,0);
});
