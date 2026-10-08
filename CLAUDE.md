# CLAUDE.md — léeme entero antes de planificar o tocar código

> **ARRANQUE DE CADA SESION (JFC 2026-10-01):** 1) leer la bitacora de Notion "Bitacora Claude +
> Codex — apps Made In Cuenca" (solo las ultimas entradas); 2) usar **Laya primero** para los juicios
> chicos (`.claude/skills/jev-jfc/scripts/laya-evaluate.py`), luego Jev, luego Claude. Asi no se
> re-explica el contexto y se gastan menos tokens desde el primer mensaje. Laya la instala el hook.

> **Laptop (JFC 2026-09-30):** el trabajo diario se hace desde la nube; la laptop es respaldo y
> copia local (ahi estan Obsidian y el pulso). No planificar nada que dependa de que JFC abra la PC.

> **INCIDENTE Y REGLA DURA 2026-09-29 — jfcarpio.com PISADO POR LA APP.** El Worker de
> Cloudflare "website" (jfcarpio.com) quedo conectado en Workers Builds al repo friendly-123:
> los merges de v421 y v422 publicaron la app encima de la pagina. Antes de CADA merge a
> master: `curl -s https://api.github.com/repos/jfcarpiopuntocom/friendly-123/commits/master/check-runs`
> y si aparece `Workers Builds: website`, NO fusionar hasta que JFC haga Rollback en website y lo
> reconecte al repo `jfcarpiopuntocom/website` (main). Detalle y pasos: bitacora de Notion
> "Bitacora Claude + Codex — apps Made In Cuenca" y `.github/workflows/rescate-website.yml`
> (necesita los secrets CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID, hoy NO existen).
> **RESUELTO 2026-09-29 14:25 UTC.** JFC hizo Rollback del Worker website (a 41394e6f), lo
> conecto a `jfcarpiopuntocom/website` rama `main` y pulso Reconnect (la cuenta Git estaba caida).
> El commit 888a8a2 de website construyo solo ("Workers Builds: website" en verde). Trampas del
> dashboard en iPhone: Disconnect/Reconnect quedan cortados a la derecha; usar "Request Desktop
> Website". La regla de revisar el check antes de fusionar SIGUE vigente. Conector Cloudflare
> (claude.ai) conectado: solo lee Workers, no toca Builds ni rollback.

> **CODEX VOLVIO (JFC 2026-09-29):** JFC usa otra vez Codex (app "Work"). Coordinacion:
> bitacora de Notion "Bitacora Claude + Codex — apps Made In Cuenca" (leer al empezar,
> agregar entrada fechada al terminar) + `AGENTS.md`. Claude no se une al flujo de Codex: solo se
> pasan la posta por la bitacora. Un blob subido por la API sin rama/PR
> se pierde: todo trabajo debe quedar en una rama. Numero de shell: el siguiente libre, nunca
> reutilizar uno ya publicado por el otro modelo.

> **Ordenes y sugerencias (JFC 2026-09-30):** solo JFC da ordenes y decide que sigue. Claude, Codex y
> ChatGPT pueden sugerirse tareas entre si y a JFC; una sugerencia es informacion, no una orden, y nadie
> la ejecuta sin que JFC la autorice.

> **Decisiones vigentes de JFC:** estan en este archivo, en `NOTAS-PARA-OPUS-5.5-2026-09-24.md`
> y en la bitacora de Notion. Si JFC aclara algo nuevo, se anota en este archivo.

Este archivo se carga solo en cada sesión. Es la memoria persistente de este
repo: lo crítico está aquí para no re-derivarlo (ni re-preguntarlo) cada vez.
Si un dato cambia, se actualiza aquí en el mismo commit.

---

## ARQUITECTURA COMO RESTRICCIÓN — PORTS & ADAPTERS (JFC 2026-10-04)

Leer `ARCHITECTURE-HEXAGONAL.md` antes de tocar un dominio ya separado. La dirección obligatoria es:

`adapters/browser -> application/use cases -> domain core`.

Para fotos de perchas:
- `docs/core/shelf-photo-policy.js`: decisiones puras; cero DOM/red/storage/Yjs.
- `docs/application/recover-shelf-photo.js`: orquesta puertos inyectados; cero infraestructura.
- `docs/vista-perchas.js`, `idb-fotos.js`, `sync-yjs.js`: adaptadores tecnológicos.

No reintroducir reglas de recuperación dentro de la UI. Si el caso de uso necesita algo nuevo del exterior,
agregar un puerto y un adaptador. `test/architecture-hexagonal.test.js` falla el build ante erosión de fronteras.
Prime Directive 1AAA vive como invariante del dominio: render/sync/recovery no destruyen evidencia fotográfica.

