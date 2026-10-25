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

const {browser}=require('./helpers/browser.cjs');
const pauseUntil=async predicate=>{for(let i=0;i<150&&!predicate();i++)await Promise.resolve();assert.ok(predicate(),'deferred durable store reached');};
const sold=async(w,quantity)=>w.fetch('/api/productos/p24/venta',{method:'POST',body:JSON.stringify({cantidad:quantity})});
const state=async w=>w.request('/api/respaldo/exportar');

test('full backend: serial sales use one device PN counter, both receipts remain',async()=>{
  const w=browser();
  w.localStorage.setItem('f123_device_id','fixture-device-A');
  const a=await sold(w,2),first=await a.json();
  const b=await sold(w,3),second=await b.json();
  assert.equal(a.status,200);assert.equal(b.status,200);
  assert.notEqual(first.ventaId,second.ventaId);
  const data=await state(w),p=data.productos.find(p=>p.id==='p24');
  assert.equal(p.stockActual,75);
  assert.equal(p.stockBase,80);
  assert.deepEqual(Object.keys(p.stockPN),['fixture-device-A']);
  assert.equal(p.stockPN['fixture-device-A'].sub,5);
  assert.ok(data.ventas.some(v=>v.id===first.ventaId));
  assert.ok(data.ventas.some(v=>v.id===second.ventaId));
});

test('full backend: pending IndexedDB ACK shields Yjs, GET and first durable PN',async()=>{
  const w=browser();w.localStorage.setItem('f123_device_id','fixture-device-A');
  let release,firstSnapshot=null, emitted=0;
  w.OCSyncEmit=()=>{emitted++;return true};
  w.OCEstadoIDB={guardar:(snapshot)=>{firstSnapshot=JSON.parse(JSON.stringify(snapshot));return new Promise(resolve=>{release=resolve;});}};
  w.localStorage.setItem=()=>{throw Error('quota');};
  const inFlight=sold(w,2);
  await pauseUntil(()=>!!release);
  const p=firstSnapshot.productos.find(p=>p.id==='p24');
  assert.equal(p.stockActual,78);assert.equal(p.stockBase,80);
  assert.equal(p.stockPN['fixture-device-A'].sub,2);
  assert.equal(w.OCSync.catalogoPropio(),null,'provisional sale cannot seed Yjs');
  const remote={ubicaciones:[],productos:[{id:'remote-fixture',nombre:'REMOTE FIXTURE',ubicacionId:'bar',stockActual:4,precio:1}]};
  assert.equal(w.OCSync.aplicarCatalogo(remote,null),false,'remote merge held until ACK');
  let readDone=false;
  const read=state(w).then(result=>{readDone=true;return result;});
  await Promise.resolve();await Promise.resolve();
  assert.equal(readDone,false,'read must not observe provisional sale');
  assert.equal(emitted,0,'no stock announcement before ACK');
  release(true);
  const sale=await inFlight, data=await read;
  assert.equal(sale.status,200);
  assert.equal(emitted,1,'announce once');
  assert.ok(data.productos.some(p=>p.id==='remote-fixture'),'remote merge drained after ACK');
  assert.equal(data.productos.find(p=>p.id==='p24').stockPN['fixture-device-A'].sub,2);
});

test('full backend: failed IndexedDB ACK restores sale before remote merge, no ghost facts',async()=>{
  const w=browser();w.localStorage.setItem('f123_device_id','fixture-device-A');
  const before=await state(w);
  let release,emitted=0;
  w.OCSyncEmit=()=>{emitted++;return true};
  w.OCEstadoIDB={guardar:(_snapshot,strict)=>strict?new Promise(resolve=>{release=resolve;}):Promise.resolve(false)};
  const originalSetItem=w.localStorage.setItem;
  w.localStorage.setItem=()=>{throw Error('quota');};
  const inFlight=sold(w,2);await pauseUntil(()=>!!release);
  assert.equal(w.OCSync.aplicarCatalogo({ubicaciones:[],productos:[{id:'remote-fixture',nombre:'REMOTE FIXTURE',ubicacionId:'bar',stockActual:4,precio:1}]},null),false);
  release(false);
  const sale=await inFlight;
  w.localStorage.setItem=originalSetItem;delete w.OCEstadoIDB;
  const after=await state(w);
  assert.equal(sale.status,507);
  const oldP=before.productos.find(p=>p.id==='p24'),p=after.productos.find(p=>p.id==='p24');
  assert.equal(p.stockActual,oldP.stockActual);
  assert.equal(Object.hasOwn(p,'stockPN'),Object.hasOwn(oldP,'stockPN'));
  assert.equal(after.ventas.length,before.ventas.length);
  assert.deepEqual(after.movimientos.slice(before.movimientos.length).map(m=>m.tipo),['merge-catalogo'],
    'rejected local sale leaves no ghost audit; legitimate queued remote merge is preserved');
  assert.equal(emitted,0);
  assert.ok(after.productos.some(p=>p.id==='remote-fixture'),'queued remote facts survive rejected local sale');
});

test('sale 507 without remote merge has no outgoing catalog notification',async()=>{
 const w=browser(),before=await state(w),events=[];
 const dispatch=w.dispatchEvent.bind(w);
 w.dispatchEvent=e=>{if(e.type==='oc-catalogo-cambiado')events.push(e.type);return dispatch(e)};
 w.OCEstadoIDB={guardar:async()=>false};
 const save=w.localStorage.setItem;
 w.localStorage.setItem=()=>{throw Error('quota')};
 const response=await sold(w,2);
 w.localStorage.setItem=save;delete w.OCEstadoIDB;
 const after=await state(w);
 assert.equal(response.status,507);
 assert.equal(after.productos.find(p=>p.id==='p24').stockActual,before.productos.find(p=>p.id==='p24').stockActual);
 assert.deepEqual(events,[],'rejected sale cannot announce phantom stock');
});

test('sale exception before ACK restores previous stock, PN and audit',async()=>{
 const w=browser(),before=await state(w),p0=before.productos.find(p=>p.id==='p24');
 const labels=[];
 const dispatch=w.dispatchEvent.bind(w);
 w.dispatchEvent=e=>{if(e.type==='oc-catalogo-cambiado')labels.push(e.type);return dispatch(e)};
 let emitted=0;w.OCSyncEmit=()=>{emitted++;return true};
 const response=await w.fetch('/api/productos/p24/venta',{
  method:'POST',body:JSON.stringify({cantidad:2,info:{nombreEvento:{toString:null}}})
 });
 const after=await state(w),p1=after.productos.find(p=>p.id==='p24');
 assert.equal(response.status,500);
 assert.equal(p1.stockActual,p0.stockActual,'failed formatting must restore stock');
 assert.equal(Object.hasOwn(p1,'stockPN'),Object.hasOwn(p0,'stockPN'));
 assert.equal(after.ventas.length,before.ventas.length);
 assert.equal(after.movimientos.length,before.movimientos.length);
 assert.equal(emitted,0);assert.deepEqual(labels,[]);
});
