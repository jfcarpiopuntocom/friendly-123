'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const src=fs.readFileSync(path.join(__dirname,'../src/dashboard/dashboard-main.js'),'utf8');
const a=src.indexOf('  $("entrar").addEventListener("click", async function () {');
const b=src.indexOf('  /* ========================================================================\n     QUIEN TIENE ACCESO',a);
assert.ok(a>0&&b>a,'must extract actual Safari dashboard login click handler');
const handler=src.slice(a,b);
const LIC='F123-TEST-1234-1234-12345';
async function attempt({central='unavailable',localPin=false,admin=false,lockout=0,remote={ok:false,datos:{error:'denied'}},read=true,ownerAdoption=true}={}){
 const calls={central:0,local:0,remote:0,paint:0,adopt:0};let submit;
 const els={entrar:{disabled:false,addEventListener:(_,fn)=>submit=fn},codigo:{value:LIC},pin:{value:'201',focus(){}},msg:{style:{},textContent:''}};
 const sandbox={
  $:id=>els[id],normalizarCodigo:x=>x,codigoLocalActivo:()=>LIC,
  leerEstadoLocalActual:async()=>read?{_rev:2,productos:[],usuarios:[{rol:'admin',pin:'202',activo:true}]}:null,
  verificarAdminVigente:(pin,e)=>admin,
  verificarOwnerCentralDashboard:async()=>{calls.central++;return central;},
  window:{OCSecure:{segundosBloqueo:()=>lockout}},
  pinLocalOk:async()=>{calls.local++;return localPin;},
  pintarDesdeLocal:()=>{calls.paint++;return true;},
  conectar:async()=>{calls.remote++;},
  verificarPin:async()=>remote,
  recordarLicencia:()=>{},pulso:()=>{},pedirFoto:()=>{},cargarAcceso:()=>{},sinNadie:()=>{},
  ws:{close(){}},navigator:{onLine:true},Number,
  autorizado:false,_sesionLocal:false,codigoSesionActual:'',fotoToken:'',_ultimaRevRepintada:-1
 };
 vm.runInNewContext(handler,sandbox,{filename:'dashboard-actual-login.js'});
 await submit();
 return {calls,sandbox,els};
}
test('RED: official central Owner unlocks local Safari notebook despite stale browser PIN',async()=>{
 const x=await attempt({central:'owner',localPin:false});
 assert.equal(x.calls.central,1);
 assert.equal(x.calls.paint,1,'Owner approved by canonical authority paints on this device');
 assert.equal(x.calls.local,0,'stale PIN verifier should not add false failed attempts');
 assert.equal(x.calls.remote,1,'background sync may be attempted AFTER the local dashboard is already authorized');
 assert.equal(x.sandbox.autorizado,true);
});
test('RED: central rejection defeats stale local Owner verifier and never paints',async()=>{
 const x=await attempt({central:'wrong',localPin:true});
 assert.equal(x.calls.paint,0);
 assert.equal(x.sandbox.autorizado,false);
 assert.equal(x.calls.remote,0);
});
test('RED: current roster Admin remains authorized locally without invoking Owner authority',async()=>{
 const x=await attempt({central:'wrong',localPin:false,admin:true});
 assert.equal(x.calls.paint,1);
 assert.equal(x.calls.central,0,'Admin must not consume Owner PIN lockout');
 assert.equal(x.sandbox.autorizado,true);
});
test('RED: stale admin shortcut cannot bypass central Owner rejection',async()=>{
 const x=await attempt({central:'wrong',localPin:true,admin:false});
 assert.equal(x.sandbox.autorizado,false);
 assert.equal(x.calls.paint,0);
});
test('RED: central explicit lockout fails closed even with old local Owner proof',async()=>{
 const x=await attempt({central:'locked',localPin:true});
 assert.equal(x.sandbox.autorizado,false);
 assert.equal(x.calls.paint,0);
});
test('RED: local login lockout stays enforced even if central would approve',async()=>{
 const x=await attempt({central:'owner',localPin:true,lockout:44});
 assert.equal(x.sandbox.autorizado,false);
 assert.equal(x.calls.paint,0);
});
test('No local notebook remains remote-only with no credential bypass',async()=>{
 const x=await attempt({read:false,remote:{ok:false,datos:{error:'denied'}}});
 assert.equal(x.sandbox.autorizado,false);
 assert.equal(x.calls.paint,0);
});
