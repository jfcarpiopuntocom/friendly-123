'use strict';
// The actual deployed canary script, executed with Playwright replaced by a
// fully synthetic, network-free browser. No real PIN, license or user data.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const script=fs.readFileSync(path.join(__dirname,'../scripts/canario-union-fria.cjs'),'utf8');
const SECRET='SECRET_CANARIO_FICTICIO_NO_IMPRIMIR';
const LICENSE='F123-FAKE-NEVER-REAL';
function suspiciousError(nameHostile=false) {
  const e=Error(SECRET);
  if(nameHostile)e.name=SECRET;
  return e;
}
async function fakeCanary(throwAt, {hostileName=false}={}) {
  const logs=[];let exitCode=null,keypadClicks=0,now=0;
  const callbacks={};
  const pad={waitFor:async()=>{},click:async()=>{keypadClicks++;},isVisible:async()=>true};
  const page={
    on(name,callback){callbacks[name]=callback;},
    setDefaultTimeout(){},
    async goto(){
      if(throwAt==='PAGEERROR'){
        callbacks.pageerror?.(suspiciousError(true));
        throw suspiciousError(false);
      }
      if(throwAt==='NAVEGACION')throw suspiciousError(hostileName);
    },
    locator(){return {first:()=>pad};},
    async click(selector){
      if(throwAt==='UNION'&&selector==='#oc-ue-confirmar')throw suspiciousError(hostileName);
    },
    async fill(){},
    async evaluate(fn){
      if(String(fn).includes('licenciaAdoptada:'))return {
        licenciaAdoptada:true,syncCodeIgual:true,salaCorrecta:true,tieneDispositivo:true,
        tieneRoomYjs:true,tieneCanalCatalogo:true,catalogoRecuperando:true,
        hidratacionLocalPendiente:false,catalogoIdbSincronizado:true,
        catalogoSinPendientesCausales:false,tieneMetadatosPin:false,
        catalogoPadresFaltantes:2,catalogoClientesAplicados:1,catalogoEstructurasAplicadas:1
      };
      return null;
    },
    async waitForTimeout(ms){now+=ms;if(throwAt==='RECUPERACION'&&ms===5000)throw suspiciousError(hostileName);}
  };
  const fakeProcess={
    argv:['node','scripts/canario-union-fria.cjs'],
    env:{F123_CANARIO_LICENCIA:LICENSE},
    exit(code){exitCode=code;}
  };
  const ctx={
    require(name){
      assert.equal(name,'playwright');
      return {chromium:{launch:async()=>{
        if(throwAt==='LANZAMIENTO')throw suspiciousError(true);
        return {newPage:async()=>page,close:async()=>{}};
      }}};
    },
    process:fakeProcess,
    console:{log:(...a)=>logs.push(a.join(' ')),error:(...a)=>logs.push(a.join(' '))},
    Date:class FakeDate extends Date{static now(){return now;}},
    setTimeout:()=>1,clearTimeout(){}
  };
  vm.runInNewContext(script,ctx,{filename:'canario-union-fria.cjs',timeout:5000});
  // Let the canary's async IIFE and catch complete without real timers.
  await new Promise(resolve=>setImmediate(resolve));
  await new Promise(resolve=>setImmediate(resolve));
  return {logs,exitCode,keypadClicks};
}
for(const phase of ['NAVEGACION','UNION','RECUPERACION']) {
  test('coldjoin RED: '+phase+' exception yields allowlisted stage, no secrets or Owner attempts',async()=>{
    const got=await fakeCanary(phase);
    assert.equal(got.exitCode,1,'canary remains a failure');
    assert.ok(got.logs.includes('CANARIO_ERROR_ETAPA: '+phase),'must classify the failed phase');
    assert.ok(got.logs.includes('FALLA EXCEPCION: Error durante la unión'),'generic stable parser remains');
    assert.ok(!got.logs.join('\n').includes(SECRET),'exception payload never printed');
    assert.ok(!got.logs.join('\n').includes(LICENSE),'synthetic license never printed');
    assert.equal(got.keypadClicks,phase==='NAVEGACION'?0:3,'no accidental extra Owner PIN attempts');
  });
}
test('coldjoin RED: hostile Error.name is sanitized inside join catch',async()=>{
  const got=await fakeCanary('NAVEGACION',{hostileName:true});
  assert.equal(got.exitCode,1);
  assert.ok(got.logs.includes('CANARIO_ERROR_ETAPA: NAVEGACION'));
  assert.ok(got.logs.includes('FALLA EXCEPCION: Error durante la unión'));
  assert.ok(!got.logs.join('\n').includes(SECRET));
  assert.equal(got.keypadClicks,0);
});
test('coldjoin RED: pageerror with attacker-controlled name cannot reveal token',async()=>{
  const got=await fakeCanary('PAGEERROR');
  assert.equal(got.exitCode,1);
  assert.ok(got.logs.some(s=>s.startsWith('CANARIO_JS_ERRORES:')),'pageerror is still reported');
  assert.ok(!got.logs.join('\n').includes(SECRET),'unsafe error name never logged');
  assert.equal(got.keypadClicks,0);
});
test('coldjoin RED: outer launch catch never prints untrusted Error.name',async()=>{
  const got=await fakeCanary('LANZAMIENTO');
  assert.equal(got.exitCode,1);
  assert.ok(got.logs.includes('FALLA CANARIO: Error'));
  assert.ok(!got.logs.join('\n').includes(SECRET));
  assert.equal(got.keypadClicks,0);
});