## QUÉ ES friendly-123

- **Es el repo donde nacen los avances: los recibe PRIMERO** (en `/next/`, luego a clientes; ver
  actualizacion 2026-09-18 y CANARIOS). Suele ir ADELANTE de
  amigable en varios sistemas. **Nunca asumir que friendly va atrás.**
- Idioma **inglés**, con `i18n.js` (EN + ES). amigable y consultorio NO tienen
  i18n (español hardcodeado) — no portar strings a ciegas entre apps.
- Unidad básica: la percha. Licencia `F123-`. PIN de 3 dígitos.
- App hermana de **amigable-123** (producción, español) y **consultorio-123**
  (4 dígitos por diseño, foco contable, sin perchas).

## PRIME DIRECTIVE — NO NUBE, NO FILTRAR DATOS DE CLIENTES

Los datos del negocio viven en el dispositivo. Sale del aparato el heartbeat de licencia
(instanceId, licenseCode y datos que el dueño ingresó) y, solo si el dueño activa el sync, el
relay Yjs, que cifra los datos de extremo a extremo (ver 2026-09-18). **Jamás** productos,
ventas, clientes o inventario en claro. No meter servicios de nube de terceros (memoria,
analítica, etc.) que manden datos afuera. (Redacción confirmada por JFC 2026-09-30.)

**Canarios con Sentry y PostHog (decisión de JFC 2026-10-01):** errores, flujos y checksums NO son datos
del negocio; mandarlos a Sentry/PostHog no viola esta regla. Corren en /next/ y en la app de clientes.
Todo pasa por `docs/canarios.js` con lista blanca, limpieza de texto, id anónimo y tope por sesión.
AVISAN, NO FRENAN: nada de canarios.js decide la promoción a clientes. Jamás mandar ahí datos del negocio.

---

## POLÍTICA DE RELEASE — nombre público = shell (JFC 2026-10-06)

- **La familia v448 GOLDEN queda CERRADA** por orden de JFC (aprobado en dos sesiones). Desde v452,
  `version.json.releaseName` es igual al número del shell: `f123-shell-v452` -> `"v452"`.
- Cada cambio a `docs/` sube el shell al siguiente entero nunca usado (lo exige
  `scripts/release-control.cjs`), `releaseName` al mismo número, y `cacheGeneration`/`CACHE_GENERACION` al siguiente `goldenN`.
- Lo visible para clientes sigue "1.0" hasta nueva orden de JFC.
- Historia: v448 GOLDEN fue la familia congelada del 2026-10-04 al 2026-10-06 (hotfixes golden1..golden16, shells v448..v451).

## CHECKLIST DE RELEASE — obligatorio en CADA cambio a un archivo del SHELL

Un archivo del SHELL es cualquiera listado en `const SHELL=[...]` de `docs/sw.js`
(index.html, auth-ui.js, mock-backend.js, etc.). Si tocas uno:

1. Sube `const CACHE`, `version.json.shell` y `releaseName` al siguiente entero nunca usado (ej. v452 -> v453).
2. Sube `cacheGeneration` y `CACHE_GENERACION` al siguiente `goldenN`.
3. `node scripts/gen-manifest.js` (regenera los SHA-256 del shell).
4. `bash check-sw.sh` — tiene que salir TODO OK (hashes reales cuadran,
   sw.js↔version.json coinciden, G4 nav/sección). Si falla, no se pushea.
5. Corre `npm test` y los gates Golden relevantes; recién ahí PR/promoción.

Saltarse esto deja a aparatos instalados con una mezcla de generaciones. El número visible
no se usa como invalidación de cache: para eso existe `goldenN`.

> **⚠ TRAMPA ACTIVA EN WINDOWS (descubierta 2026-09-22, afecta a Claude y a
> Codex por igual).** En este checkout `core.autocrlf=true` y no hay
> `.gitattributes`: el disco queda en CRLF, pero GitHub Pages sirve el blob de
> git en LF. `gen-manifest.js` hashea los bytes del DISCO, así que el
> manifiesto guarda hashes CRLF que NO coinciden con producción. Y
> `check-sw.sh` compara contra ese mismo disco: **da 5/5 OK aunque el
> manifiesto esté mal para producción.** Un OK de check-sw en Windows NO
> prueba nada sobre lo que descargan los aparatos.
> Verificación real, contra lo que sirve Pages:
> `curl -s https://jfcarpiopuntocom.github.io/friendly-123/<archivo> | sha256sum`
> o sin red: `git show HEAD:docs/<archivo> | sha256sum`.
> Pendiente de decisión de JFC: normalizar CRLF→LF en gen-manifest y
> check-sw (o `.gitattributes` con `eol=lf`) y regenerar. El SRI del SW es
> fail-open, así que esto no deja a nadie afuera ni pierde datos.

