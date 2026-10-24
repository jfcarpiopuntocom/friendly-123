'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../docs/mock-backend.js'), 'utf8');
const section = (start, end) => {
  const a = source.indexOf(start), b = source.indexOf(end, a);
  assert.ok(a !== -1 && b > a, 'exact production source anchors');
  return source.slice(a, b);
};
const put = section('      if (path === "/api/config/retencion" && method === "PUT") {', '      /* LEALTAD (benchmark #5)');
const storageGuard = section('  let _guardadoEstrictoPendiente = null;', '  function _guardarEstadoLocalAhora(');
const catalogGuard = section('  function aplicarCatalogo(remoto, rolRemoto, nombreCanonicoYjs) {', '    const _demoRemoto =');
const pinCompletion = section('    if (promesasPins.length) Promise.all(promesasPins)', '    // Ambos caminos de sync');

function runner(mode, role = 'dueno') {
  let writes = 0, notified = 0, release, snapshots = [];
  const deps = {
    _rolLocal: () => role,
    _normRetencion: o => o && [0,7,14,30].includes(o.dias) ? { id:'retencion', dias:o.dias, rev:o.rev||null } : null,
    _revNueva: () => ({ c:2, d:'fixture' }),
    announced: () => { notified++; },
    J: (body,status=200) => ({body,status}),
    durable: (strict,snapshot) => {
      writes++; snapshots.push({strict, snapshot:JSON.parse(JSON.stringify(snapshot))});
      if (strict && mode === 'deferred') return new Promise(resolve => { release=resolve; });
      if (strict && mode === 'throw') return Promise.reject(new Error('quota'));
      return strict ? mode !== false : true;
    }
  };
  const compile = new Function('deps',
    'const {_rolLocal,_normRetencion,_revNueva,J}=deps;\n'
    + 'const RETENCION_DIAS=[0,7,14,30];\n'
    + 'let ajusteRetencion={id:"retencion",dias:7,rev:{c:1,d:"fixture"}};\n'
    + 'let movimientos=[],selloUltimo="original",_payoutConfirmando=false,_payoutCatalogosPendientes=[];\n'
    + 'const clonar=o=>JSON.parse(JSON.stringify(o));\n'
    + 'const avisarCatalogoCambiado=()=>deps.announced();\n'
    + 'const mov=(kind,details,announce=true)=>{movimientos.push({kind,details});selloUltimo="changed";if(announce)avisarCatalogoCambiado();};\n'
    + 'const _guardarEstadoLocalAhora=(strict)=>deps.durable(strict,{retencion:ajusteRetencion,movimientos});\n'
    + storageGuard + '\n'
    + catalogGuard + '\n'
    + 'if(remoto.retencion)ajusteRetencion=remoto.retencion;mov("merge-catalogo",{},false);guardarEstadoLocal();return {ok:true};}\n'
    + 'async function run(body){const path="/api/config/retencion",method="PUT";let debePersistir=true;try{\n'
    + put + '\n}finally{if(debePersistir)guardarEstadoLocal();}}\n'
    + 'function finishPin(pin){const promesasPins=[pin],cambioPersistible=false,remoto={deviceNombre:"synthetic"},window={};' + pinCompletion + '}\n'
    + 'return {run, finishPin, merge:aplicarCatalogo, photo:()=>guardarEstadoLocal(), setPayoutActive:x=>{_payoutConfirmando=x;}, drainPayout:()=>{_payoutConfirmando=false;let n=0;while(_payoutCatalogosPendientes.length){if(++n>5)throw Error("recursive queue");const q=_payoutCatalogosPendientes.shift();aplicarCatalogo(q.remoto,q.rolRemoto,q.nombreCanonicoYjs);}}, snapshot:()=>({retencion:ajusteRetencion,movimientos:movimientos.slice(),selloUltimo})};');
  return {...compile(deps), stats:()=>({writes,notified,snapshots}), release:ok=>release(ok)};
}

