"use strict";
const {test}=require("node:test"),assert=require("node:assert/strict");
const fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const src=fs.readFileSync(path.join(__dirname,"../docs/sync-realtime.js"),"utf8");
test("E1b-3 RED: legacy WebSocket is paused on hidden/lease-loss and resumes only for current visible tab",()=>{
 assert.match(src,/function puedeConectarLegado\(/);
 assert.match(src,/function sincronizarSesionLegada\(/);
 assert.match(src,/window\.addEventListener\("oc-tab-session-changed",\s*sincronizarSesionLegada\)/);
 assert.match(src,/document\.addEventListener\("visibilitychange",\s*sincronizarSesionLegada\)/);
 assert.match(src,/if \(!puedeConectarLegado\(\)\) \{[^}]*cerrarWsExistente\(\)/);
});
test("E1b-3 RED: legacy socket cannot escape async key/room derivation after tab becomes inactive",()=>{
 const a=src.indexOf("  async function conectar() {");
 const b=src.indexOf("/* ========================================================================== ",a);
 assert.ok(a>0&&b>a);
 const body=src.slice(a,b);
 assert.match(body,/const miGeneracion = \+\+_conexionGeneracion/);
 assert.match(body,/if \(!puedeConectarLegado\(\) \|\| miGeneracion !== _conexionGeneracion\) return;/);
 const checks=(body.match(/if \(!puedeConectarLegado\(\) \|\| miGeneracion !== _conexionGeneracion\) return;/g)||[]).length;
 assert.ok(checks>=2,"revalidate after each asynchronous step");
 assert.match(body,/ws\.onopen = \(\) => \{\s*if \(!puedeConectarLegado\(\)/);
});
test("E1b-3 RED: legacy listener lifecycle responds without touching business outbox",()=>{
 const a=src.indexOf("  function sincronizarSesionLegada() {");
 const b=src.indexOf("  /* UNA LICENCIA = UNA SALA",a);
 assert.ok(a>=0&&b>a);
 const script=src.slice(a,b).replace(/window\.addEventListener\("online",[\s\S]*?;\s*\}\);/,"");
 let hidden=false,lease=true,connected=0,closed=0,socket={readyState:1};
 const listeners={};
 const ctx={get ws(){return socket},set ws(v){socket=v},document:{
   get hidden(){return hidden},addEventListener:(n,f)=>listeners[n]=f},
  window:{OCTabSession:{canSync:()=>lease},addEventListener:(n,f)=>listeners[n]=f},
  leerSala:()=>({codigo:"TEAM-TEST"}),cerrarWsExistente:()=>{closed++;socket=null},
  conectar:()=>{connected++;socket={readyState:0}},reintentoMs:1000,
  WebSocket:{OPEN:1},_conexionGeneracion:0};
 vm.createContext(ctx);vm.runInContext("function puedeConectarLegado(){return !document.hidden && (!window.OCTabSession || window.OCTabSession.canSync());}\n"+script,ctx);
 hidden=true;listeners.visibilitychange();assert.equal(closed,1);assert.equal(connected,0);
 hidden=false;lease=false;listeners["oc-tab-session-changed"]();assert.equal(closed,2);assert.equal(connected,0);
 lease=true;listeners["oc-tab-session-changed"]();assert.equal(connected,1);
});


test("E1b-3 RED: stale legacy connection cannot overwrite a newer room key",()=>{
 const a=src.indexOf("  async function conectar() {"),b=src.indexOf("/* ========================================================================== ",a);
 const body=src.slice(a,b);assert.ok(a>0&&b>a);
 assert.match(body,/const claveDerivada = await derivarClave\(codigoNorm\)/);
 assert.match(body,/if \(!puedeConectarLegado\(\) \|\| miGeneracion !== _conexionGeneracion\) return;\s*claveActual = claveDerivada/);
 assert.match(body,/const salaDerivada = await idDeSala\(_salaCod\)/);
 assert.match(body,/if \(!puedeConectarLegado\(\) \|\| miGeneracion !== _conexionGeneracion\) return;\s*salaIdActual = salaDerivada/);
});