## SISTEMA DE INTEGRIDAD DE VERSIÓN (ya montado, no romper)

- `version-manifest.json`: SHA-256 por archivo del shell.
- SW: verificación SRI **fail-open** — si un hash no cuadra NUNCA borra el
  archivo; lo re-pide y conserva el servido si falla. No dejar a nadie afuera.
- `check-sw.sh`: recomputa el hash real y falla si el manifest está viejo.
- Recarga de versión: huella `version|shell`; el `_recargarSeguroVersion`
  DIFIERE la recarga al próximo login (no interrumpe el tecleo del PIN).

---

## CÓMO INVESTIGAR SIN QUEMAR TOKENS

`docs/index.html` y `docs/mock-backend.js` son enormes. **Nunca leerlos enteros.**

```bash
git log --since="7 days ago" --pretty=format:"%h %ad %s" --date=short
git show --stat <sha>
grep -n "MARCADOR" docs/index.html          # ubicar, no volcar
```

En archivos minificados (sw.js de amigable, mock-backend de amigable): editar con
scripts que verifiquen que el ancla es ÚNICA antes de reemplazar, y `node --check`
después. Nunca `sed` a ciegas en minificado.

---

## HERRAMIENTAS DE LA NUBE (JFC 2026-09-30)

- Si falta una herramienta, se instala sin pedir permiso y se anota en `.claude/HERRAMIENTAS-NUBE.md`
  en el mismo commit. `.claude/hooks/session-start.sh` deja lista esa caja de herramientas al abrir
  cada sesion de la nube (LibreOffice, pdftoppm, pptxgenjs, Playwright con su navegador, etc.).

## GIT — YO CIERRO EL CICLO, NADA QUEDA A MEDIAS

- Antes de ramificar: `git fetch origin master` y `git checkout -B <rama>
  origin/master` (base fresca, evita conflictos por ref vieja).
- Pushes frecuentes; cada paso verde se pushea. Nada se queda solo en el disco
  del contenedor (es efímero).
- JFC no necesita saber qué es un PR/rama/merge y no se le pregunta por eso. El
  ciclo (respaldo → commit → push → PR → mergear cuando esté verde y comprobado)
  es responsabilidad mía. Se merge cuando está verde, no antes; pero no espera su
  permiso, espera la comprobación.
- Rama por defecto: **master**.

---

## NOMENCLATURA (aplicada en las tres apps)

- **fiado** = deuda del cliente (debt). **abono** = crédito a favor (credit).
  Se quitó el confuso "on credit". El abono puede ser **"sin determinar"** (no
  atado a un producto) o por ítem.
- **Cortesía**: hay costo pero no precio (ingreso 0). **SÍ cuenta** hacia las
  100 ventas gratis del mes (espíritu Robin Hood).
- Form de comisionista: el origen "libre" se muestra como **"Promoter"** (esta
  app es en inglés). En las apps en español el término preferido de JFC es
  **"promotor/a"** (cubre ambos géneros). Pulldown Y cajita en la misma línea;
  botón **"Save agent"**.
- Archivar un producto/evento **NO** lo saca del dashboard ni del histórico.

---

## ESTILO AL ESCRIBIR PARA JFC

- Español natural, 80% para el lego (claro, directo), 20% académico. **No usar
  "vive en"** (calco del inglés que JFC detesta).
- **Legibilidad premiada SIEMPRE**: nunca texto gris/opaco/sombreado ni muy
  pequeño en la UI. Tinta de verdad.
- Sin emojis en la UI. Comentarios en el código que expliquen POR QUÉ, con fecha
  y el bug real.
- No parar a mitad de una tarea aprobada para pedir permiso otra vez. No dejar
  commits sin pushear. No hacerle pedir la misma cosa tres veces.

## JFC actualizacion 2026-09-18 — prevalece sobre notas antiguas

Friendly tiene cliente real y datos de produccion: ya NO es un repo de testeo. La prioridad 1AAA es integridad de datos; la promesa de sincronizacion total en <=2 segundos entre aparatos online y activos solo puede anunciarse tras medicion fisica, persistencia y visualizacion. El relay Yjs cifra los datos de negocio de extremo a extremo: la frase antigua «jamás salen productos/ventas del aparato» ya no describe el sync opt-in actual. No publicar claves, PIN, licencias completas ni datos de clientes.

