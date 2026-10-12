# friendly123.com/app/ — espejo automatico de la version ESTABLE

Situacion detectada el 2026-10-12: la app bajo https://friendly123.com/app/ servia v468 y la app publica GitHub Pages v487. El Worker independiente `friendly123-com` se desplegaba manualmente.

## Configuracion unica (Cloudflare Workers Builds, cuenta propietaria de friendly123.com)

Conectar **solo** el Worker `friendly123-com` (NO `friendly-123`, `website` ni `f123-code`) al repositorio `jfcarpiopuntocom/friendly-123`.

- **Production branch:** `estable` (nunca master, never next).
- **Root directory:** raiz del repositorio.
- **Build command:** `node sitio-friendly123/build-cloud.mjs`.
- **Deploy command:** `npx wrangler deploy --config sitio-friendly123/wrangler.jsonc`.
- **Environment:** Node 20+ y acceso de lectura Git a los repositorios publicos `friendly-123` y `website`. El token de Cloudflare se gestiona en Workers Builds; nunca subirlo a Git.
- Validar que los custom domains actuales `friendly123.com` y `www.friendly123.com` siguen vinculados a ese Worker.

## Guardias

1. El build aborta si su SHA exacto no coincide con `refs/heads/estable` remoto.
2. Clona el sitio `website` publico a un temporal para preservar landing/SEO/legal existentes sin dependencia de discos Windows.
3. Ejecuta el constructor existente `sitio-friendly123/build.mjs`: la landing queda en / y la app en /app/.
4. Recalcula el manifiesto SHA-256 **solo** para HTML reescrito deliberadamente por SEO, y aborta cualquier diferencia no permitida.
5. Publica `/app/_release.json` con SHA y shell para comparar contra GitHub Pages y `/app/version.json`. No contiene datos personales.
6. Publicacion es un unico Worker de assets, sin duplicar base de datos, sin modificar `docs/`, sin renombrar, borrar ni cambiar Workers ajenos.

**No usar redireccion de /app/ a GitHub Pages**: la PWA offline almacena datos por origen web. Una redireccion cambiaria el origen y podria esconder datos previamente creados en friendly123.com. Si algun dia hay migracion, diseñar explicitamente exportar/importar cifrado, consentimiento y verificaciones.

## Verificacion despues de cada promotion

- `https://jfcarpiopuntocom.github.io/friendly-123/version.json`
- `https://friendly123.com/app/version.json`
- `https://friendly123.com/app/_release.json`

Las dos primeras deben reportar **el mismo shell y cacheGeneration**, y la tercera el SHA exacto promovido a `estable`. Si falla Cloudflare Builds, no afirmar deploy; mantener la version previa y alertar. La promocion de `estable` sigue siendo la unica compuerta de aprobacion, por tanto no se gastan minutos extra de GitHub Actions para duplicar la PWA en el dominio.

Nota: esta automatizacion solo queda activa tras conectar Worker Builds en la cuenta Cloudflare correcta. La conexion Cloudflare que hoy aparece en otro proyecto no esta autorizada para este Worker.
