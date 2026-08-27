# Nota de trabajo — Capa de redundancia del sistema de sync (2026-08-27)

## Qué se cambió
Se agregó una capa de REDUNDANCIA al sistema de sync/team, ADITIVA y de mínimo
toque: no se tocó la lógica de sync existente, solo se añadieron hooks de una
línea que llaman al nuevo subsistema (removibles).

## Archivos
- **NUEVO `docs/sync-watchdog.js`** — el subsistema completo (IIFE autocontenido,
  expone `window.OCSyncWatchdog`). 3 capacidades:
  - **A) Snapshot local**: guarda periódicamente (cada 5 min + al cambiar
    catálogo/equipo/checkpoint) una foto completa (perchas, productos+stock,
    equipo+PIN+rol+rev, clientes, nombre) en IndexedDB (`f123_sync_watchdog`),
    independiente del relay. Si el relay cae, el dato sigue siendo durable.
  - **B) Verificador de consistencia**: cada 60s compara la huella de cada par
    (`f123_micelio_vistos`) con la propia; si un par diverge ≥2 checks
    consecutivos (anti-falsos positivos), el aparato de mayor rol hace un
    re-sync seguro (resincronizar + pedirCatalogo), nunca un merge a ciegas.
  - **C) Snapshot entre pares**: un aparato rezagado pide un snapshot completo
    (catálogo + equipo + clientes + STOCK) a un par conectado, por mensajes
    efímeros (`__snapshot_pedido__`/`__snapshot_trozo__`), troceado a ~200KB.
    Se aplica con `aplicarCheckpoint` (add-only + guarda de frescura), así que
    NUNCA pisa datos existentes.
- **`docs/sync-realtime.js`** — 5 hooks aditivos (removibles en una línea):
  2 constantes `TIPO_SNAPSHOT_*`, 2 handlers en `ws.onmessage` que delegan al
  watchdog, y el método `OCSyncControl.enviarMensaje()` (envío genérico cifrado
  de mensajes efímeros).
- **`docs/index.html`** — 1 línea: `<script src="./sync-watchdog.js">` tras
  sync-realtime.js.
- **`docs/sw.js`** — shell bump a `f123-shell-v122` + `./sync-watchdog.js` en la
  lista del shell.
- **`docs/version.json`** — shell a `f123-shell-v122`.
- **NUEVO `.claude/harness-watchdog.cjs`** + **`.claude/test-todo.sh`** — paso 8
  de la compuerta (11 comprobaciones).

## Por qué
El sync existente es sólido pero tiene puntos únicos de fallo: el checkpoint
vive solo en el relay, la divergencia se muestra pero no se actúa, y el log de
ops tiene tope 500. Esta capa cubre esos huecos SIN tocar lo que funciona.

## Prioridad de datos
Perchas, PIN, roles, inventario, clientela = prioridad (todo cubierto). FOTOS =
secundarias, FUERA de esta capa (fase 2, extensión del snapshot store).

## Cómo se verificó
- `node --check` en todos los .js: OK.
- Compuerta completa `test-todo.sh`: **TODO VERDE (8/8)**, incluido el nuevo
  harness-watchdog (11 comprobaciones: snapshot local, merge add-only sin pisar,
  acumulación por trozos, detección de divergencia, sin errores de página).

## Cómo se quita (si hiciera falta)
Borrar `docs/sync-watchdog.js`, su `<script>` en index.html, los 5 hooks de
sync-realtime.js, el harness y el paso 8 de test-todo.sh. Revertir sw.js/
version.json a v121. Nada más.

## Respaldo
- Rama git: `backup/20260827-112801-antes-sync-watchdog`
- Copia: `C:\00 Projects\sandbox\_backups\friendly-123-20260827-112801-antes-sync-watchdog` (con CHECKSUMS.sha256)
