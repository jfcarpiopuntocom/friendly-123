# CLAUDE.md — léeme entero antes de planificar o tocar código

Este archivo se carga solo en cada sesión. Los demás `.md` no. Por eso lo
crítico está aquí y no repartido en apuntes que nadie abre.

---

## MENTALIDAD (JFC, 2026-09-03) — CIRUJANO DE SOFTWARE, IKIGAI

Actuar como el mejor cirujano de software del mundo: brillante, delicado, riguroso,
**quirúrgico**. Regla dura sobre todas: **ante todo, NO matar al paciente — no
arruinar lo que ya funciona.** Cambios mínimos, precisos, verificados antes de
tocar producción; sin quemar tokens. Cada corte cuenta.

---

## PRIME DIRECTIVE 1A — NUNCA ROMPER A UN DUEÑO DE LICENCIA (JFC, 2026-09-02, la más alta)

**Jamás romper la experiencia, los datos ni la confianza de un dueño de licencia
que YA está usando la app.** El 2026-09-02 a idiomARTE (nuestro PRIMER cliente
pagado) le salió un error de "límite de licencia mínima" por un cambio nuestro:
eso NO puede volver a pasar NUNCA.

- **Los tweaks son SOLO al margen.** A JFC le gusta la app como está. Se hacen
  tweaks o adiciones ENANAS, aditivas, que no tocan lo que ya funciona ni lo que
  un cliente ya usa. Nada de refactors, nada de gates nuevos sobre flujos vivos,
  nada que pueda capar, bloquear o degradar a una instancia activada/pagada.
- **Regla de oro del gating:** una instancia ya activada (con `instanceId`, o un
  cliente pagado) NUNCA debe caer al tope del plan gratis ni ver un límite. Ante
  cualquier duda sobre si un cambio puede afectar a un cliente activo: **no se
  hace**, se pregunta.
- Esto está por ENCIMA de todo lo demás (solo debajo de REGLA –1, la palabra de
  JFC). Si un cambio "mejora" algo pero arriesga romperle a un dueño: no va.

---

## REGLA –1 — EL PROMPT DE JFC ES PALABRA SAGRADA (directiva suprema)

Lo que JFC dice **es lo que va**, y **prevalece siempre** sobre mis asunciones,
alucinaciones, devaneos, "creatividad" o gusto estético. No está exenta de
errores, pero manda igual: si creo que se equivoca, lo digo en UNA línea y **hago
lo que pidió**. Lo que él NO pidió, no se implementa; lo que SÍ pidió, se termina
completo hasta pushear.

- **No asumir, no inventar, no alucinar.** Si se puede medir, se mide. Si hay
  especificación (manual, paleta, apunte), se usa EXACTA — nunca un valor
  "parecido" ni un cambio "porque se ve mejor".
- **No detenerse ni dejar colgado.** Prohibido cerrar con "¿arranco?" / "quedo
  listo apenas confirmes". JFC no sabe (ni debe) de git: yo cierro el ciclo
  (backup → commit → push → mergear cuando verde y comprobado).
- **UI del cliente en vivo: intocable** sin permiso. Nada de popups/banners
  nuevos; avisos técnicos a consola.
- **Verificar 3X antes de entregar** (guards, node --check, check-sw, y visual
  con `verificar-ui` si toca UI). Respaldos y apuntes abundantes.

El detalle completo y portátil a TODOS los proyectos está en
`.claude/commands/modus-operandi.md`. Es el estándar por defecto de JFC.

---

## REGLA 0-bis — ESTADO MUTABLE PRIMERO (patrón SKILL.state, JFC 2026-09-01)

Antes que nada, leer **`.claude/ESTADO.md`**: el estado de ejecución vivo, compacto
y mutable (implementa arXiv:2608.26263 aplicado a este trabajo). Da contexto
suficiente sin re-derivar del chat gigante → menos tokens, menos errores
evitables. **Al terminar cada trabajo se SOBRESCRIBE** (estado, no log); el
detalle narrativo va al `DIARIO-*.md`. Orden de lectura al abrir sesión:
`.claude/ESTADO.md` → `CLAUDE.md` → `DIARIO-*.md` más reciente.

