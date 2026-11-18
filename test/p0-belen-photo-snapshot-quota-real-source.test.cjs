'use strict';
// Hermes STK-H1: reproduce REAL mock-backend export + strict save serialization.
// Pure synthetic 15 x 420 KiB dataURLs. No real customer/account/images.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const src=fs.readFileSync(path.join(__dirname,'../docs/mock-backend.js'),'utf8');
const start=src.indexOf('  function estadoActualExportable(opc) {');
const end=src.indexOf('  // Item 19:',start);
const store=src.indexOf('  function _guardarEstadoLocalAhora(');
assert.ok(start>0 && end>start && store>end, 'run actual source export and durable save serialization');
const exportCode=src.slice(start,end);
const saverCode=src.slice(store,store+4900);
const exp=/const crudo = (JSON\.stringify\([^\n;]+\));/.exec(saverCode);
assert.ok(exp,'must test exact source snapshot serializer expression');
function harness({count=15, size=420*1024, hash=true}={}){
 const encoded='data:image/jpeg;base64,'+'A'.repeat(size);
 const products=Array.from({length:count},(_,i)=>({
   id:'synthetic-'+i,stockActual:10,foto:encoded,
   ...(hash?{fotoHash:'sha256-test-'+String(i).padStart(3,'0'),fotoRev:'synthetic-rev'}:{})
 }));
 const locs=[{id:'synthetic-shelf',foto:encoded, ...(hash?{fotoHash:'sha256-shelf'}:{})}];
 const empty=[];
 const c={
   productos:products,ubicaciones:locs,ventas:empty,movimientos:empty,transferencias:empty,
   gastos:empty,ajustesComision:empty,payouts:empty,payoutConflicts:empty,payoutQuarantine:empty,
   sucursales:empty,promotoras:empty,clientes:empty,usuarios:empty,
   gastosMensuales:{},categoriasMeta:{},ajusteImpuesto:null,ajusteLealtad:null,
   ajusteRetencion:null,ajusteMoneda:null,
   _evidenciaEstadoAB:null,_payoutCore:()=>null, _localRev:0,
   _actividadExportable:()=>[],clonarProfundo:x=>JSON.parse(JSON.stringify(x)),
   instanceId:'synthetic-device',nombreNegocio:'SYNTHETIC QA',nombreNegocioTs:0,
   nombreNegocioRev:null,selloUltimo:null
 };
 const helperStart=src.indexOf('  function _estadoParaGuardarSinFotos(');
 const helper=(helperStart>0&&helperStart<store) ? src.slice(helperStart,store) : '';
 vm.runInNewContext(exportCode+'\n'+helper+'\nthis.exportable=estadoActualExportable;\n'+
    'this.serializeForStrictSave=function(vivo){return '+exp[1]+';};',c);
 return {c,products,locs,encoded};
}
test('STK-H1 RED: actual strict durable snapshot must fit 5 MiB with 15 confirmed photo pointers',()=>{
 const {c,products,encoded}=harness();
 const vivo=c.exportable({vivo:true});
 assert.equal(vivo.productos[0].foto,encoded,'in-memory UI must retain photo');
 const crudo=c.serializeForStrictSave(vivo);
 const bytes=Buffer.byteLength(crudo);
 const quota=5*1024*1024;
 // Synthetic A/B quota is the next boundary if strict IndexedDB is blocked.
 const storage={setItem(_k,v){if(Buffer.byteLength(v)>quota){
   const e=new Error('QuotaExceededError synthetic');e.name='QuotaExceededError';throw e;
 }}};
 assert.doesNotThrow(()=>storage.setItem('f123-ab',crudo),
   'durable commit cannot depend on re-inlining already confirmed large photos');
 assert.ok(bytes<quota,'durable local journal must not carry redundant photo base64');
 assert.equal(products[0].foto,encoded,'never mutate live product during snapshot projection');
});
test('STK-H1: portable backup export remains full-fidelity (existing bytes stay available)',()=>{
 const {c,encoded}=harness({count:1,size:256});
 const original=c.exportable();
 assert.equal(original.productos[0].foto,encoded);
 assert.equal(original.ubicaciones[0].foto,encoded);
 assert.equal(original.productos[0].fotoHash,'sha256-test-000');
});
test('STK-H1: unverified legacy inline photo with no durable hash MUST remain in snapshot',()=>{
 const {c,encoded}=harness({count:1,size:512,hash:false});
 const snap=c.serializeForStrictSave(c.exportable({vivo:true}));
 assert.ok(snap.includes(encoded),'never discard the only photo copy in legacy state');
});
test('STK-H1: source serializer only changes durable payload, not backup export API',()=>{
 assert.match(src,/estadoActualExportable\(\{ vivo: true \}\)/);
 assert.match(src,/function estadoActualExportable\(opc\)/);
 assert.doesNotMatch(exportCode,/delete\s+\w+\.foto|\.foto\s*=\s*null/);
});
