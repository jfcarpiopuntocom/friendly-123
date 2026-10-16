const { test } = require('node:test');
const assert = require('node:assert/strict');
const { browser } = require('./helpers/browser.cjs');
const makeApp = () => { const app = browser(); app.OCAuth = { rolActual: () => 'dueno' }; return app; };
const edit = (app, c, data) => app.request('/api/clientes/' + c.id + '/contacto', 'PATCH', data);

test('legacy customer residence stays unknown; explicit profile survives sync, reload and backup', async () => {
  const app = makeApp();
  const legacy = await app.request('/api/clientes', 'POST', { nombre: 'Synthetic legacy' });
  assert.equal(legacy.resideCuenca, null); assert.equal(legacy.genero, 'unknown');
  const c = await app.request('/api/clientes', 'POST', { nombre: 'Synthetic profile', resideCuenca: true, genero: 'female', telefono: '0991234567' });
  assert.equal(c.resideCuenca, true); assert.equal(c.genero, 'female');
  const peer = makeApp(); peer.receive(app);
  const get = async a => (await a.request('/api/clientes')).find(x => x.id === c.id);
  assert.equal((await get(peer)).resideCuenca, true); assert.equal((await get(peer)).genero, 'female');
  await edit(app, c, { resideCuenca: false, genero: 'male' });
  peer.receive(app);
  assert.equal((await get(peer)).resideCuenca, false); assert.equal((await get(peer)).genero, 'male');
  const reload = browser(app.localStorage);
  assert.equal((await get(reload)).resideCuenca, false);
  const restored = makeApp();
  await restored.request('/api/respaldo/importar', 'POST', await app.request('/api/respaldo/exportar'));
  assert.equal((await get(restored)).genero, 'male');
  await edit(app, c, { resideCuenca: null, genero: 'unknown' });
  assert.equal((await get(app)).resideCuenca, null);
});

test('invalid profile input is rejected atomically, while old contact guards remain compatible', async () => {
  const app = makeApp();
  const c = await app.request('/api/clientes', 'POST', { nombre: 'Synthetic guarded', resideCuenca: true, genero: 'female' });
  for (const invalid of [{ resideCuenca: 'false' }, { resideCuenca: 0 }, { genero: 'other' }, { genero: null }]) {
    await assert.rejects(() => edit(app, c, { nombre: 'Do not save', ...invalid }), /400/);
    await assert.rejects(() => app.request('/api/clientes', 'POST', { nombre: 'Do not create', ...invalid }), /400/);
  }
  assert.equal((await app.request('/api/clientes')).find(x => x.id === c.id).nombre, c.nombre);
  const oldBase = { nombre: c.nombre, telefono: '', email: '', notas: '', rangoEdad: '', pais: '' };
  await edit(app, c, { baseContacto: oldBase, telefono: '0991234567' });
  const fresh = (await app.request('/api/clientes')).find(x => x.id === c.id);
  await assert.rejects(() => edit(app, c, { baseContacto: { ...fresh, resideCuenca: false }, genero: 'male' }), /409/);
  await assert.rejects(() => edit(app, c, { baseContacto: { ...fresh, genero: 'unknown' }, genero: 'male' }), /409/);
  const changed = await edit(app, c, { baseContacto: fresh, genero: 'male' });
  assert.equal(changed.genero, 'male'); assert.equal(changed.resideCuenca, true);
});
