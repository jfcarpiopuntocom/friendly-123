# Nota de trabajo — Fail-safes de integridad del sync (FASE 2, 2026-08-27)

## Qué se cambió
Fortalecimiento del sync/team con 3 fail-safes de integridad de datos, todos
ADITIVOS y de mínimo toque. No se tocó la lógica de sync existente: se subieron
topes, se añadió una marca de desborde y una poda de higiene.

## Archivos
- **`docs/mock-backend.js`** — dedup `_opsAplicadas` (set de opIds ya aplicados):
  tope subido de **500 → 2000**. Antes, si un opId se evictaba del set y el par
  lo reenviaba (catch-up), un delta de stock se aplicaba DOS veces (doble
  conteo). Con 2000 la evicción es rarísima; el vector de catch-up (desde el log
  de ops) ya evita reenviar lo que el par conoce, así que este set es la última
  red.
- **`docs/sync-realtime.js`** — cola offline `COLA_KEY` (`guardarCola`): tope
  subido de **200 → 1000** y, si se desborda, en vez de descartar en silencio
  (movimientos de stock perdidos sin aviso) se deja una marca
  `f123_sync_cola_desbordada` con el tamaño. Nunca se pierde stock en silencio.
- **`docs/sync-watchdog.js`** — nueva función `colaDesbordada()` y campo
  `colaDesbordada` en `estado()`, para que una sesión o el tablero puedan avisar
  del desborde de la cola offline.
- **`docs/micelio-vivo.js`** — poda de `f123_micelio_vistos`: los aparatos
  callados más de **24h** (`PODA_MS`) se consideran dados de baja y se quitan al
  leer (`podarEquipo()` llamado desde `equipo()`). Nunca poda mi propio id. Antes
  un aparato dado de baja quedaba "a ciegas" para siempre y el verificador del
  watchdog perseguía fantasmas.
- **NUEVO `.claude/harness-failsafe.cjs`** + **`.claude/test-todo.sh`** — paso 9
  de la compuerta (11 comprobaciones).
- **`docs/sw.js`** — shell bump a `f123-shell-v123`.
- **`docs/version.json`** — shell a `f123-shell-v123`.

## Por qué
El sync es sólido pero tenía dos fallas de integridad silenciosas: el dedup con
tope 500 podía doblar un delta de stock, y la cola offline con tope 200 descartaba
movimientos en silencio. Además el registro del micelio acumulaba fantasmas.

## Documentado, NO se cambió (por diseño)
- **SPOF-5**: el checkpoint NO lleva ventas — es deliberado. Las ventas son el
  log irremplazable por caja; el checkpoint es add-only para aparato fresco y
  meterle ventas arriesgaría corromper el historial. Las ventas viajan por el
  stream de ops en vivo.
- **SPOF-7** (WebRTC P2P) y **SPOF-8** (fotos) — futuros, fuera de esta fase.

## Cómo se verificó
- `node --check` en todos los .js: OK.
- Compuerta completa `test-todo.sh`: **TODO VERDE (9/9)**, incluido el nuevo
  harness-failsafe (11 comprobaciones: dedup no dobla stock, marca de desborde
  visible en el watchdog, poda de micelio conservando mi id y los frescos, topes
  estáticos en el código, sin errores de página).

## Cómo se quita (si hiciera falta)
Revertir los topes en mock-backend.js y sync-realtime.js, quitar la marca de
desborde y la poda de micelio, quitar `colaDesbordada()` del watchdog, borrar el
harness y el paso 9 de test-todo.sh. Revertir sw.js/version.json a v122. Nada más.

## Respaldo
- Rama git: `backup/20260827-115030-antes-fase2-sync-fortificar`
- Copia: `C:\00 Projects\sandbox\_backups\friendly-123-20260827-115030-antes-fase2-sync-fortificar` (con CHECKSUMS.sha256)
