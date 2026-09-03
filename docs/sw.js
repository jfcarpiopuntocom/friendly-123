// sw.js — capa PWA mínima para AMIGABLE-123 (item 4, revisión JFC 2026-07-05).
// Cachea el shell estático (HTML/JS/CSS propios) para que la app ABRA sin
// conexión. A propósito NUNCA cachea ni intercepta:
//   - /api/*        → los datos deben ir siempre a la red (o al mock local),
//                     nunca servirse desde una caché vieja (stock/precios).
//   - version.json  → el chequeo de versión (Fase 2) necesita SIEMPRE la
//                     versión fresca del servidor; cachearlo mataría el aviso.
// Item 2 (fuentes offline): también cachea las fuentes de Google
// (fonts.googleapis.com / fonts.gstatic.com) tras la primera visita, así la
// tipografía sobrevive sin conexión. Los font stacks del CSS ya traen
// fallbacks del sistema por si nunca llegaron a cachearse.
/* SUBIR ESTE NUMERO cada vez que cambie cualquier archivo del SHELL. Si no se
   sube, el telefono que ya tiene la app instalada se queda con la version vieja
   PARA SIEMPRE. Hay un chequeo: bash check-sw.sh.
   El historial de que trajo cada version esta en git, no aqui: la lista de
   comentarios pegados a esta linea crecio hasta ser ilegible. */
/* FORTALECIDO 2026-08-25 — "sigue viendo la version vieja hasta en incognito"
   tenia DOS causas distintas y las dos quedan cubiertas (una del todo, la
   otra parcialmente, ver abajo):
   (A) El shell cacheado por este SW no se habia invalidado (numero de CACHE
       sin subir) -> se sube el numero cada vez que se toca algo real.
   (B) El propio archivo sw.js puede quedar servido desde la cache HTTP del
       navegador (GitHub Pages manda max-age=600), y entonces el navegador
       NUNCA llega a comparar bytes con este sw.js nuevo, sin importar cuanto
       se suba el numero de CACHE aqui adentro. ESO NO SE ARREGLA DESDE ESTE
       ARCHIVO: hace falta registrar el SW con { updateViaCache: "none" } en
       el register() (revisar index.html u otro archivo de arranque). Mientras
       tanto este archivo avisa a las pestañas abiertas apenas toma control
       (broadcastActualizacion, abajo) para que el aviso salga lo antes
       posible una vez que el navegador SI agarra el sw.js nuevo.
   Ademas, install/activate/fetch quedan blindados con try/catch: ningun
   error interno deja un evento sin resolver, y el fetch nunca devuelve
   undefined a respondWith (bug real de la v87: el fallback sin cache y sin
   navegacion devolvia undefined, y eso el navegador lo mostraba como "network
   error" en vez de una respuesta controlada).
   2026-08-25 (comisionistas): el shell cambio (index/i18n/mock-backend) y el
   numero ya estaba en v88 por el hardening de arriba — se mantiene v88, cubre
   ambos cambios del mismo dia. */
const CACHE = "f123-shell-v204"; // v192: 12 micromejoras (lapicito único + naranja de precaución, paleta del dinero, fechas locale, actividad→registro, crédito↔ítem, chip filtra gastos, undo cancelación 5s, editar/cancelar venta solo dueño/admin, crédito por expirar, editar evento/comprador, editar expiración de crédito)
const SHELL = [
  "./",
  "./index.html",
  "./logo.png",
  "./aislamiento.js",
  "./404.html",
  "./manual.html",
  "./barcode128.js",
  "./qrcode-local.js",
  "./favicon.png",
  "./pocketbase-client.js",
  "./estado-idb.js", "./mock-backend.js", "./red-segura.js",
  "./device-identity.js",
  "./storage-durabilidad.js",
  "./sync-realtime.js",
  "./sync-watchdog.js",
  "./lista-dinamica.js",
  "./vendor/ufuzzy.min.js",
  "./vendor/minisearch.min.js",
  "./i18n.js",
  "./crypto-store.js",
  "./email-recovery.js",
  "./auth-ui.js",
  "./backup-scheduler.js",
  "./avanzado-extra.js",
  "./soporte-visual.js",
  "./geo-ping.js",
  "./novedades.js",
  "./help-ui.js",
  "./idb-fotos.js",
  "./idb-archivo.js",
  "./simon-config.js", "./percha-reposicion.js", "./micelio-vivo.js", "./micelio-ui.js", "./tablero.html", "./tablero-avanzado.js", "./borradores.js", "./vista-perchas.js",
  "./welcome-ui.js",
  "./tutorial-ui.js",
  "./event-bus.js", "./logger.js", "./telemetry.js", "./identity-context.js", "./feature-gate.js", "./audit-store.js", "./sync-queue.js", "./sync-outbox.js", "./ui-actions.js", "./salud-app.js", "./hechos.js", "./reconciliacion.js", "./cartera.js", "./plan-pagos.js", "./plan-pagos-ui.js", "./caja-chica.js", "./respaldo-empleado.js", "./edutips.js", "./workshop-brand.js", "./manifest.json",
  "./version-manifest.json",
];

