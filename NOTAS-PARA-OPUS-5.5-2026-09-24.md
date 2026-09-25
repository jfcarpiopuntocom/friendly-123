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
- [~] `docs/save.html` (Opus 5.5, 2026-09-24): FAQ de 5 preguntas HECHA (solo hechos ya publicados, <details> sin JS, 375 px verificado, fijada en test/seo-legibilidad.test.js). DECIDIDO por JFC 2026-09-24 y HECHO: prueba social con nombres (Belen de idiomARTE y Jose de Olimpo Chess Club, con permiso); fuera los enlaces a la encuesta (hero y seccion bajo la oferta) y el WhatsApp duplicado de soporte. Embudo unico: calculadora -> demo -> prueba 30 dias -> comprar. Se conserva 'Send me this calculation on WhatsApp' (decision previa de JFC). Pendiente tecnico chico: JSON-LD FAQPage con las mismas 5 respuestas. Nota original:
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
- [x] `docs/manual.html`: ya tenia title y description propios (bilingue). Sin cambio. (Opus 5.5, 2026-09-24)

## Bloque 1 — Clip en el hero de la landing
- [ ] Solo desde la PC de JFC (repo website, cambios locales sin commit).
  Detalle en PLAN-BLOQUES-2026-09-24.md.

## Panel de licencias — pulido de UI (la logica ya esta y tiene tests)
- [x] Modal de pago a 375 px: cabe sin scroll horizontal (Chromium, 343 px). Se agregaron rotulos visibles a las dos fechas y el texto de ayuda pasa de gris a tinta. (Opus 5.5)
- [x] Tabla de lotes: boton "Ver sin usar" muestra en la caja de codigos los que ningun aparato activo (solo lectura; se pueden bajar en CSV). (Opus 5.5)
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
- [x] RESUELTO (Opus 5.5): el chequeo ahora quita comentarios HTML antes de buscar; la palabra <script> dentro del comentario del cargador abria un falso bloque. index.html sin tocar. Nota original:
  `.claude/check-inline.cjs` aun marcaba "Unexpected identifier 'de'" en el
  script inline #4 de `docs/index.html`: viene de antes de 2026-09-24. Es
  un texto en español dentro de un bloque que el chequeo lee como JS.
  Ubicarlo (numerar los <script> sin src) y arreglar SOLO el comentario o
  el chequeo, nunca el codigo que corre.

## Estado al cierre de Fable 5.1 (2026-09-24, shell v387 en vivo)
- Commissions: 6 carreras de dos aparatos + 11 casos Hugo/Paco/Luis en verde
  (`test/commissions-carreras-sync.test.js`, `test/commissions-hugo-paco-luis.test.js`).
  Cualquier cambio en ventas/liquidaciones/ajustes: correr esos dos PRIMERO.
- Probado tambien (8 carreras): asistente archivado y cambio de base durante el pago. Falta (Fable 5.1 futuro, no Opus): carreras con TRES
  aparatos y estado rancio (uno vuelve de una semana offline con ventas
  viejas); devolucion de una venta con asistente cuando el asistente ya fue
  archivado; pagar un mes en A mientras B cambia la base bruto/margen.
- Panel: falta probar en vivo emitir un lote y registrar un pago con el
  Worker desplegado (JFC lo hace desde panel.html; si algo falla, el error
  sale en la linea de mensaje del panel: copiarlo aqui).

## BENCHMARK DE RIVALES (Opus 5.5, 2026-09-24) — qué sumar y qué ya ganamos
Fuentes: puppetvendors.com (guías 2026 de consignación y Shopify), softwareadvice,
fitsmallbusiness, technologyadvice, getcircular, resaleos, circle-hand, G2/Capterra
(Loyverse). Rivales: Ricochet, ConsignCloud, SimpleConsign, Circle-Hand, Visceral
(consignación); Loyverse, Square, Shopify POS (tienda chica).

### Ya ganamos (decirlo en la landing, sin exagerar)
- Pago unico con licencia de 5 anos frente a suscripciones mensuales.
- Funciona sin internet de verdad; Loyverse es de los pocos que lo hacen y Square no del todo.
- Semaforo de colores en vez de tablas; la competencia es de planilla.
- Devolucion despues de pagar = ajuste negativo que nunca edita lo pagado; venta repartida
  entre dos personas al centavo; COUNTER SALE; carreras entre aparatos probadas (v387).

