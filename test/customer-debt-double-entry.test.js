// Autor: Codex, 2026-10-07. Synthetic fixtures only; no customer data or network.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const LG=require('../docs/core/ledger.js');
const sale={id:'synthetic-credit-sale',fecha:'2026-10-07T12:00:00Z',clienteId:'synthetic-debtor',productoId:'synthetic-product',ubicacionId:'own',cantidad:1,precioUnit:18,info:{formaPago:'fiado'},split:null};
const build=cartera=>LG.buildLedger({ventas:[sale],ajustes:[],payouts:[],gastos:[],cartera,ubicaciones:[{id:'own',tipo:'propio'}]});
const net=(ledger,account)=>ledger.entries.flatMap(e=>e.lines).filter(l=>l.account===account).reduce((n,l)=>n+l.debitCents-l.creditCents,0);

test('the actual sale payment field posts on-account sales to receivables without inventing cash',()=>{
  const ledger=build([]);
  assert.equal(net(ledger,'1000'),0);
  assert.equal(net(ledger,'1100'),1800);
  assert.deepEqual(ledger.errors,[]);
});

test('a linked price correction is not cash received and does not reduce the canonical receivable twice',()=>{
  const ledger=build([{id:'synthetic-correction',tipo:'abono',monto:90,fecha:sale.fecha,clienteId:sale.clienteId,ventaId:sale.id,naturaleza:'correccion_venta'}]);
  assert.equal(net(ledger,'1000'),0);
  assert.equal(net(ledger,'1100'),1800);
  assert.deepEqual(ledger.errors,[]);
});

test('an actual customer payment still posts cash and reduces the debt',()=>{
  const ledger=build([{id:'synthetic-payment',tipo:'abono',monto:18,fecha:sale.fecha,clienteId:sale.clienteId}]);
  assert.equal(net(ledger,'1000'),1800);
  assert.equal(net(ledger,'1100'),0);
});