## REGLA 0 — LEER LOS APUNTES ANTES DE PLANIFICAR

**Obligatorio, antes de proponer cualquier plan o port:**

```bash
ls *.md _private/*.md 2>/dev/null          # qué apuntes hay
cat PORT-NOTES-*.md LAS-TRES-APPS-*.md DIRECCION-PRODUCTO-*.md
```

Esto NO es opcional y no se salta por ahorrar tokens. El 2026-08-18 se propuso
un plan de port que habría borrado trabajo de friendly-123 porque no se leyó
`PORT-NOTES-2026-07-21.md`, donde ya estaba escrito que friendly-123 recibe los
avances primero. Un plan hecho sin leer los apuntes es un plan que destruye
trabajo.

Si un apunte contradice lo que dice este archivo, **gana el apunte más reciente
y hay que actualizar este archivo en el mismo commit.**

---

## REGLA 1 — FOTO ANTES DE TOCAR NADA

```bash
bash .claude/snapshot.sh "antes-de-lo-que-sea"
```

Rama de respaldo fechada + tar fuera del repo (incluye lo NO rastreado, que es
justo lo que no sobrevive a un clon nuevo) + sha256 de todo .js/.html/.json/.md.
Se corre ANTES de empezar, no después. Sin excusa y sin preguntar.

## REGLA 1b — NUNCA SE PIERDE TRABAJO DE JFC

- **Jamás sobrescribir un archivo completo entre apps hermanas.** Se injerta
  cambio por cambio. Las tres apps divergieron hace rato: `cp` de una a otra
  borra trabajo.
- Antes de cualquier port: rama de respaldo fechada en el repo destino.
- Ante la duda de si algo es trabajo propio de esa app: **preguntar, no decidir.**

---

## REGLA 2 — TRABAJO LOCAL, PUSHES FRECUENTÍSIMOS

El trabajo es local. Se commitea y se pushea seguido — no un commit gigante al
final. Cada paso que queda verde se pushea. Nada se queda sólo en el disco de
un contenedor que se recicla.

## REGLA 2b — NO PARAR (texto de JFC, 2026-08-18)

> "no tengo permitido ser estupido, y debo ser util, no alucinar, no asumir, no
> parar y arruinarle su dia a JFC, no dejar sin pushear idiotamente, no dejar de
> poner el plan de trabajo siempre en el chat antes de hacer para que JFC retome
> en otra sesion o PC o incluso cuenta de Claude"

Desglosado, porque cada parte tiene su forma de fallar:

- **No parar.** En modo auto, con el plan aprobado, se sigue hasta terminar. NO
  se corta a mitad para resumir avances ni para pedir permiso otra vez. JFC deja
  esto corriendo justo para no estar pendiente de la PC.
- **El plan SIEMPRE en el chat antes de hacer.** No sólo en un `.md`. Tiene que
  poder retomar desde otra sesión, otra PC u otra cuenta de Claude leyendo el
  chat.
- **Nunca dejar sin pushear.** Cada paso que queda verde se pushea.
- **No asumir, no alucinar.** Si un dato se puede medir, se mide. Lo que no se
  comprobó se dice que no se comprobó.

JFC deja trabajo corriendo de noche. No detenerse a pedir permiso a mitad de
una tarea aprobada. Se para sólo si hay una contradicción real que puede
destruir datos; en ese caso se muestra y se sigue con todo lo demás.

Pushear siempre. Nunca dejar commits sin subir.

## REGLA 2d — YO CIERRO EL CICLO. NADA QUEDA A MEDIAS

> "no entiendo por qué he tenido que pedirte unas 80 veces que no hagas esto
> 'los 3 PR siguen en borrador esperando tu decisión' (...) yo no si quiera sé
> lo que es un PR ni debo necesitar saber" — JFC, 2026-08-18

