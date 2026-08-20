# Plan — 13 microbugs reales + guards/autocuraciones + verificación de sync de equipo (2026-08-20, ronda 2)

**Para:** JFC · **Alcance:** AMIGABLE, friendly-123, Consultorio-123

**ESTADO: CERRADO 2026-08-20.** Los 13 bugs corregidos y pusheados. G1/G2/G4
instalados en las 3 apps (G3 y G5 quedaron implementados dentro de A1/A2). G2,
al correr por primera vez, encontró que el fix de bases IndexedDB compartidas
nunca se había portado a friendly-123 (producción) — se portó en el momento,
mismo patrón de migración segura. Sync de equipo verificado funcionando.
Pasada final de i18n (497/497 y 485/485 claves EN/ES) sin hallazgos nuevos.
JFC declaró v1.0 para las 3 apps el mismo día. Detalle completo en
`PROMPTS-Y-BITACORA.md`, entrada "2026-08-20 — cierre de sesion".

Investigación hecha por 3 agentes en paralelo (uno por app), con grep/git/node —
sin leer ningún `index.html` completo (pasan de 1MB los 3). Cada hallazgo tiene
el comando que lo prueba.

**Nota honesta:** JFC pidió hasta 22. Encontré 13 con evidencia dura (5 en
AMIGABLE, 3 en friendly-123, 5 en Consultorio-123) y me detuve ahí — los tres
agentes revisaron explícitamente IDs duplicados, claves cross-app, paridad
i18n, `==` vs `===`, fechas UTC, y reportaron que el resto ya estaba blindado
por fixes de rondas anteriores. Rellenar hasta 22 con dudas sin confirmar
sería ruido, no señal — mismo criterio que la ronda 1.

---

## SYNC DE EQUIPO/DISPOSITIVO — verificado, funciona

Confirmado en Consultorio-123 (el más reorganizado hoy) carácter a carácter:
- `sync-realtime.js` y `tablero.html` tienen `RELAY_URL`/`SALT_FIJO`/`idDeSala()`
  espejados exactamente — sin drift.
- Los tipos de mensaje nuevos (`TIPO_CARTERA_PEDIDO`/`TROZO`) no chocan con
  `TIPO_CATALOGO_*`/`TIPO_CATCHUP_*` existentes.
- `OCSync.clientesActivos()` (mock-backend.js:1161) y
  `AMG.Cartera.saldoDeCliente()` (cartera.js:104) existen con la firma exacta
  que `sync-realtime.js`/`tablero.html` esperan.
- **No se encontraron rupturas funcionales.** El único hallazgo fue de
  nomenclatura (`SALT_FIJO` sigue diciendo `"amigable-sync-v1"` en las 3 apps),
  no de funcionalidad — como `RELAY_URL` ya es específico por app, las salas
  no chocan en la práctica. Se documenta como bug #14 abajo, prioridad baja.

---

## Los 13 microbugs, por app y por riesgo

### AMIGABLE

**A1. [GRAVE] Doble caja negra de errores — el panel de soporte solo lee una de las dos**
`docs/index.html:5906` y `:6497` — dos IIFEs `cajaNegraErrores` distintas,
una escribe en `localStorage["amigable_errores"]`, la otra en `"oc_errores"`.
El panel de "Soporte técnico" (`leerErroresGuardados()`, línea 6543) solo lee
`oc_errores`. Errores capturados solo por la primera (incluye los fallos de
`version.json`, ver A5) son invisibles para quien da soporte.
**Comprobar:** `grep -n "amigable_errores\|oc_errores" docs/index.html`

**A2. [MEDIO] Kill-switch remoto (R4) cargado pero sin ningún consumidor**
`docs/feature-gate.js` define `window.OCApagado(id)`, pero
`grep -c "OCApagado" docs/index.html` da 0 fuera de la propia definición.
Si JFC pone algo en `version.json.apagar` hoy, no pasa nada — nadie pregunta.

**A3. [MEDIO] Placeholder de licencia existente miente sobre el formato real**
`docs/auth-ui.js` — placeholder dice `AMG-XXXX-XXXX-XXXX` (3 grupos),
`generarCodigoAMG()` genera 4 grupos + checksum de 5 caracteres. Un dueño
reactivando en un segundo dispositivo puede truncar su código copiando el
placeholder como referencia.

