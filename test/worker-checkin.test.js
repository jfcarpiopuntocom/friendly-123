/* Regresión del Worker de licencias: un checkin PASIVO nunca debe degradar un
   registro bueno (JFC 2026-09-22, hallazgo #15 de la megaauditoría de sync).

   POR QUÉ EXISTE: las protecciones de /checkin ya están implementadas y son
   correctas, pero hasta hoy eran una promesa de disciplina — ningún test fallaba
   si alguien las rompía. Son justo la clase de regla que se pierde en una
   refactorización inocente, y el costo sería silencioso: el panel de licencias
   mostrando el nombre viejo de un negocio, o un contacto borrado, sin que nadie
   se entere hasta que JFC lo mira.

   Un /checkin es AUTOMÁTICO (se dispara solo en cada login), no deliberado. Por
   eso nunca puede vaciar un campo ni mover una licencia: eso solo lo hace una
   acción explícita del panel o un rename/join con revisión mayor.

   Fixtures sintéticos, KV en memoria, sin red y sin credenciales reales.
   NOTA: el Worker vive fuera de docs/, así que este archivo NO requiere subir
   el shell — no toca la app que corre en los aparatos. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

// KV en memoria con la superficie que usa worker.js: get / put / list / delete.
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

// MASTER_KEY sintética: este test nunca toca el Worker publicado ni su secreto real.
const entorno = () => ({ LICENCIAS: kvFalsa(), MASTER_KEY: 'fixture-master-key-not-real' });

async function checkin(worker, env, body) {
  const req = new Request('https://fixture.invalid/checkin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return worker.default.fetch(req, env, { waitUntil() {} });
}

const registro = (env, id) => JSON.parse(env.LICENCIAS.store.get(`inst:${id}`));

test('a passive checkin with empty optional fields never wipes saved contact data', async () => {
  const worker = await cargarWorker();
  const env = entorno();
  const instanceId = 'fixture-instance-contacto';

  await checkin(worker, env, {
    instanceId, accion: 'register', licenseCode: 'F123-FIXTURE-AAAA',
    email: 'duena@fixture.invalid', nombre: 'Fixture', apellido: 'Duena',
    cedula: '0000000000', whatsapp: '0999111222',
  });
  const guardado = registro(env, instanceId);
  assert.equal(guardado.email, 'duena@fixture.invalid');
  assert.equal(guardado.whatsapp, '0999111222');

  // Login posterior desde un navegador que todavía no hidrató su caché: manda
  // los opcionales VACÍOS. No debe borrar nada de lo ya guardado.
  await checkin(worker, env, {
    instanceId, accion: 'login', licenseCode: 'F123-FIXTURE-AAAA',
    email: '', nombre: '', apellido: '', cedula: '', whatsapp: '',
  });

  const despues = registro(env, instanceId);
  assert.equal(despues.email, 'duena@fixture.invalid', 'el correo sobrevive al login vacío');
  assert.equal(despues.whatsapp, '0999111222', 'el whatsapp sobrevive');
  assert.equal(despues.nombre, 'Fixture');
  assert.equal(despues.apellido, 'Duena');
  assert.equal(despues.cedula, '0000000000');
});

test('a passive login cannot overwrite an already registered business name', async () => {
  const worker = await cargarWorker();
  const env = entorno();
  const instanceId = 'fixture-instance-nombre';

  await checkin(worker, env, {
    instanceId, accion: 'register', licenseCode: 'F123-FIXTURE-BBBB',
    nombreNegocio: 'Nombre bueno', nombreNegocioRev: 5, nombreNegocioTs: 5000,
  });
  assert.equal(registro(env, instanceId).nombreNegocio, 'Nombre bueno');

  // Este es el incidente real que persiguió a JFC en Safari: un aparato entra
  // con un caché viejo y su login arrastra el nombre anterior al panel.
  await checkin(worker, env, {
    instanceId, accion: 'login', licenseCode: 'F123-FIXTURE-BBBB',
    nombreNegocio: 'Nombre viejo de cache', nombreNegocioRev: 1, nombreNegocioTs: 1000,
  });

  assert.equal(registro(env, instanceId).nombreNegocio, 'Nombre bueno',
    'un login pasivo NO retrocede el nombre del negocio');
});

test('an explicit rename with a higher revision does win', async () => {
  const worker = await cargarWorker();
  const env = entorno();
  const instanceId = 'fixture-instance-rename';

  await checkin(worker, env, {
    instanceId, accion: 'register', licenseCode: 'F123-FIXTURE-CCCC',
    nombreNegocio: 'Nombre inicial', nombreNegocioRev: 2, nombreNegocioTs: 2000,
  });

  // El guard no debe volverse una jaula: un rename deliberado con revisión
  // mayor SÍ tiene que poder avanzar, o el dueño no podría renombrar nunca.
  await checkin(worker, env, {
    instanceId, accion: 'rename', licenseCode: 'F123-FIXTURE-CCCC',
    nombreNegocio: 'Nombre nuevo deliberado', nombreNegocioRev: 3, nombreNegocioTs: 3000,
  });

  const despues = registro(env, instanceId);
  assert.equal(despues.nombreNegocio, 'Nombre nuevo deliberado', 'el rename deliberado sí avanza');
  assert.equal(despues.nombreNegocioRev, 3);
});

test('a passive checkin cannot move a device to another license', async () => {
  const worker = await cargarWorker();
  const env = entorno();
  const instanceId = 'fixture-instance-licencia';

  await checkin(worker, env, {
    instanceId, accion: 'register', licenseCode: 'F123-FIXTURE-CANONICA',
  });
  assert.equal(registro(env, instanceId).licenseCode, 'F123-FIXTURE-CANONICA');

  // Un navegador con licencia local obsoleta no puede sacar al aparato de su
  // cuaderno canónico: eso reagruparía al cliente en el panel sin que nadie
  // lo pidiera.
  await checkin(worker, env, {
    instanceId, accion: 'login', licenseCode: 'F123-FIXTURE-OBSOLETA',
  });
  assert.equal(registro(env, instanceId).licenseCode, 'F123-FIXTURE-CANONICA',
    'un login pasivo no reasigna la licencia');

  // Pero un join deliberado sí debe poder moverla.
  await checkin(worker, env, {
    instanceId, accion: 'join', licenseCode: 'F123-FIXTURE-NUEVA',
  });
  assert.equal(registro(env, instanceId).licenseCode, 'F123-FIXTURE-NUEVA',
    'un join explícito sí mueve la licencia');
});
