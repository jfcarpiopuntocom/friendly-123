# NOTAS PARA OPUS 5.5 — lo que NO justifica gastar Fable 5.1 (JFC 2026-09-24)

Leer antes: CLAUDE.md, PLAN-BLOQUES-2026-09-24.md. Regla de reparto (JFC):
**Fable 5.1** = dinero, sync, integridad de datos, seguridad, debug de
Commissions y del panel de licencias, decisiones de arquitectura.
**Opus 5.5** = todo lo de esta lista: UI, copy, SEO, medicion, diseño de
landing. Cada item trae que hacer, donde y como se comprueba. Al terminar
uno, marcar [x] aqui y una linea de estado.

URL permanente de referencia (donde vive lo publicado hoy):
https://jfcarpiopuntocom.github.io/friendly-123/
Cuando Hostinger este en marcha (Bloque P, fases B-E), la URL del codigo sera
`https://<dominio de JFC>/friendly-123/docs/` (JFC confirma el dominio; el
plan esta en PLAN-BLOQUE-P-CARGADOR-HOSTINGER-2026-09-24.md).

## Bloque 7 — Hallmark en landing y save.html (conversion)
- [ ] Referencia: github.com/nutlope/hallmark (estructura de landing que
  convierte: promesa en 1 linea, prueba social, 3 beneficios, precio claro,
  1 CTA repetido, FAQ corta, sin muros de texto).
- [ ] `docs/save.html`: ya tiene la promesa de 24 h (commit b3fb439). Falta:
  un solo CTA visible por pantalla (hoy compiten varios), FAQ de 5 preguntas
  (precio unico, 5 anos, que pasa al vencer, datos en el aparato, WhatsApp),
  y una prueba social honesta (una tienda real con permiso; si no hay
  permiso, no inventar: usar "used daily in Cuenca since 2026").
- [ ] Landing (repo `website`, carpeta `friendly123/`): misma pauta. **Solo
  desde la PC de JFC** (el contenedor no ve ese repo ni github.io).
- Regla dura: colores con texto blanco solo sobre `--verde-ink #0B7A4B` y
  `--naranja-ink #C2410C` (ver Bloque 2 abajo); min 13 px; sin gris.
- Comprobar: Lighthouse local (`npm i lighthouse` local, nunca npx) SEO y
  Accessibility >= 95 en save y visualize; screenshot 375 px y escritorio.

## Bloque 2 — SEO, lo que queda
- [x] robots.txt, sitemap.xml, canonical y JSON-LD en index/save/visualize
  (Fable 5.1, 2026-09-24, `test/seo-legibilidad.test.js`).
- [x] Contraste: chips y boton principal de save/visualize y `li.naranja` de
  la app pasan a tinta oscura (5:1+).
- [ ] Re-medir con Lighthouse local y PageSpeed Insights (API sin key) y
  anotar antes/despues en PLAN-BLOQUES.
- [ ] Validar el JSON-LD en validator.schema.org (pegar la URL viva).
- [ ] hreflang: la app es EN con ES por i18n en la misma URL; NO poner
  hreflang a URLs que no existen. Solo `lang="en"` como esta.
- [ ] `docs/manual.html`: title y description propios (hoy generico).

## Bloque 1 — Clip en el hero de la landing
- [ ] Solo desde la PC de JFC (repo website, cambios locales sin commit).
  Detalle en PLAN-BLOQUES-2026-09-24.md.

## Panel de licencias — pulido de UI (la logica ya esta y tiene tests)
- [ ] Modal de pago: probar en telefono (375 px) que los 6 campos se ven sin
  scroll horizontal. Ajustar `.lic-modal-caja` si hace falta.
- [ ] Tabla de lotes: boton "Ver activados" filtra por lote; falta un "Ver
  sin usar" (codigos del lote que ningun aparato uso): la lista viene en
  `_licLotes[i].codigos` y los usados en `_licData[].licenseCode`.
- [ ] Textos del panel mezclan espanol e ingles (heredado). Unificar en
  espanol (el panel lo usa solo JFC). No tocar nombres de funciones.

## Notas de la app que son de UI (no de dinero)
- [ ] Advanced > linea "Code: github.io · 4 scripts": si JFC quiere, mover la
  cajita del canario dentro de un `<details>` para que no ocupe espacio.

## Donde rinde Fable 5.1 al pulir v1.0 (para no gastarlo en lo de arriba)
1. Cualquier cambio en `mock-backend.js` que toque ventas, splits,
   liquidaciones, ajustes o stock: correr y AMPLIAR
   `test/commissions-hugo-paco-luis.test.js` (camino real, dos aparatos).
2. Sync (sync-yjs.js, aplicarCatalogo, catalogoPropio): cualquier campo nuevo
   tiene que viajar y converger; test rojo-verde contra el respaldo.
3. Worker de licencias (`cloudflare-worker/worker.js`): estados, pagos, lotes.
   Nunca quitar acceso a quien pago (regla monotona).
4. Seguridad: licencias nunca en el repo (G5), claves solo en secrets, CORS
   solo al origen de github.io, cargador solo https.
5. Diagnostico de un cliente real (Belen/idiomARTE): leer bitacora y
   liquidaciones antes de tocar nada; nunca "arreglar" borrando namespaces.
