'use strict';
// Beer/stock P0: source-anchored, synthetic-only. Never touches actual idiomARTE.
const {test}=require('node:test'), assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const src=fs.readFileSync(path.join(__dirname,'../docs/mock-backend.js'),'utf8');
function exact(start,end){const a=src.indexOf(start),b=src.indexOf(end,a);assert.ok(a>=0&&b>a,'real source anchors '+start);return src.slice(a,b);}
const sale=exact('        const _fotoVenta = { stock: p.stockActual', '      if ((m = path.match(/^\\/api\\/ventas\\/([^/]+)\\/anular$/)))');
const productPrep=exact('  function _prepararOpStock(payload, idOperacion) {','  function emitirOpStock(tipo, payload, preparado = false) {');
const patch=exact('        const stockAntesEdicion = Number(p.stockActual) || 0;', '      // Borrado definitivo (dueno, doble confirmacion en la UI).');
function prepareWith(p) {
 const fakeLS=new Map([['f123_device_id','SYNTHETIC-PC']]);
 return new Function('p','fakeLS',`
  const productos=[p],window={OCLatencia:{ahoraRelay:()=>null}},
  localStorage={getItem:k=>fakeLS.get(k)||null,setItem:(k,v)=>fakeLS.set(k,v)},
  uuid=()=> 'synthetic-uuid';${productPrep}
  return _prepararOpStock;
 `)(p,fakeLS);
}
test('sales: PN/base/stock timestamp must be staged before durable snapshot',()=>{
 const before=10,cant=2;
 const p={id:'synthetic-beer',stockActual:before,stockTs:1000};
 const savePoint=sale.indexOf('await guardarEstadoLocal(true, true)');
 const preparePoint=sale.indexOf('_prepararOpStock(');
 assert.ok(savePoint>=0,'original durable sale gate present');
 assert.ok(preparePoint>=0&&preparePoint<savePoint,'PN ledger must be recorded before ACK, not after');
 // Concrete source-derived operation: a sale lowering from 10 to 8 creates base 10 and sub 2.
 p.stockActual-=cant;
 prepareWith(p)({productoId:p.id,delta:-cant});
 assert.equal(p.stockBase,10);
 assert.equal(p.stockPN['SYNTHETIC-PC'].sub,2);
});
test('failed durable sale restores exact pre-sale PN metadata, including absent keys',()=>{
 const p={id:'synthetic-beer',stockActual:10,stockTs:1000};
 const original=JSON.stringify(p);
 const capture=sale.slice(sale.indexOf('        const _fotoVenta'),sale.indexOf('        /* DATOS DEL EVENTO'));
 const fail=sale.slice(sale.indexOf('        if (!_ventaGuardada) {'),sale.indexOf('        emitirOpStock("venta"'));
 assert.ok(capture.includes('const _fotoVenta')&&fail.includes('return J('),'exact sale rollback anchors');
 const aux=new Function('p','prepare',`
  const cant=2,ventas=[],movimientos=[],uuid=()=> 'synthetic-sale',
        _ventaGuardada=false,tSeguro=(k,msg)=>msg,J=(body,status)=>({body,status}),
        clonar=x=>JSON.parse(JSON.stringify(x));
  let selloUltimo='initial';
  ${capture}
  ventas.push({id:'synthetic-sale'});
  movimientos.push({id:'synthetic-movement'});
  prepare({productoId:p.id,delta:-cant});
  ${fail}
 `);
 const response=aux(p,prepareWith(p));
 assert.equal(response.status,507);
 assert.equal(JSON.stringify(p),original,'a rejected sale cannot leave PN/base/clock changed in RAM');
});
test('bar conversion: stock change cannot publish to peers before durable commit',()=>{
 const emit=patch.indexOf('emitirOpStock("conversion-bar"');
 const save=patch.indexOf('await guardarEstadoLocal(true');
 assert.ok(emit>=0,'real bar conversion path');
 assert.ok(save>=0&&save<emit,'bar stock conversion must have a durable gate before publication');
});
