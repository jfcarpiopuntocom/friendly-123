'use strict';
// Regression: an on-account obligation survives interruption between the
// durable sale and the optional legacy receipt, without duplicate debt.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { browser } = require('./helpers/browser.cjs');

async function fixture() {
  const facts=[];
  const w=browser();
  w.OCAuth={rolActual:()=> 'dueno'};
  w.AMG={Hechos:{
    registrar:async(tipo,datos)=> {const f={id:'f'+facts.length,tipo,datos:JSON.parse(JSON.stringify(datos)),ts:1000+facts.length};facts.push(f);return f;},
    todos:async()=>facts,verificarCadenas:async()=>({ok:true})
  }};
  vm.runInContext(fs.readFileSync(require.resolve('../docs/cartera.js'),'utf8'),w);
  const c=await w.request('/api/clientes','POST',{nombre:'Synthetic fiado client'});
  const p=await w.request('/api/productos','POST',{nombre:'Synthetic fiado item',barcode:'FIADO-ATOMIC-NEW',precio:108,costo:5,stockInicial:20});
  return {w,facts,c,p};
}
const sale=(s,flag=true)=>s.w.request('/api/productos/'+s.p.id+'/venta','POST',{
  cantidad:1,clienteId:s.c.id,info:{formaPago:'fiado',...(flag?{fiadoAtomico:true}:{})}
});
const balance=(s)=>s.w.request('/api/clientes/'+s.c.id+'/cartera');

test('fiado obligation is durable as part of the sale before a separate receipt',async()=>{
  const s=await fixture();const r=await sale(s);
  const v=s.w.catalog().ventas.find(x=>x.id===r.ventaId);
  assert.equal(v.info.fiadoAtomico,true);
  assert.equal(s.facts.length,0);
  assert.equal((await balance(s)).saldo,-108);
  assert.equal((await balance(s)).historial.filter(m=>m.tipo==='cargo').length,1);
});

test('an ordinary receipt of the same sale replaces, not adds to, durable debt',async()=>{
  const s=await fixture();const r=await sale(s);
  assert.equal((await balance(s)).saldo,-108);
  await s.w.request('/api/clientes/'+s.c.id+'/fiar','POST',{monto:108,motivo:'Sale on credit',ventaId:r.ventaId});
  assert.equal(s.facts.filter(x=>x.tipo==='cartera_cargo').length,1);
  assert.equal((await balance(s)).saldo,-108);
  assert.equal((await balance(s)).historial.filter(m=>m.tipo==='cargo').length,1);
});

test('editing price and voiding a marked sale updates the debt without new fact',async()=>{
  const s=await fixture();const r=await sale(s);
  await s.w.request('/api/ventas/'+r.ventaId,'PATCH',{precioUnit:18});
  assert.equal((await balance(s)).saldo,-18);
  await s.w.request('/api/ventas/'+r.ventaId+'/anular','POST',{});
  assert.equal((await balance(s)).saldo,0);
  assert.equal(s.facts.length,0);
});

test('real customer payment offsets the sale obligation without a fabricated receipt',async()=>{
  const s=await fixture();await sale(s);
  await s.w.request('/api/clientes/'+s.c.id+'/abonar','POST',{monto:108,motivo:'Real payment'});
  assert.equal((await balance(s)).saldo,0);
  assert.equal(s.facts.filter(x=>x.tipo==='cartera_abono').length,1);
});

test('old unmarked sales retain prior behavior, preserving regression contracts',async()=>{
  const s=await fixture();const r=await sale(s,false);
  assert.equal((await balance(s)).saldo,0);
  await s.w.request('/api/clientes/'+s.c.id+'/fiar','POST',{monto:108,motivo:'Legacy linked credit',ventaId:r.ventaId});
  assert.equal((await balance(s)).saldo,-108);
});

test('a marker is rejected by backend unless credit sale has a customer',async()=>{
  const s=await fixture();
  const r=await s.w.request('/api/productos/'+s.p.id+'/venta','POST',{
    cantidad:1,info:{formaPago:'efectivo',fiadoAtomico:true}
  });
  assert.equal(s.w.catalog().ventas.find(v=>v.id===r.ventaId).info.fiadoAtomico,false);
});
