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

// Claude 2026-10-07: REWRITTEN. Codex's prototype test fed a cartera_abono with naturaleza=correccion_venta and
// expected the ledger to skip it. That branch was removed (nothing writes such facts: a price correction in Sold
// writes NO cartera fact; the debt is read from the sale). The intent that survives: a correction is never cash.
test('a price correction of a credit sale is never cash: the sale posts its CURRENT value to receivables, no abono exists', () => {
  const ledger=build([]); // sale already corrected to 18 and no cartera fact written by the correction
  assert.equal(net(ledger,'1000'),0);
  assert.equal(net(ledger,'1100'),1800);
  assert.deepEqual(ledger.errors,[]);
});

test('overpaid after a correction: the ordinary payment is real cash and receivables go negative (credit in favor)',()=>{
  const ledger=build([{id:'synthetic-paid-before-fix',tipo:'abono',monto:108,fecha:sale.fecha,clienteId:sale.clienteId}]);
  assert.equal(net(ledger,'1000'),10800);
  assert.equal(net(ledger,'1100'),1800-10800);
});

test('an actual customer payment still posts cash and reduces the debt',()=>{
  const ledger=build([{id:'synthetic-payment',tipo:'abono',monto:18,fecha:sale.fecha,clienteId:sale.clienteId}]);
  assert.equal(net(ledger,'1000'),1800);
  assert.equal(net(ledger,'1100'),0);
});
