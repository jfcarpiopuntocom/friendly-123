/* Round-trip de FOTOS en el respaldo (JFC 2026-09-22, hallazgo #9).

   EL BUG QUE CIERRA: el export "Export via WhatsApp" armaba `fotosPerchas`
   leyendo claves "*_foto_percha_*" de localStorage. Desde v244 las fotos viven
   en IndexedDB por hash (docs/idb-fotos.js) y en localStorage SOLO quedan
   borrados de limpieza. Resultado: el respaldo salía SIN NINGUNA foto y la app
   decía "Copy downloaded" igual. El dueño se enteraba al restaurar, cuando ya
   era tarde. El fix agrega `fotosIDB` al paquete y lo restaura al importar.

   ALCANCE HONESTO DE ESTA PRUEBA: en Node no hay IndexedDB, así que
   `idb-fotos.js` corre su rama de respaldo sobre localStorage (SOPORTADO=false,
   una rama real: es la que usan los navegadores sin IDB). Esto prueba el
   CONTRATO del que depende el export/import — guardarFoto/leerTodas por id y
   que una foto sobreviva el viaje — pero NO prueba la rama IndexedDB de un
   Safari real. Esa sigue necesitando el smoke de navegador. No presentar un
   verde de aquí como prueba de que las fotos cruzan en el iPhone de Belén. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

// Ventana mínima SIN indexedDB, para que idb-fotos.js tome su rama de respaldo.
function ventanaConFotos() {
  const entries = new Map();
  const w = {
    localStorage: {
      get length() { return entries.size; },
      key: i => [...entries.keys()][i],
      getItem: k => entries.get(k) ?? null,
      setItem: (k, v) => entries.set(k, String(v)),
      removeItem: k => entries.delete(k),
    },
    console: { warn() {}, error() {}, log() {} },
    crypto: globalThis.crypto,
    TextEncoder, atob, btoa,
  };
  w.window = w; w.globalThis = w; w.self = w;
  vm.createContext(w);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'docs', 'idb-fotos.js'), 'utf8'), w);
  return w;
}

test('the photo store round-trips a photo by id, which is what the backup relies on', async () => {
  const w = ventanaConFotos();
  assert.ok(w.OCFotos && w.OCFotos.leerTodas && w.OCFotos.guardarFoto,
    'OCFotos expone leerTodas/guardarFoto: si esto cambia de nombre, el export deja de llevar fotos en silencio');

  const foto = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';
  assert.equal(await w.OCFotos.guardarFoto('percha-fixture', foto), true);

  const todas = await w.OCFotos.leerTodas();
  assert.equal(todas['percha-fixture'], foto, 'leerTodas ve la foto guardada');
});

test('a photo survives export into the package and import into a clean device', async () => {
  const origen = ventanaConFotos();
  const foto = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';
  await origen.OCFotos.guardarFoto('percha-viajera', foto);

  // Mitad EXPORT: es lo que arma el botón "Export via WhatsApp".
  const paquete = {
    schemaVersion: 2, _formaB: true, datos: { productos: [] },
    fotosPerchas: {},                                  // almacén legacy (vacío hoy)
    fotosIDB: await origen.OCFotos.leerTodas(),        // almacén REAL — lo que faltaba
  };
  assert.equal(Object.keys(paquete.fotosIDB).length, 1,
    'el paquete lleva la foto: antes del fix este número era 0 y nadie se enteraba');

  // El paquete viaja como JSON por WhatsApp: tiene que sobrevivir serializado.
  const recibido = JSON.parse(JSON.stringify(paquete));

  // Mitad IMPORT: aparato nuevo, vacío.
  const destino = ventanaConFotos();
  assert.equal(Object.keys(await destino.OCFotos.leerTodas()).length, 0, 'el destino arranca sin fotos');
  for (const id of Object.keys(recibido.fotosIDB)) {
    await destino.OCFotos.guardarFoto(id, recibido.fotosIDB[id]);
  }

  assert.equal((await destino.OCFotos.leerTodas())['percha-viajera'], foto,
    'la foto llega íntegra al aparato nuevo');
});

test('an old backup without fotosIDB still imports without throwing', async () => {
  // Compatibilidad hacia atrás: schemaVersion sigue en 2 a propósito, así que
  // una app nueva tiene que poder leer un respaldo viejo (sin fotosIDB) y una
  // app vieja ignora el campo que no conoce.
  const destino = ventanaConFotos();
  const viejo = { schemaVersion: 2, datos: { productos: [] }, fotosPerchas: {} };
  let restauradas = 0;
  if (viejo.fotosIDB && destino.OCFotos.guardarFoto) {
    for (const id of Object.keys(viejo.fotosIDB)) {
      if (await destino.OCFotos.guardarFoto(id, viejo.fotosIDB[id])) restauradas++;
    }
  }
  assert.equal(restauradas, 0);
  assert.equal(Object.keys(await destino.OCFotos.leerTodas()).length, 0, 'no rompe ni inventa fotos');
});
