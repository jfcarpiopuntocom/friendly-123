'use strict';
// C247 (JFC 23 nov 2026, Belen): Commissions filters are cumulative: dates + associate + product + rack + customer narrow the SAME sales.
const {test}=require('node:test');const assert=require('node:assert/strict');
global.window=global;require('../docs/core/commission-history.js');const H=global.OCCommissionHistory||window.OCCommissionHistory;
const V=(id,dia,p,prod,ub,cli,com)=>({id,fecha:`2026-11-${dia}T15:00:00.000Z`,cantidad:1,precioUnit:100,comisionAsociado:com,netoCasa:100-com,comisionPct:com,promotoraId:p,asociadoNombre:p,productoId:prod,productoNombre:prod,ubicacionId:ub,ubicacionNombre:ub,clienteId:cli,clienteNombre:cli});
const sales=[V('a1','03','Ana','taza','r1','c1',40),V('a2','12','Ana','plato','r1','c2',40),V('b1','05','Beto','taza','r2','c1',30),V('b2','20','Beto','plato','r2','c3',30)];
const n=f=>H.project({sales,group:'total',zone:'America/Guayaquil',...f}).totals.count;
test('C247: no filters = everything; each filter narrows; they add up (AND); removing one restores the other',()=>{
 assert.equal(n({}),4);
 assert.equal(n({filtros:{comisionista:['Ana']}}),2);
 assert.equal(n({from:'2026-11-10',to:'2026-11-30'}),2);
 assert.equal(n({from:'2026-11-10',to:'2026-11-30',filtros:{comisionista:['Ana']}}),1,'dates + associate = intersection, associate filter does not break');
 assert.equal(n({from:'2026-11-10',to:'2026-11-30',filtros:{comisionista:['Ana'],producto:['taza']}}),0);
 assert.equal(n({filtros:{comisionista:['Ana','Beto'],producto:['taza']}}),2,'several values inside one filter = OR');
 assert.equal(n({filtros:{comisionista:['Ana'],producto:['plato']}}),1);
 assert.equal(n({filtros:{comisionista:[]}}),4,'empty list = no filter');
});
test('C247: facets come from the date range only and never shrink with the other filters',()=>{
 const f=H.facets({sales,from:'2026-11-10',to:'2026-11-30',zone:'America/Guayaquil'});
 assert.deepEqual(f.comisionista.map(x=>x.id),['Ana','Beto']);
 assert.equal(H.facets({sales,from:'2026-11-01',to:'2026-11-04',zone:'America/Guayaquil'}).comisionista.length,1);
});