Mandato visual de JFC: todas las cajas y tarjetas de Friendly, amigable-123 y consultorio-123 tienen las cuatro esquinas completas. No reintroducir clip-path diagonal, esquina rota, doblez ni ojal. El header de Friendly en móvil debe ser compacto sin perder nombre, dispositivo, selector, idioma, usuario/rol, salir, ayuda ni estado. El diseño de PC no se rediseña por esta correccion. Nunca usar texto gris de bajo contraste.

Antes de tocar sync o identidad, inspeccionar origin/master, `docs/version.json` y `git log`. Un iPhone Safari en v318 mostró un nombre antiguo en PIN y ninguno en header: no cambiar nombres reales ni borrar namespaces para «arreglar» la pantalla; diagnosticar la licencia/sala y conservar el ultimo nombre conocido.

---

## CONSTITUCIÓN DE TRABAJO (JFC 2026-09-22) — destilada de sus últimos 20 prompts
Esto NO es estilo, es cómo se trabaja aquí. Si algo de abajo se incumple, el
trabajo está mal hecho aunque el código funcione.

### 1. No detenerse. La misión ya se dio.
- Un plan aprobado con N pasos son N autorizaciones. Se ejecutan del 1 al N
  seguido, en el mismo turno.
- **PROHIBIDO decir "voy con X" y cerrar el turno.** Si lo anuncio, lo hago ya.
  Anunciar y parar es peor que callar: él cree que arranqué y en realidad está
  esperándome.
- Nunca cerrar con "¿sigo?", "¿voy por ese?" ni con una lista de pendientes
  presentada como menú. Lo que quede fuera se dice como hecho consumado y con
  su razón ("no toqué X porque cambia la forma de la API").
- Se para SOLO si hay bloqueo real: falta un dato que solo él tiene, la acción es
  destructiva/irreversible y no estaba autorizada, o hay una disyuntiva crucial (varias salidas
  razonables que cambian el producto, el dinero o la seguridad). En ese caso se confirma UNA
  vez, con opciones y una recomendación, y se sigue con todo lo demás.
- Con una misión clara ya dada NO se pregunta "¿sigo?". Reformular el pedido en una línea al
  empezar sirve para que JFC corrija a tiempo, pero no se espera su respuesta para arrancar
  (JFC 2026-09-30: "confirmar cosas cruciales/disyuntivas, pero no preguntar sigo").

### 2. Respaldar de más, siempre.
- Antes de CADA lote de cambios: copia + `SHA256-LINES.txt` con bytes, líneas
  y SHA-256 de cada archivo tocado, en `backups/<fecha_hora>_<motivo>/`.
- Ante la duda, respaldar. Nunca ha sobrado un respaldo.
- Tras restaurar un archivo, **verificar por SHA-256** que quedó idéntico.

### 3. Verificar antes de afirmar. Evidencia, no aserciones.
- Skills obligatorias, se invocan sin que él las pida:
  `systematic-debugging` ante cualquier bug o test rojo, ANTES de proponer fix;
  `verification-before-completion` antes de decir "listo/arreglado/pasa".
- Un test verde no prueba nada si no se comprobó que falla sin el fix:
  **rojo-verde contra el respaldo real** siempre que se corrija un bug.
- Un test de fijación (comportamiento que ya era correcto) se rotula como tal.
  No se vende como prueba de un arreglo.
- Desplegar NO es verificar. Solo la URL viva cuenta, y se dice qué prueba y
  qué no prueba.
- Si no puedo comprobar algo, se dice: *"hice X, falta que verifiques Y en
  iOS"*. Falsa confianza encima de un bug es peor que el bug.

### 4. Aditivo. Jamás dañar lo que ya funciona.
- Campo nuevo antes que cambiar el formato; rama nueva antes que reescribir la
  vieja; flag reversible antes que cutover.
- Compatibilidad en las DOS direcciones: una app vieja debe poder leer lo nuevo
  y viceversa. Subir `schemaVersion` hace que una app vieja RECHACE el archivo:
  pensarlo dos veces.
- Antes de agregar un guard, revisar quién llama hoy: un guard que rompe al
  único llamador real es un bug, no una mejora.
- Reusar lo probado. No inventar un patrón nuevo si ya hay uno funcionando.

### 5. Git y entrega.
- Commit + push sin pedir permiso. Nada se queda en el disco.
- **Dar la URL viva sin que la pida**, siempre, en cada entrega.
- `check-sw.sh` 5/5 y suite completa en verde antes de publicar.

### 6. Honestidad operativa.
- Cachearme los propios errores y decirlos. Un diagnóstico silencioso que no
  funciona es peor que no tenerlo.
- No relajar un test para que pase mi código: se corrige el código o el
  comentario, nunca el guard que protege algo real.
- Nunca mentir un logro ni inflar lo verificado.

