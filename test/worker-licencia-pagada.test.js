/* Pagado es de la LICENCIA, no del aparato (JFC 2026-09-22).

   idiomARTE tiene 3 aparatos bajo una licencia. Si JFC marca "full" solo uno,
   los otros dos no pueden pasar a solo lectura a los 30 días. La regla es
   monótona: solo DA acceso, nunca lo quita, y no pisa un aparato bloqueado.
   KV en memoria, credencial sintética, sin tocar el Worker publicado. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const MASTER = 'fixture-master-key-not-real';
function kv() {
  const store = new Map();
  return { store,
    async get(k) { return store.has(k) ? store.get(k) : null; },
    async put(k, v) { store.set(k, String(v)); },
    async delete(k) { store.delete(k); },
    async list({ prefix = '' } = {}) { return { keys: [...store.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })) }; } };
}
// OJO: el Worker exige instanceId de >=6 caracteres (/^[a-zA-Z0-9-]{6,120}$/).
// Con IDs cortos el checkin y el marcado fallan EN SILENCIO y una prueba puede
// pasar sin probar nada (le pasó a la del aparato bloqueado en el primer
// intento). Por eso todo marcar exige 200.
const cargar = () => import(pathToFileURL(path.join(__dirname, '..', 'cloudflare-worker', 'worker.js')).href);
const env = () => ({ LICENCIAS: kv(), MASTER_KEY: MASTER });
async function checkin(w, e, instanceId, licenseCode) {
  const r = await w.default.fetch(new Request('https://fixture.invalid/checkin', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ instanceId, accion: 'login', licenseCode }),
  }), e, { waitUntil() {} });
  return r.json();
}
async function marcar(w, e, instanceId, estado) {
  const r = await w.default.fetch(new Request(`https://fixture.invalid/licencias/${instanceId}/estado`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Master-Key': MASTER },
    body: JSON.stringify({ estado }),
  }), e, { waitUntil() {} });
  return r.status;
}
const estadoDe = (e, id) => JSON.parse(e.LICENCIAS.store.get(`inst:${id}`)).estado;

test('marking ONE device as paid pays the whole license: siblings inherit it', async () => {
  const w = await cargar(); const e = env();
  const L = 'F123-FIXTURE-TRES-APARATOS';
  for (const id of ['fixture-pc', 'fixture-iphone', 'fixture-ipad']) await checkin(w, e, id, L);
  assert.equal(estadoDe(e, 'fixture-iphone'), 'minima');

  assert.equal(await marcar(w, e, 'fixture-pc', 'full'), 200); // JFC marca solo la PC
  const r = await checkin(w, e, 'fixture-iphone', L);          // el iPhone entra después
  assert.equal(r.estado, 'full', 'el iPhone hereda el pago de su licencia');
  assert.equal(estadoDe(e, 'fixture-iphone'), 'full');
  assert.equal((await checkin(w, e, 'fixture-ipad', L)).estado, 'full', 'y el iPad también');
});

test('a device that joins an already-paid license starts paid, not on a trial', async () => {
  const w = await cargar(); const e = env();
  const L = 'F123-FIXTURE-YA-PAGADA';
  await checkin(w, e, 'fixture-original', L);
  assert.equal(await marcar(w, e, 'fixture-original', 'full'), 200, 'JFC pudo marcar el estado');
  assert.equal((await checkin(w, e, 'fixture-aparato-nuevo', L)).estado, 'full');
});

test('a license already paid BEFORE this change heals itself on the next checkin', async () => {
  const w = await cargar(); const e = env();
  const L = 'F123-FIXTURE-LEGADO';
  // Estado de antes del cambio: un aparato "full" y NINGUNA clave lic:.
  e.LICENCIAS.store.set('inst:fixture-viejo', JSON.stringify({ instanceId: 'fixture-viejo', licenseCode: L, estado: 'full' }));
  e.LICENCIAS.store.set('inst:fixture-hermano', JSON.stringify({ instanceId: 'fixture-hermano', licenseCode: L, estado: 'minima' }));
  await checkin(w, e, 'fixture-viejo', L);   // su checkin anota la licencia como pagada
  assert.equal((await checkin(w, e, 'fixture-hermano', L)).estado, 'full');
});

test('a blocked device is never upgraded by its license being paid', async () => {
  const w = await cargar(); const e = env();
  const L = 'F123-FIXTURE-BLOQUEO';
  await checkin(w, e, 'fixture-bueno', L); await checkin(w, e, 'fixture-robado', L);
  assert.equal(await marcar(w, e, 'fixture-robado', 'bloqueada'), 200, 'JFC pudo marcar el estado');
  assert.equal(await marcar(w, e, 'fixture-bueno', 'full'), 200, 'JFC pudo marcar el estado');
  assert.equal((await checkin(w, e, 'fixture-robado', L)).estado, 'bloqueada', 'el bloqueo puntual de JFC se respeta');
});

test('paying one license never touches another license', async () => {
  const w = await cargar(); const e = env();
  await checkin(w, e, 'fixture-aaaa', 'F123-FIXTURE-AAAA'); await checkin(w, e, 'fixture-bbbb', 'F123-FIXTURE-BBBB');
  assert.equal(await marcar(w, e, 'fixture-aaaa', 'full'), 200, 'JFC pudo marcar el estado');
  assert.equal((await checkin(w, e, 'fixture-bbbb', 'F123-FIXTURE-BBBB')).estado, 'minima');
});
