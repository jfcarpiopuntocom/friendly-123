const { test } = require('node:test');
const assert = require('node:assert/strict');
const { browser } = require('./helpers/browser.cjs');

async function store(app) {
  app.OCAuth = { rolActual: () => 'dueno' };
  const alice = await app.request('/api/promotoras', 'POST', { nombre:'Alice Payee', comisionBase:40 });
  const rack = await app.request('/api/ubicaciones', 'POST', { nombre:'Payout Rack', tipo:'socio' });
  await app.request(`/api/ubicaciones/${rack.id}`, 'PUT', { promotoraId:alice.id });
  const product = await app.request('/api/productos', 'POST', { nombre:'Payout Vase', sku:'PAYOUT-VASE', barcode:'PAYOUT-VASE', precio:100, costo:20, stockInicial:10, ubicacionId:rack.id });
  return {alice,rack,product};
}

test('new commission payment creates an auditable payout and keeps compatibility flags', async () => {
  const app=browser(); const s=await store(app);
  await app.request(`/api/productos/${s.product.id}/venta`, 'POST', {cantidad:1});
  const before=(await app.request('/api/liquidaciones')).find(x=>x.ubicacionId===s.rack.id);
  assert.equal(before.stillDue,40);
  assert.equal(before.payoutBalances[0].due,40);

  const paid=await app.request(`/api/liquidaciones/${s.rack.id}/marcar-pagado`, 'POST', {
    payeeId:s.alice.id, medioPago:'transferencia', opId:'fixture-pay-1', reference:'TX-123'
  });
  assert.equal(paid.amount,40);
  assert.equal(paid.payeeId,s.alice.id);

  const payouts=await app.request(`/api/payouts?ubicacionId=${s.rack.id}`);
  assert.equal(payouts.length,1);
  assert.equal(payouts[0].opId,'fixture-pay-1');
  assert.equal(payouts[0].amountCents,4000);
  assert.equal(payouts[0].method,'transferencia');
  assert.equal(payouts[0].reference,'TX-123');
  assert.ok(payouts[0].items.some(i=>i.kind==='sale'));

  const after=(await app.request('/api/liquidaciones')).find(x=>x.ubicacionId===s.rack.id);
  assert.equal(after.stillDue,0);
  assert.equal(after.estado,'pagado');
  const exported=await app.request('/api/respaldo/exportar');
  assert.equal(exported.payouts.length,1);
  assert.equal(exported.ventas.find(v=>v.productoId===s.product.id).liquidada,true);
});

test('same explicit opId is idempotent even after the balance is already zero', async () => {
  const app=browser(); const s=await store(app);
  await app.request(`/api/productos/${s.product.id}/venta`, 'POST', {cantidad:1});
  const body={payeeId:s.alice.id,medioPago:'efectivo',opId:'fixture-idempotent'};
  const a=await app.request(`/api/liquidaciones/${s.rack.id}/marcar-pagado`,'POST',body);
  const b=await app.request(`/api/liquidaciones/${s.rack.id}/marcar-pagado`,'POST',body);
  assert.equal(b.existing,true);
  assert.equal(a.payoutId,b.payoutId);
  assert.equal((await app.request('/api/payouts')).length,1);
});

