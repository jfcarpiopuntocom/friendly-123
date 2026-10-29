'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const src=fs.readFileSync(path.join(__dirname,'../docs/sync-realtime.js'),'utf8');
const at=src.indexOf('    unirse(codigo) {'),end=src.indexOf('    desactivar() {',at);
assert.ok(at>0&&end>at,'extract the actual production join method');
const method=src.slice(at,end);
const OWN='F123-SYNTHETIC-OWN',OTHER='F123-SYNTHETIC-OTHER';
function exercise({from=OWN,target=OWN,result={ok:true,mismo:true},active=true,available=true}={}){
  const originalNotebook='{"nombreNegocio":"Original synthetic store","productos":[{"id":"item-1","stock":12}],"ventas":[{"id":"sale-1"}]}';
  const disk=new Map([
    ['f123_owned',JSON.stringify({licenseCode:from,instanceId:'synthetic-pwa'})],
    ['f123_sync_room',JSON.stringify({codigo:from})],
    ['f123_estado_v4_A',originalNotebook]
  ]);
  const fn=new Function('disk','from','target','switchResult','active','available',`
    let yjsPause=0,yjsResume=0,legacyConnect=0,events=0;
    const localStorage={getItem:k=>disk.has(k)?disk.get(k):null,
      setItem:(k,v)=>disk.set(k,String(v)),removeItem:k=>disk.delete(k)};
    const normalizarCodigo=c=>String(c||'').trim().toUpperCase();
    const _esLord=()=>false,_registrarAcceso=()=>{};
    const conectar=()=>{legacyConnect++};
    const reintentoMs=1000,intentosSeguidos=0;
    const leerSala=()=>JSON.parse(localStorage.getItem('f123_sync_room')||'null');
    const self={crypto:{randomUUID:()=> 'synthetic-pwa'}};
    const CustomEvent=class {constructor(name,options){this.type=name;this.detail=options?.detail}};
    const y=available?{estado:active?'activo':'apagado',canal:{
      pausar:()=>{yjsPause++},reanudar:()=>{yjsResume++}
    }}:null;
    const window={OCTienda:{licenciaActual:()=>from,cambiar:()=>switchResult},
      OCYjs:y,dispatchEvent:()=>{events++}};
    const obj={activar:(code)=>{localStorage.setItem('f123_sync_room',JSON.stringify({codigo:normalizarCodigo(code)}));return {ok:true}},${method}};
    const reply=obj.unirse(target);
    return {reply,yjsPause,yjsResume,legacyConnect,events,
      saved:disk.get('f123_estado_v4_A'),owned:JSON.parse(disk.get('f123_owned')).licenseCode,
      pending:disk.get('f123_join_pending_v1')};
  `);
  return fn(disk,from,target,result,active,available);
}
test('rejoining the same notebook explicitly retries encrypted Yjs PIN/name recovery exactly once',()=>{
  const r=exercise();
  assert.equal(r.reply.ok,true);
  assert.equal(r.reply.mismo,true);
  assert.equal(r.legacyConnect,1);
  assert.equal(r.yjsPause,1,'Yjs catalog must be reconnected, not just legacy sync');
  assert.equal(r.yjsResume,1,'one bounded explicit retry');
  assert.equal(r.events,1);
  assert.equal(r.owned,OWN);
  assert.match(r.saved,/sale-1/,'ledger bytes remain untouched');
  assert.match(r.saved,/stock":12/,'inventory remains untouched');
});
test('same-license retry before Yjs initialization preserves data and leaves startup event',()=>{
  const r=exercise({active:false});
  assert.equal(r.reply.ok,true);
  assert.equal(r.yjsPause,0);
  assert.equal(r.yjsResume,0);
  assert.equal(r.events,1);
  assert.match(r.saved,/Original synthetic store/);
});
test('switching to another notebook must not reconnect the OLD encrypted Yjs room',()=>{
  const r=exercise({from:OWN,target:OTHER,result:{ok:true,cambiado:true}});
  assert.equal(r.reply.ok,true);
  assert.equal(r.yjsPause,0);
  assert.equal(r.yjsResume,0);
  assert.equal(r.owned,OTHER);
  assert.match(r.saved,/sale-1/);
});
test('failed business selection restores previous license without triggering Yjs or data mutation',()=>{
  const r=exercise({from:OWN,target:OTHER,result:{ok:false,error:'Synthetic identity conflict'}});
  assert.equal(r.reply.ok,false);
  assert.equal(r.owned,OWN);
  assert.equal(r.yjsPause,0);
  assert.equal(r.yjsResume,0);
  assert.match(r.saved,/stock":12/);
});
