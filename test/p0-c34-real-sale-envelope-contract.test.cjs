'use strict';
// C34: exact-source contract between post-local-ACK sale stock event and C31
// typed 2.0 dispatcher. Product source is evaluated, no copied fake adapter.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const backend = fs.readFileSync(path.join(root,'docs/mock-backend.js'),'utf8');
const sync = fs.readFileSync(path.join(root,'docs/sync-yjs.js'),'utf8');
const stamp='const _opVenta = { productoId: p.id, delta: -cant };';
const endStamp='_prepararOpStock(_opVenta);';

function emittedSale({ productPrice=15, finalPrice=15, quantity=2, paid=30,
                       paymentMethod='cash', paidAmount=null, opIdVenta='sale-c34-real-0001',
                       courtesy=false, atomicCredit=false, stockAfter=3 }={}) {
  const start=backend.indexOf(stamp);
  assert.ok(start>0,'must exercise exact post-ACK _opVenta expression in real backend');
  const end=backend.indexOf(endStamp,start);
  assert.ok(end>start,'must preserve _prepararOpStock call after commercial envelope');
  const code=backend.slice(start,end+endStamp.length);
  const fn=new Function('p','cant','infoVenta','_esCortesia','precioEfectivo','montoBruto','_prepararOpStock','opIdVenta',
    code+'\nreturn _opVenta;');
  const p={id:'prod-123',precio:productPrice,stockActual:stockAfter};
  const captured=[];
  const out=fn(p,quantity,{formaPago:paymentMethod,montoPagado:paidAmount,fiadoAtomico:atomicCredit},
    courtesy,finalPrice,paid, x=>{captured.push(x)},opIdVenta);
  assert.equal(captured.length,1,'stock movement stays the exact same single event');
  assert.equal(out.productoId,'prod-123');
  assert.equal(out.delta,-quantity);
  return out;
}
function translate(raw){
  const start=sync.indexOf('    function _traducirOpLegadoAComando20(op, licenciaFallback) {');
  assert.ok(start>0,'exact C31 mapper must exist');
  const end=sync.indexOf('    API.traducirOpLegadoAComando20 =',start);
  assert.ok(end>start,'mapper closing boundary must exist');
  const fn=new Function(sync.slice(start,end)+'\nreturn _traducirOpLegadoAComando20;')();
  return fn({opId:'op_c34_sale_0001',tipo:'venta',
    _salaOrigen:'F123-ABCDEF1234567890',payload:raw},'F123-ABCDEF1234567890');
}

test('RED C34: verified cash sale event carries exact quantity/cents for actual C31 translator',()=>{
  const payload=emittedSale();
  assert.deepEqual(
    {quantity:payload.cantidad,amountCents:payload.amountCents,opId:payload.opId},
    {quantity:2,amountCents:3000,opId:'sale-c34-real-0001'});
  const command=translate(payload);
  assert.equal(command?.kind,'sale.record');
  assert.equal(command?.productId,'prod-123');
  assert.equal(command?.quantity,2);
  assert.equal(command?.amountCents,3000);
});
test('C34: commission-bearing special/partial/credit/courtesy/deficit sales must not become cash sale.record',()=>{
  const cases=[
    {paymentMethod:'fiado'},
    {paymentMethod:'cash',atomicCredit:true},
    {paymentMethod:'cash',courtesy:true,paid:0},
    {paymentMethod:'cash',paidAmount:5},
    {paymentMethod:'cash',productPrice:15,finalPrice:12,paid:24},
    {paymentMethod:'transferencia'},
    {paymentMethod:''},
    {paymentMethod:'cash',stockAfter:-1},
    {paymentMethod:'cash',productPrice:0,finalPrice:0,paid:0},
    {paymentMethod:'cash',opIdVenta:'sale:legacy-0001'}
  ];
  for(const c of cases){
    const payload=emittedSale(c);
    assert.equal(translate(payload),null,'unsafe sale must stay legacy for '+JSON.stringify(c));
  }
});
test('C34: never derive server amount from stock delta or invent paid total',()=>{
  const stockOnly={productoId:'prod-123',delta:-2};
  assert.equal(translate(stockOnly),null);
  assert.equal(emittedSale({paymentMethod:'cash',paid:NaN}).amountCents,undefined);
});
