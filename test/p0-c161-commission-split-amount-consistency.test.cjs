'use strict';
// C161: source-executed read-only commission history must NEVER show incompatible money totals.
// The backend's reparto invariant is Σ(payee.monto cents) = comisionAsociado cents.
const {test}=require('node:test'),assert=require('node:assert/strict');
const report=require('../docs/core/commission-history.js');
function sale(overrides={}){
 return {id:'sale-consistency',fecha:'2026-11-21',productoId:'book',productoNombre:'Libro',ubicacionId:'rack1',
   cantidad:1,precioUnit:100,comisionAsociado:20,
   promotoraId:'seller',asociadoNombre:'Belén',asistenteNombre:'Lucía',
   reparto:[{rol:'vendedor',promotoraId:'seller',monto:12},{rol:'asistente',promotoraId:'assistant',monto:8}],
   ...overrides};
}
test('C161 RED: mismatch of explicit split vs receipt commission is flagged, never an apparently exact sum',()=>{
 const bad=sale({reparto:[{rol:'vendedor',promotoraId:'seller',monto:12},{rol:'asistente',promotoraId:'assistant',monto:9}]});
 for(const group of ['producto','comisionista']){
  const x=report.project({sales:[bad],group,lang:'es'});
  assert.equal(x.totals.count,1,'do not make sale disappear or invent a refund');
  assert.equal(x.totals.gross,100);
  assert.equal(x.totals.splitConflicts,1,'inconsistent recorded split must be visible');
  assert.equal(x.totals.unknownCommission,1,'whole-sale commission sum is not verified');
  assert.ok(x.groups.every(g=>g.unknownCommission>0),'no misleading exact per-payee amount');
  assert.match(report.render({sales:[bad],group,lang:'es'}),/role="alert"/);
  assert.match(report.render({sales:[bad],group,lang:'es'}),/Por verificar/);
 }
});
test('C161: missing or unsafe payee amount is also fail-closed, not quietly coerced to zero',()=>{
 for(const value of [null,'bad',Number.POSITIVE_INFINITY]){
  const v=sale({reparto:[{rol:'vendedor',promotoraId:'seller',monto:12},
    {rol:'asistente',promotoraId:'assistant',monto:value}]});
  const x=report.project({sales:[v],group:'comisionista'});
  assert.equal(x.totals.splitConflicts,1);
  assert.equal(x.totals.unknownCommission,1);
  assert.ok(x.groups.every(g=>g.unknownCommission>0));
 }
});
test('C161: exact cent-level split and reversed identical receipt remain correct',()=>{
 const v=sale(),inverted={...v,reparto:v.reparto.slice().reverse()};
 for(const sales of [[v,inverted],[inverted,v]]){
  const x=report.project({sales,group:'comisionista',lang:'es'});
  assert.equal(x.totals.count,1);assert.equal(x.totals.gross,100);
  assert.equal(x.totals.commission,20);
  assert.equal(x.totals.conflicts,0);assert.equal(x.totals.splitConflicts,0);
  assert.equal(x.totals.unknownCommission,0);
  assert.equal(x.groups.find(g=>g.id==='seller').commission,12);
  assert.equal(x.groups.find(g=>g.id==='assistant').commission,8);
 }
});
