const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const workerSource = fs.readFileSync(path.join(__dirname, '../cloudflare-worker/worker.js'), 'utf8');
const panelSource = fs.readFileSync(path.join(__dirname, '../docs/panel.html'), 'utf8');
const authSource = fs.readFileSync(path.join(__dirname, '../docs/auth-ui.js'), 'utf8');

async function workerFrom(source) {
  return (await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'))).default;
}

function fixture(worker) {
  const kv = new Map();
  const env = { MASTER_KEY: 'fixture-only', LICENCIAS: {
    get: async k => kv.get(k) || null,
    put: async (k, v) => { kv.set(k, v); },
    list: async ({ prefix }) => ({ keys: [...kv.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })) }),
  } };
  const send = async (route, body, master = false) => {
    const req = new Request('https://fixture.invalid' + route, { method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(master ? { 'X-Master-Key': 'fixture-only' } : {}) },
      body: JSON.stringify(body) });
    const res = await worker.fetch(req, env);
    const result = await res.json();
    assert.equal(res.status, 200, JSON.stringify(result));
    return result;
  };
  return { kv, send };
}

test('passive login cannot revert the notebook name repaired in panel', async () => {
  const { kv, send } = fixture(await workerFrom(workerSource));
  const instanceId = 'fixture-device-001';
  await send('/checkin', { instanceId, licenseCode: 'F123-FIXTURE', nombreNegocio: '007 New Store', accion: 'register' });
  await send('/editar-correo', { instanceId, nombreNegocio: '17 de septiembre' }, true);
  await send('/checkin', { instanceId, nombreNegocio: '007 New Store', nombreNegocioRev: 0, accion: 'login' });
  assert.equal(JSON.parse(kv.get('inst:' + instanceId)).nombreNegocio, '17 de septiembre');
  await send('/checkin', { instanceId, nombreNegocio: '007 New Store', nombreNegocioRev: 0, accion: 'sync-nombre' });
  assert.equal(JSON.parse(kv.get('inst:' + instanceId)).nombreNegocio, '17 de septiembre');
  await send('/checkin', { instanceId, nombreNegocio: '18 de septiembre', nombreNegocioRev: 2, nombreNegocioTs: Date.now(), accion: 'rename' });
  assert.equal(JSON.parse(kv.get('inst:' + instanceId)).nombreNegocio, '18 de septiembre');
  assert.ok(JSON.parse(kv.get('hist:' + instanceId)).length >= 2);
});

test('passive checkin cannot move an existing device to another license', async () => {
  const { kv, send } = fixture(await workerFrom(workerSource));
  const instanceId = 'fixture-client-device';
  await send('/checkin', { instanceId, licenseCode: 'F123-CLIENT-CANONICAL', nombreNegocio: 'Client fixture', accion: 'register' });
  await send('/checkin', { instanceId, licenseCode: 'F123-OLD-LOCAL', nombreNegocio: 'Old local name', accion: 'login' });
  const saved = JSON.parse(kv.get('inst:' + instanceId));
  assert.equal(saved.licenseCode, 'F123-CLIENT-CANONICAL');
  assert.equal(saved.nombreNegocio, 'Client fixture');
  await send('/checkin', { instanceId, licenseCode: 'F123-DELIBERATE-ROTATION', accion: 'rotacion' });
  assert.equal(JSON.parse(kv.get('inst:' + instanceId)).licenseCode, 'F123-DELIBERATE-ROTATION');
  await send('/checkin', { instanceId, licenseCode: 'F123-EXPLICIT-JOIN', accion: 'join' });
  assert.equal(JSON.parse(kv.get('inst:' + instanceId)).licenseCode, 'F123-EXPLICIT-JOIN');
});

test('soft reattach uses an explicit local join marker and clears it only after Worker confirmation', async () => {
  const start = authSource.indexOf('  function heartbeatLogin(owned) {');
  const source = authSource.slice(start, authSource.indexOf('  let rol = null;', start));
  const entries = new Map([['f123_join_pending_v1', JSON.stringify({ instanceId: 'fixture-device', licenseCode: 'F123-TEAM' })]]);
  const actions = [];
  let reply = null;
  const context = { localStorage: { getItem: k => entries.get(k) || null, removeItem: k => entries.delete(k) },
    enviarHeartbeat: async payload => { actions.push(payload.accion); return reply; } };
  vm.createContext(context);
  vm.runInContext(source, context);
  const owned = { instanceId: 'fixture-device', licenseCode: 'F123-TEAM' };
  await context.heartbeatLogin(owned);
  assert.equal(entries.has('f123_join_pending_v1'), true, 'offline marker survives');
  reply = { licenseCode: 'F123-OTHER' };
  await context.heartbeatLogin(owned);
  assert.equal(entries.has('f123_join_pending_v1'), true, 'mismatched reply cannot acknowledge');
  reply = { licenseCode: 'F123-TEAM' };
  await context.heartbeatLogin(owned);
  assert.equal(entries.has('f123_join_pending_v1'), false);
  await context.heartbeatLogin(owned);
  assert.deepEqual(actions, ['join', 'join', 'join', 'login']);
});

test('panel offers a reversible name-unification action only for JFC-owned group', () => {
  assert.match(panelSource, /const soloJfc = n > 1 && nMios === n && !!g\.cod/);
  assert.match(panelSource, /function licUnificarNombre\(codigo\)/);
  assert.match(panelSource, /async function licAplicarNombre\(codigo\)/);
  assert.match(panelSource, /verificados\.some\(r => r\.nombreNegocio !== nombre\)/);
});

test('logging out repaints the PIN gate from the current notebook', () => {
  const gateName = { innerHTML: '007 New Store', style: {} };
  const gate = { style: {} };
  const message = { style: {}, textContent: '' };
  const doc = { body: { classList: { remove() {} }, style: {} },
    getElementById: id => ({ 'oc-gate-negocio': gateName, 'oc-msg': message })[id] || null };
  const context = { document: doc, window: { OCTienda: { nombreActivo: () => '17 de septiembre', esUnida: () => false },
      t: (_, fallback) => fallback || 'Entering', dispatchEvent() {} },
    localStorage: { getItem: () => JSON.stringify({ instanceId: 'fixture-device-001', nombreNegocio: '007 New Store' }) },
    sessionStorage: { removeItem() {} }, CustomEvent: class { constructor(type) { this.type = type; } },
    clearTimeout() {}, temporizadorInactividad: 0, rol: 'admin', demoSesion: false,
    gate, nuevoTeclado() {}, $: () => message, dispositivoApropiado: () => true };
  vm.createContext(context);
  const renderer = authSource.slice(authSource.indexOf('  function pintarNegocioGate()'), authSource.indexOf('  function pintarBuildGate()'));
  const logoutStart = authSource.indexOf('  function cerrarSesion(mensaje) {');
  const logout = authSource.slice(logoutStart, authSource.indexOf('  $("oc-borrar")', logoutStart));
  vm.runInContext(renderer + '\n' + logout + '\ncerrarSesion();', context);
  assert.match(gateName.innerHTML, /17 de septiembre/);
  assert.doesNotMatch(gateName.innerHTML, /007 New Store/);
});
