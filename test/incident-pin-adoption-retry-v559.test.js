"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const code=fs.readFileSync(path.join(__dirname,"../docs/mock-backend.js"),"utf8");
const start=code.indexOf("    if (promesasPins.length) Promise.all(promesasPins).then(");
const stop=code.indexOf("    // Ambos caminos de sync",start);
assert.ok(start>0&&stop>start,"real asynchronous PIN adoption continuation found");
function fixture(results,settings={}) {
  const timers=[],events=[],room=settings.room||"synthetic-room";
  let applications=0,persisted=0;
  const y={roomId:room,estado:"activo",canal:{recuperando:false},
    _store:{aplicar(){applications++;}}};
  const win={OCYjs:y,dispatchEvent:(ev)=>events.push({type:ev.type,detail:ev.detail})};
  const ctx={window:win,CustomEvent:class {constructor(type,init){this.type=type;this.detail=init?.detail;}},
    setTimeout:(cb,ms)=>{const t={cb,ms,cancelled:false};timers.push(t);return t;},
    clearTimeout:t=>{if(t)t.cancelled=true;},
    promesasPins:results.map(x=>Promise.resolve(x)),
    cambioPersistible:false,remoto:{deviceNombre:"synthetic"},
    agregadasU:0,agregadosP:0,actualizados:0,miembrosAgregados:0,
    miembrosActualizados:0,miembrosQuitados:0,clientesAgregados:0,
    mov:()=>{},guardarEstadoLocal:async()=>{persisted++;return true;},
    avisarCatalogoCambiado:()=>{},Promise,Math,Number,JSON,Object};
  vm.createContext(ctx);vm.runInContext(code.slice(start,stop),ctx);
  return {win,y,timers,events,counts:()=>({applications,persisted}),
    settle:async()=>{await Promise.resolve();await Promise.resolve();await Promise.resolve();await Promise.resolve();}};
}
test("P0 failed credential persistence schedules bounded re-apply of CURRENT remote state",async()=>{
  const f=fixture([false]);await f.settle();
  assert.equal(f.timers.length,1,"must retry instead of silently dropping adoption");
  assert.ok(f.timers[0].ms>=500);
  assert.equal(f.events.length,1,"signal pending, without exposing any PIN");
  assert.deepEqual(Object.keys(f.events[0].detail||{}).sort(),["pendiente"]);
  f.timers[0].cb();
  assert.equal(f.counts().applications,1);
});
test("P0 changed license room cancels stale credential retries",async()=>{
  const f=fixture([false]);await f.settle();assert.equal(f.timers.length,1);
  f.y.roomId="new-shop";f.timers[0].cb();
  assert.equal(f.counts().applications,0);
});
test("P0 successful credential adoption does not schedule retries",async()=>{
  const f=fixture([true]);await f.settle();
  assert.equal(f.timers.length,0);
  assert.equal(f.counts().persisted,1);
});
test("P0 partial credential adoption persists successes and retries only current Yjs state",async()=>{
  const f=fixture([true,false]);await f.settle();
  assert.equal(f.timers.length,1);
  assert.equal(f.counts().persisted,1);
  assert.equal(f.events.length,1);
});
