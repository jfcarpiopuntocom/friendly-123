/* Sonar de Canarios en el Worker (plan canarios F4, JFC 2026-09-25).
   - Un latido con varios errores ya no se pierde entero (antes: 413 sobre 4096 bytes).
   - La salud viaja por LISTA BLANCA: un campo extra (un nombre, un monto) no se guarda.
   - Solo los aparatos en la licencia LORD ponen en rojo al canario; los clientes suman al sonar.
   - Las ordenes Push/Rewind/Detener exigen la Master Key.
   Fixtures sinteticos, KV en memoria, sin red y sin credenciales reales. La licencia
   lord de prueba NO tiene formato de licencia real a proposito (guarda G5). */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

function kvFalsa() {
  const store = new Map();
  return {
    store,
    async get(k) { return store.has(k) ? store.get(k) : null; },
    async put(k, v) { store.set(k, String(v)); },
    async delete(k) { store.delete(k); },
    async list({ prefix = '' } = {}) { return { keys: [...store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })) }; },
  };
}
const cargar = () => import(pathToFileURL(path.join(__dirname, '..', 'cloudflare-worker', 'worker.js')).href);
const LORD = 'F123-FIXTURE-LORD';
const entorno = () => ({ LICENCIAS: kvFalsa(), MASTER_KEY: 'fixture-master-key-not-real', LORD_LICENSE: LORD });
async function llamar(w, env, ruta, { metodo = 'GET', body, clave } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (clave) headers['X-Master-Key'] = clave;
  const r = await w.default.fetch(new Request('https://fixture.invalid' + ruta, { method: metodo, headers, body: body ? JSON.stringify(body) : undefined }), env);
  return { status: r.status, json: await r.json() };
}
// Peor caso REAL: cada campo al tope que impone la app (salud-app.js paraEnviar y auth-ui.js trim).
const errorLargo = (i) => ({ msg: ('TypeError ' + i).padEnd(200, 'x'), archivo: 'a'.repeat(57) + '.js', linea: 100000 + i, ver: 'v'.repeat(24), cuando: new Date().toISOString(), veces: 99999 });
const contactoTope = { email: 'e'.repeat(150) + '@fixture.io', nombre: 'n'.repeat(120), apellido: 'a'.repeat(120), cedula: 'c'.repeat(40), nombreNegocio: 'b'.repeat(120), whatsapp: '5'.repeat(20) };

test('latido con 10 errores largos (>4 KB) se acepta y guarda los errores', async () => {
  const w = await cargar(); const env = entorno();
  const body = { ...contactoTope, instanceId: 'inst-muchos-errores', licenseCode: 'F123-FIXTURE-CLIENTE', accion: 'login',
    errores: Array.from({ length: 10 }, (_, i) => errorLargo(i)), salud: { shell: 'f123-shell-v403', canal: 'estable', errores: 10 } };
  assert.ok(JSON.stringify(body).length > 4096, 'el payload de prueba supera el tope viejo');
  const r = await llamar(w, env, '/checkin', { metodo: 'POST', body });
  assert.equal(r.status, 200);
  const reg = JSON.parse(await env.LICENCIAS.get('inst:inst-muchos-errores'));
  assert.equal(reg.errores.length, 10);
  assert.equal(reg.salud.errores, 10);
});

test('la salud pasa por lista blanca: un campo extra nunca se guarda', async () => {
  const w = await cargar(); const env = entorno();
  await llamar(w, env, '/checkin', { metodo: 'POST', body: { instanceId: 'inst-lista-blanca', licenseCode: 'F123-FIXTURE-CLIENTE',
    salud: { shell: 'f123-shell-v403', canal: 'estable', errores: 0, cliente: 'Maria', monto: 99 } } });
  const reg = JSON.parse(await env.LICENCIAS.get('inst:inst-lista-blanca'));
  assert.deepEqual(Object.keys(reg.salud).sort(), ['at', 'caidas', 'canal', 'cuadre', 'errores', 'mezcla', 'retenido', 'shell']);
  assert.ok(!JSON.stringify(reg).includes('Maria'));
});

test('solo la licencia lord pone en rojo al canario; los clientes cuentan en el sonar', async () => {
  const w = await cargar(); const env = entorno();
  const shell = 'f123-shell-v404';
  await llamar(w, env, '/checkin', { metodo: 'POST', body: { instanceId: 'inst-cliente-1', licenseCode: 'F123-FIXTURE-CLIENTE', salud: { shell, canal: 'estable', errores: 2 } } });
  let e = (await llamar(w, env, '/canario/estado?shell=' + shell)).json;
  assert.equal(e.rojo, false, 'un cliente con errores no frena el canario');
  assert.equal(e.aparatos, 1); assert.equal(e.aparatosConProblemas, 1);
  await llamar(w, env, '/checkin', { metodo: 'POST', body: { instanceId: 'inst-lord-1', licenseCode: LORD, salud: { shell, canal: 'next', errores: 0, cuadre: 'ok' } } });
  e = (await llamar(w, env, '/canario/estado?shell=' + shell)).json;
  assert.equal(e.rojo, false); assert.equal(e.reportes, 1);
  await llamar(w, env, '/checkin', { metodo: 'POST', body: { instanceId: 'inst-lord-1', licenseCode: LORD, salud: { shell, canal: 'next', errores: 1, cuadre: 'fallo' } } });
  e = (await llamar(w, env, '/canario/estado?shell=' + shell)).json;
  assert.equal(e.rojo, true);
  assert.deepEqual(e.rojos[0].motivos, ['errores', 'cuadre']);
  assert.ok(!JSON.stringify(e).includes('inst-'), 'la lectura publica no expone instanceIds');
});

test('ordenes del Sonar: sin Master Key no; push, detener y reanudar con ella', async () => {
  const w = await cargar(); const env = entorno();
  assert.equal((await llamar(w, env, '/canario/orden', { metodo: 'POST', body: { accion: 'push' } })).status, 401);
  const r = await llamar(w, env, '/canario/orden', { metodo: 'POST', body: { accion: 'rewind' }, clave: 'fixture-master-key-not-real' });
  assert.equal(r.json.orden.accion, 'rewind');
  assert.equal((await llamar(w, env, '/canario/orden')).json.orden.id, r.json.orden.id);
  await llamar(w, env, '/canario/orden', { metodo: 'POST', body: { accion: 'detener' }, clave: 'fixture-master-key-not-real' });
  assert.equal((await llamar(w, env, '/canario/estado?shell=f123-shell-v404')).json.detenido, true);
  await llamar(w, env, '/canario/orden', { metodo: 'POST', body: { accion: 'reanudar' }, clave: 'fixture-master-key-not-real' });
  assert.equal((await llamar(w, env, '/canario/orden')).json.detenido, false);
  assert.equal((await llamar(w, env, '/canario/orden', { metodo: 'POST', body: { accion: 'borrar-todo' }, clave: 'fixture-master-key-not-real' })).status, 400);
});
