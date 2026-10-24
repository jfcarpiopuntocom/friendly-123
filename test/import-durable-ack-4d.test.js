'use strict';
// 4D/1AAA: execute the exact production import route in a synthetic notebook.
// No client storage, network, license, real pictures, or production endpoint.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const src = fs.readFileSync(path.join(__dirname, '../docs/mock-backend.js'), 'utf8');
const a = src.indexOf('      if (path === "/api/respaldo/importar") {');
const b = src.indexOf('      if (path === "/api/liquidaciones")', a);
assert.ok(a !== -1 && b > a, 'production route anchors must exist');
const route = src.slice(a, b);

function scenario({ quota = false, role = 'dueno', valid = true, commit = true, suffix = '', staleReadback = false } = {}) {
  const initial = {
    productos: [{ id: 'old', stockActual: 12 }],
    movimientos: [{ id: 'old-mov', sello: 'old-seal' }],
    nombreNegocio: 'Original', usuarios: [{ id: 'owner', pin: '555' }],
    configuracion: { categoriasMeta: { ceramics: { estado: 'visible' } } }
  };
  const imported = {
    productos: [{ id: 'new', stockActual: 0 }],
    movimientos: [], nombreNegocio: 'Imported',
    usuarios: [{ id: 'owner', pin: '123' }],
    configuracion: { categoriasMeta: { ceramics: { estado: 'oculta' } } },
    schemaVersion: 3
  };
  const ledger = new Map();
  let current = structuredClone(initial), applied = 0, saves = 0, backupAttempts = 0;
  const deps = {
    OC_STATE_KEY: 'f123_estado_v4', OC_STATE_SUFIJO: suffix,
    localStorage: {
      setItem(k, v) {
        backupAttempts++;
        if (quota) throw Error('QuotaExceededError');
        ledger.set(k, v);
      },
      getItem(k) { return staleReadback ? null : (ledger.get(k) || null); }
    },
    _rolLocal: () => role,
    validarRespaldo: () => valid ? '' : 'Invalid backup',
    estadoActualExportable: () => structuredClone(current),
    aplicarRespaldo: backup => { current = structuredClone(backup); applied++; },
    guardarEstadoLocal: () => { saves++; return Promise.resolve(commit); },
    J: (body, status = 200) => ({ body, status })
  };
  const run = new Function('d', `
    const {localStorage, _rolLocal, validarRespaldo, estadoActualExportable,
      aplicarRespaldo, guardarEstadoLocal, J, OC_STATE_KEY, OC_STATE_SUFIJO} = d;
    return async function(body) {
      const path = '/api/respaldo/importar';
      let debePersistir = true;
      try { ${route} }
      finally { if (debePersistir) guardarEstadoLocal(); }
    };
  `)(deps);
  return { run: () => run(imported), initial, imported,
    inspect: () => ({ current, applied, saves, backupAttempts,
      preimageKey: 'f123_estado_v4' + suffix + '_preimport',
      preimage: ledger.has('f123_estado_v4' + suffix + '_preimport')
        ? JSON.parse(ledger.get('f123_estado_v4' + suffix + '_preimport')) : null }) };
}

test('1AAA: quota rejects recovery preimage -> HTTP 507, original business untouched', async () => {
  const x = scenario({ quota: true });
  const reply = await x.run();
  assert.equal(reply.status, 507);
  assert.deepEqual(x.inspect().current, x.initial);
  assert.equal(x.inspect().applied, 0);
  assert.equal(x.inspect().saves, 0);
});
test('1AAA: legitimate import preserves an exact original recovery preimage', async () => {
  const x = scenario();
  const reply = await x.run();
  assert.equal(reply.status, 200);
  assert.deepEqual(x.inspect().preimage, x.initial);
  assert.deepEqual(x.inspect().current, x.imported);
});
test('1AAA: owner-only authorization and invalid file reject BEFORE mutation', async () => {
  const denied = scenario({ role: 'empleado' }), invalid = scenario({ valid: false });
  assert.equal((await denied.run()).status, 403);
  assert.equal((await invalid.run()).status, 400);
  assert.equal(denied.inspect().applied, 0);
  assert.equal(invalid.inspect().applied, 0);
});
test('1AAA RED (unresolved): preimage succeeds but durable commit fails -> 507, full rollback', async () => {
  const x = scenario({ commit: false });
  const reply = await x.run();
  assert.equal(reply.status, 507, 'never promise a restored notebook without a durable commit');
  assert.deepEqual(x.inspect().current, x.initial, 'stock, PIN, audit and categories must survive');
});

