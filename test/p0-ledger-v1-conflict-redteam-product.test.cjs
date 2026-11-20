// Independent real-friendly-123/master RED gate; synthetic only.
// Full verified 9-case QA reused from private injertos PR #14, no runtime code changes.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const LG=require('../docs/core/ledger.js');
const F='2026-11-17T09:00:00.000Z';
const V=(id,price)=>({id,fecha:F,ubicacionId:'self',
  productoId:'synthetic-sku',cantidad:1,precioUnit:price,split:null});
const G=(id,amt)=>({id,fecha:F,ubicacionId:'self',monto:amt});
const empty=(extra={})=>({ventas:[],ajustes:[],gastos:[],cartera:[],payouts:[],
  ubicaciones:[{id:'self',tipo:'propio'}],...extra});
function booked(L,kind,id){return L.entries.filter(x=>x.factKind===kind&&x.factId===id)}
function balanced(L){return L.entries.every(e=>e.lines.reduce(
  (s,l)=>s+l.debitCents-l.creditCents,0)===0)}
test('baseline: repeated IDENTICAL sale id is idempotent and not a conflict',()=>{
  const L=LG.buildLedger(empty({ventas:[V('s1',25),V('s1',25)]}));
  assert.equal(L.errors.length,0);
  assert.equal(booked(L,'venta','s1').length,1);
  assert.equal(L.balances.accounts['1000'].balanceCents,2500);
});
test('RED: conflicting sale same id 25.00 vs 0.01 must be quarantined independent of input order',()=>{
  for(const pair of [[V('s1',25),V('s1',0.01)],
    [V('s1',0.01),V('s1',25)]]){
    const L=LG.buildLedger(empty({ventas:pair}));
    assert.ok(L.errors.some(x=>x.factKind==='venta'&&x.factId==='s1'&&
      /conflict|divergen|duplicad/i.test(x.motivo)),
      'a conflicting sale fact must be visible in audit errors');
    assert.equal(booked(L,'venta','s1').length,0,
      'money cannot be silently chosen by lexicographically lower JSON');
    assert.equal(L.balances.accounts['1000'].balanceCents,0);
  }
});
test('RED: one conflicting id does NOT suppress an independent valid sale',()=>{
  const L=LG.buildLedger(empty({
    ventas:[V('s1',25),V('s1',0.01),V('s2',40)]
  }));
  assert.equal(booked(L,'venta','s1').length,0);
  assert.equal(booked(L,'venta','s2').length,1);
  assert.equal(L.balances.accounts['1000'].balanceCents,4000);
  assert.equal(balanced(L),true);
});
test('RED: conflicting expense id must not silently choose one cash movement',()=>{
  const L=LG.buildLedger(empty({
    gastos:[G('g1',10),G('g1',100)]
  }));
  assert.ok(L.errors.some(x=>x.factKind==='gasto'&&x.factId==='g1'&&
    /conflict|divergen|duplicad/i.test(x.motivo)));
  assert.equal(booked(L,'gasto','g1').length,0);
  assert.equal(L.balances.accounts['1000'].balanceCents,0);
});
test('RED: customer debt collection same opId with two amounts is NOT a single arbitrary cash receipt',()=>{
  const a={id:'c1',opId:'one-collection-id',tipo:'abono',fecha:F,monto:10},
    b={...a,monto:100};
  const L=LG.buildLedger(empty({cartera:[a,b]}));
  assert.ok(L.errors.some(x=>x.factKind==='cobro'&&x.factId==='one-collection-id'&&
    /conflict|divergen|duplicad/i.test(x.motivo)));
  assert.equal(booked(L,'cobro','c1').length,0);
  assert.equal(L.balances.accounts['1000'].balanceCents,0);
});
test('safe corrections use NEW fact IDs; never mutate original economic event',()=>{
  const L=LG.buildLedger(empty({ventas:[V('s1',25),V('s2',0.01)]}));
  assert.equal(L.errors.length,0);
  assert.equal(booked(L,'venta','s1').length,1);
  assert.equal(booked(L,'venta','s2').length,1);
  assert.equal(L.balances.accounts['1000'].balanceCents,2501);
});

test('same sale with reordered object keys remains an identical legitimate retry',()=>{
 const a=V('s1',25);
 const b={precioUnit:25,cantidad:1,productoId:'synthetic-sku',
   ubicacionId:'self',fecha:F,id:'s1',split:null};
 const L=LG.buildLedger(empty({ventas:[a,b]}));
 assert.equal(L.errors.length,0,'same semantic fact is not a conflict');
 assert.equal(booked(L,'venta','s1').length,1);
 assert.equal(L.balances.accounts['1000'].balanceCents,2500);
});
test('same expense ID with identical payload repeats only once',()=>{
 const L=LG.buildLedger(empty({gastos:[G('g1',10),G('g1',10)]}));
 assert.equal(L.errors.length,0);
 assert.equal(booked(L,'gasto','g1').length,1);
 assert.equal(L.balances.accounts['1000'].balanceCents,-1000);
});

test('conflicting commission-adjustment same id is quarantined without discarding original sale',()=>{
 const a={id:'adj1',ventaId:'s1',fecha:F,ubicacionId:'self',
   montoComisionSocio:10};
 const L=LG.buildLedger(empty({
   ventas:[V('s1',25)],ajustes:[a,{...a,montoComisionSocio:20}]
 }));
 assert.ok(L.errors.some(x=>x.factKind==='ajuste'&&x.factId==='adj1'&&
   /conflict|divergen|duplicad/i.test(x.motivo)));
 assert.equal(booked(L,'ajuste','adj1').length,0);
 assert.equal(booked(L,'venta','s1').length,1);
 assert.equal(L.balances.accounts['1000'].balanceCents,2500);
 assert.equal(balanced(L),true);
});
