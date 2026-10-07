/* Regresión de seguridad: /recover-pin NO puede ser un relay de correo
   (auditoría 2026-10-07, B-2). Antes, con instanceId vacío se saltaba la
   validación y el rate limit y el correo salía a cualquier dirección del
   request desde la cuenta Resend del dueño.
   Reglas fijadas aquí: instanceId obligatorio y registrado; el destino es
   SOLO el correo guardado de esa instancia; 5/hora por instancia y por IP
   (CF-Connecting-IP) -> 429.
   El env de prueba NO trae llave de Resend: una petición que pasa todas las
   compuertas llega al paso de correo y responde "email_no_configurado". Eso
   prueba que validación y rate limit corrieron ANTES de enviar. fetch se
   intercepta para verificar que nunca sale una llamada saliente.
   (El caso "se envía 1 correo" queda para verificación manual tras el deploy.)
   Fixtures sintéticos, sin red ni credenciales. El Worker vive fuera de
   docs/: este archivo no requiere subir el shell. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

function kvFalsa() {
  const store = new Map();
  return {
    store,
    async get(key) { return store.has(key) ? store.get(key) : null; },
    async put(key, value) { store.set(key, String(value)); },
    async delete(key) { store.delete(key); },
    async list({ prefix = "" } = {}) {
      return { keys: [...store.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })) };
    },
  };
}
const cargarWorker = () =>
  import(pathToFileURL(path.join(__dirname, '..', 'cloudflare-worker', 'worker.js')).href);

const ID = 'fixture-instance-recover';
const CORREO_GUARDADO = 'duenio@fixture.invalid';

function entorno({ correo = CORREO_GUARDADO, extraIds = [] } = {}) {
  const env = { LICENCIAS: kvFalsa(), MASTER_KEY: 'fixture-master-key-not-real' };
  for (const id of [ID, ...extraIds]) {
    env.LICENCIAS.store.set(`inst:${id}`, JSON.stringify({ instanceId: id, email: correo, estado: 'activo' }));
  }
  return env;
}

async function sinSalida(fn) {
  const real = globalThis.fetch;
  const llamadas = [];
  globalThis.fetch = async (url) => { llamadas.push(String(url)); return new Response('{}', { status: 200 }); };
  try { await fn(llamadas); } finally { globalThis.fetch = real; }
}

async function recuperar(worker, env, body, ip = '203.0.113.7') {
  const req = new Request('https://fixture.invalid/recover-pin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip },
    body: JSON.stringify(body),
  });
  return worker.default.fetch(req, env, { waitUntil() {} });
}
const es4xx = (res) => res.status >= 400 && res.status < 500;

test('empty instanceId is rejected (4xx), reaches no mail step', async () => {
  const worker = await cargarWorker();
  await sinSalida(async (llamadas) => {
    const res = await recuperar(worker, entorno(), { email: 'victima@fixture.invalid', pin: '123', instanceId: '' });
    assert.ok(es4xx(res), 'status ' + res.status);
    assert.equal(llamadas.length, 0);
  });
});

test('missing instanceId field is rejected (4xx)', async () => {
  const worker = await cargarWorker();
  const res = await recuperar(worker, entorno(), { email: 'victima@fixture.invalid', pin: '123' });
  assert.ok(es4xx(res), 'status ' + res.status);
});

test('unknown instanceId is rejected (4xx)', async () => {
  const worker = await cargarWorker();
  const res = await recuperar(worker, entorno(), { email: 'victima@fixture.invalid', pin: '123', instanceId: 'fixture-no-existe' });
  assert.ok(es4xx(res), 'status ' + res.status);
});

test('instance without a stored email is rejected, never falls back to the body address', async () => {
  const worker = await cargarWorker();
  const res = await recuperar(worker, entorno({ correo: '' }), { email: 'atacante@fixture.invalid', pin: '123', instanceId: ID });
  assert.ok(es4xx(res), 'status ' + res.status);
});

test('valid instance passes the gates and reaches the mail step (email not configured here)', async () => {
  const worker = await cargarWorker();
  const res = await recuperar(worker, entorno(), { email: 'atacante@fixture.invalid', pin: '123', instanceId: ID });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).motivo, 'email_no_configurado');
});

test('6th request for the same instance within the window gets 429', async () => {
  const worker = await cargarWorker();
  const env = entorno();
  for (let i = 1; i <= 5; i++) {
    const ok = await recuperar(worker, env, { email: 'x@fixture.invalid', pin: '123', instanceId: ID }, '203.0.113.' + i);
    assert.equal(ok.status, 200, 'request ' + i);
  }
  const sexta = await recuperar(worker, env, { email: 'x@fixture.invalid', pin: '123', instanceId: ID }, '203.0.113.99');
  assert.equal(sexta.status, 429);
});

test('6th request from the same IP across different instances gets 429', async () => {
  const worker = await cargarWorker();
  const ids = [0, 1, 2, 3, 4, 5].map(i => `fixture-ip-${i}-abc`);
  const env = entorno({ extraIds: ids });
  for (let i = 0; i < 5; i++) {
    const ok = await recuperar(worker, env, { email: 'x@fixture.invalid', pin: '123', instanceId: ids[i] }, '198.51.100.5');
    assert.equal(ok.status, 200, 'request ' + i);
  }
  const sexta = await recuperar(worker, env, { email: 'x@fixture.invalid', pin: '123', instanceId: ids[5] }, '198.51.100.5');
  assert.equal(sexta.status, 429);
});
