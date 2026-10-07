// Autor: Codex, 2026-10-07. Synthetic fixtures only; no customer data or network.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {browser}=require('./helpers/browser.cjs');

async function fixture(){
  const w=browser(); w.OCAuth={rolActual:()=> 'dueno'};
  const facts=[];
  w.AMG={Hechos:{registrar:async(tipo,datos)=>{
    const fact={id:'debt-fixture-'+facts.length,tipo,datos:JSON.parse(JSON.stringify(datos)),ts:Date.now()};
    facts.push(fact); return fact;
  },todos:async()=>facts,verificarCadenas:async()=>({ok:true})}};
  vm.runInContext(fs.readFileSync(require.resolve('../docs/cartera.js'),'utf8'),w);
  const customer=await w.request('/api/clientes','POST',{nombre:'Synthetic debtor'});
  const other=await w.request('/api/clientes','POST',{nombre:'Synthetic second debtor'});
  const product=await w.request('/api/productos','POST',{nombre:'Synthetic wine',barcode:'FIADO-LINK',precio:108,costo:5,stockInicial:5});
  const sale=await w.request('/api/productos/'+product.id+'/venta','POST',{cantidad:1,clienteId:customer.id,info:{formaPago:'fiado'}});
  return {w,facts,customer,other,product,sale};
}

test('an explicitly linked debt preserves the exact sale ID without rewriting older facts',async()=>{
  const s=await fixture();
  await s.w.request('/api/clientes/'+s.customer.id+'/fiar','POST',{monto:7,motivo:'Legacy manual debt'});
  const before=JSON.stringify(s.facts[0]);
  await s.w.request('/api/clientes/'+s.customer.id+'/fiar','POST',{monto:108,motivo:'Sale debt',ventaId:s.sale.ventaId});
  assert.equal(s.facts[1].datos.ventaId,s.sale.ventaId);
  assert.equal(s.facts[1].datos.clienteId,s.customer.id);
  assert.equal(JSON.stringify(s.facts[0]),before);
  assert.equal(s.facts[0].datos.ventaId,undefined,'manual/legacy debts remain unlinked');
  const balance=await s.w.request('/api/clientes/'+s.customer.id+'/cartera');
  assert.equal(balance.saldo,-115);
});

test('a sale link cannot charge a different customer or an unknown sale',async()=>{
  const s=await fixture();
  await assert.rejects(s.w.request('/api/clientes/'+s.other.id+'/fiar','POST',{monto:108,ventaId:s.sale.ventaId}));
  await assert.rejects(s.w.request('/api/clientes/'+s.customer.id+'/fiar','POST',{monto:108,ventaId:'missing-sale'}));
  assert.equal(s.facts.length,0,'rejected links leave no financial facts');
});

test('a sale link rejects a paid sale and a mismatched sale amount before posting money',async()=>{
  const s=await fixture();
  const paid=await s.w.request('/api/productos/'+s.product.id+'/venta','POST',{cantidad:1,clienteId:s.customer.id,info:{formaPago:'efectivo'}});
  await assert.rejects(s.w.request('/api/clientes/'+s.customer.id+'/fiar','POST',{monto:108,ventaId:paid.ventaId}));
  await assert.rejects(s.w.request('/api/clientes/'+s.customer.id+'/fiar','POST',{monto:18,ventaId:s.sale.ventaId}));
  assert.equal(s.facts.length,0);
});

test('repeating the linked debt request never posts the same sale twice',async()=>{
  const s=await fixture();
  const post=()=>s.w.request('/api/clientes/'+s.customer.id+'/fiar','POST',{monto:108,motivo:'Sale debt',ventaId:s.sale.ventaId});
  await Promise.all([post(),post(),post()]);
  await post();
  assert.equal(s.facts.length,1);
  assert.equal((await s.w.request('/api/clientes/'+s.customer.id+'/cartera')).saldo,-108);
});
