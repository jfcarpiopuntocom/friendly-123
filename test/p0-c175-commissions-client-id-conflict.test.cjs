'use strict';
// C175 P0: execute the production read-only Commissions projector.
// Duplicated receipt ID from two distinct customer identities must never
// attribute the same payable commission to an arbitrary customer by arrival order.
const {test}=require('node:test'),assert=require('node:assert/strict');
const path=require('node:path'),report=require('../docs/core/commission-history.js');
const base={id:'sale-one-opId',fechaLocal:'2026-11-21',productoId:'art',productoNombre:'Arte',
 ubicacionId:'rack-01',promotoraId:'associate-01',asociadoNombre:'Belén',
 cantidad:1,precioUnit:100,comisionAsociado:20};
const alice={...base,clienteId:'client-A',clienteNombre:'Alice'};
const bob={...base,clienteId:'client-B',clienteNombre:'Bob'};

test('C175 RED: same receipt ID with DIFFERENT customer IDs fails visibly closed in both replay orders',()=>{
 for(const rows of [[alice,bob],[bob,alice]]){
  const byClient=report.project({sales:rows,group:'cliente',lang:'es'});
  assert.equal(byClient.totals.conflicts,1);
  assert.equal(byClient.totals.unknownCommission,1);
  assert.equal(byClient.groups.length,0,'never silently credit first customer');
  assert.equal(byClient.totals.commission,0,'known subtotal alone must not count conflicting receipt');
  const total=report.render({sales:rows,group:'total',lang:'es'});
  assert.match(total,/Recibos con el mismo ID/);
  assert.match(total,/Por verificar/);
  assert.doesNotMatch(total,/(?:<b>Comisiones registradas<\/b>|<b>Total de comisiones<\/b>)[\s\S]*?\$20[,.]00/);
 }
});

test('C175: missing customer IDs with conflicting names also fail, not first-arrival wins',()=>{
 const noIdA={...base,clienteNombre:'Ana'},noIdB={...base,clienteNombre:'Luis'};
 const x=report.project({sales:[noIdA,noIdB],group:'cliente'});
 assert.equal(x.totals.conflicts,1);
 assert.equal(x.groups.length,0);
 assert.equal(x.totals.unknownCommission,1);
});

test('C175: same stable customer ID and changed display NAME remains one valid economic receipt',()=>{
 const renamed={...alice,clienteNombre:'Alicia'};
 for(const rows of [[alice,renamed],[renamed,alice]]){
  const x=report.project({sales:rows,group:'cliente',lang:'es'});
  assert.equal(x.totals.conflicts,0,'display-only rename must not invent money conflicts');
  assert.equal(x.totals.count,1);
  assert.equal(x.totals.gross,100);
  assert.equal(x.totals.commission,20);
  assert.equal(x.groups.length,1);
  assert.equal(x.groups[0].id,'client-A');
  assert.equal(x.groups[0].commission,20);
 }
});

test('C175: exact repeated receipt remains idempotent and distinct IDs keep full totals',()=>{
 const x=report.project({sales:[alice,{...alice},{...bob,id:'sale-two'}],group:'cliente'});
 assert.equal(x.totals.conflicts,0);
 assert.equal(x.totals.count,2);
 assert.equal(x.totals.gross,200);
 assert.equal(x.totals.commission,40);
 assert.equal(x.groups.length,2);
 assert.equal(x.groups.find(g=>g.id==='client-A').commission,20);
 assert.equal(x.groups.find(g=>g.id==='client-B').commission,20);
});
