'use strict';
// C151: actual shared Commissions projector must honor even ONE explicit payee.
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const report=require('../docs/core/commission-history.js');
function sale(overrides={}){
 return {id:'one-recipient',fecha:'2026-11-21',productoId:'book',productoNombre:'Libro',
  ubicacionId:'rack',cantidad:1,precioUnit:100,comisionAsociado:20,
  promotoraId:'seller',asociadoNombre:'Belén',asistenteNombre:'Lucía',
  reparto:[{rol:'asistente',promotoraId:'assistant',monto:20}],...overrides};
}
test('C151 RED: sole credited assistant receives her commission, never the storefront seller',()=>{
 const x=report.project({sales:[sale()],group:'comisionista',lang:'es'});
 assert.equal(x.totals.count,1);
 assert.equal(x.totals.gross,100);
 assert.equal(x.totals.commission,20);
 assert.equal(x.groups.length,1);
 assert.equal(x.groups[0].id,'assistant','use the explicit reparto payeeId even when there is only one row');
 assert.equal(x.groups[0].label,'Lucía');
 assert.equal(x.groups[0].commission,20);
 assert.doesNotMatch(report.render({sales:[sale()],group:'comisionista',lang:'es'}),/Belén/);
});
test('C151: one seller row, repeated receipt and empty split still preserve existing safety',()=>{
 const onlySeller=sale({reparto:[{rol:'vendedor',promotoraId:'seller',monto:20}]});
 const x=report.project({sales:[onlySeller,{...onlySeller}],group:'comisionista'});
 assert.equal(x.totals.count,1);
 assert.equal(x.totals.conflicts,0);
 assert.equal(x.totals.commission,20);
 assert.equal(x.groups[0].id,'seller');
 const noRows=sale({reparto:[]});
 const legacy=report.project({sales:[noRows],group:'comisionista'});
 assert.equal(legacy.totals.count,1);
 assert.equal(legacy.totals.commission,20);
 assert.equal(legacy.groups[0].id,'seller','empty split keeps established fallback');
});
test('C151: app and Dashboard continue to use exactly one read-only projector',()=>{
 const root=path.join(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
 assert.match(read('src/app/app-inline-01.js'),/OCCommissionHistory\.render/);
 assert.match(read('src/dashboard/dashboard-main.js'),/OCCommissionHistory\.render/);
 assert.match(read('docs/core/commission-history.js'),/Array\.isArray\(v\.reparto\)/);
});
