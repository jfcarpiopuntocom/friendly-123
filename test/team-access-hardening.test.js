const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { browser } = require('./helpers/browser.cjs');

test('team API denies staff mutations and does not reveal PINs to staff', async () => {
  const w = browser();
  w.OCAuth = { rolActual: () => 'dueno' };
  const admin = await w.request('/api/usuarios', 'POST', { nombre: 'Fixture admin', pin: '741', rol: 'admin' });
  w.OCAuth.rolActual = () => 'empleado';
  await assert.rejects(() => w.request('/api/usuarios', 'POST', { nombre: 'No', pin: '742' }));
  await assert.rejects(() => w.request(`/api/usuarios/${admin.id}`, 'PATCH', { email: 'x@example.invalid' }));
  await assert.rejects(() => w.request(`/api/usuarios/${admin.id}`, 'DELETE', {}));
  const list = await w.request('/api/usuarios?pins=1');
  assert.equal(Object.hasOwn(list[0], 'pin'), false);
});

test('an admin can manage staff and self, but cannot remove or promote anyone', async () => {
  const w = browser();
  w.OCAuth = { rolActual: () => 'dueno' };
  const admin = await w.request('/api/usuarios', 'POST', { nombre: 'Admin', pin: '751', rol: 'admin' });
  w.OCAuth.rolActual = () => 'admin';
  w.OCCurrentUser = { id: admin.id, nombre: admin.nombre, rol: 'admin' };
  const staff = await w.request('/api/usuarios', 'POST', { nombre: 'Staff', pin: '752', rol: 'empleado' });
  assert.equal((await w.request(`/api/usuarios/${staff.id}`, 'PATCH', { activo: false })).activo, false);
  assert.equal((await w.request(`/api/usuarios/${admin.id}`, 'PATCH', { nombre: 'Admin updated' })).nombre, 'Admin updated');
  await assert.rejects(() => w.request(`/api/usuarios/${staff.id}`, 'PATCH', { nombre: 'Must not stick', rol: 'admin' }));
  assert.equal((await w.request('/api/usuarios')).find(x => x.id === staff.id).nombre, 'Staff');
  await assert.rejects(() => w.request(`/api/usuarios/${staff.id}`, 'DELETE', {}));
});

test('remote team removal notifies the live session and list', async () => {
  const owner = browser(), peer = browser();
  owner.OCAuth = { rolActual: () => 'dueno' };
  const member = await owner.request('/api/usuarios', 'POST', { nombre: 'Fixture staff', pin: '742' });
  peer.receive(owner);
  let events = 0;
  peer.addEventListener('oc-equipo-sync', () => events++);
  await owner.request(`/api/usuarios/${member.id}`, 'DELETE', {});
  peer.OCSync.aplicarEquipoRemoto(owner.catalog().usuarios);
  assert.equal(events, 1);
});

test('team PIN cannot collide with a current built-in role PIN', async () => {
  const w = browser();
  w.OCAuth = { rolActual: () => 'dueno' };
  w.OCSecure = { coincidePin: async () => false,
    leerPinsVisibles: () => ({ owner: '741', empleados: ['743'], acct: '744' }) };
  await assert.rejects(() => w.request('/api/usuarios', 'POST', { nombre: 'Collision', pin: '741' }));
  await assert.rejects(() => w.request('/api/usuarios', 'POST', { nombre: 'Collision', pin: '743' }));
  await assert.rejects(() => w.request('/api/usuarios', 'POST', { nombre: 'Collision', pin: '744' }));
});

test('team mutations fail closed when integrated PIN verification fails', async () => {
  const w = browser();
  w.OCAuth = { rolActual: () => 'dueno' };
  w.OCSecure.coincidePin = async () => { throw new Error('fixture crypto failure'); };
  await assert.rejects(() => w.request('/api/usuarios', 'POST', { nombre: 'Unsafe', pin: '746' }), /PIN_NO_VERIFICADO/);
  assert.equal((await w.request('/api/usuarios')).length, 0);
});

