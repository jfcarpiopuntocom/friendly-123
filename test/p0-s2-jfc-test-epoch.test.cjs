'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const mock=fs.readFileSync(path.join(__dirname,'../docs/mock-backend.js'),'utf8');
const sync=fs.readFileSync(path.join(__dirname,'../docs/sync-yjs.js'),'utf8');
const first=mock.indexOf('  function _esLicenciaJfcParaS2() {');
const last=mock.indexOf('  let _demoRefrescado = false;',first);
assert.ok(first>0&&last>first,'real test-only cutover functions exist');
const code=mock.slice(first,last);
function harness({testLicense=false,borrar=true}={}) {
  const data=new Map([['f123_estado_v4_A','old-A'],['f123_estado_v4_B','old-B'],
    ['f123_estado_v4_ptr','A'],['f123_estado_v4_journal','old-journal'],
    ['f123_estado_v4_sello','old-sello'],['f123_estado_v4','old-legacy'],
    ['f123_owned','PIN-and-license-untouched'],['client_licensed','real-client-data']]);
  const storage={getItem:k=>data.has(k)?data.get(k):null,
    setItem:(k,v)=>data.set(k,String(v)),removeItem:k=>data.delete(k)};
  let emptied=0, mirrorDeletes=0;
  const ctx=vm.createContext({
    _licenciaActual(){return '';},_vaciarTiendaFresca(){emptied++;},
    _cargoBufferReal:true,_demoRefrescado:false,_estadoLecturaBloqueada:false,
    _estadoPublicableConfirmado:null,_huellaPublicable(){return 'empty';},
    window:{OCEstadoIDB:{soportado:true,async borrar(){mirrorDeletes++;return borrar;}}},
    localStorage:storage,Math,String,Error,console,
    OC_STATE_SUFIJO:'',OC_STATE_KEY:'f123_estado_v4',OC_STATE_PTR:'f123_estado_v4_ptr',
    OC_STATE_SELLO:'f123_estado_v4_sello',claveBuffer:c=>'f123_estado_v4_'+c
  });
  vm.runInContext(code,ctx);
  if(testLicense)ctx._esLicenciaJfcParaS2=()=>true;
  return {ctx,data,get emptied(){return emptied;},get mirrorDeletes(){return mirrorDeletes;}};
}
test('S2 never mutates data or auth for a client license',async()=>{
  const h=harness();
  assert.equal(h.ctx._prepararCorteJfcS2(),false);
  assert.equal(h.emptied,0);assert.equal(h.mirrorDeletes,0);
  assert.equal(h.data.get('client_licensed'),'real-client-data');
  assert.equal(h.data.get('f123_owned'),'PIN-and-license-untouched');
});
test('S2 JFC test cutover clears only active business and old mirror before sync',async()=>{
  const h=harness({testLicense:true});
  assert.equal(h.ctx._prepararCorteJfcS2(),true);
  assert.equal(await h.ctx.window.__f123JfcResetReady,true);
  assert.equal(h.mirrorDeletes,1);assert.equal(h.emptied,1);
  for(const k of ['f123_estado_v4_A','f123_estado_v4_B','f123_estado_v4_ptr','f123_estado_v4_journal','f123_estado_v4_sello'])
    assert.equal(h.data.has(k),false,k);
  assert.equal(h.data.get('f123_estado_v4'),'');
  assert.equal(h.data.get('f123_jfc_s2_epoch_20261101'),'ok');
  assert.equal(h.data.get('f123_owned'),'PIN-and-license-untouched');
  assert.equal(h.data.get('client_licensed'),'real-client-data');
  assert.equal(h.ctx._prepararCorteJfcS2(),false,'idempotent after reset');
});
test('S2 does not turn on sync when mirror reset fails',async()=>{
  const h=harness({testLicense:true,borrar:false});
  assert.equal(h.ctx._prepararCorteJfcS2(),true);
  assert.equal(await h.ctx.window.__f123JfcResetReady,false);
  assert.equal(h.ctx._estadoLecturaBloqueada,true);
  assert.equal(h.data.has('f123_jfc_s2_epoch_20261101'),false);
});
test('S2 every updated device derives same fresh room and waits for local cutover',()=>{
  assert.match(sync,/codigo \+ "::jfc-test-epoch-2026-11-01"/);
  assert.match(sync,/if \(window\.__f123JfcResetReady && await window\.__f123JfcResetReady !== true\)/);
  assert.match(mock,/if \(_corteJfcS2\) return; \/\/ old test mirror must never restore/);
  assert.match(sync,/API\.esLicenciaPruebaJfc = _salaId !== codigo/);
});

test('S2 a license entered after the PIN screen boot also gates the fresh room',()=>{
  assert.ok(mock.includes('window.__f123PrepareJfcReset = _prepararCorteJfcS2'));
  assert.ok(sync.includes('if (typeof window.__f123PrepareJfcReset === "function") window.__f123PrepareJfcReset();'));
  assert.ok(sync.indexOf('window.__f123PrepareJfcReset()') < sync.indexOf('await window.__f123JfcResetReady'));
});

test('S2 blocks an IDB recovery started before a late PIN-screen reset',()=>{
  assert.match(mock,/if \(_corteJfcS2 \|\| window\.__f123JfcResetReady\) return; \/\/ asynchronous read may predate S2/);
  assert.match(mock,/if \(_corteJfcS2 \|\| window\.__f123JfcResetReady\) return; \/\/ includes PIN entered after boot/);
});