### 7. COUNTER SALE: NO es la casa, se comisiona (JFC 2026-09-30; reemplaza la regla del 2026-09-22)
- Al registrar una venta, **nunca** se exige elegir associate o comisionista.
- Elegir otra persona en la venta no borra ni altera el associate permanente de la percha.
- **COUNTER NO ES LA CASA** (JFC 2026-09-30, Belen/idiomARTE, shell v429). "Counter sale" = se vendio
  en el mostrador o en la puerta. Se comisiona IGUAL que cualquier venta: trato de la pieza (comisionista
  o % propios) y, si la pieza no trae nada, trato de la percha. Solo queda sin comision si no hay trato
  con nadie (percha propia sin comisionista). Motivo: el 2026-09-22 counter = "venta de la casa" chocaba
  con la comision puesta en la pieza (dos ordenes que se contradecian) y la comision se perdia en
  silencio. Practica mundial (consignacion): la parte de quien trae la pieza se paga siempre.
  Tecnica: la venta se guarda en modoComision "acuerdo" + campo nuevo `canalVenta: "mostrador"`;
  counter ignora al asistente; si el comisionista de la pieza ya no existe, usa el trato de la percha:
  una venta NUNCA se bloquea. Ventas viejas guardadas como "counter" (<= v428) siguen igual y se
  corrigen una a una con "Review split". La UI no debe ofrecer opciones que se bloqueen o contradigan
  entre si (JFC 2026-09-30).

## DINERO DE COMISIONES: DECISIONES DE JFC 2026-10-07 (shells v465-v466)
- Venta anulada despues de pagarse: lo pagado se DESCUENTA DEL PROXIMO PAGO (credito "void" derivado en payout-ledger.js).
- Cierre de mes para pagos: NO por ahora. No implementarlo sin nueva orden.
- Retencion antes de pagar: es OPCION DEL DUENO (0/7/14/30 dias, apagada por defecto), ajuste "retencion" del cuaderno.
  Lo retenido nunca se muestra como pagado ni se puede pagar.
- Botones de Commissions: textos cortos (By product, By rack, WhatsApp, CSV); el texto largo queda en aria-label.
- Idempotencia de pagos (v465): clave por intencion, misma clave con otro pedido = 409, reversa nunca mayor que lo pagado,
  pago multipersona todo o nada. Pruebas: test/payout-idempotencia-2026-10-07.test.js y test/payout-anulada-retencion-2026-10-07.test.js.

## GRAPH VIEW Y SONAR (decisiones de JFC 2026-10-07)
- friendly123.com/graph-view/ = dos grafos 3D publicos (toda la app arriba, todo lo que toca dinero abajo), generados por
  `sitio-friendly123/graph-view/extraer.mjs` desde docs/ del mismo commit en cada `node build.mjs`. Para clientes (Belen y otros).
- La version publica va SIN lista de riesgos (funciones de dinero sin test) ni duplicados: eso es solo para el panel lord.
- El Sonar de Canarios del panel lord SE QUEDA (Push/Rewind/Detener intactos). Pendiente: mejorar su backend con el grafo,
  poner AMBOS grafos al FONDO del panel, y cambiar los canarios por otros mas "cool" que JFC apruebe antes.
- Regenerar en cada merge a master. Hoy friendly123.com se despliega a mano (Worker friendly123-com); el despliegue
  automatico necesita un token de Cloudflare en GitHub que JFC tiene que crear.

## REGLA DURA JFC 2026-10-01: NO MENTIR. LA UI HACE LO QUE DICE (las 3 apps, paginas y paneles)
- Prohibido que una pantalla, boton, aviso o texto afirme algo que no paso o que no se comprobo:
  "hecho", "guardado", "enviado", "publicado", "sincronizado", "pagado", "cumplido", etc.