**Nunca** dejar trabajo terminado esperando una decisión suya sobre mecánica de
git. JFC no tiene que saber qué es un PR, una rama o un merge, y no se le
pregunta. El ciclo completo es responsabilidad mía:

1. Respaldo local abundante (`snapshot.sh`: rama fechada + tar + sha256).
2. Commit y push.
3. Sacar el PR de borrador y **mergearlo** a la rama principal.
4. Verificar que quedó mergeado y que no rompió nada.

Se merge cuando está **verde y comprobado**, no antes: mergear código sin
verificar sería lo contrario de profesional. Pero el merge no espera su permiso,
espera la comprobación. Si algo no se puede mergear, se dice POR QUÉ en una
línea y se arregla — no se deja en el limbo.

## REGLA 2e — TERMINAR LA MISIÓN, NO FRENAR EN LO YA PEDIDO (JFC, 2026-08-25)

> "ya te he pedido 80 veces que dejes de detenerte en cambio en las cosas que YO
> MISMO ya pedí o aprobé. Acostúmbrate a terminar tus misiones."

Si JFC ya lo pidió o lo aprobó (incluye elegir una opción en una pregunta), **se
hace completo hasta terminar** — no se vuelve a preguntar "¿lo hago?", no se
para a mitad a pedir permiso, no se deja a medias esperando su decisión. Preguntar
es SOLO para una duda real que él no haya resuelto y que pueda destruir datos o
cambiar el modelo del producto. Lo que él NO pidió, no se implementa por
iniciativa propia (no auto-aprobarse features); lo que SÍ pidió, se termina.

## REGLA 3 — BITÁCORA

Registrar los prompts de JFC en `PROMPTS-Y-BITACORA.md`: textuales, fechados, y
qué se hizo con cada uno. Sirve para retroceder cuando él quiera.

---

## MODELO MULTI-TIENDA (2026-08-26 — cambio de modelo aprobado por JFC)

Poner una licencia = **VOLVERSE esa tienda** (switch), NO fusionar (merge). Antes
`unirse()` hacía merge y sobrescribía `f123_owned` — la app seguía mostrando la
tienda local con otro nombre y los PINs del equipo no entraban. Ahora:

- Cada licencia = una tienda aislada en localStorage. El estado se namespacea con
  un sufijo `::<licencia>` en los buffers A/B (`claveBuffer`/puntero en
  `mock-backend.js`). La tienda propia usa sufijo `""` (claves legacy → cero
  migración). **Propiedad de seguridad: sin `f123_tienda_activa`, todo es
  byte-idéntico a antes.**
- `window.OCTienda.cambiar(lic)`: flush de la tienda actual → marcador
  `f123_tienda_activa` → `location.reload()`. Registro `f123_tiendas` mapea
  licencia→sufijo para volver a cualquiera (la propia = `""`).
- `unirse()` (sync-realtime.js) llama `OCTienda.cambiar()`. El sync aterriza en
  el namespace de la tienda activa automáticamente.

**LÍMITE SIN NUBE:** el relay es zero-knowledge; no guarda el estado de ninguna
tienda. Los PINs/datos de otra tienda solo llegan si el aparato de esa tienda
está ENCENDIDO empujando su catálogo. Unirse con el otro aparato apagado = tienda
vacía (seed) hasta que sincronice. NO agregar un servidor que guarde estado —
rompería la regla sin-nube.

---

## LAS TRES APPS — qué es cada una

| | **amigable-123** | **friendly-123** | **consultorio-123** |
|---|---|---|---|
| Rol | producción, español | **repo de TESTEO — recibe los avances PRIMERO** | focus groups / market research |
| Idioma | español | inglés (`i18n.js`) | español |
| Unidad básica | la percha | la percha | el paciente |
| Licencia | `AMG-` | `F123-` | propio |
| PIN | 3 dígitos | 3 dígitos | **4 dígitos, POR DISEÑO** — no "corregir" |