// Solo se cachean respuestas de estos orígenes — el propio y las fuentes.
const HOSTS_PERMITIDOS = [self.location.origin, "https://fonts.googleapis.com", "https://fonts.gstatic.com"];

// Aviso push a todas las pestañas abiertas (controladas o no) de que este SW
// tomo control con un CACHE nuevo. Complementa al "que-shell" (que es la
// pagina preguntando activamente) — este se dispara solo, sin que nadie
// pregunte, apenas termina "activate".
function broadcastActualizacion() {
  try {
    self.clients.matchAll({ includeUncontrolled: true }).then((lista) => {
      lista.forEach((cliente) => {
        try { cliente.postMessage({ tipo: "shell-actualizado", shell: CACHE }); } catch (_) {}
      });
    }).catch(() => {});
  } catch (_) {}
}

self.addEventListener("install", (evento) => {
  // PRECACHE RESILIENTE (JFC 2026-07-22) — NO volver a cache.addAll(SHELL).
  // addAll es ATÓMICO: si UN archivo del SHELL falla (renombrado, 404, o un
  // timeout de red en el móvil durante la instalación), TODO el precache se
  // aborta y el dispositivo queda SIN shell offline. (El .catch de antes solo
  // evitaba que install rechazara, pero igual no cacheaba NADA.) Con cache.add
  // por archivo + allSettled, un archivo malo solo se pierde a sí mismo y el
  // resto queda cacheado: la app sigue abriendo offline en teléfonos/tablets.
  try {
    evento.waitUntil(
      caches.open(CACHE).then((cache) => Promise.allSettled(
        SHELL.map((u) => cache.add(new Request(u, { cache: "reload" })).catch((e) => { try { console.warn("[SW] no se pudo precachear", u, e && e.message); } catch (_) {} }))
      )).then(() => {
        /* VERIFICACIÓN SRI-STYLE (JFC 2026-08-28, sistema de integridad de
           versión). Tras precachear, se lee version-manifest.json (ya en la
           cache) y se borra de la cache cualquier archivo del shell cuyo
           SHA-256 no cuadre con el manifest. Así una copia corrupta o a medias
           nunca se sirve: la próxima carga la re-pide a la red. Silencioso y
           por archivo (no aborta el precache). */
        try {
          caches.open(CACHE).then((cache) => cache.match("./version-manifest.json").then((res) => {
            if (!res) return;
            res.json().then((man) => {
              if (!man || !man.files) return;
              const promesas = Object.keys(man.files).map((rel) => {
                const esperado = man.files[rel];
                if (typeof esperado !== "string" || esperado.indexOf("sha256-") !== 0) return Promise.resolve();
                return cache.match(rel).then((r) => {
                  if (!r) return;
                  return r.text().then((txt) => {
                    return crypto.subtle.digest("SHA-256", new TextEncoder().encode(txt)).then((buf) => {
                      const hex = Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
                      if (("sha256-" + hex) !== esperado) {
                        try { console.warn("[SW] hash no cuadra, descartando copia corrupta:", rel); } catch (_) {}
                        return cache.delete(rel);
                      }
                    });
                  });
                });
              });
              Promise.allSettled(promesas).catch(() => {});
            }).catch(() => {});
          })).catch(() => {});
        } catch (_) {}
      }).catch((e) => { try { console.warn("[SW] precache incompleto:", e && e.message); } catch (_) {} })
    );
  } catch (e) {
    // Blindaje 2026-08-25: si algo revienta ANTES de poder extender el
    // evento (p.ej. caches.open no disponible), igual dejamos que install
    // termine sin precache en vez de quedar colgado o rechazado a medias.
    try { console.warn("[SW] install fallo por completo, sigue sin precache:", e && e.message); } catch (_) {}
  }
  self.skipWaiting();
});

self.addEventListener("activate", (evento) => {
  try {
    evento.waitUntil(
      caches.keys()
        .then((nombres) => Promise.all(nombres.filter((n) => n.startsWith("f123-shell-") && n !== CACHE).map((n) => caches.delete(n))))
        .then(() => broadcastActualizacion())
        .catch((e) => { try { console.warn("[SW] activate con errores:", e && e.message); } catch (_) {} })
    );
  } catch (e) {
    try { console.warn("[SW] activate fallo por completo:", e && e.message); } catch (_) {}
  }
  self.clients.claim();
});

