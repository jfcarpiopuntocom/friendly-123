# AMIGABLE — Plan de distribución, soberanía y auto-update

> Estado: APROBADO por JFC (2026-07-03), Fase 1 ENTREGADA. Es la arquitectura
> del carácter del producto: **soberanía digital**. Sin suscripción, sin nube
> de datos.
>
> **Progreso:**
> - ✅ Fase 1 — Página de error/404 con WhatsApp: `docs/404.html` + `public/404.html`, en vivo.
> - ⏳ Fase 2 — `version.json` + chequeo de versión (aviso, sin auto-reemplazo).
> - ⏳ Fase 3 — `updater.html` (reemplazo real con validación de hash).
> - ⏳ Fase 4 — Export cifrado del negocio.
> - ⏳ Fase 5 — Panel de control de JFC (push de versiones, releases, backups).
> - ⏳ Fase 6 — QR por negocio (#4) + redundancia Nostr (opcional).

## 1. Principios (no negociables)

1. **Sin suscripción.** Se paga una vez (o nada, en demo). La app sigue
   funcionando aunque el proveedor desaparezca.
2. **Sin nube de datos.** Los datos del negocio viven **cifrados en el
   dispositivo** del dueño (tablet o PC). Él exporta a su gusto (respaldo
   JSON ya existe). Nadie más los ve.
3. **Vive en el navegador.** Nada de app de tienda, nada de .exe, nada que el
   usuario tenga que "instalar" con permisos peligrosos. Un archivo HTML local
   + almacenamiento del navegador.
4. **Código auditable.** El fuente es legible y se **sugiere auditarlo**. Es
   parte del argumento de venta (soberanía = confianza).
5. **El único servidor es de UPDATES**, no de datos. Basta el GitHub de JFC
   (Pages). Opcional: un VPS o un canal tipo Nostr como redundancia.

## 2. Componentes

- **App autocontenida** (lo que hoy vive en `docs/`): corre 100% en el
  navegador con su backend simulado local (`mock-backend.js`).
- **Datos locales cifrados**: `localStorage`/`IndexedDB` + export cifrado bajo
  control del usuario. (Las claves ya se guardan cifradas; falta cifrar el
  blob de negocio completo en el export.)
- **`version.json`** en el repo: `{ version, fecha, hash, notas, url }`. Es la
  única "verdad" de cuál es la última versión del día.
- **`updater.html`** (html intermedio): página a la que la app salta para
  descargar los archivos nuevos y **reemplazar** el actual, y luego redirige de
  vuelta a la app ya actualizada.
- **Página 404 / de error**: si algo se rompe, pantalla con los datos de JFC y
  **botón directo a WhatsApp +593 99 990 5080**. Nunca una pantalla muerta.
- **Panel de control general (solo JFC)**: desde donde **pushea versiones y
  parches cuando quiera** y maneja los **backups de versiones** (tags/releases
  de GitHub). Acceso único suyo.

## 3. Flujo de auto-update (soberano)

1. Al abrir, si hay internet, la app pide `version.json` del repo.
2. Compara con su versión local. Si hay una más nueva, avisa al dueño
   ("hay una mejora disponible") y, con su OK, salta a `updater.html`.
3. `updater.html` descarga los archivos de la nueva versión, valida el `hash`,
   reemplaza el archivo/instancia local y redirige a la app actualizada.
4. Si NO hay internet: la app sigue funcionando con su última versión. La
   soberanía nunca depende de estar conectado.
5. Si algo falla en el proceso: cae en la **página de error** con el botón a
   WhatsApp de JFC.
6. **Redundancia (futuro):** un canal descentralizado tipo **Nostr** que
   anuncia la última versión, por si el GitHub no está disponible. Solo para
   **descubrir/descargar updates**, jamás para datos del negocio.

## 4. Distribución por QR (un negocio, un QR)

Cuando JFC visita un negocio, le entrega un **QR único** que lleva a **su**
instancia. Dos caminos (a decidir según límites de GitHub):

- **A) Instancia hospedada por cliente**: subcarpeta/branch por negocio en el
  repo AMIGABLE, o parámetro (`?cliente=xxx`). Simple de pushear updates, pero
  sujeto a límites de repos/páginas gratis de GitHub (¿50-100 antes de
  despegar?).
- **B) Copia local pura**: el QR entrega el HTML autocontenido; el negocio lo
  guarda como **archivo local cifrado bajo su control**. Cero dependencia de
  GitHub por cliente. Los updates llegan por el mismo mecanismo de §3.

En ambos, al cliente se le da el GitHub de la **Demo = AMIGABLE** (el nuevo
repo main) para que audite el código.

## 5. Decisiones abiertas (para JFC)

- ¿Instancia hospedada (A) o copia local (B) como camino principal? (Se puede
  soportar ambos; ¿cuál primero?)
- Límite real de demos gratis en GitHub antes de necesitar VPS.
- ¿Cifrado del blob de negocio: passphrase del dueño (derivada con PBKDF2, ya
  se usa para PINs) o clave por dispositivo?

## 6. Fases sugeridas

1. **Página de error/404 con WhatsApp** (rápida, alto valor).
2. **`version.json` + chequeo de versión** (aviso, sin auto-reemplazo).
3. **`updater.html`** (reemplazo real con validación de hash).
4. **Export cifrado del negocio** (soberanía de datos completa).
5. **Panel de control de JFC** (push de versiones, releases, backups).
6. **QR por negocio** (camino A o B) + **redundancia Nostr** (opcional).