**friendly-123 es el repo donde se prueban cosas avanzadas.** Suele ir ADELANTE
de amigable en algunos sistemas. Verificado el 2026-08-18: va adelante en
`crypto-store.js` (+13 KB), `mock-backend.js` (orden de sacrificio de espacio),
`avanzado-extra.js` (respaldo autoverificado), `reconciliacion.js`, y todo el
sistema `i18n.js`. **Nunca asumir que friendly va atrás.**

**consultorio-123 va a ser una app DISTINTA.** No es amigable para médicos. Su
centro es lo contable y financiero: abonos, pagos, cuentas por cobrar de
pacientes, control y visualización financiera fácil. NO portarle perchas,
variantes, comisiones a asociados, eventos ni reposición de stock — un
consultorio no tiene nada de eso. Ante la duda: **no portar todavía.**

---

## VOCABULARIO (decidido 2026-08-17, aplicado en las tres)

- **encargado/a**, nunca "empleado" — no queremos que parezca control de personal.
- **asociado/a**, nunca "promotor/a". Cuando la casa retiene %: **casa anfitriona**.
- **Bar y licores son una sola cosa.** No existe el rubro "Licores".
- El rol interno sigue siendo el string `"empleado"` en PINs, endpoints y estado
  guardado. Sólo cambió el texto visible. Renombrarlo dejaría sin acceso a todo
  dispositivo ya activado.

## COMISIONES — las dos modalidades

Misma cuenta leída al revés: la vendedora se lleva 10% y la casa retiene el
resto; el artista se lleva 85% y **le deja 15% a la casa anfitriona**. **La
misma persona puede tener las dos a la vez** en perchas distintas — por eso el %
no se guarda por persona, se suma la plata real de cada trato.

---

## CÓMO INVESTIGAR SIN QUEMAR TOKENS

`index.html` pasa de 1 MB. **Nunca leerlo entero.** Se usa:

```bash
git log --since="7 days ago" --pretty=format:"%h %ad %s" --date=short
git show --stat <sha>
comm -23 <(ls a/docs|sort) <(ls b/docs|sort)   # qué archivos faltan
grep -rl "MARCADOR" docs/                       # si un sistema está o no
stat -c%s a/docs/x.js b/docs/x.js               # quién va adelante
```

Leer código sólo cuando el plan dependa de un detalle que nada de esto contesta.

---

## ESTILO AL ESCRIBIR PARA JFC

- Español natural. **No usar "vive en"** (calco del inglés, JFC lo detesta).
- Sin emojis en la UI.
- Comentarios en el código que expliquen POR QUÉ, con la fecha y el bug real.

---

## NO DEJAR NADA COLGADO ESPERANDO PERMISO (JFC, 2026-08-26)

Prohibido cerrar un turno con "quedo listo para X apenas me confirmes / dime si
arranco". Si es trabajo que él ya pidió o aprobó, **se hace hasta terminar** y se
pushea; no se le devuelve la decisión. Preguntar es solo para una duda real que
pueda destruir datos o cambiar el modelo del producto (REGLA 2e). Él tiene
apuntes, prompts, .md y regaños de sobra: usarlos, no re-preguntar.

## SKILLS EXTERNAS APROBADAS (JFC, 2026-08-26) — pero de uso RACIONADO

JFC aprobó traer dos skills de `anthropics/skills`, PERO **queman tokens**, así
que la regla es: **sugerir su uso cada vez y esperar su OK**, o usarlas con
mucha mesura. Nunca dispararlas de oficio.

- **`verificar-ui`** (basada en `webapp-testing`, Playwright/Chromium ya
  preinstalado): abre la app y saca screenshots de las pantallas críticas
  (candado de PIN, tarjetas de Inventory, flujo "Join my team") ANTES de pushear,
  para no entregar UI rota. Es la defensa contra editar a ciegas. **Costosa en
  tokens → pedir OK antes de correrla.**
- **`reglas-friendly`** (via `skill-creator`): invariantes que toda sesión debe
  respetar — paleta EXACTA del semáforo (#00C87A/#FFC700/#F97316/#E8365D/#0A0A0F,
  base de la UX, solo sin azul); **prohibido** meter popups/banners nuevos a la UI
  del cliente en vivo; checklist de release (snapshot → guards → check-sw → bump
  de shell **Y** version → push); no sobrescribir entre apps hermanas.

