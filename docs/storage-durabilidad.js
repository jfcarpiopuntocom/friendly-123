// storage-durabilidad.js — friendly-123 (Fase 1 del plan de blindaje de datos, 2026-08-04)
// ============================================================================
// QUE HACE: navigator.storage.persist() se llamaba una sola vez, al activar el
// dispositivo (auth-ui.js), sin leer el resultado. Si el navegador lo negaba
// (comun en iOS Safari sin instalar la PWA, o bajo presion de espacio), nadie
// se enteraba nunca — y localStorage/IndexedDB quedan en modo "best-effort":
// el sistema operativo puede borrarlos sin avisar si el dispositivo necesita
// espacio y la app lleva dias sin abrirse.
//
// Este modulo centraliza esa llamada, LEE el resultado, lo recuerda, reintenta
// en cada arranque mientras no este concedido (los navegadores la conceden mas
// facil con uso repetido o app instalada), y expone el estado para que la UI
// pueda avisar honestamente al dueno si sus datos siguen en riesgo.
//
// Si la API no existe (navegador viejo) o falla: no rompe nada, la app sigue
// exactamente igual que hoy. Cero dependencia obligatoria, mismo criterio que
// sync-realtime.js.
(function () {
  const KEY_ESTADO = "f123_storage_persist";

  function leerEstado() {
    try { return JSON.parse(localStorage.getItem(KEY_ESTADO) || "null"); } catch (_) { return null; }
  }
  function guardarEstado(persistido) {
    try {
      localStorage.setItem(KEY_ESTADO, JSON.stringify({ persistido: persistido, verificadoEn: Date.now() }));
    } catch (_) {}
  }

  // Intenta obtener persistencia y ACTUALIZA el estado guardado con el
  // resultado real (a diferencia de la llamada anterior, fire-and-forget).
  async function verificarYSolicitar() {
    if (!navigator.storage || !navigator.storage.persist || !navigator.storage.persisted) {
      guardarEstado(null); // API no disponible en este navegador — ni si ni no
      return null;
    }
    try {
      let ya = await navigator.storage.persisted();
      if (!ya) ya = await navigator.storage.persist();
      guardarEstado(!!ya);
      return !!ya;
    } catch (_) {
      return leerEstado() ? leerEstado().persistido : null;
    }
  }

  // Estado sincronico ultimo conocido, para pintar UI sin esperar una promesa.
  function estadoConocido() {
    const e = leerEstado();
    return e ? e.persistido : null; // true | false | null (null = nunca verificado o API ausente)
  }

  window.OCStorageDurable = { verificarYSolicitar: verificarYSolicitar, estadoConocido: estadoConocido };

  // Se verifica solo una vez por carga de pagina, en segundo plano, sin
  // bloquear el arranque de la app.
  try { verificarYSolicitar(); } catch (_) {}
})();