**A4. [MEDIO] Aviso de "hay una versión nueva" (A4/autodiagnóstico) sale en inglés**
`docs/salud-app.js:227` usa `window.OCI18n.getLang()`, que **no existe en
AMIGABLE** (`backup-scheduler.js` lo documenta explícitamente: "amigable-123
NO tiene sistema bilingüe"). `esES` siempre es `false` → banner en inglés a
usuarios que no lo leen. Bug de portación (código de friendly-123 pegado sin
adaptar, commit `43503cc`).

**A5. [BAJO] `enviarHeartbeatLicencia` escribe diagnóstico de red en la clave huérfana**
`docs/index.html:6464` — mismo origen que A1: los fallos de `version.json`
(404/500) quedan en `amigable_errores`, invisibles en el panel de soporte.

### friendly-123 (producción)

**F1. [MEDIO] Mensajes de "Team Sync" hardcodeados en inglés, bypasean i18n**
`docs/avanzado-extra.js:751-756` — el flujo de "join team" (sync entre
dispositivos) escribe `"Paste the team code first."`,
`"That is not a friendly-123 team code..."`, `"Joined. This device is now
syncing with the team."` directo al DOM, sin `t()`. Un empleado con la app en
español ve estos 3 mensajes del flujo de sync en inglés puro.
**Comprobar:** `grep -n "Paste the team code first" docs/avanzado-extra.js`

**F2. [BAJO-MEDIO] Alerta de error de "duplicar variante" hardcodeada en español**
`docs/index.html:3221` — `duplicarComoVariante()` usa
`ocAlert("No se pudo preparar la variante.")`, sin `t()`, en una app
English-first. Rompe consistencia de idioma en el camino de error.

**F3. [BAJO] Comentario de `aislamiento.js` no advierte la condición frágil real**
`docs/aislamiento.js:353` — el shim de IndexedDB funciona hoy, pero nada
protege contra que alguien reordene los `<script>` de `index.html` o mueva la
apertura de estas DB a un Worker (que no comparte el `window.indexedDB`
parcheado). No es un bug activo, es un punto fragile sin guard — ver G1 abajo.

### Consultorio-123

**C1. [GRAVE] `vista-perchas.js` sigue cargado en producción pese a que su propio comentario dice que se desactivó**
`docs/vista-perchas.js:1-6` dice *"Ya no carga (se quitó su `<script>` de
index.html y su entrada del SHELL en sw.js)"* — pero
`docs/index.html:5067` y `docs/sw.js:42` **siguen** teniendo la referencia.
El código corre sobre un DOM sin botón de nav que lo muestre: peso muerto
activo, y el SW sigue cacheando una versión que se documentó como retirada.
**Comprobar:** `grep -n "vista-perchas.js" docs/index.html docs/sw.js`

**C2. [MEDIO] `#vista-perchas` quedó inalcanzable desde la UI — el comentario del código no calza con los tabs reales**
`docs/index.html:1534-1544` — el comentario dice que "Insumos" sería la
tercera pestaña de Atenciones, pero el `.at-tabs` real solo tiene 2 botones
(`atenciones`, `agenda`). Consecuencia directa de C1: la sección sigue en el
DOM, su script sigue cargado, pero no hay ruta de UI hacia ella.

**C3. [MEDIO] `telemetry.js`: `SESSION_KEY` no se migró, aunque `DB_NAME` sí (mismo archivo, fix a medias)**
`docs/telemetry.js:40` — `DB_NAME` se corrigió a `c123_telemetry_db` con
comentario "FIX JFC 2026-08-20" en la línea de arriba, pero
`SESSION_KEY = "amg_session_id_v1"` no se tocó. Como `sessionStorage` se
comparte por origen (no por ruta) entre las 3 apps en GitHub Pages, un
usuario que navega entre AMIGABLE/friendly-123/Consultorio-123 en la misma
pestaña arrastra el mismo `sessionId` de telemetría entre las tres.

**C4. [BAJO] `geo-ping.js`: mismo patrón que C3 — `CONSENT_KEY` sin migrar**
`docs/geo-ping.js:47` — `DB_NAME` sí migrado a `c123_geo_db`, pero
`CONSENT_KEY = "amg_geo_consentidos_v1"` sigue compartido. Un consentimiento
de geolocalización otorgado en una app hermana se lee como ya otorgado acá.

**C5. [BAJO] IDs `np-*` duplicados en dos formularios — riesgo introducido HOY por la reorganización de Atenciones**
`docs/index.html` ~3775 y ~4020 — 13 IDs compartidos entre el formulario de
"Vender"/Atenciones y el de alta de Inventario. Hoy no coexisten visibles a
la vez, pero es el mismo patrón que ya causó un bug real esta sesión
(Insumos con `display:none` por el tab wrapper) — si un cambio futuro los deja
visibles juntos, `getElementById` empieza a devolver el nodo equivocado en
silencio.

### Las 3 apps

**14. [BAJO] `SALT_FIJO` del relay sigue diciendo `"amigable-sync-v1"` en las 3 apps**
Nomenclatura, no funcionalidad — `RELAY_URL` ya es específico por app así
que las salas no chocan. Se corrige por prolijidad, no por urgencia.

---

## Guards/autocuraciones/verificaciones nuevas propuestas

