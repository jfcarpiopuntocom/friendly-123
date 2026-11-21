'use strict';
// C149: Commissions A+B projection must key split payees by identity/role, not array order.
// No backend writes; test the exact production projector shared by both UIs.
const {test}=require('node:test'),assert=require('node:assert/strict');
const report=require('../docs/core/commission-history.js');
function sale(){
 return {id:'sale-split-C149',fecha:'2026-11-21',productoId:'book',
  productoNombre:'Libro',ubicacionId:'rack-1',cantidad:1,precioUnit:100,
  comisionAsociado:20,promotoraId:'person-seller',asociadoNombre:'Belén',
  asistenteNombre:'Lucía',reparto:[
   {rol:'vendedor',promotoraId:'person-seller',monto:12},
   {rol:'asistente',promotoraId:'person-assistant',monto:8}
  ]};
}
test('C149 RED: same economic split reordered on remote replay is not a conflicting sale in either receipt order',()=>{
 const a=sale(),b={...a,reparto:a.reparto.slice().reverse()};
 for(const sales of [[a,b],[b,a]]){
  const result=report.project({sales,group:'comisionista',lang:'es'});
  assert.equal(result.totals.conflicts,0,'same payee/role/amount must not conflict because of array order');
  assert.equal(result.totals.count,1);
  assert.equal(result.totals.gross,100);
  assert.equal(result.totals.commission,20);
  assert.equal(result.groups.length,2);
  const perId=Object.fromEntries(result.groups.map(x=>[x.id,x]));
  assert.equal(perId['person-seller'].label,'Belén','seller label follows role/payee, not index');
  assert.equal(perId['person-assistant'].label,'Lucía','assistant label follows role/payee, not index');
  assert.equal(perId['person-seller'].commission,12);
  assert.equal(perId['person-assistant'].commission,8);
 }
});
test('C149: true payee amount or role disagreement under the same sale id remains an explicit conflict',()=>{
 const a=sale(),bad={...a,reparto:a.reparto.slice().reverse().map(r=>({...r}))};
 bad.reparto.find(r=>r.promotoraId==='person-assistant').monto=9;
 const result=report.project({sales:[a,bad],group:'comisionista',lang:'es'});
 assert.equal(result.totals.conflicts,1);
 assert.equal(result.totals.count,0);
 assert.equal(result.groups.length,0);
 assert.equal(result.totals.unknownCommission,1);
 const changedRole={...a,reparto:a.reparto.map(r=>({...r,rol:r.rol==='vendedor'?'asistente':'vendedor'}))};
 assert.equal(report.project({sales:[a,changedRole]}).totals.conflicts,1,
   'a role change may change obligations and must not be collapsed');
});
test('C149: explicit per-payee name wins over position and preserves third split beneficiary',()=>{
 const a=sale();
 a.reparto.push({rol:'colaborador',promotoraId:'person-third',nombre:'María',monto:1});
 a.comisionAsociado=21;
 const result=report.project({sales:[a],group:'comisionista',lang:'es'});
 const byId=Object.fromEntries(result.groups.map(x=>[x.id,x]));
 assert.equal(byId['person-third'].label,'María');
 assert.equal(byId['person-third'].commission,1);
 assert.equal(result.totals.commission,21);
 assert.equal(result.totals.count,1);
});