Los archivos de estas skills viven en `.claude/commands/`. Crearlos no cuesta;
CORRERLOS (sobre todo verificar-ui) sí → avisar y esperar aprobación.

---

## PRIORIDADES DE JFC (2026-08-27) — orden de decisión para TODO trabajo

JFC lo dijo textual: "mis prioridades son estabilidad → redundancias para que el
fallo sea virtualmente imposible → sistemas híbridos que combinen las mejores
librerías y fail-safes a prueba de hierro disponibles mundialmente → flexibilidad
de UX para que sea amigable y no demasiado estructurada, que permita 2 o más
formas de lograr lo mismo en la UI → innovación → investigación para más
innovación".

Este es el orden de prioridad al decidir, en cada cambio:

1. **ESTABILIDAD** — lo que ya funciona no se rompe. Nada de refactors que
   toquen lo que está verde. La compuerta (test-todo.sh) es ley: rojo = no se
   pushea.
2. **REDUNDANCIA / FAIL-SAFE** — el fallo debe ser virtualmente imposible.
   Doble buffer A/B, tombstones, respaldos, reloj lógico, kill-switch que falla
   abierto: todo lo que hace que un fallo no destruya datos. Antes de quitar
   cualquier salvaguarda, preguntar "¿qué pasa si esto falla?".
3. **SISTEMAS HÍBRIDOS** — combinar las mejores librerías y soluciones
   disponibles mundialmente, con fail-safes a prueba de hierro. No reinventar
   lo que ya existe bien hecho; integrarlo con capas de seguridad.
4. **FLEXIBILIDAD DE UX** — amigable, no rígida. Permitir 2 o más caminos para
   lograr lo mismo en la UI (ej. teclado + botón, escáner + tipeo, panel + app).
   No forzar una sola forma de hacer las cosas.
5. **INNOVACIÓN** — mejoras nuevas que aporten valor real.
6. **INVESTIGACIÓN** — buscar más innovación, sin quemar tokens (ver sección
   "CÓMO INVESTIGAR SIN QUEMAR TOKENS").

Regla dura que nunca se negocia: **nunca romper los datos del usuario** — su
inventario, clientes, licencias, nombre de tienda, PINs, jerarquía. Todo lo
demás se puede iterar; eso no.

---

## REGLA 4 — RESPALDO ABUNDANTE + NOTAS PARA OTRAS SESIONES (JFC, 2026-08-27)

JFC lo pidió como regla dura: "siempre (nueva regla dura también) respaldos
abundantes y notas para que otros modelos o sesiones sepan exactamente lo que
hiciste".

- **RESPALDO ANTES DE TOCAR**: antes de cualquier cambio, snapshot fechado +
  copia fuera del repo (incluyendo lo NO rastreado por git) + checksums sha256.
  Ver `snapshot.sh` y la sección "RESPALDO ANTES DE TOCAR NADA" de REGLAS.
- **NOTAS POR CADA TRABAJO**: al terminar un trabajo, dejar una nota fechada en
  `docs/` (o `.claude/notas/`) que diga QUÉ se cambió, POR QUÉ, CÓMO se verificó
  (compuerta verde), y QUÉ quedó pendiente. Que otra sesión o modelo pueda
  retomar sin adivinar.
- **BITÁCORA**: registrar cada trabajo en la bitácora (ver REGLA 3).

## REGLA 7 — JFC ES MAINTENANCE/SUPPORT, VISITANTE PARCIAL (JFC, 2026-08-27) — REGLA DURA

"a mi siempre taggeame como maintenance/support, como visitante parcial que no
invade el total de datos, por ejemplo yo veo visual e inventario pero no precios
ni numeros!!!! esto que acabo de decir, para TODAS mis apps!"

