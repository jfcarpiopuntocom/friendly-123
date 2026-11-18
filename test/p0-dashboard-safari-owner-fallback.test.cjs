'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
// Execute the published dashboard's real click handler, not an imagined imitation.
const source = fs.readFileSync(path.join(__dirname, '../src/dashboard/dashboard-main.js'), 'utf8');
const start = source.indexOf('  $("entrar").addEventListener("click", async function () {');
const end = source.indexOf('  /* ========================================================================\n     QUIEN TIENE ACCESO', start);
assert.ok(start >= 0 && end > start, 'real Entrar handler must be found');
const loginSource = source.slice(start, end);
const license = 'F123-TEST-1234-1234-12345'; // synthetic only

async function attempt({ local = {_rev:9}, localCode=license, pinResult=false,
  remoteResult={ok:true,datos:{rol:'dueno',fotoToken:'synthetic-token'}},
  remoteError=null, enteredCode=license } = {}) {
  const counters={ connected:0, verified:0, painted:0, snapshot:0, saved:0 };
  let clicked;
  const nodes={
    entrar:{disabled:false,addEventListener(type,cb){assert.equal(type,'click'); clicked=cb;}},
    codigo:{value:enteredCode}, pin:{value:'123',focus(){}},
    msg:{style:{},textContent:''}
  };
  const scope={
    $:id=>{assert.ok(nodes[id],id);return nodes[id];},
    leerEstadoLocalActual:async()=>local,
    normalizarCodigo:s=>s,
    codigoLocalActivo:()=>localCode,
    verificarAdminVigente:()=>false,
    verificarOwnerCentralDashboard:async()=>"unavailable",
    pinLocalOk:async()=>pinResult,
    pintarDesdeLocal:()=>{counters.painted++;return true;},
    conectar:async()=>{counters.connected++;if(remoteError) throw remoteError;},
    verificarPin:async()=>{counters.verified++;return remoteResult;},
    pedirFoto:()=>{counters.snapshot++;},cargarAcceso:()=>{},
    sinNadie:()=>{},pulso:()=>{},
    recordarLicencia:()=>{counters.saved++;},
    ws:{close(){}},
    navigator:{onLine:true},
    Number,
    autorizado:false,_sesionLocal:false,codigoSesionActual:'',
    _ultimaRevRepintada:-1, fotoToken:''
  };
  vm.runInNewContext(loginSource,scope,{filename:'dashboard-entrar-real.js'});
  assert.equal(typeof clicked,'function');
  await clicked();
  return {scope,counters,nodes};
}

test('RED: stale Safari local Owner verifier can be superseded only by encrypted remote Owner approval',async()=>{
  const r=await attempt();
  assert.equal(r.counters.connected,1,'must ask authorized peer instead of failing locally');
  assert.equal(r.counters.verified,1);
  assert.equal(r.scope.autorizado,true,'only affirmative remote Owner proof may authorize');
  assert.equal(r.scope._sesionLocal,false,'remote proof is not a local PIN proof');
  assert.equal(r.counters.painted,0,'stale local notebook is not trusted as current remote snapshot');
  assert.equal(r.counters.snapshot,1,'request current authorized snapshot');
});
test('wrong PIN rejected locally and remotely never exposes business',async()=>{
  const r=await attempt({remoteResult:{ok:false,datos:{error:'Invalid owner proof'}}});
  assert.equal(r.counters.connected,1,'still asks remote verification');
  assert.equal(r.counters.verified,1);
  assert.equal(r.scope.autorizado,false);
  assert.equal(r.counters.painted,0);
  assert.equal(r.counters.snapshot,0);
});
test('remote timeout after local mismatch never unlocks or exposes notebook',async()=>{
  const r=await attempt({remoteError:new Error('timeout')});
  assert.equal(r.scope.autorizado,false);
  assert.equal(r.counters.painted,0);
  assert.equal(r.counters.snapshot,0);
});
test('local lockout is not bypassed by a network peer',async()=>{
  const r=await attempt({pinResult:{bloqueado:37}});
  assert.equal(r.counters.connected,0);
  assert.equal(r.counters.verified,0);
  assert.equal(r.scope.autorizado,false);
});
test('valid local Owner still enters without network dependency',async()=>{
  const r=await attempt({pinResult:true,remoteError:new Error('offline')});
  assert.equal(r.scope.autorizado,true);
  assert.equal(r.scope._sesionLocal,true);
  assert.equal(r.counters.painted,1);
});
test('unrelated local license cannot be used as PIN proof or display another notebook',async()=>{
  const r=await attempt({localCode:'F123-TEST-9999-9999-99999',pinResult:true,
    remoteResult:{ok:false,datos:{error:'Invalid PIN'}}});
  assert.equal(r.scope.autorizado,false);
  assert.equal(r.counters.painted,0);
});

test('a remote Admin approval after a stale local verifier also requires authentic peer proof',async()=>{
  const r=await attempt({remoteResult:{ok:true,datos:{rol:'admin',fotoToken:'synthetic-admin-token'}}});
  assert.equal(r.counters.connected,1);
  assert.equal(r.counters.verified,1);
  assert.equal(r.scope.autorizado,true);
  assert.equal(r.scope._sesionLocal,false);
  assert.equal(r.counters.painted,0);
  assert.equal(r.counters.snapshot,1);
});
