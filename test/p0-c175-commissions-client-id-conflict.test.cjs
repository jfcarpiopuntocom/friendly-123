'use strict';
// C175 P0 source-executed report: a duplicate receiptId with inconsistent
// customer identity must not silently assign real commissions to whichever
// customer happened to arrive first. Preserve genuine totals independently.
const {test}=require('node:test'),assert=require('node:assert/strict');
const report=require('../docs/core/commission-history.js');
const base={id:'sale-one-opId',fechaLocal:'2026-11-21',productoId:'art',productoNombre:'Arte',
 ubicacionId:'rack-01',promotoraId:'associate-01',asociadoNombre:'Belén',
 cantidad:1,precioUnit:100,comisionAsociado:20};
const alice={...base,clienteId:'client-A',clienteNombre:'Alice'};
const bob={...base,clienteId:'client-B',clienteNombre:'Bob'};

test('C175 RED: duplicate sale ID from DIFFERENT clients cannot assign money to first arriving client',()=>{
 for(const sales of [[alice,bob],[bob,alice]]){
  const x=report.project({sales,group:'cliente',lang:'es'});
  assert.equal(x.totals.conflicts,0,'matching sale amounts are authentic');
  assert.equal(x.totals.customerConflicts,1,'customer attribution conflict visible');
  assert.equal(x.totals.count,1,'receipt ID must only count once');
  assert.equal(x.totals.commission,20,'do not hide authentic total for changed client attribution');
  assert.equal(x.groups.length,1,'one neutral attribution, not an arbitrary client');
  assert.equal(x.groups[0].id,'__f123_cliente_por_verificar__');
  assert.equal(x.groups[0].label,'Cliente por verificar');
  assert.equal(x.groups[0].commission,20);
  const html=report.render({sales,group:'cliente',lang:'es'});
  assert.match(html,/importe conservado, cliente por verificar/);
  assert.match(html,/Cliente por verificar/);
  assert.doesNotMatch(html,/<strong[^>]*>Alice<\/strong>|<strong[^>]*>Bob<\/strong>/);
  const general=report.project({sales,group:'total',lang:'es'});
  assert.equal(general.totals.commission,20,'primary Commissions KPI keeps authentic amount');
  assert.equal(general.totals.customerConflicts,0,'customer conflict only affects by-client breakdown');
 }
});

test('C175: when customerId absent, conflicting customer names use neutral attribution too',()=>{
 const a={...base,clienteNombre:'Ana'},b={...base,clienteNombre:'Luis'};
 const x=report.project({sales:[a,b],group:'cliente'});
 assert.equal(x.totals.customerConflicts,1);
 assert.equal(x.totals.commission,20);
 assert.equal(x.groups.length,1);
 assert.equal(x.groups[0].id,'__f123_cliente_por_verificar__');
});

test('C175: stable same client ID with changed display name is NOT an economic conflict',()=>{
 const renamed={...alice,clienteNombre:'Alicia'};
 for(const sales of [[alice,renamed],[renamed,alice]]){
  const x=report.project({sales,group:'cliente'});
  assert.equal(x.totals.customerConflicts,0);
  assert.equal(x.totals.conflicts,0);
  assert.equal(x.totals.count,1);
  assert.equal(x.totals.commission,20);
  assert.equal(x.groups.length,1);
  assert.equal(x.groups[0].id,'client-A');
  assert.equal(x.groups[0].commission,20);
 }
});

test('C175: true economic conflicts still fail closed even when client identity is equal',()=>{
 const diff={...alice,comisionAsociado:25};
 for(const sales of [[alice,diff],[diff,alice]]){
  const x=report.project({sales,group:'cliente',lang:'es'});
  assert.equal(x.totals.conflicts,1);
  assert.equal(x.totals.unknownCommission,1);
  assert.equal(x.totals.customerConflicts,0);
  assert.equal(x.groups.length,0);
  assert.match(report.render({sales,group:'total',lang:'es'}),/Por verificar/);
 }
});

test('C175: genuine replay and distinct sale IDs still count money once per receipt',()=>{
 const x=report.project({sales:[alice,{...alice},{...bob,id:'sale-two'}],group:'cliente'});
 assert.equal(x.totals.conflicts,0);
 assert.equal(x.totals.customerConflicts,0);
 assert.equal(x.totals.count,2);
 assert.equal(x.totals.gross,200);
 assert.equal(x.totals.commission,40);
 assert.equal(x.groups.length,2);
 assert.equal(x.groups.find(g=>g.id==='client-A').commission,20);
 assert.equal(x.groups.find(g=>g.id==='client-B').commission,20);
});

test('C175 RED: duplicate sale ID with absent promoter ID never credits arbitrary associate',()=>{
 const first={...base,promotoraId:undefined,asociadoNombre:'Seller A'};
 const second={...first,asociadoNombre:'Seller B'};
 for(const sales of [[first,second],[second,first]]){
  const x=report.project({sales,group:'comisionista',lang:'es'});
  assert.equal(x.totals.conflicts,0);
  assert.equal(x.totals.associateConflicts,1);
  assert.equal(x.totals.commission,20);
  assert.equal(x.groups.length,1);
  assert.equal(x.groups[0].id,'__f123_comisionista_por_verificar__');
  assert.equal(x.groups[0].commission,20);
  const html=report.render({sales,group:'comisionista',lang:'es'});
  assert.match(html,/importe conservado, comisionista por verificar/);
  assert.doesNotMatch(html,/<strong[^>]*>Seller A<\/strong>|<strong[^>]*>Seller B<\/strong>/);
  assert.equal(report.project({sales,group:'total'}).totals.commission,20);
 }
});

test('C175: split without payee identifiers and changed names conserves amount in neutral associate bucket',()=>{
 const first={...base,reparto:[
  {rol:'vendedor',nombre:'Seller A',monto:12},
  {rol:'asistente',nombre:'Helper A',monto:8}
 ]};
 const second={...first,reparto:[
  {rol:'asistente',nombre:'Helper B',monto:8},
  {rol:'vendedor',nombre:'Seller B',monto:12}
 ]};
 for(const sales of [[first,second],[second,first]]){
  const x=report.project({sales,group:'comisionista',lang:'es'});
  assert.equal(x.totals.conflicts,0,'role order does not alter money');
  assert.equal(x.totals.splitConflicts,0);
  assert.equal(x.totals.associateConflicts,1);
  assert.equal(x.totals.commission,20);
  assert.equal(x.groups.length,1);
  assert.equal(x.groups[0].id,'__f123_comisionista_por_verificar__');
  assert.equal(x.groups[0].commission,20);
 }
});

test('C175: split stable payee IDs with cosmetic rename remain two authentic people',()=>{
 const first={...base,reparto:[
  {rol:'vendedor',promotoraId:'payee1',nombre:'Seller A',monto:12},
  {rol:'asistente',promotoraId:'payee2',nombre:'Helper A',monto:8}
 ]};
 const second={...first,reparto:[
  {rol:'asistente',promotoraId:'payee2',nombre:'Helper B',monto:8},
  {rol:'vendedor',promotoraId:'payee1',nombre:'Seller B',monto:12}
 ]};
 const x=report.project({sales:[first,second],group:'comisionista'});
 assert.equal(x.totals.conflicts,0);
 assert.equal(x.totals.associateConflicts,0);
 assert.equal(x.totals.commission,20);
 assert.equal(x.groups.length,2);
 assert.equal(x.groups.find(g=>g.id==='payee1').commission,12);
 assert.equal(x.groups.find(g=>g.id==='payee2').commission,8);
});