- Cuando JFC entra a una tienda ajena (Sarah, Diego, etc.) su rol es
  **maintenance/support**: ve el **inventario y las fotos/visuales** para
  verificar integridad, pero **NO ve precios ni números** (ventas, costos,
  ganancias, montos) **NI los datos de contacto de los clientes** (teléfono,
  email, WhatsApp, dirección). Es lo que se acostumbra legal y world-class
  globalmente: el soporte técnico no accede a datos personales de los clientes
  del negocio.
- Aplica a **todas las apps** (friendly-123, AMIGABLE, etc.), no solo a esta.
- No invade los números del negocio ni los datos personales de sus clientes;
  solo verifica que el inventario y las fotos estén íntegros.

## REGLA 8 — TRACKING 24/7 SIN RETENER CONTENIDOS (JFC, 2026-08-27) — REGLA DURA

"quiero tracking de todo, de dispositivo, de PIN, de errores para defendernos de
quejas injustas, de todo! no retenemos los contenidos de las tiendas pero sí
hasta hashes parciales"

- Se trackea: dispositivo (instanceId, apodo, IP, lastSeen), PIN (eventos de
  login/fallo, sin guardar el PIN en claro), errores (para defenderse de quejas
  injustas).
- **NO se retienen los contenidos de las tiendas** (productos, ventas, datos).
  Solo **hashes parciales** (huellas) para verificar integridad sin guardar el
  contenido.

### REGLA 8b — TODO USO DE LA APP AL RADAR DE INSPECTOR (JFC, 2026-09-03, 1A)

"si alguien usa la app debe estar en nuestro radar de inventarios, PUNTO, aunque
lo de las licencias siga sin estar totalmente resuelto ... la prioridad 1A es que
esté en nuestro radar todo uso de la app o nunca vamos a tener control de esto."

- **Cada instancia que usa la app entra al radar de Inspector™** (panel privado
  del lord). El radar reusa el roster de micelio (zero-knowledge, sobre el relay
  ya existente): apodo, rol, estado y última señal de cada instancia — **huellas,
  nunca contenido** (respeta REGLA 8 y el límite sin-nube).
- Esto es prioridad **1A**; va por delante de resolver licencias y de "peso"
  (dedup/absorción de instancias extraviadas), que son prioridad 2.
- LÍMITE HONESTO (no-nube): el radar ve lo que alcanza por el relay (las tiendas/
  salas donde el aparato del lord está presente). No se agrega un servidor central
  que guarde estado de todas las tiendas — eso rompería la regla sin-nube.

<<<<<<< HEAD
### REGLA 8c — MERGE PRIMERO, JAMÁS PERDER TRABAJO REAL (JFC, 2026-09-03) — DURA

"prefiero que se mergee todo siempre cuando se encuentran dispositivos entre sí y
la gente deba borrar manualmente y haya excesos en esa dirección ligeramente, a
que se pierdan datos y trabajo de la gente en el mundo real en sus dispositivos
rogue o huérfanos ... no todo cliente es pagado y nuestra capa de servicio a la
comunidad emprendedora y a la sociedad debe honrar y cuidar a todos, la
integridad de su trabajo y sus datos."

- **Sesgo permanente hacia FUSIONAR, no descartar.** Cuando dos aparatos se
  encuentran, la conducta por defecto es MERGE (absorber/conservar), aunque eso
  deje de más. Perder datos/trabajo de una persona real es MUCHO peor que un
  exceso de datos que ella luego limpia a mano.
- **Todo borrado es MANUAL y NO destructivo.** Ninguna limpieza automática puede
  borrar datos ni identidad reales. "Olvidar" en el radar solo quita una entrada
  del roster LOCAL (huella); el aparato, su inventario y su identidad quedan
  intactos y reaparece si vuelve a latir.
- Aplica a **todos**, pagados o no. La integridad del trabajo del usuario está por
  encima de la prolijidad del radar.

=======
>>>>>>> origin/master
---

## REGLA 6 — DIARIO .md POR VENTANA DE 48h (JFC, 2026-08-27) — REGLA DURA