test('full storage: HTTP 507, unchanged policy, audit seal and no remote announcement',async()=>{
  const x=runner(false), result=await x.run({dias:14});
  assert.equal(result.status,507);
  assert.equal(x.snapshot().retencion.dias,7);
  assert.equal(x.snapshot().movimientos.length,0);
  assert.equal(x.snapshot().selloUltimo,'original');
  assert.equal(x.stats().notified,0);
  assert.equal(x.stats().writes,1);
});
test('durable success: single history, notice and strict save',async()=>{
  const x=runner(true),result=await x.run({dias:14});
  assert.equal(result.status,200);
  assert.equal(x.snapshot().retencion.dias,14);
  assert.equal(x.snapshot().movimientos.length,1);
  assert.equal(x.stats().notified,1);
  assert.equal(x.stats().writes,1);
});
test('rejected storage Promise also rolls back',async()=>{
  const x=runner('throw'),result=await x.run({dias:30});
  assert.equal(result.status,507);
  assert.equal(x.snapshot().retencion.dias,7);
  assert.equal(x.stats().notified,0);
});
test('invalid and unauthorized requests do not commit',async()=>{
  const bad=runner(true),denied=runner(true,'empleado');
  assert.equal((await bad.run({dias:99})).status,400);
  assert.equal((await denied.run({dias:14})).status,403);
  assert.equal(bad.stats().writes,0);
  assert.equal(denied.stats().writes,0);
});
test('incoming newer catalog and background photo survive rejected retention without stale snapshot',async()=>{
  const x=runner('deferred');
  const pending=x.run({dias:14});
  assert.equal(x.snapshot().retencion.dias,14);
  const remote={retencion:{id:'retencion',dias:30,rev:{c:9,d:'remote'}}};
  assert.equal(x.merge(remote,'dueno',true),false,'real catalog guard queues while retention is pending');
  const photo=x.photo();
  assert.equal(x.stats().writes,1,'background photo snapshot deferred');
  x.release(false);
  const result=await pending;
  await photo;
  assert.equal(result.status,507);
  assert.equal(x.snapshot().retencion.dias,30,'newer remote retention preserved');
  assert.deepEqual(x.snapshot().movimientos.map(m=>m.kind),['merge-catalogo'],'real merge audit preserved');
  assert.equal(x.stats().notified,0);
  const backgrounds=x.stats().snapshots.filter(s=>!s.strict);
  assert.ok(backgrounds.length>=1);
  assert.ok(backgrounds.every(s=>s.snapshot.retencion.dias===30),'photo cannot resurrect rejected local 14');
});
test('successful local ACK then remote merge: both ordered with no dropped audit',async()=>{
  const x=runner('deferred'), pending=x.run({dias:14});
  assert.equal(x.merge({retencion:{id:'retencion',dias:30,rev:{c:9,d:'remote'}}},'dueno',true),false);
  x.release(true);
  const result=await pending;
  assert.equal(result.status,200);
  assert.equal(x.snapshot().retencion.dias,30);
  assert.deepEqual(x.snapshot().movimientos.map(m=>m.kind),['config-retencion','merge-catalogo']);
  assert.equal(x.stats().snapshots[0].snapshot.retencion.dias,14);
});

test('retention and payout barriers hand off a remote merge without requeue loops',async()=>{
  const x=runner('deferred'),pending=x.run({dias:14});
  const remote={retencion:{id:'retencion',dias:30,rev:{c:9,d:'remote'}}};
  assert.equal(x.merge(remote,'dueno',true),false);
  x.setPayoutActive(true);
  x.release(false);
  assert.equal((await pending).status,507);
  assert.equal(x.snapshot().retencion.dias,7,'payout holds the queued remote state, not a rejected 14');
  x.drainPayout();
  assert.equal(x.snapshot().retencion.dias,30);
  assert.deepEqual(x.snapshot().movimientos.map(m=>m.kind),['merge-catalogo']);
});

test('PIN merge started before retention keeps its audit after failed retention',async()=>{
  const x=runner('deferred');
  let finish;
  x.finishPin(new Promise(resolve=>{finish=resolve}));
  const pending=x.run({dias:14});
  finish(true);
  await new Promise(resolve=>setImmediate(resolve));
  x.release(false);
  assert.equal((await pending).status,507);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(x.snapshot().retencion.dias,7);
  assert.deepEqual(x.snapshot().movimientos.map(m=>m.kind),['merge-catalogo']);
  assert.ok(x.stats().snapshots.some(s=>!s.strict && s.snapshot.movimientos.some(m=>m.kind==='merge-catalogo')));
});
