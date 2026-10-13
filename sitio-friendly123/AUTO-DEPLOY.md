# friendly123.com — Workers Builds desde `estable` (2026-10-12)

**Objetivo:** `friendly123.com/` conserva la landing comercial; `friendly123.com/app/` entrega
la misma version APROBADA que GitHub Pages `/friendly-123/`. No redirigir a otro origen:
IndexedDB, fotos, licencias y datos locales pertenecen al origen actual.

**Estado:** PREPARADO EN RAMA AISLADA. NO CONECTADO A PRODUCCION. NO HACER MERGE
o activar Builds hasta completar los ensayos indicados abajo. Esta nota no es un
comprobante de despliegue.

## Infraestructura, alcance y permisos

- Repositorio: `jfcarpiopuntocom/friendly-123`. Fuente de la PWA: `docs/` en `estable`.
- Worker de ESTATICOS, y SOLO este: `friendly123-com`. Ruta actual:
  `friendly123.com` + `www.friendly123.com`, sin cambios de dominio ni DNS.
- NO usar Worker `friendly-123` (licencias/otros), `website`, `f123-code`,
  `BuscaClientes` ni Worker de sincronizacion. No tocar sus conexiones o despliegues.
- No introducir API, Cloudflare KV, D1, colas, cron ni consultas periódicas.
  Los archivos estaticos se sirven desde Workers Static Assets.
- Cuenta propietaria del Worker: **NO es la cuenta `5c15f6eacab9538c6f4cccbe750758d0`
  que hoy aparece en el conector de BuscaClientes.** El acceso actual NO autoriza este deploy.
- Root directory en Workers Builds: **raiz del repositorio**.
- Production branch: **`estable`**, no `master`, `next`, `website/main` ni otra.
- Build command: `node sitio-friendly123/build-cloud.mjs`
- Deploy command: `npx wrangler deploy --config sitio-friendly123/wrangler.jsonc`
- Previews automatizados: **desactivados** hasta diseñar aislamiento y controles.
- Herramientas: Node compatible con ESM (recomendado 22+), git, Wrangler del
  `package-lock.json` del repo. Instalar dependencias con `npm ci` cuando el entorno
  no lo haga. Sin secretos en repo, frontend, Notion o logs.
- Confirmar el nombre `friendly123-com` en `sitio-friendly123/wrangler.jsonc`
  y en el dashboard antes de conectar. No usar `npx wrangler deploy` sin `--config`.

## Salvaguardas integradas al build

1. Comparar `git rev-parse HEAD` con el SHA **remoto** `refs/heads/estable`.
   Rechazar un checkout de master, una revision vieja o un ref no verificable.
2. Usar el snapshot de marketing anclado en `sitio-friendly123/website-source-lock.sha`
   (revision de `jfcarpiopuntocom/website`, **no implica validacion visual del sitio
   actualmente publicado**). No usar arbitrariamente el ultimo `website/main`.
3. En la copia de `docs/`, verificar todos los SHA-256 del manifiesto original
   ANTES de construir. En el resultado permitir cambios unicamente de SEO/meta
   en `index.html`, `manual.html` y `save.html`; NO en datos, scripts, fotos ni SW.
4. Verificar shell coherente entre `version.json`, `sw.js` y manifiesto.
   En ausencia de `sharp`, los HTML deben referenciar imagenes originales,
   nunca un WebP que no exista.
5. Releer el SHA remoto de `estable` al terminar: un candidato superado falla cerrado.
6. Emitir `/app/_release.json` con SHA exacto, shell, cacheGeneration y fuente
   del sitio; es un archivo estatico, sin informacion personal ni KV.
7. Solo se empaqueta `dist/` para el Worker **friendly123-com**.
   Ningun paso de compilacion envia datos, borra caches de usuarios, migra tablas
   o toca el sistema de licencias/sync.

## Puerta de activacion (ninguna es opcional)

