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

## GUARDAS DE DATOS — leer antes de tocar nada (estamos LIVE con clientes)
- NO tocar: `docs/mock-backend.js`, `docs/sync-yjs.js`, `docs/sync-*.js`,
  `docs/estado-idb.js`, `docs/idb-*.js`, `docs/crypto-store.js`,
  `docs/auth-ui.js`, `cloudflare-worker/`, `cloudflare-sync-relay/`. Si una
  tarea de esta lista parece necesitarlo, se PARA y se anota aqui para
  Fable 5.1. Dinero, sync, licencias y acceso son de Fable 5.1.
- Nunca datos de clientes, PIN, licencias completas ni claves en codigo,
  tests, commits, capturas ni prompts. `check-sw.sh` G5 lo vigila.
- Cada cambio a un archivo del SHELL (lista `const SHELL` en `docs/sw.js`):
  subir `f123-shell-vNNN` en sw.js y version.json, `node
  scripts/gen-manifest.js`, `bash check-sw.sh` con TODO OK. save.html,
  visualize.html, robots, sitemap y panel.html NO son shell.
- Antes de cada lote: copia + SHA-256 en `backups/<fecha>_<motivo>/`.
- Suite: `PLAYWRIGHT_BROWSERS_PATH=... node --test` (o `npm test`); 283 en
  verde el 2026-09-24. Un test nuevo de UI se rotula como fijacion.
- Aditivo siempre: campo nuevo antes que cambiar formato; nada de
  schemaVersion; compatibilidad en las dos direcciones.
- Legibilidad: sin gris, sin opacidad en texto, minimo 13 px, cuatro esquinas,
  texto blanco SOLO sobre `--verde-ink #0B7A4B`, `--naranja-ink #C2410C`,
  `--rojo-ink #B8123C`, `--azul-ink #2F6F86`, `--negro`, `#0F7A6C`
  (WhatsApp). `test/seo-legibilidad.test.js` lo fija.
- Commit + push + PR en rama `claude/...` desde `origin/master` fresco;
  mergear solo con la suite verde y check-sw OK.

## PageSpeed de referencia (save.html, movil, 2026-09-24 21:18 UTC, ANTES de v386)
Performance 88 · Accessibility 94 (contraste) · Best Practices 100 · SEO 100.
FCP 3.1 s · LCP 3.1 s · TBT 20 ms · CLS 0 · Speed Index 3.1 s.
Hallazgos: imagen sin width/height (arreglado: logo con medidas), minificar
CSS (3 KiB), 1 tarea larga, DOM grande, contraste (arreglado: chips, cards,
boton WhatsApp, rojo y azul a tintas). Re-medir DESPUES y anotar aqui.
Las advertencias CSP/HSTS/COOP/XFO no se pueden fijar en GitHub Pages
(no hay cabeceras); cuando el codigo sirva desde Hostinger, ahi van en el
.htaccess (tarea de Fable 5.1, es seguridad).

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

## Bloque 1 — clip del hero (Fable 5.1 hizo el clip; falta insertarlo, SOLO desde la PC de JFC)
- Clip publicado: `website/friendly123/clips/clip1-split-fable.html` →
  https://jfcarpio.com/friendly123/clips/clip1-split-fable.html
  (1:1, 9 s, sin dependencias, reduced-motion con fotograma final).
  El `clip1-split.html` local de JFC sigue intacto; el nuevo va al lado.
- Insertar en el hero de `website/friendly123/index.html` (tiene cambios
  locales sin commit en la PC: primero commit de eso, luego esto), como
  tarjeta superpuesta abajo del arte, NUNCA reemplazando el sombrero y las
  bolsas:
  `<figure class="hero-clip"><iframe src="clips/clip1-split-fable.html" loading="lazy" title="One sale, split fairly" style="aspect-ratio:1/1;width:100%;max-width:420px;border:0;border-radius:14px;display:block"></iframe><figcaption data-copy="clipSplit"></figcaption></figure>`
  La clave `clipSplit` ya existe en copy.es. Verificar 375 px y escritorio
  con captura; el iframe no debe tapar el H1 ni el CTA.
- Criterio estetico (no negociable): papel, tinta, UN acento, numeros
  tabulares, sin degradados brillantes ni sombras blandas ni emojis. Si se
  cambia algo del clip, mantener la historia (venta entra, se parte 60/40,
  la percha pasa a verde) y las notas del propio archivo.

## Higiene pendiente (chica)
- `.claude/check-inline.cjs` aun marca "Unexpected identifier 'de'" en el
  script inline #4 de `docs/index.html`: viene de antes de 2026-09-24. Es
  un texto en español dentro de un bloque que el chequeo lee como JS.
  Ubicarlo (numerar los <script> sin src) y arreglar SOLO el comentario o
  el chequeo, nunca el codigo que corre.

## Estado al cierre de Fable 5.1 (2026-09-24, shell v387 en vivo)
- Commissions: 6 carreras de dos aparatos + 11 casos Hugo/Paco/Luis en verde
  (`test/commissions-carreras-sync.test.js`, `test/commissions-hugo-paco-luis.test.js`).
  Cualquier cambio en ventas/liquidaciones/ajustes: correr esos dos PRIMERO.
- Lo que NO se probo aun (Fable 5.1 futuro, no Opus): carreras con TRES
  aparatos y estado rancio (uno vuelve de una semana offline con ventas
  viejas); devolucion de una venta con asistente cuando el asistente ya fue
  archivado; pagar un mes en A mientras B cambia la base bruto/margen.
- Panel: falta probar en vivo emitir un lote y registrar un pago con el
  Worker desplegado (JFC lo hace desde panel.html; si algo falla, el error
  sale en la linea de mensaje del panel: copiarlo aqui).
