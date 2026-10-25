'use strict';
// v579 P0. Synthetic stock only; never uses real client records.
const {test}=require('node:test'), assert=require('node:assert/strict');
const fs=require('node:fs'), path=require('node:path');
const src=fs.readFileSync(path.join(__dirname,'../docs/mock-backend.js'),'utf8');
function part(start,end){const a=src.indexOf(start), b=src.indexOf(end,a); assert.ok(a>=0&&b>a,'source anchors: '+start); return src.slice(a,b);}
const sale=part('        const _fotoVenta = { stock: p.stockActual', '      if ((m = path.match(/^\\/api\\/ventas\\/([^/]+)\\/anular$/)))');
const prep=part('  function _prepararOpStock(payload, idOperacion) {','  function emitirOpStock(tipo, payload, preparado = false) {');
function prepare(p) {
  const keys=new Map([['f123_device_id','fixture-device']]);
  return new Function('p','keys',`const productos=[p],window={OCLatencia:{ahoraRelay:()=>null}},localStorage={getItem:k=>keys.get(k)||null,setItem:(k,v)=>keys.set(k,v)},uuid=()=> 'fixture';${prep};return _prepararOpStock;`)(p,keys);
}
test('sale: stock PN must enter first durable snapshot, and only then announce',()=>{
  const a=sale.indexOf('_prepararOpStock('), b=sale.indexOf('await guardarEstadoLocal(true, true)');
  const emit=sale.indexOf('emitirOpStock("venta"');
  assert.ok(a>=0&&a<b, 'prepare PN before durable ACK');
  assert.ok(emit>b && /emitirOpStock\("venta",\s*[^,]+,\s*true\)/.test(sale), 'emit once after commit without reapplying PN');
  assert.match(sale,/mov\("venta",[\s\S]*?false\);/, 'do not publish from audit before ACK');
  const p={id:'fixture-beer',stockActual:8};
  prepare(p)({productoId:p.id,delta:-2});
  assert.equal(p.stockBase,10);
  assert.equal(p.stockPN['fixture-device'].sub,2);
});
test('sale: rejected ACK restores exactly existing and absent PN metadata',()=>{
  const start=sale.indexOf('        const _fotoVenta ='), stop=sale.indexOf(';\n',start);
  assert.ok(start>=0&&stop>start);
  const capture=sale.slice(start,stop+1);
  const fail=sale.slice(sale.indexOf('        if (!_ventaGuardada) {'),sale.indexOf('        emitirOpStock("venta"'));
  assert.ok(fail.includes('return J('));
  const run=new Function('p','prepare',`const cant=2,ventas=[],movimientos=[],clonar=x=>JSON.parse(JSON.stringify(x)),tSeguro=(_k,s)=>s,J=(body,status)=>({body,status});let selloUltimo='fixture';${capture};p.stockActual-=cant;ventas.push({id:'v'});movimientos.push({id:'m'});prepare({productoId:p.id,delta:-cant});let _ventaGuardada=false;${fail}`);
  for(const p of [
    {id:'fixture-beer',stockActual:10},
    {id:'fixture-beer',stockActual:10,stockBase:12,stockPN:{peer:{add:3,sub:5}},stockTs:3000,stockDeficit:1}
  ]) {
    const before=JSON.stringify(p), out=run(p,prepare(p));
    assert.equal(out.status,507);
    assert.equal(JSON.stringify(p),before,'restore existing values AND absent keys');
  }
});
test('sale: in-flight attempt cannot be seeded, merged or read as committed',()=>{
  const incoming=part('  function aplicarCatalogo(remoto, rolRemoto, nombreCanonicoYjs) {','    const _demoRemoto =');
  const outgoing=part('    catalogoPropio() {','      _sembrarCategoriasLegado()');
  const fetch=part('  const _fetchConCandado = async function (url, opts) {','    const rolAlPedir=');
  assert.match(sale,/_ventaConfirmando\s*=\s*true/, 'sale locks provisional state');
  assert.match(sale,/finally\s*\{[\s\S]*?_ventaCatalogosPendientes/, 'sale must drain merge queue');
  assert.match(incoming,/_ventaConfirmando[\s\S]*?_ventaCatalogosPendientes/, 'remote merge waits for rollback/ACK');
  assert.match(outgoing,/_ventaConfirmando[\s\S]*?return null/, 'Yjs must not seed uncommitted stock');
  assert.match(fetch,/_ventaPendiente[\s\S]*?await _ventaPendiente/, 'reads await ACK/rollback');
});
