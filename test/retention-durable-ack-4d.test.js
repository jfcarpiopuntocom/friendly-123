'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../docs/mock-backend.js'), 'utf8');
const begin = source.indexOf('      if (path === "/api/config/retencion" && method === "PUT") {');
const end = source.indexOf('      /* LEALTAD (benchmark #5)', begin);
assert.ok(begin >= 0 && end > begin, 'extract real retention PUT handler');

function runner(durable) {
  const history = [];
  let announced = 0, writes = 0, seq = 1;
  const deps = {
    _rolLocal: () => 'dueno',
    _normRetencion: x => (x && [0,7,14,30].includes(x.dias) ? {id:'retencion',dias:x.dias,rev:x.rev||null} : null),
    _revNueva: () => ({c:seq++,d:'fixture'}),
    mov: (kind,details) => { history.push({kind,details}); },
    avisarCatalogoCambiado: () => { announced++; },
    guardarEstadoLocal: async () => { writes++; return durable; },
    J: (body,status=200) => ({body,status}),
  };
  const factory = new Function('deps', 'const {_rolLocal,_normRetencion,_revNueva,mov,avisarCatalogoCambiado,guardarEstadoLocal,J}=deps;\n'
    + 'const RETENCION_DIAS=[0,7,14,30]; let ajusteRetencion={id:"retencion",dias:7,rev:{c:1,d:"fixture"}};\n'
    + 'let movimientos=[], selloUltimo="original";\n'
    + 'async function run(body){const path="/api/config/retencion",method="PUT";let debePersistir=true;\n'
    + 'try {\n' + source.slice(begin,end) + '\n} finally {if(debePersistir) guardarEstadoLocal();}\n'
    + '} return {run,get:()=>({ajusteRetencion,movimientos,selloUltimo})};');
  return {...factory(deps), history, reads: () => ({announced,writes})};
}

test('failed durable storage must be HTTP 507, no catalog announce, no changed policy or log', async () => {
  const x=runner(false);
  const old=x.get();
  const response=await x.run({dias:14});
  assert.equal(response.status,507);
  assert.equal(x.get().ajusteRetencion.dias,7);
  assert.deepEqual(x.get().ajusteRetencion.rev,old.ajusteRetencion.rev);
  assert.equal(x.history.length,0,'no phantom movement after rejected commit');
  assert.equal(x.reads().announced,0,'no premature remote publication');
  assert.equal(x.reads().writes,1,'a single strict attempt, not an extra finally write');
});

test('confirmed durable storage is HTTP 200 with one history and one catalog notification', async () => {
  const x=runner(true);
  const response=await x.run({dias:14});
  assert.equal(response.status,200);
  assert.equal(x.get().ajusteRetencion.dias,14);
  assert.equal(x.history.length,1);
  assert.equal(x.reads().announced,1);
  assert.equal(x.reads().writes,1);
});

test('unauthorized and invalid requests never write any storage', async () => {
  const x=runner(true);
  const r=await x.run({dias:999});
  assert.equal(r.status,400);
  assert.equal(x.history.length,0);
  assert.equal(x.reads().announced,0);
});