test('a mixed-person rack refuses one ambiguous payment and accepts separate payouts', async () => {
  const app=browser(); app.OCAuth={rolActual:()=> 'dueno'};
  const ana=await app.request('/api/promotoras','POST',{nombre:'Ana',comisionBase:40});
  const bob=await app.request('/api/promotoras','POST',{nombre:'Bob',comisionBase:20});
  const rack=await app.request('/api/ubicaciones','POST',{nombre:'Mixed Rack',tipo:'socio'});
  await app.request(`/api/ubicaciones/${rack.id}`,'PUT',{promotoraId:ana.id});
  const p=await app.request('/api/productos','POST',{nombre:'Mixed Item',barcode:'MIX-PAY',precio:100,costo:10,stockInicial:5,ubicacionId:rack.id});
  await app.request(`/api/productos/${p.id}/venta`,'POST',{cantidad:1});
  await app.request(`/api/productos/${p.id}/venta`,'POST',{cantidad:1,modoComision:'associate',promotoraId:bob.id});

  const response=await app.fetch('/api/payouts',{method:'POST',body:JSON.stringify({ubicacionId:rack.id,mes:new Date().toISOString().slice(0,7),medioPago:'efectivo'})});
  assert.equal(response.status,409);
  const err=await response.json();
  assert.match(err.error,/more than one associate/i);
  assert.equal(err.payees.length,2);

  /* The historical rack-wide endpoint remains compatible for old shells, but
     the new first-class payout API refuses ambiguity. New UI always picks a person. */
  await app.request(`/api/liquidaciones/${rack.id}/marcar-pagado`,'POST',{payeeId:ana.id,medioPago:'efectivo'});
  let liq=(await app.request('/api/liquidaciones')).find(x=>x.ubicacionId===rack.id);
  assert.equal(liq.estado,'pendiente');
  assert.equal(liq.payoutBalances.find(x=>x.payeeId===ana.id).due,0);
  assert.equal(liq.payoutBalances.find(x=>x.payeeId===bob.id).due,20);

  await app.request(`/api/liquidaciones/${rack.id}/marcar-pagado`,'POST',{payeeId:bob.id,medioPago:'transferencia'});
  liq=(await app.request('/api/liquidaciones')).find(x=>x.ubicacionId===rack.id);
  assert.equal(liq.estado,'pagado');
  assert.equal(liq.stillDue,0);
  assert.equal((await app.request('/api/payouts')).length,2);
});

test('payouts travel through sync once and are deduplicated by opId', async () => {
  const A=browser(); const s=await store(A);
  await A.request(`/api/productos/${s.product.id}/venta`,'POST',{cantidad:1});
  await A.request(`/api/liquidaciones/${s.rack.id}/marcar-pagado`,'POST',{payeeId:s.alice.id,medioPago:'efectivo',opId:'shared-op'});
  const B=browser(); B.OCAuth={rolActual:()=> 'dueno'}; B.receive(A);
  assert.equal((await B.request('/api/payouts')).filter(p=>p.opId==='shared-op').length,1);
  A.receive(B); B.receive(A);
  assert.equal((await A.request('/api/payouts')).filter(p=>p.opId==='shared-op').length,1);
  assert.equal((await B.request('/api/payouts')).filter(p=>p.opId==='shared-op').length,1);
});


test('reversal is append-only, preserves original payout and reopens amount due', async () => {
  const app=browser(); const s=await store(app);
  await app.request(`/api/productos/${s.product.id}/venta`,'POST',{cantidad:1});
  const pay=await app.request(`/api/liquidaciones/${s.rack.id}/marcar-pagado`,'POST',{payeeId:s.alice.id,medioPago:'cheque',opId:'pay-to-reverse'});
  const rev=await app.request(`/api/payouts/${pay.payoutId}/reverse`,'POST',{reason:'Cheque cancelled before delivery',opId:'reverse-pay-to-reverse'});
  assert.equal(rev.reversal.reversalOf,pay.payoutId);
  const history=await app.request(`/api/payouts?ubicacionId=${s.rack.id}`);
  assert.equal(history.length,2);
  assert.ok(history.some(p=>p.id===pay.payoutId));
  assert.ok(history.some(p=>p.reversalOf===pay.payoutId));
  const liq=(await app.request('/api/liquidaciones')).find(x=>x.ubicacionId===s.rack.id);
  assert.equal(liq.stillDue,40);
  assert.equal(liq.estado,'pendiente');
  assert.equal(liq.payoutHistory.some(p=>p.type==='reversal' && p.amount===-40),true);
});
