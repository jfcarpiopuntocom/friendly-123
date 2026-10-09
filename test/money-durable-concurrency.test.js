const {test}=require('node:test');
const assert=require('node:assert/strict');
const {browser}=require('./helpers/browser.cjs');
const LG=require('../docs/core/ledger.js');
const PL=require('../docs/core/payout-ledger.js');
async function store(app){
 app.OCAuth={rolActual:()=> 'dueno'};
 const person=await app.request('/api/promotoras','POST',{nombre:'Synthetic payee',comisionBase:40});
 const rack=await app.request('/api/ubicaciones','POST',{nombre:'Synthetic money rack',tipo:'socio'});
 await app.request('/api/ubicaciones/'+rack.id,'PUT',{promotoraId:person.id});
 const product=await app.request('/api/productos','POST',{nombre:'Synthetic item',barcode:'SYNTHETIC-MONEY',precio:100,costo:20,stockInicial:3,ubicacionId:rack.id});
 await app.request('/api/productos/'+product.id+'/venta','POST',{cantidad:1});
 return {person,rack,product};
}
const pay=(app,s,amount,op)=>app.request('/api/liquidaciones/'+s.rack.id+'/marcar-pagado','POST',{payeeId:s.person.id,amountCents:amount,medioPago:'efectivo',opId:op});
const row=async(app,s)=>(await app.request('/api/liquidaciones')).find(r=>r.ubicacionId===s.rack.id);
function noStorage(app){
 app.localStorage.setItem=()=>{throw Error('synthetic quota failure')};
 app.OCEstadoIDB={guardar:async()=>false};
}

