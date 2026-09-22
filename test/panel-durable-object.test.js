/* Migración del panel a Durable Object para el SLA ≤2s (JFC 2026-09-22).

   Cierra el hallazgo #6 de la megaauditoría: el panel leía de Workers KV, que
   es *eventually consistent* por diseño, así que ≤2s era imposible de prometer
   ahí por mucho que se afinara el código.

   Lo que estas pruebas protegen NO es la velocidad (eso se mide en producción),
   sino la propiedad de la que depende la velocidad SIN arriesgar datos reales
   de clientes: que el DO sea un espejo de lectura y que KV siga siendo la red
   de seguridad. Si alguien "optimiza" quitando la escritura a KV, o deja que un
   DO a medio llenar esconda aparatos, estas pruebas se ponen rojas. */
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

// DO falso: almacenamiento en Map + el mismo enrutado que la clase real.
// `roto:true` simula que el Durable Object no responde, que es el escenario
// donde hay que demostrar que NO se pierde nada.
function doFalso({ roto = false } = {}) {
  const storage = new Map();
  const stub = {
    storage,
    async fetch(url, opciones = {}) {
      if (roto) throw new Error('durable object caido');
      const u = new URL(url);
      const metodo = opciones.method || 'GET';
      if (u.pathname.startsWith('/r/')) {
        const id = decodeURIComponent(u.pathname.slice(3));
        if (metodo === 'PUT') { storage.set(`inst:${id}`, JSON.parse(opciones.body)); return { ok: true }; }
        if (metodo === 'DELETE') { storage.delete(`inst:${id}`); return { ok: true }; }
      }
      if (u.pathname === '/all' && metodo === 'GET') {
        const salida = [...storage.values()];
        return { ok: true, json: async () => salida };
      }
      return { ok: false };
    },
  };
  return { storage, binding: { idFromName: () => 'registro-global', get: () => stub } };
}

const cargarWorker = () =>
  import(pathToFileURL(path.join(__dirname, '..', 'cloudflare-worker', 'worker.js')).href);

const MASTER = 'fixture-master-key-not-real';

async function checkin(worker, env, body) {
  return worker.default.fetch(new Request('https://fixture.invalid/checkin', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }), env, { waitUntil() {} });
}

async function listarPanel(worker, env) {
  const r = await worker.default.fetch(new Request('https://fixture.invalid/licencias', {
    method: 'GET', headers: { 'X-Master-Key': MASTER },
  }), env, { waitUntil() {} });
  return { status: r.status, filas: await r.json() };
}

test('a checkin lands in the Durable Object, which is what makes the panel read fresh', async () => {
  const worker = await cargarWorker();
  const fake = doFalso();
  const env = { LICENCIAS: kvFalsa(), MASTER_KEY: MASTER, REGISTROS: fake.binding };

  await checkin(worker, env, { instanceId: 'inst-fresco', accion: 'register', licenseCode: 'F123-FIXTURE-DO' });

  assert.equal(fake.storage.size, 1, 'el registro se espejó al DO en la misma escritura');
  assert.equal(fake.storage.get('inst:inst-fresco').licenseCode, 'F123-FIXTURE-DO');
  // Y sigue estando en KV: el DO NO reemplaza la fuente de verdad.
  assert.ok(env.LICENCIAS.store.get('inst:inst-fresco'), 'KV conserva el registro como red de seguridad');
});

test('a broken Durable Object never loses a record: KV still has it and the panel still shows it', async () => {
  const worker = await cargarWorker();
  const fake = doFalso({ roto: true });
  const env = { LICENCIAS: kvFalsa(), MASTER_KEY: MASTER, REGISTROS: fake.binding };

  // Este es EL escenario que no puede fallar: si el DO se cae, un cliente real
  // no puede quedarse sin su registro de licencia.
  const r = await checkin(worker, env, { instanceId: 'inst-resistente', accion: 'register', licenseCode: 'F123-FIXTURE-CAIDO' });
  assert.equal(r.status, 200, 'el checkin responde OK aunque el DO esté caído');
  assert.ok(env.LICENCIAS.store.get('inst:inst-resistente'), 'el registro quedó guardado en KV igual');

  const { status, filas } = await listarPanel(worker, env);
  assert.equal(status, 200);
  assert.equal(filas.some(f => f.instanceId === 'inst-resistente'), true,
    'el panel lo sigue mostrando por el camino de respaldo: más rancio, nunca ausente');
});

test('a half-filled Durable Object can never hide a device that exists in KV', async () => {
  const worker = await cargarWorker();
  const fake = doFalso();
  const env = { LICENCIAS: kvFalsa(), MASTER_KEY: MASTER, REGISTROS: fake.binding };

  // Dos aparatos ya existentes en KV (el mundo anterior a este cambio) y el DO
  // vacío, que es exactamente el estado del primer despliegue.
  env.LICENCIAS.store.set('inst:viejo-1', JSON.stringify({ instanceId: 'viejo-1', estado: 'minima', lastSeen: 2 }));
  env.LICENCIAS.store.set('inst:viejo-2', JSON.stringify({ instanceId: 'viejo-2', estado: 'full', lastSeen: 1 }));
  assert.equal(fake.storage.size, 0);

  const primera = await listarPanel(worker, env);
  assert.equal(primera.filas.length, 2, 'la primera lectura los muestra TODOS, tomados de KV');

  // Relleno perezoso: sin evento de migración, sin copia en masa.
  assert.equal(fake.storage.size, 2, 'y de paso rellenó el DO para la próxima lectura');

  const segunda = await listarPanel(worker, env);
  assert.equal(segunda.filas.length, 2, 'la segunda lectura ya sale del DO y no pierde a nadie');
});

test('deleting an instance removes it from both stores, so no ghost row survives', async () => {
  const worker = await cargarWorker();
  const fake = doFalso();
  const env = { LICENCIAS: kvFalsa(), MASTER_KEY: MASTER, REGISTROS: fake.binding };

  await checkin(worker, env, { instanceId: 'inst-a-borrar', accion: 'register', licenseCode: 'F123-FIXTURE-DEL' });
  assert.equal(fake.storage.size, 1);

  const r = await worker.default.fetch(new Request('https://fixture.invalid/licencias/inst-a-borrar', {
    method: 'DELETE', headers: { 'X-Master-Key': MASTER },
  }), env, { waitUntil() {} });
  assert.equal(r.status, 200);

  assert.equal(fake.storage.size, 0, 'sale del DO: si no, el camino "fresco" mostraría una fila fantasma');
  assert.equal(env.LICENCIAS.store.has('inst:inst-a-borrar'), false, 'y de KV');
  // La papelera conserva el registro: borrar desde un panel es justo donde se
  // producen los arrepentimientos.
  assert.ok(env.LICENCIAS.store.get('borrado:inst-a-borrar'), 'queda archivado y es recuperable');
});