JFC lo pidió como regla dura: "guardes mis prompts en archivos .md por día pero
cada día es 48h y tus 'epifanías' o 'redescubrimientos porque olvidaste
contexto', para que siempre tengas contexto aunque yo solo tenga la cuenta de
$10 de AbacusAI por ahora".

- **Un archivo por ventana de 48h**, en la raíz del repo, nombrado
  `DIARIO-<fecha-inicio>.md` (ej. `DIARIO-2026-08-27.md` cubre 2026-08-27 →
  2026-08-29). Al abrir una ventana nueva se crea el archivo nuevo.
- **Contenido obligatorio**:
  1. **Prompts de JFC** textuales y fechados (lo que pidió, con sus palabras).
  2. **Epifanías / redescubrimientos** míos: cosas que redescubrí porque perdí
     contexto, lecciones duras, decisiones de producto, bugs de raíz. Que otra
     sesión o modelo los lea y no vuelva a tropezar.
  3. **Qué se hizo** con cada prompt (resumen de una línea + archivos tocados).
- **Al empezar cada sesión**: leer el `DIARIO-*.md` más reciente (además de
  `CLAUDE.md` y la bitácora) para tener contexto sin quemar tokens.
- **Al terminar cada trabajo**: anotar en el diario de la ventana actual.
- La bitácora (`PROMPTS-Y-BITACORA.md`) sigue siendo el registro histórico
  largo; el diario es el contexto vivo de la ventana.

---

## REGLA 5 — EL PLAN SIEMPRE EN EL CHAT ANTES DE HACER (JFC, 2026-08-27)

JFC lo pidió como regla dura: "siempre mostrar un plan en este chat de lo que
voy a hacer para que yo siempre entienda y pueda retroceder si hiciste algo
terrible o rompiste mis proyectos".

- Antes de ejecutar cualquier trabajo de varios pasos, el plan va **escrito en
  el chat**, no sólo en un `.md` ni en la lista de tareas.
- El plan dice QUÉ se va a hacer, EN QUÉ ORDEN, y QUÉ archivos se tocan.
- Así JFC entiende y puede retroceder si algo sale mal.
- El plan dice QUÉ se va a hacer, EN QUÉ ORDEN, y QUÉ archivos se tocan.
- Así JFC entiende y puede retroceder si algo sale mal.

---

## FASE 2 — Fail-safes de integridad del sync (2026-08-27, shell v123)

Día de fortificación/depuración del sync/team. Se cerraron 2 fallas de
integridad silenciosas y 1 de higiene, todo aditivo y de mínimo toque:

1. **Dedup `_opsAplicadas` tope 500→2000** (mock-backend.js): antes, si un opId
   se evictaba del set y el par lo reenviaba, un delta de stock se aplicaba 2
   veces (doble conteo). Con 2000 la evicción es rarísima.
2. **Cola offline `COLA_KEY` tope 200→1000 + marca `f123_sync_cola_desbordada`**
   (sync-realtime.js): antes descartaba movimientos en silencio si estabas
   offline mucho tiempo. Ahora nunca se pierde stock en silencio; el watchdog
   expone `colaDesbordada()` en `estado()`.
3. **Poda de micelio `f123_micelio_vistos` >24h** (micelio-vivo.js): los aparatos
   dados de baja ya no quedan "a ciegas" para siempre ni el verificador del
   watchdog persigue fantasmas. Nunca poda mi propio id.

Compuerta: **TODO VERDE (9/9)** con el nuevo `harness-failsafe.cjs` (paso 9, 11
comprobaciones). Nota completa: `docs/NOTA-failsafes-sync-2026-08-27.md`.

**Documentado, NO se cambió (por diseño):** el checkpoint NO lleva ventas (las
ventas son el log irremplazable por caja; viajan por el stream de ops en vivo).
WebRTC P2P (SPOF-7) y fotos (SPOF-8) quedan para fases futuras.

Respaldo: rama `backup/20260827-115030-antes-fase2-sync-fortificar` + copia en
`C:\00 Projects\sandbox\_backups\` con CHECKSUMS.sha256.