- Si la accion queda en cola o depende de otro sistema, se dice ASI ("registrada, todavia no esta
  hecha") y la pantalla muestra el estado MEDIDO (ej. el panel compara lo que tienen los clientes).
- Antes de entregar cualquier cambio de UI: comprobar que cada promesa de esa pantalla se cumple en
  el dato o en el sistema real (persona-testing / verificar-ui). Si no se pudo comprobar, se dice.
- Caso que origino la regla: el PUSH del panel decia "hecho" y los clientes seguian en v429 (sonar.yml
  corre cada 4-7 h). Corregido en v432. Cualquier texto "no honesto" que se encuentre se corrige en el acto.

## REGLA DURA JFC 2026-10-01: LO QUE GASTE MENOS TOKENS + JFC NO USA TERMINAL
- Entre dos caminos que logran lo mismo, se elige el que gaste menos tokens (esperar un proceso en segundo plano no gasta).
- JFC nunca corre comandos: Claude hace todo. Si algo exige su laptop (GPU, Obsidian), se usa una sesion LOCAL de Claude Code, no se le pasan comandos.
- Pruebas con materiales de JFC (logo, frases, datos demo propios), nunca con contenido generico.

## LICENCIAS: NUNCA EN EL REPO (JFC 2026-09-22) — el repo es PÚBLICO
- Jamás escribir una licencia completa (F123-/AMG-/C123-) en código, docs, tests
  ni commits. Una licencia da acceso a su cuaderno. Pasó con la licencia
  principal de JFC y con la de idiomARTE; se escondieron el 2026-09-22.
- En el código, comparar por huella (cyrb53), como sync-yjs.js. La licencia
  principal del dueño es el secret LORD_LICENSE del Worker.
- `check-sw.sh` G5 falla si aparece una. No relajar esa guarda.
- JFC es el DUEÑO de la app (lord = su licencia principal), nunca "soporte".

## JEV + OMNIROUTE: REPARTO DE TRABAJO (JFC 2026-09-24, regla dura, las 3 apps)
- **ORDEN DE JFC 2026-10-01: "usa Laya SIEMPRE SIEMPRE SIEMPRE que sea posible".** Laya hereda las
  ordenes que ya tenia Jev: "usa JEV at all times" (09-26) y "luego de tu research siempre mucho Jev"
  (09-27). Todo juicio chico (clasificar, rankear, triar, si/no, validar hallazgos de research, puntuar
  copy) pasa PRIMERO por Laya, sin que JFC lo pida, en cada sesion y en cada tarea. Gratis y local: no
  hay excusa de costo. Jev solo si Laya falla o duda; Claude al final. Mismas prohibiciones de datos.
- **LAYA PRIMERO (JFC 2026-10-01):** Laya (`pip install laya`, modelo abierto, corre en el aparato,
  gratis) hace los mismos juicios que Jev (choice/score/noul). Orden: Laya -> Jev -> Claude decide.
  Mismas prohibiciones. Ejecutor: `.claude/skills/jev-jfc/scripts/laya-evaluate.py` (mismo JSON que Jev).
  En la nube necesita `huggingface.co` y `cdn-lfs.huggingface.co` en Network access del entorno. Tambien `*.hf.co` y `cas-server.xethub.hf.co`.
  **FUNCIONA (2026-10-01):** JFC agrego los dominios; Laya responde en ~5 s. Formato de cada pregunta:
  `{"type":"choice","criteria":[...],"instructions":"..."}` (no "options").
- Claude razona, depura, lee y escribe código y textos. Jev (TypeSafe, vía Vercel AI
  Gateway) toma los juicios chicos y repetidos sobre el MISMO estado público:
  clasificar, rankear, triar, sí/no sobre muchos ítems. El código hace cuentas,
  fechas, dinero y todo lo determinista.
- Skill: `~/.claude/skills/jev-jfc` (Claude) y `~/.codex/skills/jev-jfc` (Codex),
  mismo ejecutor. Clave SOLO en la variable de usuario `AI_GATEWAY_API_KEY`, tope USD 1.
- Solo se llama si ahorra más contexto del que gasta. Confianza baja o error ->
  decide Claude o el flujo existente, sin reintentos.
- JAMÁS mandar a Jev: datos de clientes, PIN, licencias, claves, datos del panel,
  transcripts completos ni volcados del repo. Jev aconseja, no autoriza: dinero,
  publicar y borrar siguen con sus guardas y con JFC.
- **JFC 2026-09-26: "usa JEV at all times".** Jev se usa SIEMPRE que haya clave, también en
  la nube, con las mismas prohibiciones de abajo (nada de clientes, PIN, licencias ni claves).
  En la nube la clave va en las variables del entorno (AI_GATEWAY_API_KEY); si falta, se
  dice UNA vez y no se le vuelve a pedir a JFC. La máquina de la nube NO ve la laptop.
- **JFC 2026-09-27: "Luego de tu research siempre mucho Jev".** Todo research (web, benchmark,
  landing, copy) termina con una pasada FUERTE de Jev: rankear, triar y validar sí/no cada
  hallazgo o propuesta, con criterios explícitos, antes de presentárselo a JFC. Si Jev falla
  (hoy 403 por falta de créditos), se dice UNA vez y queda anotado como pasada pendiente.
- **Jev en la nube:** el entorno "GitHub1" tiene la variable `AI_GATEWAY_API_KEY` y Network access
  Custom con `ai-gateway.vercel.sh` (+ defaults); solo las sesiones nuevas lo ven. Hoy responde
  403 por falta de credito: decirlo una vez y no volver a pedirle nada a JFC.
- **jevgrep (github dzhng/jevgrep, evaluado 2026-09-26): NO adoptado.** Busca codigo en
  lenguaje natural con la misma clave de Jev. En la nube se cuelga si no se le cierra la
  entrada: usar `jg "pregunta" ./carpeta < /dev/null` (auth: `jg auth --provider vercel --stdin`).
  Carpeta chica: 69 s y acierta. `docs/` de friendly: mas de 9 min sin respuesta (index.html
  1.25 MB). grep lo resuelve en < 1 s. Reevaluar solo si JFC lo pide o si parten esos
  archivos. Manda codigo a Jev: solo repos publicos, nunca datos de clientes.
- Compactación de sesión con Jev: plugin `fast-jev-compaction@fast-jev-compaction-jfc`
  (fork local de JFC que va por Vercel AI Gateway y censura licencias, claves y PIN antes de
  enviar). Si falla, Claude Code hace el resumen normal.
  **2026-09-26 (JFC eligio "publico"):** el plugin va COPIADO dentro de este repo en
  `.claude/marketplaces/fast-jev-compaction-jfc/` (marketplace de directorio) porque su repo
  es privado y la nube no lo clonaba. Ademas NUNCA habia pasado la validacion de Claude Code
  (`$.env.get(name)` con nombre variable): se corrigio a nombres literales y ahora valida.
  Para actualizarlo: copiar de nuevo desde jfcarpiopuntocom/fast-jev-compaction-jfc sin
  tests/, demo/ ni examples/ (traen licencias de prueba que G5 podria marcar).
- Poda de salidas largas de Bash con Jev: plugin `fast-jev-output@jev-pruner-jfc`.
  **2026-09-27 (JFC: "Sí, duh!"):** tambien COPIADO en `.claude/marketplaces/jev-pruner-jfc/`
  (repo origen privado). Solo lo que corre: sin tests/, evals/, demo/, codex/, .agents/.
  Ya validaba; lee la clave de AI_GATEWAY_API_KEY (entorno o env de settings).

## SEGUNDO CEREBRO: NOTION, DROPBOX Y OBSIDIAN (JFC 2026-09-29/30)
- Detalle y reglas en el skill `segundo-cerebro`. Notion (siempre) y el conector de Dropbox
  de claude.ai (Outbox en vivo) llegan desde la nube; el vault de Obsidian vive solo en la
  laptop. La nube no lo ve: lo que deba llegarle se deja en el Outbox de Dropbox o en Notion.
- Nunca meter el vault ni contenido de Dropbox/Obsidian en friendly-123 (repo PUBLICO) ni en Notion.
- Privacidad: los comandos base del vault son locales. `/research`, `/x-*`, podcasts y
  embeddings en la nube mandan texto a terceros (Perplexity, Grok, Gemini): jamas con
  datos de clientes, licencias, PIN ni claves.

## CLOUDFLARE = CAPA PRIVADA DE LAS APPS (JFC 2026-09-24, regla dura, las 3 apps)
- Todo lo privado o semipublico (Worker de licencias, relay de sync, y el
  origen del codigo para el cargador anti-clon) vive en la cuenta Cloudflare
  de JFC, con 2FA activada. GitHub Pages sigue siendo la PUERTA (ahi estan los
  datos por origen); Cloudflare Pages sirve el codigo.
- Hostinger hoy es SOLO el dominio jfcarpio.com (sin hosting). No se planifica
  nada sobre Hostinger salvo que JFC contrate hosting o sea vital; el DNS de
  jfcarpio.com puede apuntar subdominios a Cloudflare (ej. code.jfcarpio.com).
- Ningun modelo cambia de proveedor, borra un Worker/Pages ni mueve el origen
  del codigo sin orden expresa de JFC. Runbook: PLAN-BLOQUE-P-CARGADOR-HOSTINGER-2026-09-24.md.

## REGLAS DURAS JFC 2026-09-24 (tarde)
- **Modelo:** lo de dinero, sync, acceso y seguridad (lo que los apuntes marcaban "Fable 5.1")
  lo hace el modelo de la sesion (Opus 5.5 o Sonnet 5.5) con estas MISMAS guardas: plan, respaldo
  SHA-256, test rojo-verde contra el respaldo, dos aparatos, shell nuevo.
- **Apuntes siempre hacia adelante, y tambien en el chat**: al cerrar cada paso, marcar
  en NOTAS-PARA-OPUS-5.5-2026-09-24.md lo hecho y lo que queda, y decirlo en el chat.
- **Jev + research online antes de decidir** (ahorro de tokens y rigor): skill jev-jfc
  para juicios repetidos; research online para benchmark y dudas de mercado.
- **Benchmark sin violar PI**: aprender funciones de los rivales, nunca copiar su codigo,
  textos ni diseno; tener respuesta propia para cada "pero ellos tienen X".

## MODALES SOLO EN ADVANCED + EMBUDO (JFC 2026-09-24) — REGLA DURA
- Modales/avisos RUTINARIOS (respaldo, recordatorios) solo al ENTRAR a Advanced
  y con rol dueño/admin/encargado. Jamás al abrir la app ni en una venta.
- Demo + landing (jfcarpio.com/friendly123/) = un embudo hacia save.html/PayPal.
  Ganchos elegantes dentro del producto; sin nombrar frameworks. Jev puntúa
  variantes de copy con criterios explícitos.

## REGLA DURA JFC 2026-09-27: NUNCA LLAMAR A JFC "ECONOMISTA"
- Prohibido "economista" / "economist" para referirse a JFC, en cualquier texto (sitio,
  apps, onepagers, bios, metadatos, posts). A él le suena pretencioso, aun con maestría y
  casi doctorado. Tampoco debe sonar a asesor contable.
- Cómo SÍ: **investigador económico y empresarial** y **consultor** (EN: economic and
  business researcher; consultant).
- No aplica a terceros (p. ej. "Bastiat, economista francés") ni a textos académicos
  sobre "los economistas" en general.

## MARCA Y DUEÑO (JFC 2026-09-25) — REGLA DURA, LAS 3 APPS
- La línea de apps se llama **Made In Cuenca: intuitive business apps**
  (friendly-123, amigable-123, consultorio-123). Nombre exacto, sin parafrasear
  ni traducir.
- Es identidad de la línea. En la UI va solo donde JFC lo pida (hoy, la línea de
  crédito del pie); no se riega por pantallas ni se explica en el producto.
- JFC es el DUEÑO de la app: el LORD OF SOFTWARE. "Lord" es correcto y se queda.
  Lo que JFC pidió quitar fue tratarlo como "soporte", nunca el lord. La
  licencia lord se reconoce por huella cyrb53, jamás escrita en el repo.
- friendly v401: el diagnóstico de Advanced (Sync, Code, origen del código) solo
  se ve en el aparato lord entrando como dueño, o con canario puesto. La
  medición sigue corriendo para todos.

## CANARIOS Y TRES CANALES (JFC 2026-09-25) — REGLA DURA, LEER ANTES DE PUBLICAR
Friendly tiene clientes reales. Desde el shell v403 los clientes ya NO reciben
master directo. GitHub Pages publica con GitHub Actions (`.github/workflows/`):
- `/friendly-123/`        = rama `estable` -> CLIENTES REALES.
- `/friendly-123/next/`   = rama `master`  -> CANARIO (aparatos en la licencia
  lord de JFC; un aparato lord que abre la raiz pasa solo a /next/).
- `/friendly-123/previo/` = rama `previo`  -> estable anterior (rewind).
Mismo origen = mismos datos: las tres versiones leen el MISMO cuaderno, asi que
la compatibilidad de datos en las dos direcciones es obligatoria.

Flujo: merge a master -> sale en /next/ -> `promover.yml` espera 33 min mirando
el Sonar del Worker (`/canario/estado`) -> si no hay rojo ni "Detener", mueve
previo <- estable <- master y publica. Regla de JFC: 33 minutos MAXIMO desde
cada push; JFC es parte del equipo de prueba.
Emergencias (panel privado de JFC, seccion "Sonar de Canarios", aparte de la
lista de licencias): PUSH (next a clientes ya), REWIND (clientes a previo),
Detener/Reanudar. Las ejecuta `sonar.yml` (cron cada 5 min).
Desde una sesion de nube NO se pueden relanzar workflows (la integracion da 403, verificado 2026-09-30) y no hay `gh`: en una emergencia JFC usa el panel.

Checklist de release (se suma al de arriba): tras el merge, verificar la URL
VIVA de `/next/` (no la raiz), decirle a JFC que el shell esta en /next/ y a que
hora llega a clientes; a los 33 min verificar la raiz.
Fusionar a master no exige esperar despliegues. Pages rechaza un despliegue nuevo unos segundos despues
de que el anterior termina ("in progress deployment"; visto 2026-09-30 con 11 s de diferencia entre dos
despliegues que NO se solapaban, asi que un grupo de `concurrency` no lo evita). `publicar.yml` reintenta
solo, hasta 3 intentos. Tras fusionar, comprobar que `publicar` termino en exito. Si quedo rojo, JFC lo
relanza en Actions ("Re-run failed jobs") o lo repara el siguiente push a master.
Vuelta atras total: Settings > Pages > "Deploy from a branch" master /docs.
Plan completo: PLAN-CANARIOS-2026-09-25.md.
