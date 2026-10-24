'use strict';
const {test}=require('node:test'), assert=require('node:assert/strict');
const {analyze,present}=require('../scripts/forensics/fiados-readonly.cjs');
const date='2026-09-29T16:00:00Z',dateLabel='2026-09-29';
const sale=(id,client)=>({id,clienteId:client,productoId:'ipa',fecha:date,precioUnit:5,cantidad:1});
const receipt=(id,client,ventaId)=>({id,tipo:'cartera_cargo',ts:Date.parse(date),
  datos:{clienteId:client,monto:5,motivo:'SALE ON CREDIT: CERVEZA IPA',...(ventaId?{ventaId}:{})}});
test('read-only: five legacy IPA receipts stay unresolved, not silently assigned by matching date/name/amount',()=>{
 const notebook={ventas:Array.from({length:5},(_,i)=>sale('sale-'+i,'customer-B')),
   productos:[{id:'ipa',nombre:'Cerveza IPA'}]};
 const ledger={hechos:Array.from({length:5},(_,i)=>receipt('cargo-'+i,'customer-A'))};
 const snapshot=JSON.stringify([notebook,ledger]);
 const report=analyze({notebook,ledger,date:dateLabel,term:'cerveza'});
 assert.equal(report.cargos.length,5);
 assert.equal(report.conteos.SIN_VENTA_VINCULADA,5);
 assert.ok(report.cargos.every(x=>x.ventaId===null && x.clienteVentaId===null));
 assert.equal(JSON.stringify([notebook,ledger]),snapshot,'no mutation of either input');
});
test('explicit sale from another customer is flagged; matching sale is not',()=>{
 const notebook={ventas:[sale('a','customer-A'),sale('b','customer-B')],productos:[]};
 const ledger={hechos:[receipt('charge-a','customer-A','a'),receipt('charge-b','customer-A','b')]};
 const out=analyze({notebook,ledger,date:dateLabel,term:'IPA'});
 assert.deepEqual(out.cargos.map(x=>x.estado),['VINCULO_COINCIDE','CLIENTE_EXPLICITO_DISTINTO']);
});
test('manual link/unlink remains evidence and never guesses a destination',()=>{
 const notebook={ventas:[sale('b','customer-B')],productos:[]};
 const ledger={hechos:[receipt('old','customer-A'),
   {id:'link1',tipo:'cartera_vinculo',ts:100,datos:{clienteId:'customer-A',cargoId:'old',ventaId:'b',accion:'vincular'}},
   {id:'link2',tipo:'cartera_vinculo',ts:200,datos:{clienteId:'customer-A',cargoId:'old',ventaId:null,accion:'desvincular'}}]};
 const out=analyze({notebook,ledger,date:dateLabel});
 assert.equal(out.cargos[0].estado,'SIN_VENTA_VINCULADA');
 assert.equal(out.cargos[0].ventaId,null);
});
test('missing Hechos input aborts: notebook backup alone is not proof of financial history',()=>{
 assert.throws(()=>analyze({notebook:{ventas:[],productos:[]},date:dateLabel}),/both notebook AND ledger/);
 assert.throws(()=>analyze({notebook:{ventas:[],productos:[]},ledger:{},date:dateLabel}),/ledger.hechos/);
});
test('read-only report redacts opaque identifiers unless explicitly selected',()=>{
 const notebook={ventas:[sale('sale-sensitive','customer-other')],productos:[]};
 const ledger={hechos:[receipt('receipt-sensitive','customer-A','sale-sensitive')]};
 const out=analyze({notebook,ledger,date:dateLabel});
 const redacted=present(out);
 assert.ok(!JSON.stringify(redacted).includes('receipt-sensitive'));
 assert.ok(!JSON.stringify(redacted).includes('customer-other'));
 assert.ok(!JSON.stringify(redacted).includes('SALE ON CREDIT'), 'no private motive text by default');
 assert.equal(present(out,{fullIds:true}).cargos[0].cargoId,'receipt-sensitive');
});

test('privacy: even 1-character customer identifiers are replaced by report-scoped aliases',()=>{
 const raw=analyze({notebook:{ventas:[],productos:[]},
   ledger:{hechos:[receipt('a','b')]},date:dateLabel});
 const safe=JSON.stringify(present(raw));
 assert.equal(safe.includes('"clienteCargoId": "b"'),false);
 assert.equal(safe.includes('"cargoId": "a"'),false);
 assert.match(safe,/ID-1/);
 assert.match(safe,/ID-2/);
});


test('ICU portability: date filter does not depend on locale-formatted output',()=>{
 const vm=require('node:vm'), fs=require('node:fs'), path=require('node:path');
 const source=fs.readFileSync(path.join(__dirname,'../scripts/forensics/fiados-readonly.cjs'),'utf8');
 const mod={exports:{}};
 const baseIntl=Intl;
 const simulatedIntl={DateTimeFormat:function(_locale,opts){
   const real=new baseIntl.DateTimeFormat('en-CA',opts);
   return {format:()=> '9/29/2026',formatToParts:date=>real.formatToParts(date)};
 }};
 vm.runInNewContext(source,{module:mod,require,Intl:simulatedIntl,console,process:{argv:[]}}, {filename:'fiados-readonly.cjs'});
 const report=mod.exports.analyze({
   notebook:{ventas:[],productos:[]},
   ledger:{hechos:[receipt('locale-proof','customer-A')]},
   date:dateLabel
 });
 assert.equal(report.cargos.length,1,'date must match even when en-CA displays MM/DD/YYYY');
 assert.equal(report.cargos[0].fecha,dateLabel);
});