self.addEventListener("fetch", (evento) => {
  try {
    const url = new URL(evento.request.url);
    // Nunca /api/*: siempre red (datos en vivo, nunca caché vieja).
    if (url.pathname.startsWith("/api/")) return;
    // Nunca version.json: el aviso de update (Fase 2) exige versión fresca.
    if (url.pathname.endsWith("/version.json") || url.pathname.endsWith("version.json")) return;
    if (evento.request.method !== "GET") return;
    if (!HOSTS_PERMITIDOS.includes(url.origin)) return;

    // Estrategia (corregida 2026-07-07, JFC reporto Ayuda vieja tras deploy):
    //   - Mismo origen (shell de la app): NETWORK-FIRST — con conexion siempre
    //     se sirve lo ultimo publicado en Pages y se refresca la copia; la
    //     cache solo responde cuando NO hay red. Asi un deploy se ve en la
    //     primera recarga, no en la segunda.
    //   - Fuentes de Google: CACHE-FIRST — son inmutables por URL versionada,
    //     no hay razon para pedirlas de nuevo. Llegan como respuestas "opaque"
    //     (ok=false), por eso se aceptan tambien.
    const esMismoOrigen = url.origin === self.location.origin;
    const guardar = (res) => {
      if (res && (res.ok || res.type === "opaque")) {
        const copia = res.clone();
        caches.open(CACHE).then((cache) => cache.put(evento.request, copia)).catch(() => {});
      }
      return res;
    };

    // Blindaje 2026-08-25: respuesta de ultimo recurso. En la v87, si no
    // habia nada en cache y la request no era de navegacion, el fallback
    // devolvia `undefined` a respondWith() -> el navegador lo mostraba como
    // "network error" en vez de manejarlo. Ahora SIEMPRE hay una Response
    // real, aunque sea un 503.
    const respuestaOffline = () => new Response("Sin conexion y sin copia en cache.", {
      status: 503,
      statusText: "Offline",
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });

    if (esMismoOrigen) {
      // cache:"no-cache" fuerza revalidacion con el servidor (GitHub Pages manda
      // max-age=600; sin esto, el navegador puede responder con su cache HTTP
      // hasta 10 min y el deploy "no sale" aunque el SW pida red).
      evento.respondWith(
        fetch(evento.request, { cache: "no-cache" }).then(guardar).catch(() =>
          // FIX 2026-07-07: sin red, una URL con query (?desde=whatsapp) no
          // coincidia con el cache y la app no abria. Toda navegacion cae al
          // index cacheado como ultima red de seguridad.
          caches.match(evento.request).then((c) => {
            if (c) return c;
            if (evento.request.mode === "navigate") {
              return caches.match("./index.html").then((idx) => idx || respuestaOffline());
            }
            return respuestaOffline();
          })
        ).catch(() => respuestaOffline())
      );
    } else {
      evento.respondWith(
        caches.match(evento.request)
          .then((cacheada) => cacheada || fetch(evento.request).then(guardar))
          .catch(() => respuestaOffline())
      );
    }
  } catch (e) {
    // Blindaje 2026-08-25: si algo revienta antes de llegar a respondWith,
    // no interceptamos nada — se deja pasar a la red normal del navegador
    // en vez de romper la request.
    try { console.warn("[SW] fetch handler fallo, dejando pasar a la red:", e && e.message); } catch (_) {}
    return;
  }
});

/* A4 — AUTODIAGNOSTICO DE VERSION (JFC 2026-08-19).
   El service worker es el unico que sabe DE VERDAD que shell esta sirviendo.
   La pagina se lo pregunta y lo compara con el shell que declara version.json
   (que nunca se cachea, ver el fetch de arriba). Si no coinciden, el
   dispositivo quedo con media version vieja —el bug que rompio Avanzado en el
   iPhone de JFC— y se le ofrece recargar en vez de dejarlo roto en silencio.
   2026-08-25: se agrega "skip-waiting" para que la pagina pueda forzar la
   activacion inmediata de un SW nuevo (patron estandar de un boton
   "Actualizar ahora" en el aviso de version). */
self.addEventListener("message", (ev) => {
  try {
    if (!ev.data) return;
    if (ev.data.tipo === "que-shell" && ev.source && ev.source.postMessage) {
      ev.source.postMessage({ tipo: "shell-actual", shell: CACHE });
      return;
    }
    if (ev.data.tipo === "skip-waiting" || ev.data.type === "SKIP_WAITING") {
      self.skipWaiting();
    }
  } catch (_) {}
});
