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
const CACHE = "f123-shell-v87"; // bumped 2026-08-21 (v1.0): el equipo (PINs/roles) viaja por sync, jerarquia del admin, stock sin negativos, fuera el codigo TEAM- y el QR
const SHELL = [
  "./",
  "./index.html",
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
  "./lista-dinamica.js",
  "./vendor/ufuzzy.min.js",
  "./vendor/minisearch.min.js",
  "./i18n.js",
  "./crypto-store.js",
  "./email-recovery.js",
  "./auth-ui.js",
  "./backup-scheduler.js",
  "./avanzado-extra.js",
  "./geo-ping.js",
  "./novedades.js",
  "./help-ui.js",
  "./idb-fotos.js",
  "./idb-archivo.js",
  "./simon-config.js", "./percha-reposicion.js", "./micelio-vivo.js", "./micelio-ui.js", "./tablero.html", "./tablero-avanzado.js", "./borradores.js", "./vista-perchas.js",
  "./welcome-ui.js",
  "./tutorial-ui.js",
  "./event-bus.js", "./logger.js", "./telemetry.js", "./identity-context.js", "./feature-gate.js", "./audit-store.js", "./sync-queue.js", "./sync-outbox.js", "./ui-actions.js", "./salud-app.js", "./hechos.js", "./reconciliacion.js", "./cartera.js", "./plan-pagos.js", "./plan-pagos-ui.js", "./caja-chica.js", "./respaldo-empleado.js", "./edutips.js", "./manifest.json",
];

// Solo se cachean respuestas de estos orígenes — el propio y las fuentes.
const HOSTS_PERMITIDOS = [self.location.origin, "https://fonts.googleapis.com", "https://fonts.gstatic.com"];

self.addEventListener("install", (evento) => {
  // PRECACHE RESILIENTE (JFC 2026-07-22) — NO volver a cache.addAll(SHELL).
  // addAll es ATÓMICO: si UN archivo del SHELL falla (renombrado, 404, o un
  // timeout de red en el móvil durante la instalación), TODO el precache se
  // aborta y el dispositivo queda SIN shell offline. (El .catch de antes solo
  // evitaba que install rechazara, pero igual no cacheaba NADA.) Con cache.add
  // por archivo + allSettled, un archivo malo solo se pierde a sí mismo y el
  // resto queda cacheado: la app sigue abriendo offline en teléfonos/tablets.
  evento.waitUntil(
    caches.open(CACHE).then((cache) => Promise.allSettled(
      SHELL.map((u) => cache.add(new Request(u, { cache: "reload" })).catch((e) => { try { console.warn("[SW] no se pudo precachear", u, e && e.message); } catch (_) {} }))
    )).catch((e) => { try { console.warn("[SW] precache incompleto:", e && e.message); } catch (_) {} })
  );
  self.skipWaiting();
});

self.addEventListener("activate", (evento) => {
  evento.waitUntil(
    caches.keys().then((nombres) => Promise.all(nombres.filter((n) => n.startsWith("f123-shell-") && n !== CACHE).map((n) => caches.delete(n))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (evento) => {
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
  if (esMismoOrigen) {
    // cache:"no-cache" fuerza revalidacion con el servidor (GitHub Pages manda
    // max-age=600; sin esto, el navegador puede responder con su cache HTTP
    // hasta 10 min y el deploy "no sale" aunque el SW pida red).
    evento.respondWith(
      fetch(evento.request, { cache: "no-cache" }).then(guardar).catch(() =>
        // FIX 2026-07-07: sin red, una URL con query (?desde=whatsapp) no
        // coincidia con el cache y la app no abria. Toda navegacion cae al
        // index cacheado como ultima red de seguridad.
        caches.match(evento.request).then((c) => c || (evento.request.mode === "navigate" ? caches.match("./index.html") : undefined))
      )
    );
  } else {
    evento.respondWith(
      caches.match(evento.request).then((cacheada) => cacheada || fetch(evento.request).then(guardar))
    );
  }
});

/* A4 — AUTODIAGNOSTICO DE VERSION (JFC 2026-08-19).
   El service worker es el unico que sabe DE VERDAD que shell esta sirviendo.
   La pagina se lo pregunta y lo compara con el shell que declara version.json
   (que nunca se cachea, ver el fetch de arriba). Si no coinciden, el
   dispositivo quedo con media version vieja —el bug que rompio Avanzado en el
   iPhone de JFC— y se le ofrece recargar en vez de dejarlo roto en silencio. */
self.addEventListener("message", (ev) => {
  try {
    if (ev.data && ev.data.tipo === "que-shell" && ev.source && ev.source.postMessage) {
      ev.source.postMessage({ tipo: "shell-actual", shell: CACHE });
    }
  } catch (_) {}
});