test('1AAA RED (real apply): failed commit cannot replace financial history, PIN, inventory or categories', async () => {
  // Use original production export/apply/list-sidecar function bodies, not a mocked apply.
  function exact(start, end) {
    const a = src.indexOf(start), b = src.indexOf(end, a);
    assert.ok(a >= 0 && b > a, 'required production function anchors: ' + start);
    return src.slice(a, b);
  }
  const funcs = [
    exact('  function estadoActualExportable() {', '  // Item 19:'),
    exact('  function aplicarRespaldo(body) {', '  function _leerListaCat('),
    exact('  function _leerListaCat(clave) {', '  /* Siembra registros para las categorías')
  ].join('\n');
  const ls = new Map([
    ['f123_categorias_custom', '["Old"]'],
    ['f123_categorias_ocultas', '[]']
  ]);
  const fixture = { writes: 0, commit: false,
    localStorage: { getItem: k => ls.get(k) || null, setItem: (k, v) => ls.set(k, v) } };
  const program = `
    const OC_STATE_KEY = 'f123_estado_v4', OC_STATE_SUFIJO = '';
    const _CAT_BASE_CUSTOM = 'f123_categorias_custom', _CAT_BASE_OCULTAS = 'f123_categorias_ocultas';
    const _catKey = x => x, _CAT_ESTADOS = ['custom','borrada','oculta','visible'];
    const clonar = x => JSON.parse(JSON.stringify(x)), _payoutCore = () => null;
    const _normImpuesto = x => x, _normMoneda = x => x, _normLealtad = x => x, _normRetencion = x => x;
    let ubicaciones = [{ id:'s1', nombre:'Gallery' }],
      productos = [{ id:'old', nombre:'Old', stockActual:12, precio:8, costo:2, ubicacionId:'s1' }],
      ventas = [{id:'v1', productoId:'old', cantidad:1, precioUnit:8}],
      movimientos = [{id:'m1', sello:'old-seal'}], transferencias = [], gastos = [], ajustesComision = [],
      payouts = [{id:'pay-old',opId:'op-old',amountCents:100}], payoutConflicts = [], payoutQuarantine = [],
      sucursales = [], promotoras = [], clientes = [], usuarios = [{id:'u1',pin:'555'}],
      instanceId = 'inst-old', nombreNegocio = 'Original Gallery',
      nombreNegocioTs = 10, nombreNegocioRev = 2, selloUltimo = 'old-seal',
      gastosMensuales = {s1:900}, cacheUltimaVenta = {},
      ajusteImpuesto = {pct:15}, ajusteMoneda = {codigo:'USD'},
      ajusteLealtad = null, ajusteRetencion = {dias:7}, _localRev = 5,
      categoriasMeta = {old:{id:'old',nombre:'Old',estado:'custom'}};
    const window = {dispatchEvent:()=>{}}, CustomEvent = function(){}, ponerFotosDemo = ()=>{};
    const localStorage = d.localStorage, _rolLocal = () => 'dueno', validarRespaldo = () => '';
    const guardarEstadoLocal = () => {d.writes++; return Promise.resolve(d.commit)};
    const J = (body,status=200) => ({body,status});
    ${funcs}
    async function run(body) {
      const path='/api/respaldo/importar';
      let debePersistir=true;
      try { ${route} }
      finally {if(debePersistir)guardarEstadoLocal();}
    }
    const view=()=>({state:estadoActualExportable(),
      custom:localStorage.getItem('f123_categorias_custom'),
      hidden:localStorage.getItem('f123_categorias_ocultas')});
    return {run,view};
  `;
  const app = new Function('d', program)(fixture);
  const before = app.view();
  const imported = {
    schemaVersion:3, ubicaciones:[{id:'s1',nombre:'Gallery'}],
    productos:[{id:'new',nombre:'New',stockActual:0,precio:5,costo:1,ubicacionId:'s1'}],
    ventas:[], movimientos:[], payouts:[], usuarios:[{id:'u1',pin:'123'}],
    nombreNegocio:'Imported Gallery', configuracion:{
      categoriasMeta:{old:{id:'old',nombre:'Old',estado:'oculta'}}
    }
  };
  const response = await app.run(imported);
  assert.equal(response.status, 507, 'must wait for durable commit instead of returning HTTP 200');
  assert.deepEqual(app.view(), before, 'rollback must include sales, payouts, PINs, stock, name and sidecar categories');
});

test('1AAA: stale storage readback aborts before replacing notebook', async () => {
  const x = scenario({ staleReadback: true });
  const reply = await x.run();
  assert.equal(reply.status, 507);
  assert.deepEqual(x.inspect().current, x.initial);
  assert.equal(x.inspect().applied, 0);
  assert.equal(x.inspect().saves, 0);
});
test('1AAA: recovery preimage uses the active store namespace', async () => {
  const x = scenario({ suffix: '::room-2' });
  const reply = await x.run();
  assert.equal(reply.status, 200);
  assert.equal(x.inspect().preimageKey, 'f123_estado_v4::room-2_preimport');
  assert.deepEqual(x.inspect().preimage, x.initial);
});