### Lo que tienen y nos falta, por impacto en ventas (dueño de la decision: JFC)
1. **Portal o estado de cuenta para el comisionista/artista** (Ricochet y ConsignCloud lo
   venden como diferencial): ver sus piezas sin vender, lo vendido y lo pendiente de pago.
   Version sin servidor para nosotros: un enlace de solo lectura, firmado y con fecha de
   vencimiento, generado desde Commissions, o el recibo de WhatsApp ampliado. ARQUITECTURA
   Y SEGURIDAD = Fable 5.1. UI del recibo = Opus.
2. **Aviso automatico al comisionista cuando se vende su pieza** (WhatsApp con mensaje listo,
   como ya hacemos con el recibo). Barato y muy valorado.
3. **Rebaja por antigüedad** (consignacion: -10 % a los 30 dias, -25 % a los 60, o devolver
   al artista). Hoy tenemos umbrales de color; falta la regla de precio por dias en percha.
   Toca dinero = Fable 5.1.
4. **Medio de pago al liquidar** (efectivo, transferencia, credito en tienda) guardado en el
   pago al comisionista. Hoy "marcar pagado" no dice como se pago. Aditivo, toca dinero = Fable.
5. **Programa de lealtad simple** (Loyverse lo trae gratis): puntos o "la 10.a compra con
   descuento" sobre clientes que ya existen. Opus puede hacer la UI; la regla de dinero, Fable.
6. **El comisionista carga sus piezas e imprime etiquetas** (Ricochet). Para nosotros: un
   rol "commissionist/artist" con solo alta de productos en su percha. Acceso = Fable.

### Orden sugerido
2 (aviso WhatsApp, 1 dia) → 4 (medio de pago, 1 dia) → 1 (estado de cuenta) → 3 (rebaja por
dias) → 5 → 6. Cada uno: plan en .md, respaldo, test rojo-verde, shell nuevo.

## AVANCE 2026-09-24 noche (Opus 5.5, shell v388) — lo que sigue
- [x] Carrera de TRES aparatos con estado rancio: verde sin cambios de codigo (9 carreras en test/commissions-carreras-sync.test.js).
- [x] Legibilidad movil: 11 -> 13 px (Hoy, Inventario, reportes). Contraste: boton del escaner, "abrir feria", precio de etiquetas, aviso de Avanzado.
      Auditoria Chromium 375 px: textos chicos 80 -> 1; bajo contraste en Etiquetas 47 -> 9.
