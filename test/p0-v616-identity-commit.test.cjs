'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const backend=fs.readFileSync(path.join(__dirname,'../docs/mock-backend.js'),'utf8');
const realtime=fs.readFileSync(path.join(__dirname,'../docs/sync-realtime.js'),'utf8');
const start=backend.indexOf('    cambiar(licencia, opts) {');
const split=backend.indexOf('    /* CLAIM / MERGE',start);
const end=backend.indexOf('  };\n\n  function _catalogoInterno',split);
assert.ok(start>=0&&split>start&&end>split);
const cambiar=backend.slice(start,split);
const reconciliar=backend.slice(split,end).match(/    reconciliar\(licencia\) \{[\s\S]*?\n    \},/)?.[0];
assert.ok(reconciliar);
const A='F123-SYNTHETIC-A',B='F123-SYNTHETIC-B';
function go({from=A,target=B,active='',owned=B,registry={},pending=false,fail='',claim=false}={}){
 const disk=new Map([
 ['f123_owned',JSON.stringify({licenseCode:owned,instanceId:'synthetic-only'})],
 ['f123_tienda_activa',active],['f123_tiendas',JSON.stringify(registry)],
 ['f123_estado_v4_A',JSON.stringify({nombreNegocio:'Original shop',productos:[{id:'item-a',stock:12}],ventas:[{id:'sale-a'}]})]
 ]);
 if(pending)disk.set('f123_join_pending_v1',JSON.stringify({licenseCode:target,instanceId:'synthetic-only'}));
 const code=[
 'let reloads=0,room="",writes=[];',
 'const localStorage={getItem:k=>disk.get(k)??null,setItem:(k,v)=>{writes.push(k);if(k===fail)throw Object.assign(new Error("Storage full"),{name:"QuotaExceededError"});disk.set(k,String(v))}};',
 'const _normLic=x=>String(x||"").trim().toUpperCase().replace(/\\s+/g,"");',
 'const _licenciaPropia=()=>JSON.parse(localStorage.getItem("f123_owned")||"{}").licenseCode||"";',
 'const _licenciaActual=()=>from;','const OC_STATE_SUFIJO=active;',
 'const guardarEstadoLocal=()=>{};',
 'const window={OCSyncControl:{fijarSala:x=>{room=x;return {ok:true}},resincronizar:()=>({ok:true})},dispatchEvent(){}};',
 'const CustomEvent=class{constructor(type,opts){this.type=type;this.detail=opts?.detail}};',
 'const location={reload:()=>{reloads++}};',
 'const obj={'+cambiar+reconciliar+'};window.OCTienda=obj;',
 'const result=claim?obj.reconciliar(target):obj.cambiar(target,{desde:from});',
 'return {result,reloads,room,active:disk.get("f123_tienda_activa"),owned:JSON.parse(disk.get("f123_owned")).licenseCode,oldData:disk.get("f123_estado_v4_A"),writes,reg:disk.get("f123_tiendas")};'
 ].join('\n');
 return new Function('disk','from','target','active','fail','claim',code)(disk,from,target,active,fail,claim);
}
test('normal joining B selects B and preserves all bytes of A',()=>{
 const r=go();
 assert.equal(r.result.ok,true);
 assert.equal(r.active,'::'+B);
 assert.match(r.oldData,/sale-a/);
});
test('P0: ambiguous v614 alias cannot choose an empty notebook without proof',()=>{
 const r=go({from:B,target:B,owned:B,pending:true,registry:{[A]:'',[B]:''}});
 assert.equal(r.result.ok,false);
 assert.equal(r.active,'');
 assert.equal(r.reloads,0);
 assert.match(r.oldData,/Original shop/);
});
test('P0: failed marker write cannot claim successful notebook switch or reload',()=>{
 const r=go({fail:'f123_tienda_activa'});
 assert.equal(r.result.ok,false);
 assert.equal(r.active,'');
 assert.equal(r.reloads,0);
 assert.equal(r.room,'');
});
test('P0: failed registry write cannot move notebook or room',()=>{
 const r=go({fail:'f123_tiendas'});
 assert.equal(r.result.ok,false);
 assert.equal(r.active,'');
 assert.equal(r.reloads,0);
 assert.equal(r.room,'');
});
test('P0: cross-license owner claim cannot strand current ledger by changing pointer without reload',()=>{
 const r=go({from:A,target:B,owned:A,claim:true});
 assert.equal(r.result.ok,false);
 assert.equal(r.active,'');
 assert.equal(r.owned,A);
 assert.equal(r.room,'');
 assert.match(r.oldData,/sale-a/);
});
test('same-license owner recovery remains possible',()=>{
 const r=go({from:A,target:A,owned:A,claim:true});
 assert.equal(r.result.ok,true);
 assert.equal(r.active,'');
});
test('P0: join must propagate notebook-switch failure instead of earlier activation success',()=>{
 const start=realtime.indexOf('    unirse(codigo) {');
 const end=realtime.indexOf('    desactivar() {',start);
 const part=realtime.slice(start,end);
 assert.match(part,/if\s*\(!c\s*\|\|\s*c\.ok\s*!==\s*true\)[\s\S]*?revertirJoin\(\);[\s\S]*?return\s*\{\s*ok:\s*false/);
});