test('failed durable storage rejects and rolls back a team change', async () => {
  const entries = new Map();
  let full = false;
  const storage = { get length() { return entries.size; }, key: i => [...entries.keys()][i],
    getItem: k => entries.get(k) ?? null,
    setItem(k, v) { if (full && String(k).startsWith('f123_estado_v4')) throw new Error('fixture quota'); entries.set(k, String(v)); },
    removeItem: k => entries.delete(k) };
  const w = browser(storage);
  w.OCAuth = { rolActual: () => 'dueno' };
  let published = 0;
  w.addEventListener('oc-equipo-cambiado', () => published++);
  full = true;
  await assert.rejects(() => w.request('/api/usuarios', 'POST', { nombre: 'Unsaved', pin: '745' }));
  assert.equal((await w.request('/api/usuarios')).length, 0);
  assert.equal(published, 0);
});

test('PIN conflicts remain visible until the source can be merged', async () => {
  const a = browser(), b = browser();
  a.OCAuth = { rolActual: () => 'dueno' };
  b.OCAuth = { rolActual: () => 'dueno' };
  await a.request('/api/usuarios', 'POST', { nombre: 'Remote member', pin: '746' });
  const local = await b.request('/api/usuarios', 'POST', { nombre: 'Local member', pin: '746' });
  b.receive(a);
  assert.equal(b.OCSync.conflictosEquipo().length, 1);
  await b.request(`/api/usuarios/${local.id}`, 'PATCH', { pin: '747' });
  b.receive(a);
  assert.equal(b.OCSync.conflictosEquipo().length, 0);
  assert.equal((await b.request('/api/usuarios')).length, 2);
});

test('owner team changes are attributed to the owner, not Sistema', async () => {
  const w = browser();
  w.OCAuth = { rolActual: () => 'dueno' };
  await w.request('/api/usuarios', 'POST', { nombre: 'Fixture', pin: '748' });
  const log = await w.request('/api/movimientos');
  const alta = log.find(x => x.tipo === 'usuario-alta');
  assert.equal(alta.usuarioRol, 'dueno');
  assert.equal(alta.usuarioNombre, 'Owner');
});

test('an open named session closes after removal or credential revision', async () => {
  const src = fs.readFileSync(require.resolve('../docs/auth-ui.js'), 'utf8');
  const start = src.indexOf('    function revalidarSesionEquipo()');
  const end = src.indexOf('    window.addEventListener("oc-equipo-sync", revalidarSesionEquipo);', start);
  assert.ok(start > 0 && end > start);
  for (const list of [[], [{ id: 'fixture-u', rol: 'admin', activo: true, rev: { c: 2, d: 'a' } }]]) {
    const closed = [];
    const w = { t: key => key,
      OCCurrentUser: { id: 'fixture-u', rol: 'admin', rev: { c: 1, d: 'a' } } };
    const context = { window: w, rol: 'admin', fetch: async () => ({ json: async () => list }),
      cerrarSesion: message => closed.push(message) };
    vm.runInNewContext(src.slice(start, end) + '\nrevalidarSesionEquipo();', context);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(closed.length, 1);
  }
});

test('v356: an admin who edits her own card keeps her session (same rev as the store)', async () => {
  // auth-ui revalidarSesionEquipo cierra la sesión si el rev de la ficha
  // difiere del de la sesión. Editarse a sí misma no debe sacarla.
  const w = browser();
  w.OCAuth = { rolActual: () => 'dueno' };
  const admin = await w.request('/api/usuarios', 'POST', { nombre: 'Admin propia', pin: '761', rol: 'admin' });
  const lista0 = await w.request('/api/usuarios');
  const r0 = lista0.find(x => x.id === admin.id);
  w.OCAuth.rolActual = () => 'admin';
  const sesion = { id: admin.id, nombre: admin.nombre, rol: 'admin', rev: r0.rev, actualizadoEn: r0.actualizadoEn };
  w.OCCurrentUser = sesion;
  await w.request(`/api/usuarios/${admin.id}`, 'PATCH', { nombre: 'Admin renombrada' });
  const ahora = (await w.request('/api/usuarios')).find(x => x.id === admin.id);
  assert.equal(w.OCCurrentUser, sesion, 'es el mismo objeto de sesión');
  assert.equal(JSON.stringify(sesion.rev), JSON.stringify(ahora.rev), 'la sesión adopta el rev nuevo: revalidar no la cierra (misma comparación que auth-ui)');
});