- [x] Contraste de texto HECHO en shell v389 (tintas solo-texto --rojo-ink y --rust-ink; semaforo intacto). Auditoria 375 px: 0 textos oscuros-sobre-claro fallando. Nota original: Causa: rojo #E8365D, naranja #E86040 y verde #00C87A como TEXTO
      en estilos inline. Arreglo: tintas (--rojo-ink #B8123C, --rust-deep #C05000, verde #0B7A4B) solo donde son texto; nunca en fondos ni bordes del semaforo.
- [ ] JFC: probar 1 lote y 1 pago en el panel; Belen abre la app online y el candado debe decir shell-v388.
- [ ] Benchmark: responder cada "pero ellos tienen X" con funcion propia; primero el aviso por WhatsApp al comisionista.
- Todo es Opus 5.5 desde ahora (CLAUDE.md, reglas duras 2026-09-24 tarde).

## AVANCE 2026-09-24 noche (Opus 5.5, shell v388) — lo que sigue
- [x] Carrera de TRES aparatos con estado rancio: verde sin cambios de codigo (9 carreras en test/commissions-carreras-sync.test.js).
- [x] Legibilidad movil: 11 -> 13 px (Hoy, Inventario, reportes). Contraste: boton del escaner, "abrir feria", precio de etiquetas, aviso de Avanzado.
      Auditoria Chromium 375 px: textos chicos 80 -> 1; bajo contraste en Etiquetas 47 -> 9.
- [x] Contraste de texto HECHO en shell v389 (tintas solo-texto --rojo-ink y --rust-ink; semaforo intacto). Auditoria 375 px: 0 textos oscuros-sobre-claro fallando. Nota original: Causa: rojo #E8365D, naranja #E86040 y verde #00C87A como TEXTO
      en estilos inline. Arreglo: tintas (--rojo-ink #B8123C, --rust-deep #C05000, verde #0B7A4B) solo donde son texto; nunca en fondos ni bordes del semaforo.
- [ ] JFC: probar 1 lote y 1 pago en el panel; Belen abre la app online y el candado debe decir shell-v388.
- [ ] Benchmark: responder cada "pero ellos tienen X" con funcion propia; primero el aviso por WhatsApp al comisionista.
- Desde ahora todo lo hace Opus 5.5, con las mismas guardas que estaban marcadas para Fable 5.1.

## AVANCE shell v389 (Opus 5.5, 2026-09-24 noche) — lo que sigue
- [x] Contraste de texto: rojo/naranja de marca como LETRA pasan a --rojo-ink #B8123C y --rust-ink #A84300 (solo color:, nunca fondos). Commissions, Gastos, Inventario, Etiquetas, Avanzado, aviso de respaldo.
- [ ] Decision JFC: botones con texto blanco sobre naranja de marca ("Scan a label", "First Steps", "Save", "View accounting layer"). Pasan el umbral de texto grande (3.2:1 >= 3:1) pero no el de texto normal (4.5:1). Si JFC los quiere 4.5:1: fondo --rust-deep #C05000 en esos botones.
- [ ] Siguiente feature: aviso por WhatsApp al comisionista cuando se vende su pieza (benchmark #2). Plan en .md, test de dos aparatos: solo lo dispara el aparato que hizo la venta.
- [ ] JFC: probar 1 lote y 1 pago en el panel; Belen: candado debe decir shell-v389.

## AVANCE shell v390 (Opus 5.5) — benchmark #2 HECHO
- [x] Aviso por WhatsApp al comisionista tras la venta (tarjeta en linea, enlace wa.me, nunca envia solo, solo el aparato que vendio). Probado en Chromium real; test/aviso-comisionista.test.js fija las reglas.
- [ ] Siguiente del benchmark: #4 medio de pago al liquidar (efectivo / transferencia / credito en tienda) guardado en el pago al comisionista. Toca dinero: aditivo, test de dos aparatos rojo-verde.
- [ ] Idea chica derivada: mismo aviso desde la venta rapida del grid (hoy solo desde el panel de venta completo).
- [ ] JFC: probar 1 lote y 1 pago en el panel; candado de Belen debe decir shell-v390.

## AVANCE shell v391 (Opus 5.5) — benchmark #4 HECHO
- [x] Medio de pago al liquidar: dialogo de 5 botones, sellado solo en lo que ese pago liquida, viaja por sync, recibo con "Paid by". Chromium real + test rojo-verde (0/3 en v390, 3/3 con el cambio). Carreras de dinero siguen verdes.
- [ ] Siguiente del benchmark: #1 estado de cuenta del comisionista (enlace de solo lectura, firmado y con vencimiento; SOLO sus ventas). Requiere plan .md y revision de seguridad antes de codigo.
- [ ] Pequeño: mostrar el medio de pago en la tarjeta de Commissions de meses pagados y en dashboard.html.
- [ ] JFC: candado de Belen debe decir shell-v391; probar 1 lote y 1 pago en el panel.

## AVANCE shell v392 (Opus 5.5) — errores propios pescados + medio visible + plan del estado de cuenta
- [x] Error MIO v391: recibo de WhatsApp con "Paid by" en ingles dentro de un recibo en espanol -> "Pagado con".
- [x] Error MIO v390 verificado: el flujo real pasa ubicacionId (la ficha lo trae); estaba bien.
- [x] Bug HEREDADO v379: ajustes de devolucion podian volver a pendiente con una copia rancia (descuento doble). Monotono ahora; rojo-verde.
- [x] Medio de pago visible en Commissions ("paid · cash") y en la tabla de dashboard.html.
- [x] PLAN-ESTADO-DE-CUENTA-COMISIONISTA-2026-09-24.md con revision de seguridad (enlace cifrado en el fragmento #, sin servidor, vence).
- [ ] DECISION JFC: vencimiento del enlace, 7 dias (propuesto) o 30.
- [ ] Paso 1 del plan: estado.html + estado-cifrado.js con tests (ida y vuelta, vencimiento, datos alterados, XSS).

## AVANCE estado de cuenta — paso 1 HECHO (Opus 5.5, 2026-09-24)
- [x] docs/estado-cifrado.js + docs/estado.html: AES-GCM con clave de 128 bits, todo en el fragmento #, vence (7 dias por defecto, constante VENCE_DIAS_DEFECTO), lista blanca, max 60 lineas, noindex + no-referrer, pinta solo con textContent. test/estado-cuenta.test.js 6/6. Chromium 375 px: se ve bien, XSS queda como texto, vencido no muestra datos, enlace ~600 caracteres.
- [ ] Paso 2: boton "Send statement" en la tarjeta de Commissions (dueno/admin) que arma el JSON minimo del mes y abre WhatsApp al telefono del comisionista. Test: el JSON nunca trae claves prohibidas. Shell nuevo (toca index.html).
- [ ] Paso 3: ayuda y manual (que ve la artista, cuanto dura, por que no se revoca).
- [ ] DECISION JFC: 7 o 30 dias de vencimiento.

## AVANCE shell v393 (Opus 5.5, 2026-09-25) — estado de cuenta CULMINADO (benchmark #1)
- [x] Paso 2: boton "Send statement" (dueno/admin). Sin disyuntiva cruel: el dueno elige 7 o 30 dias EN CADA ENVIO. Sin telefono, WhatsApp abre para elegir contacto; si el navegador bloquea la ventana, copia el enlace y lo dice.
- [x] Paso 3: manual.html, seccion "Telling the commissionist" (aviso, medio de pago, estado; por que no se revoca).
- [x] Contraste pescado: "Mark as paid" era blanco sobre verde claro (3.3:1) -> verde oscuro.
- Prueba en Chromium de punta a punta: $150 vendido, $60 comision, $20 pagado por transferencia, $40 por pagar, vence en 30 dias; enlace ~500 caracteres.
- [ ] Siguiente del benchmark: #3 rebaja por antiguedad (apagada por defecto, por percha, aviso previo; cada venta congela su precio). Plan + test Hugo/Paco/Luis antes de codigo.
- [ ] Siguiente: #5 lealtad simple derivada de las ventas (no contador aparte, asi el sync la cuadra).
- [ ] Botones blanco sobre naranja de marca (3.2:1, texto grande): se dejan; si JFC quiere 4.5:1, --rust-deep.

## AVANCE shell v394 (Opus 5.5, 2026-09-25) — benchmark #3 y #5 CULMINADOS
- [x] Rebaja por antiguedad: por percha, apagada por defecto, lista intacta, cada venta congela su precio, comision sobre lo cobrado, override/cortesia mandan, aviso previo en Today, editor en la percha. Chromium real verificado.
- [x] FIX de sync hallado de paso: creadoEn del producto no viajaba; ahora viaja y converge a la mas antigua (si no, cada aparato cobraba otra rebaja).
- [x] Lealtad: regla global (viaja), compras derivadas de las ventas, sugerencia con boton en el panel de venta (nunca automatica), caja en Advanced. Chromium: sugiere -10 % sobre el precio ya rebajado; venta a $40.50 con cliente.
- [x] test/rebaja-lealtad.test.js 8 casos Hugo/Paco/Luis (rojo 1/8 en v393: la 1 es de fijacion; verde 8/8). Carreras de dinero siguen verdes.
- [x] Manual: secciones de rebaja y lealtad.
- Benchmark restante: #6 rol "commissionist/artist" que carga sus piezas en SU percha (toca acceso: plan + test de permisos por rol antes de codigo).
- [x] Prueba intermitente hallada y arreglada (no era azar): worker-master-recovery alteraba el ULTIMO caracter base64 del token; si era A-D solo tocaba relleno y el token seguia valido. Medido 26/400 (6.5 %). Ahora altera el medio de la firma (0/400). Worker sin cambios.
- LECCION (error mio): nunca copiar un *.test.js a backups/ con ese nombre: node --test lo ejecuta. Usar sufijo .bak.

## AVANCE shell v395 (Opus 5.5, 2026-09-24) — benchmark #6 CULMINADO: el artista carga sus piezas en SU percha
- [x] Decisiones JFC (AskUserQuestion): solo AGREGAR piezas (no edita ni borra despues); ve solo sus piezas y stock; imprime solo sus etiquetas; el tope de personas ya no existe como concepto (30 dias de uso completo; sin licencia se pierden funciones, nunca datos).
- [x] Plan: PLAN-ARTISTA-CARGA-SU-PERCHA-2026-09-24.md. Pruebas ANTES del codigo: test/artista-permisos.test.js (rojo 1/12 en v394, la 1 es de fijacion; verde 13/13).
- [x] Diseno: el PIN de artista NO va en `usuarios` (auth-ui haria entrar como EMPLEADO a cualquier rol no-admin en un aparato viejo). Va en promotoras[].accesoArtista; un aparato viejo no lo conoce y falla cerrado.
- [x] Compuerta deny-by-default en mock-backend para rol "artista": solo GET productos/ubicaciones (propios, sin costo), POST productos (forzado a su percha y a el), etiqueta propia. Todo lo demas 403, incluidas rutas futuras.
- [x] PINs sin choque en las dos direcciones (equipo, integrados, reservados, otro artista); si chocan por sync, el PIN de artista no abre.
- [x] FIX heredado: la foto elegida al CREAR un producto se perdia (POST no la guardaba). Rojo-verde.
- [x] BUG MIO pescado en Chromium: tras recargar, la vista del artista no se montaba (evento oc-login perdido). Ahora sigue la clase body.rol-artista.
- Limite conocido (no nuevo): el DOM que pinto la sesion anterior queda detras de la vista del artista, igual que hoy detras del candado. Las rutas le dan 403.
- Fuera de este trabajo: quitar LIMITE_EMPLEADOS del codigo (JFC dijo que el tope ya no existe); prueba de tiempo de panel-licencias es inestable con la suite en paralelo.
- [ ] JFC: probar en su tienda: editor del comisionista -> Artist access -> PIN; entrar con ese PIN.

## AVANCE shell v396 (Opus 5.5, 2026-09-24) — corrida Hugo/Paco/Luis: CUADRE en Sold y Commissions
- [x] Arnes nuevo test/helpers/cuadre.cjs: cruza Sold (ventas/todas), Today, P&L, Commissions, valorizado y stock esperado. test/cuadre-hugo-paco-luis.test.js: rojo 6/9 en v395 (3 de fijacion), verde 9/9.
- [x] B1 venta rechazada (cliente borrado/despedido) bajaba stock. B2 edicion rechazada dejaba stock/cantidad cambiados. B3 editar venta vieja aplicaba el % ACTUAL (rompia la regla dura). B4 se podia anular lo ya pagado. B5 pagar sellaba COUNTER SALES. B6 devolucion de venta pagada seguia como ingreso en Today/P&L/balance/semana.
- [x] Sold: toda venta sin cliente decia "Counter sale" (aunque pagara comision). Ahora "No customer", chip COUNTER SALE · house, y comision por fila.
- [x] Dos pruebas de sync vendian en percha PROPIA y esperaban "pagado": se apuntaron a percha con comision; aserciones intactas.
- [x] Terminologia (JFC): commissionist = vende/embajador; consignor = artista duena de piezas. Manual v395 corregido.
- [ ] DECISION JFC: linea de COUNTER SALES (casa) en la tarjeta de Commissions (Square lo hace como "Unattributed").
- [ ] DECISION JFC: balance cuenta inventario a PRECIO DE VENTA e incluye piezas en consignacion (no son de la tienda).
- [ ] DECISION JFC: aporte fijo y minimo garantizado se aplican POR VENTA; confirmar si el trato es por venta o por mes.

## AVANCE shell v397 (Opus 5.5, 2026-09-24) — CIERRE: "nada fuera de vista" (JFC eligio mejores practicas)
- [x] Commissions abre con "Everything sold this month": con comision + COUNTER SALES (casa) en perchas compartidas + perchas propias = Sold, al centavo. Devoluciones y neto, aporte fijo descontado. Fuente unica /api/comisiones/cuadre.
- [x] "Still to pay" de arriba ahora incluye devoluciones pendientes (antes difería de las tarjetas).
- [x] Tarjeta de percha: COUNTER SALES (casa) y total real (= Sold); percha con solo ventas de la casa ya no va a "sin ventas".
- [x] Balance a mejor practica: activo = inventario PROPIO a COSTO; a precio de venta y consignacion (de las consignadoras) quedan como referencia. La capa contable ya no mezcla precio de venta con costo.
- [x] Aporte fijo / minimo: NO se recalculo nada (dinero sellado). La pantalla decia "per event" y restaba una vez; el motor lo aplica por venta. Etiquetas "por venta" y la tarjeta muestra lo descontado de verdad.
- [x] Pruebas C1-C4: rojo 0/4 en v396, verde 4/4. commissions-belen: regex actualizada a la nueva expresion, misma guarda (sin ventas = plegada).
- [ ] Opcion futura si alguien la pide: aporte fijo POR MES (renta de espacio). Requiere plan de dinero; no construido.

## APUNTES PARA MANANA (2026-09-25, cierre de ventana 5h)
### URGENTE 1 — jfcarpio.com expone archivos internos
- Publicos hoy (HTTP 200): /CLAUDE.md, /AGENTS.md, /CLAUDE_CONSTITUTION.md, /wrangler.toml, /worker.js.
- Causa: repo "website" -> wrangler.toml con [assets] directory="./" y SIN .assetsignore: cada deploy sube el repo entero.
- Arreglo: .assetsignore (CLAUDE*.md, AGENTS.md, *.toml, worker.js, backups/, codex-backups/, *.txt, *.mjs, node_modules/)
  y deploy desde un checkout LIMPIO de HEAD (git worktree), nunca desde la carpeta con WIP.
  Wrangler con sesion: C:\00 Projects\Codex-Friendly-20260917\commissions-product-first-v370\node_modules\wrangler\bin\wrangler.js
### URGENTE 2 — las 5 URLs SEO nuevas dan 500 (error 1101) en jfcarpio.com
- Existen en git y en www.jfcarpio.com (200). El apex sirve la COPIA del ultimo wrangler deploy; ruta nueva -> Worker
  pide a www -> www redirige a apex -> ciclo -> 1101. Se arregla con el deploy limpio de arriba.
- El sitemap vivo aun es el viejo (no anuncia las URLs rotas): no hay dano en Google todavia.
- Generador: website/friendly123/generar-urls-seo.mjs (dominio en ORIGEN/RUTA para la mudanza a friendly123.com).
- friendly123/index.html tiene un cambio SIN commitear que NO es mio (texto ES "clipSplit"): no tocar ni desplegar a ciegas.
### PEDIDOS DE JFC SIN EMPEZAR (hacer en este orden)
1. Jev bien usado: auditar skill jev-jfc (llamada real, costo, confianza) y dejar prueba de uso en una decision real.
2. Reconversion de jfcarpio.com ("6 anos sin UN cliente"): pre-mortem de cero conversion + research + Jev;
   agregar testimonio: "Obtuve el research macroeconomico nacional que estaba buscando" — Dieño Peñaherra, CEO, Quito 2022
   (verificar grafia del nombre con JFC antes de publicar).
3. Pelicula WebGL2 10 s cuadrada, un solo HTML sin librerias ni archivos: mosaico de vidrio y pan de oro con el LOGO
   friendly-123 y escenas friendly (percha, semaforo, cuaderno compartido, consignacion). Clickeable -> embudo
   (save.html o lo que el pre-mortem diga). Para la landing friendly-123 Y como doodle en jfcarpio.com. Sin QR.
   Info base de los afiches: $399 / 5 anos, sin mensualidad, demo PIN 456, EN/ES, offline, consignacion por WhatsApp.
### YA HECHO HOY
- friendly v397 (cuadre Commissions, balance a costo), AMIGABLE v119 (hotfix anular pagada + plan de igualacion),
  consultorio v67 (B1, foto, balance). Todo verificado en vivo.

## AVANCE 2026-09-25 (sitio jfcarpio.com)
- [x] Archivos privados (CLAUDE.md, AGENTS.md, wrangler.toml, worker.js) ya dan 404: .assetsignore.
- [x] Worker v4: sirve el sitio desde Cloudflare (static assets), ya no pide a www. Las 5 URLs SEO de friendly123 dan 200.
- [x] 404 propia que recomienda blog, Substack y friendly-123 (noindex).
- [x] DEPLOY SIEMPRE ASI: git worktree add --detach /tmp/wsclean origin/main ; cd alli ; node <wrangler.js> deploy.
      (Error mio 2026-09-25: un deploy salio de la carpeta con WIP; se corrigio en minutos con deploy limpio.)
- [ ] JFC en Cloudflare: www en nube naranja, SSL Full strict, Bot Fight Mode, WAF + rate limit, DNSSEC.
- [ ] Backlinks entre sitios propios: descartado (poco valor, riesgo de esquema). Buscar enlaces AJENOS: gremios, prensa, directorios de software.
- [ ] Siguen pendientes: Jev bien usado, reconversion jfcarpio.com (testimonio Peñaherra: confirmar "Dieño" o "Diego"), pelicula WebGL2.

## JEV EN USO REAL + EMBUDO jfcarpio.com (2026-09-25)
Jev funciona (skill jev-jfc, 4 llamadas, ~USD 0.00014 en total). Regla aplicada: con confianza baja (0.48)
NO se decidio; se hizo research y se repregunto.
- Causa de 6 anos sin clientes: demasiadas ofertas a la vez (0.99). Arreglo: inicio con UNA oferta pagada (0.99).
- Oferta que encabeza: research macro/sectorial a medida de Ecuador para planificar 2026-2027 (1.0, con research).
- Entrada gratis: brief macro de 1 pagina del sector a cambio del correo (0.90).
- friendly-123 en jfcarpio.com: enlace secundario / doodle hacia su landing (0.64, moderado).
- Criterios Hormozi/Brunson/Kennedy: oferta chica = informe sectorial 2026-2027 (0.95); garantia = si no responde
  la pregunta acordada, reembolso total (0.97); escasez honesta = N estudios por trimestre (0.88);
  gancho = "Planifica 2026-2027 con los numeros de Ecuador que tu directorio te va a pedir" (0.97).
- DECISIONES DE JFC PENDIENTES: precios (informe sectorial ~USD 97 fue propuesta mia, no dato), cuantos estudios
  por trimestre, precio del estudio a medida, y confirmar nombre del testimonio ("Dieño" o "Diego" Peñaherra).
- Research usado: mercado LatAm de capacitacion corporativa USD 24.8B (2025); Ecuador crece ~2% en 2026,
  subio a B- (feb 2026), inversion en mineria/construccion/energia; buenas practicas de landing de consultor
  (quien y que problema en 5 s, testimonio con nombre/cargo/resultado bajo el titular, formulario de 3 campos).
- Siguiente sesion: construir el nuevo inicio de jfcarpio.com con esto (deploy limpio con worktree) y la
  pelicula WebGL2 (clic -> landing friendly-123 en friendly; en jfcarpio.com, doodle hacia friendly-123).

## INICIO jfcarpio.com (2026-09-25) — traspasado al fork
- WIP en rama home-embudo del repo website (dea2f74): bloque de oferta unica arriba, trayectoria plegable
  (foto siempre visible), boton del brief -> openWAMessage(). NO esta en main ni desplegado.
- El fork "Carga de piezas en percha propia (fork)" toma el nuevo balance por orden de JFC: producto central = las
  3 apps; talleres y reports = prioridad 1B; ni demasiado vendedor ni cero conversion.
  Testimonio: Diego Peñaherrera.
- Error mio atrapado antes de publicar: un apostrofo en el texto EN rompia TODO el script de la pagina. Revisar cada
  <script> con new Function antes de publicar. El script 1 ya traia un error de sintaxis en la version publicada (no es mio).

## AVANCE 2026-09-25 tarde — INICIO jfcarpio.com v2 PUBLICADO
- Decision JFC: producto central = las 3 apps; talleres y reports = 1B; tono ni salesy ni cero conversion.
  Testimonio: Diego Peñaherrera, CEO, Quito 2022 (grafia confirmada por JFC).
- Jev con research (4 llamadas mas, ~USD 0.00004 c/u): primera pantalla = proposito + 3 tarjetas (1.0);
  cada tarjeta a su landing (0.98); linea de confianza "economista, 20 anos" (0.89). Plegar lo intelectual (0.39: se
  dejo plegado en la misma pagina por pedido de JFC de no perder nada visible).
- Publicado (PR #10, deploy limpio): arriba "Herramientas simples para negocios reales, hechas por un economista" +
  friendly-123 / amigable-123 / consultorio-123; debajo bloque 1B (research + talleres, testimonio, brief gratis por
  WhatsApp, garantia). Portada, paneles y trayectoria intactos, plegados donde ya estaban.
- Coordinacion: la sesion original (30fb5c) hizo el WIP v1 (commit dea2f74) y me cedio el archivo. Nunca 2 sesiones en el mismo index.html.
- CSP bloqueaba Cloudflare Web Analytics (cero datos de visitas). Arreglado (PR #11). Ya se puede medir conversion.
- amigable-123 y consultorio-123 no tienen landing propia: sus tarjetas van a la app. PENDIENTE: landings propias.
- Pendiente JFC: pasos de Cloudflare (www nube naranja, SSL Full strict, Bot Fight, WAF+rate limit, DNSSEC).
- Pendiente: pelicula WebGL2 (mosaico vidrio + pan de oro, logo friendly-123) como doodle clickeable.

## AVANCE 2026-09-25 (noche) — jfcarpio.com
- [x] Mosaico WebGL2 (website/friendly123/mosaico.html, URL /friendly123/mosaico): 10 s, vidrio + pan de oro, logo ->
      semaforo -> logo, clickable a /friendly123/. ?t=segundos congela un cuadro. Incrustado en el inicio de jfcarpio.com.
- [x] SEO inicio: titulo/description/og = las 3 apps; JSON-LD ItemList de SoftwareApplication. App friendly v398: og:image absoluta.
- [x] Peso de color (60-30-10 + Jev 0.98): oro solo en botones principales; tarjetas de apps en azul acero.
- [x] Tres bandas (Jev 0.9): options-strip y stakes-section pasaron a claro (#F5F4F2) con tinta oscura.
- OJO tres index.html distintos: website/index.html (jfcarpio.com), website/friendly123/index.html (landing, WIP ajeno),
  friendly-123/docs/index.html (app / PIN).
- [ ] JFC en Cloudflare: www, blog y dashboard a Proxied; Workers route www.jfcarpio.com/* -> website; SSL Full (strict)
      + Always Use HTTPS; Bot Fight Mode; DNSSEC (copiar DS en Hostinger). No tocar MX/TXT.

## AVANCE 2026-09-25 (cierre) — SEO y seguridad
- [x] Cloudflare completo (lo hizo JFC con guia): www/blog/dashboard Proxied, SSL Full strict + Always HTTPS,
      Bot Fight Mode, DNSSEC validado (DS en Hostinger), regla vieja "Blog" borrada.
- [x] blog.jfcarpio.com -> jfcarpio.com/blog/ (Worker, rutas explicitas en wrangler.toml).
- [x] IndexNow: llave c2d8b4e084c5a6e9498a037240f5da45.txt publicada; avisos aceptados (Bing, Yandex, etc.).
- [x] Landing friendly-123: botones "leer" con URL real de cada articulo; hreflang propio por pagina.
- [x] Inicio: un solo H1 (portada vieja pasa a H2, mismo aspecto); descripcion 137 car. Landing ES: titulo/desc cortos.
- [x] Google Search Console: JFC agrego la propiedad de dominio jfcarpio.com (TXT autorizado por Google).
- [x] Search Console: sitemap https://jfcarpio.com/sitemap.xml enviado OK (16 URLs, todas 200); indexacion solicitada para /friendly123/ y /friendly123/es/ (2026-09-25).
- WIP AJENO en website/friendly123/index.html ("clipSplit" ES, clips/clip1-split.html sin rastrear): no es de ninguna
  sesion; se aparta con stash para editar y se devuelve intacto. Decision pendiente de JFC: incluir o descartar.

## AVANCE 2026-09-25 (noche 2) — v399/v400 + ANTI-COPIA fase B HECHA
- v399/v400 (live): el comisionista elegido en una venta cobra en cualquier percha (bug "Spray de la verdad");
  la venta ya no reescribe la percha antes de vender; terminos US (Walk-in customer, House sale en cursiva,
  Sales associate, consignor); Commissions/Sold se repintan al llegar una venta de otro aparato (250 ms).
  Pruebas: test/comision-percha-propia.test.js (6) y test/commissions-ui-hpl.test.js (Paco/Hugo/Luis POR LA UI).
- ANTI-COPIA fase B HECHA: origen https://f123-code.jfcarpio.workers.dev/ (Worker static assets; Pages ya no sirve).
  Trampa encontrada: la 1a subida iba en CRLF (autocrlf de Windows) y no cuadraba con github.io. Arreglo y regla:
  desplegar SOLO con `bash scripts/deploy-f123-code.sh` (export LF + compara byte a byte + CORS, falla si no cuadra).
  Probado en la app viva: 4 scripts remotos, 0 fell back, same shell v400; origen muerto -> cae a github.io entero.
- Con el origen automatico no hay paso manual por shell; si Advanced dice "shell differs", mirar el check
  "Workers Builds: friendly-123" del ultimo commit de master.
- ORIGEN ELEGIDO: https://friendly-123.jfcarpio.workers.dev/ (Worker conectado al repo, se despliega solo en cada
  merge a master, en LF; probado igual que f123-code: identico, 4 remotos, 0 fell back). f123-code queda de respaldo.
- LE TOCA A JFC (fase C, 1 aparato suyo): Advanced > pegar https://friendly-123.jfcarpio.workers.dev/ >
  "Try this origin on this device" > recargar. Debe decir "same shell" y ninguna "fell back". Dias de uso real.
- Siguiente de Claude (fase D, tras dias de C en verde): sumar el host a HOSTS_PERMITIDOS del SW y ampliar la lista.
- Evaluadas TypeLLM y CLM: no se adoptan (piden GPU local; Jev ya cubre). Opcion futura.
- Pendientes en cola: lapicito + boton directo de blacklist en clientes; los 2 clips en el hero de la landing;
  terminos US en manual.html (9) y dashboard.html (2); mosaico "mal hecho" (despues); modelo de autoridad para
  jfcarpio.com ("Trust replaced attention") -> buscar mas modelos con Jev.