A. Revisar `CLAUDE.md`, `AGENTS.md`, bitacora y los incidentes 2026.
B. Hacer merge del codigo de integracion a `master` y promoverlo por
   el flujo protegido existente a `estable`, **solo tras tests verdes**.
   Al no editar `docs/`, este cambio no requiere shell nuevo: no inventarlo.
   Verificar que `Workers Builds: website` NO esta en checks de master.
C. Ensayar el constructor con el checkout de `estable`, sin despliegue:
   `node sitio-friendly123/build-cloud.mjs`. Confirmar hashes, manifiesto, y
   que `dist/` solo contiene archivos estaticos y no bindings KV.
   Ejecutar `npm test`, `bash check-sw.sh`, pruebas focales, prueba WebKit
   y Chromium. Si cualquier resultado es rojo/desconocido, NO proceder.
D. En preview local/aislado, validar landing, enlaces, SEO, iconos, SW,
   manifest web, modo offline e ingles/espanol. Especialmente el salto
   desde PWA v468 a v488 en **mismo origen de prueba**, preservando fotos,
   IndexedDB, stock, comisiones, fiado, PIN/licencias y reconciliacion.
   No utilizar datos reales de clientes; usar fixtures y backup cifrado aparte.
E. Comparar portada y paginas legales/marketing de la build con las publicas
   actuales. Cualquier diferencia no aprobada bloquea la activacion.
F. Confirmar en la **cuenta Cloudflare propietaria correcta** que existe
   exactamente `friendly123-com`, que conserva los dos custom domains y
   que hay una version anterior para rollback.
G. SOLO entonces conectar **Worker `friendly123-com` > Settings > Builds > Connect**
   al repo, production branch `estable`, root/release commands de arriba.
   Revisar los settings antes de guardar: conectar el Worker equivocado
   es una regresion critica. Ninguna cuenta de BuscaClientes autoriza sustituirlo.
H. Primera puesta en marcha: observar la build, comprobar respuesta HTTP
   de `/`, `/app/`, `/app/sw.js`, `/app/version.json` y `/app/_release.json`,
   mas la apertura real en Safari y Chromium. No comunicar exito sin leer el
   archivo servido en el dominio oficial.

## Verificacion economica y honesta

Leer **una vez tras cada deploy** (sin cron ni polling continuo):

- `https://jfcarpiopuntocom.github.io/friendly-123/version.json`
- `https://friendly123.com/app/version.json`
- `https://friendly123.com/app/_release.json`

Criterio PASS: shell y cacheGeneration iguales y `_release.sha` =
SHA exacto actual de `estable`; respuestas HTTP 200, scripts e imagenes
disponibles y ensayo de PWA en navegador completado. 0 reportes del Sonar
NO demuestra que funcionen datos en dispositivos.

Si la compilacion falla: mantener el ultimo Worker operativo sin cambios
de rutas/datos, notificar BLOCK. Si falla tras desplegar: rollback
**solo de `friendly123-com`** a la version previa desde Cloudflare,
comprobar `/app/version.json`, y suspender automatic builds mientras se investiga.
Nunca limpiar IndexedDB, localStorage ni Cache Storage de clientes para
"arreglar" una publicacion; nunca sustituir todo friendly123.com por github.io.

## Riesgos abiertos para la primera activacion

- Se comprobo en octubre que `friendly123.com/app/` todavia servia v468
  mientras GitHub Pages servia v488. Falta probar la actualizacion entre ellas
  sobre el MISMO origen. No asumir compatibilidad solo porque el build compile.
- El snapshot `website-source-lock.sha` es un candidato tecnico, no una
  comparacion visual certificada con la landing que hoy ve el publico.
- La cuenta Cloudflare conectada no tiene acceso al Worker propietario.
- Ni este procedimiento ni este commit reducen por si solos el consumo KV
  de OTRAS aplicaciones: las 100.000 lecturas en la cuenta de BuscaClientes
  requieren diagnostico independiente.

Documentacion: https://developers.cloudflare.com/workers/ci-cd/builds/
y https://developers.cloudflare.com/workers/ci-cd/builds/build-branches/