### G1 — Autodiagnóstico de orden de carga de `aislamiento.js` (cierra F3, protege C3/C4/A1 hacia adelante)
Igual que el canario de `localStorage`/IndexedDB que ya existe en
Consultorio-123 (instalado hoy), portar el mismo canario a AMIGABLE y
friendly-123: al cargar, cada app verifica que su propio shim de aislamiento
tomó (`window.AMG.Aislamiento.instalado` e `idbInstalado`) y si no, banner +
`console.error` fuerte en vez de fallar en silencio. Esto es lo que habría
detectado C3/C4 automáticamente si `aislamiento.js` cubriera `sessionStorage`
además de `localStorage`/IndexedDB — extenderlo para incluir `sessionStorage`
en las 3 apps de una vez.
**Comprobación:** simular carga de `sessionStorage`/IndexedDB antes de que
`aislamiento.js` corra (reordenar el `<script>` a mano en una copia local),
confirmar que el banner de error aparece.

### G2 — Barrido automático de claves sin prefijo de app, como parte de `check-sw.sh`
Agregar a `check-sw.sh` (las 3 apps) un chequeo que corra
`grep -roE '"(amigable|f123|c123|amg)_[a-z_]+"' docs/*.js` y falle (exit 1)
si aparece un prefijo que NO es el de la app actual — el mismo grep que usan
los agentes hoy, pero como gate automático en cada verificación, no solo
cuando alguien se acuerda de correrlo a mano. Habría atrapado C3/C4/14 antes
de commitear.
**Comprobación:** meter a mano una clave `"f123_test"` en un `.js` de
AMIGABLE, correr `check-sw.sh`, confirmar que falla con el nombre del archivo
y la línea.

### G3 — Panel de soporte único: unificar las dos cajas negras de AMIGABLE (cierra A1/A5)
Fusionar `cajaNegraErrores` (línea 5906) dentro de la que ya lee el panel
(línea 6497, clave `oc_errores`) — una sola función, una sola clave, sin
perder ningún capturador de evento existente.
**Comprobación:** forzar un error de `version.json` (renombrarlo temporal),
confirmar que aparece en el panel de Soporte técnico.

### G4 — Verificación de rutas de nav huérfanas, como parte de `check-sw.sh`
Extraer todos los `data-vista`/`data-at-tab` del `<nav>`/`.at-tabs` de
`index.html` y confirmar que cada uno tiene su `id="vista-*"`/
`id="at-tabpanel-*"` correspondiente, Y viceversa (toda sección `vista-*`
tiene un botón que la alcance) — así no vuelve a pasar lo de C1/C2 (sección
viva sin ruta de UI) ni el bug histórico `data-vista="vista-perchas"`.
**Comprobación:** quitar a mano un botón de nav dejando su sección huérfana,
correr el chequeo, confirmar que lo señala.

### G5 — `window.OCApagado` con auto-verificación de uso (cierra A2)
En vez de solo documentar el kill-switch, agregar un `console.warn` en el
propio `feature-gate.js` si tras 3 segundos de carga ningún feature se
registró como "vigilado" (`OCApagado` nunca se llamó) — aviso de que el
mecanismo está montado pero nadie lo está usando, en vez de fallar en
silencio como hoy.
**Comprobación:** cargar la app sin ninguna llamada a `OCApagado`, confirmar
el warning en consola.

---

## Qué NO entra

- **F1/F2/A4 no incluyen la traducción en sí** (pasar los strings por `t()`
  y agregar las claves a `i18n.js`) — es la corrección quirúrgica correcta,
  pero se hace en la ejecución del plan, no es un mecanismo nuevo de
  autocuración; se lista como bug a arreglar, no como guard.
- **G2 no bloquea el commit** (no hay pre-commit hook en estos repos) — corre
  como parte de `check-sw.sh`, que ya es el gate manual-pero-obligatorio que
  se usa antes de cada push.
- **No se toca `SALT_FIJO` compartido (#14) con urgencia** — es cosmético,
  entra en el mismo PR que el resto por prolijidad, no amerita su propio
  ciclo.
- **No se reabre la pregunta de si `vista-perchas`/Salas vuelve al nav** — JFC
  ya decidió que no; C1/C2 son sobre limpiar el código muerto/huérfano que
  quedó de esa decisión, no sobre revertirla.

---

## Orden recomendado de ejecución

1. **C1 + C2** (Consultorio-123, producción, código muerto activo + sección
   huérfana) — mismo commit, se corrigen juntos.
2. **A1 + A5 + G3** (AMIGABLE: unificar las cajas negras — el fix bueno de A1
   ES G3, se hacen en el mismo paso).
3. **C3 + C4** (Consultorio-123: cerrar los dos fixes a medias de la sesión
   anterior).
4. **G1** (portar el canario de aislamiento a las 3 apps, extendido a
   sessionStorage) — antes de G2, porque G2 depende de que el criterio de
   "qué clave es de quién" esté ya limpio.
5. **G2 + G4** (los dos gates nuevos en `check-sw.sh`, las 3 apps) — se
   agregan juntos porque tocan el mismo script.
6. **F1 + F2 + A4** (las 3 traducciones/hardcodeos de idioma pendientes).
7. **A2 + A3 + G5** (AMIGABLE: kill-switch sin uso + placeholder de
   licencia — bajo riesgo, en el mismo PR).
8. **C5 + #14** (bajo riesgo, alto volumen — un solo PR final con lo que
   quede).