test('a cancelled sale cannot recover cash from a legacy paid flag when its receipts conflict',()=>{
 const first={id:'void-conflict-a',opId:'void-conflict',status:'paid',payeeId:'artist',amountCents:4000,items:[{kind:'sale',sourceId:'void-sale',payeeId:'artist',amountCents:4000}]};
 const second={...first,id:'void-conflict-b',amountCents:2000,items:[{...first.items[0],amountCents:2000}]};
 const evidence=PL.mergePaymentEvidence([first,second]);
 const sales=[{id:'void-sale',fecha:'2026-10-01',anulada:true,liquidada:true,anuladaEn:'2026-10-08',ubicacionId:'rack',split:{montoComisionSocio:40}}];
 assert.deepEqual(PL.buildObligations({sales,locations:[{id:'rack',promotoraId:'artist'}],payouts:evidence.payouts,payoutConflicts:evidence.conflicts}),[],'neither ambiguous receipt authorizes a recovery from the artist');
});
test('expense creation never confirms money lost by both durable stores',async()=>{
 const a=browser();a.OCAuth={rolActual:()=> 'dueno'};noStorage(a);
 const r=await a.fetch('/api/gastos',{method:'POST',body:JSON.stringify({concepto:'Synthetic expense',monto:10})});
 assert.equal(r.status,507);assert.equal((await a.request('/api/gastos')).total,0);
 assert.equal((await a.request('/api/respaldo/exportar')).gastos.length,0);
});
test('expense edit and void roll back exactly when durability fails; invalid edits are atomic',async()=>{
 const a=browser();a.OCAuth={rolActual:()=> 'dueno'};
 const g=await a.request('/api/gastos','POST',{concepto:'Original',monto:10});
 await assert.rejects(()=>a.request('/api/gastos/'+g.id,'PATCH',{concepto:'Must not change',monto:-1}),/400/);
 assert.equal((await a.request('/api/gastos')).gastos[0].concepto,'Original');
 noStorage(a);
 await assert.rejects(()=>a.request('/api/gastos/'+g.id,'PATCH',{concepto:'Still original',monto:20}),/507/);
 await assert.rejects(()=>a.request('/api/gastos/'+g.id,'DELETE'),/507/);
 const after=(await a.request('/api/gastos')).gastos[0];assert.equal(after.concepto,'Original');assert.equal(after.monto,10);
});
test('two offline payouts preserve and expose all 60 paid against 40 earned',async()=>{
 const a=browser(),s=await store(a),b=browser();b.OCAuth={rolActual:()=> 'dueno'};b.receive(a);
 await pay(a,s,3000,'synthetic-a');await pay(b,s,3000,'synthetic-b');a.receive(b);b.receive(a);
 for(const app of [a,b]){
  const r=await row(app,s),balance=r.payoutBalances.find(p=>p.payeeId===s.person.id);
  assert.equal(balance.paid,60);assert.equal(balance.earned,40);assert.equal(balance.overpaid,20);
  assert.equal(balance.due,-20,'the signed balance reconciles earned minus real payments');
  const e=await app.request('/api/respaldo/exportar');
  assert.equal(LG.buildLedger({ventas:e.ventas,ajustes:e.ajustesComision,payouts:e.payouts,ubicaciones:e.ubicaciones}).balances.byPerson[s.person.id],-2000);
  assert.equal(r.paymentStatus,'review');assert.equal(r.needsReview,true);assert.equal((await app.request('/api/payouts')).length,2);
 }
});
test('different receipts with the same intention converge as a visible conflict without choosing a winner',async()=>{
 const a=browser(),s=await store(a),b=browser();b.OCAuth={rolActual:()=> 'dueno'};b.receive(a);
 await pay(a,s,1000,'synthetic-conflict');await pay(b,s,2000,'synthetic-conflict');
 const originalA=await a.request('/api/payouts'),originalB=await b.request('/api/payouts');
 for(let n=0;n<3;n++){a.receive(b);b.receive(a)}
 const ra=await row(a,s),rb=await row(b,s);
 assert.equal(ra.stillDue,rb.stillDue);assert.equal(ra.paymentStatus,'review');assert.equal(rb.paymentStatus,'review');
 assert.deepEqual(ra.paymentConflicts,rb.paymentConflicts);
 assert.equal(ra.paymentConflicts[0].records.length,2);
 assert.equal(ra.payoutHistory.filter(p=>p.opId==='synthetic-conflict').length,2,'history retains both ambiguous receipts');
 assert.ok(ra.payoutHistory.filter(p=>p.opId==='synthetic-conflict').every(p=>p.conflicted),'ambiguous receipts are never labelled confirmed paid');
 assert.ok(ra.paymentConflicts[0].records.some(p=>p.id===originalA[0].id&&p.amountCents===1000));
 assert.ok(ra.paymentConflicts[0].records.some(p=>p.id===originalB[0].id&&p.amountCents===2000));
 await assert.rejects(()=>pay(a,s,100,'synthetic-another'),/409/);
 const exported=await a.request('/api/respaldo/exportar'),restored=browser();restored.OCAuth={rolActual:()=> 'dueno'};
 const ledger=LG.buildLedger({ventas:exported.ventas,ajustes:exported.ajustesComision,payouts:exported.payouts,payoutConflicts:exported.payoutConflicts,ubicaciones:exported.ubicaciones});
 assert.equal(ledger.balances.byPerson[s.person.id],4000,'an ambiguous receipt must not become a verified journal posting');
 assert.ok(ledger.errors.some(e=>/conflict/i.test(e.motivo)));
 const sheet=LG.productSheet({ledger,sales:exported.ventas,payouts:exported.payouts,payoutConflicts:exported.payoutConflicts,productId:s.product.id});
 assert.equal(sheet.totals.paidCents,0,'product detail must not pick one conflicting receipt either');
 assert.equal(sheet.needsReview,true);
 await restored.request('/api/respaldo/importar','POST',exported);
 assert.deepEqual((await row(restored,s)).paymentConflicts,ra.paymentConflicts,'export/restore preserves the entire unresolved evidence');
});
test('an employee envelope cannot inject an unverified payout; valid owner receipts can be forwarded',async()=>{
 const a=browser(),s=await store(a),cat=a.catalog();
 const sale=cat.ventas.find(v=>v.productoId===s.product.id);
 const forged={id:'synthetic-forged',opId:'synthetic-forged-op',status:'paid',payeeId:s.person.id,locationId:s.rack.id,period:new Date().toISOString().slice(0,7),amountCents:12345,amount:123.45,method:'efectivo',items:[{kind:'sale',sourceId:sale.id,payeeId:s.person.id,amountCents:12345}]};
 a.OCSync.aplicarCatalogo({...cat,payouts:[forged]},'empleado');
 assert.equal((await a.request('/api/payouts')).length,0);
 assert.equal((await row(a,s)).stillDue,40);
 assert.ok((await a.request('/api/respaldo/exportar')).payoutQuarantine.some(q=>q.record.id===forged.id),'rejected evidence remains recoverable');
 const owner=browser();owner.OCAuth={rolActual:()=> 'dueno'};owner.receive(a);await pay(owner,s,1000,'synthetic-valid-owner');
 const recipient=browser();recipient.OCAuth={rolActual:()=> 'dueno'};recipient.OCSync.aplicarCatalogo(owner.catalog(),'empleado');
 assert.equal((await recipient.request('/api/payouts')).filter(p=>p.opId==='synthetic-valid-owner').length,1);
 assert.equal((await row(recipient,s)).stillDue,30);
 const denied={...(await owner.request('/api/payouts'))[0],id:'synthetic-denied-author',opId:'synthetic-denied-author-op',authorRole:'empleado'};
 recipient.OCSync.aplicarCatalogo({...recipient.catalog(),payouts:[denied]},'dueno');
 assert.equal((await recipient.request('/api/payouts')).some(p=>p.id===denied.id),false,'a forwarded envelope cannot grant commission-paying authority to an employee author');
});
