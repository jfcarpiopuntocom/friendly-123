# Plan — Auditoría de mis cambios de 24h (v281→v285 + relay) y arreglo de microerrores
Fecha: 2026-09-16 · friendly-123 · Autor: Claude (para JFC)

Alcance auditado: `docs/sync-yjs.js` (persistencia op/pull), `docs/mock-backend.js`
(migración a un cuaderno + `nombreNegocioTs`), `cloudflare-sync-relay/worker.js`
(hibernación), y el proceso de versionado v281→v285.

Regla: NO romper lo que ya quedó bien (relay desplegado + convergencia async
verificada E2E). Estos son arreglos de robustez/costo/limpieza, no un rediseño.

## Microerrores hallados (ordenados por riesgo)

### A. Riesgo de DATOS / correctitud
1. **Op-log sin compactar: un aparato NUEVO puede perder las perchas/productos más
   viejos.** El relay guarda ops hasta 8000 y luego poda las MÁS VIEJAS. Sin
   checkpoint que las resuma, un dispositivo que se une por primera vez a un negocio
   con historia larga recibe solo las últimas 8000 ops → le faltan creaciones
   viejas. (sync-yjs.js: nunca se manda `{k:ckpt}`.)
   → FIX: en el canal CATÁLOGO, mandar `{k:ckpt}` periódico con el estado completo
   (`Y.encodeStateAsUpdate(doc)` cifrado), SOLO después de que el pull inicial
   terminó (para que el ckpt sea completo). El relay ya lo guarda y poda ops
   `lam <= ckpt` de forma segura (C1 guard ya existe).
   Verif: crear >20 productos en A en sesiones separadas; en B nuevo, `pull` y
   contar `productos` == total. Y `SELECT COUNT(*) FROM ckpt` = 1 en la sala.

2. **Desempate de nombre por `Date.now()` es vulnerable a reloj desfasado.** Dos
   aparatos-dueño con relojes distintos: el de reloj adelantado gana el nombre
   aunque haya renombrado ANTES en tiempo real. (mock-backend.js `nombreNegocioTs`.)
   → FIX: añadir un contador monotónico persistido `nombreNegocioRev` (sube +1 por
   rename local) y desempatar por `(rev, ts)`. Mantener ts solo como desempate
   secundario. Barato y determinista.
   Verif: simular rev A=2/ts viejo vs rev B=1/ts nuevo → gana A (rev mayor).

3. **La migración, en EMPATE de #productos, elige el cuaderno base de forma no
   determinista** (primer sufijo que enumera `localStorage`), y con él conserva SU
   log financiero. Podría quedarse con el log de ventas equivocado.
   → FIX: desempatar el ganador por (más productos, luego más `ventas+movimientos`,
   luego mayor `_rev`). Determinista y conserva el historial financiero más completo.
   Verif: sim con 2 buffers de igual #productos y distinto #ventas → gana el de más
   ventas.

4. **La migración escribe el cuaderno consolidado en `_A` (ptr A) pero deja `_B`
   viejo con posible `_rev` mayor.** Si un flujo posterior leyera `_B`, ganaría
   estado viejo.
   → FIX: tras escribir `_A`, sobrescribir también `_B` con el mismo cuerpo
   consolidado (o borrar `_B`), para que ningún buffer viejo pueda ganar.
   Verif: tras migrar, `_A` y `_B` tienen el mismo `_rev` (el consolidado).

### B. Costo / quema de Workers (lo que más te dolió)
5. **`pull` desde `lam:0` en CADA reconexión reenvía TODO el op-log cada vez** →
   ancho de banda, tiempo activo del DO y CPU de descifrado desperdiciados.
   → FIX: persistir el `lam` más alto aplicado por sala en localStorage y pedir
   `{k:pull, lam:<último>}`. Con el ckpt (#1), el catch-up queda mínimo.
   Verif: 2ª conexión a una sala con N ops recibe 0 (o solo lo nuevo), no N.

6. **`enviarUpdate` persiste CADA update local como su propia op (sin agrupar).**
   Un editor activo genera decenas de ops → bloat del log + muchas requests al DO.
   → FIX: coalescer: acumular updates ~500 ms y mandar UNA op (o un
   `encodeStateAsUpdate` del diff). Menos ops, menos requests, mismo resultado.
   Verif: crear 5 productos seguidos genera 1 op (no 5) en la sala.

7. **Fotos: cada blob se persiste como op y NO se puede compactar** (el estado
   completo de fotos supera el frame de 256 KB). El log de fotos puede inflarse.
   → FIX: en el canal FOTOS no mandar ckpt (documentado), pero deduplicar por hash
   (ya son content-addressed) y NO re-persistir un hash ya guardado. Además guard
   de tamaño (#8).
   Verif: publicar la misma foto 2 veces genera 1 sola op.

8. **El cliente puede mandar una op > 256 KB → el relay cierra el socket (1009) →
   tormenta de reconexión.** No hay guard de tamaño en `enviarUpdate`.
   → FIX: si el frame cifrado supera ~250 KB, no mandarlo como op única (dejar que
   el chunking del catálogo/foto lo cubra) y avisar en consola.
   Verif: un update artificialmente grande no dispara cierre 1009 (log en su lugar).

### C. Relay (introducido con la hibernación)
9. **`webSocketClose` reenvía el `code` entrante a `servidor.close(code, reason)`;
   códigos reservados (1005/1006) LANZAN excepción al pasarse a `close()`** — el
   cierre limpio no ocurre (lo traga el try/catch). (worker.js:181)
   → FIX: `servidor.close(1000)` sin reenviar el código entrante (o no re-cerrar).
   Verif: `node --check` + una desconexión abrupta no deja el socket colgado.

10. **En cada conexión el cliente manda hello(tag1) Y pull → el estado puede llegar
    DOS veces** (vivo + persistido). Idempotente en Yjs, pero dobla tráfico.
    → FIX: mantener hello solo para presencia viva; para catch-up de estado confiar
    en pull. Bajo impacto; se aplica junto con #5.
    Verif: contar mensajes recibidos en una conexión con 1 peer vivo: no duplica.

### D. Proceso (tu queja de fondo)
11. **Churn de versiones v281→v285 en ráfaga**, cada una forzando recarga del shell
    → tormenta de reconexiones que quemó `duration` (justo lo que luego arreglé).
    Y "listo/verificado" dicho antes de comprobar.
    → FIX (proceso, va en CLAUDE.md/memoria): agrupar arreglos en UN solo bump de
    shell; verificar E2E ANTES de cantar victoria; no subir shell para experimentos.
    Verif: este plan se ejecuta en UN bump (v286), no cinco.

## Orden de ejecución
1 → 3 → 4 → 2 (datos) · luego 9 (relay, redeploy) · luego 5 → 6 → 7 → 8 → 10
(costo, un bump de cliente) · 11 es proceso (sin código, va a memoria/CLAUDE.md).

## Qué NO entra
- NO tocar la lógica de convergencia que ya quedó verificada (sembrar/aplicar,
  aplicarCatalogo add-only, la migración base). Solo se endurece.
- NO retirar el sync viejo todavía (orden previa de JFC).
- NO homologar a amigable/consultorio hasta que friendly quede sólido y probado
  con los 2 aparatos reales.
- NO Loyverse, NO PocketBase durable ahora.
- NO tocar color de iconos, NO botones nuevos, NO tocar data de clientes.

## Entrega
- Datos (1-4) + relay (9): 1 redeploy de relay + verificación E2E.
- Costo (5-8,10): 1 bump de cliente (v286) con verificación E2E de convergencia
  Y de que el pull no reenvía todo.
- Proceso (11): 2 líneas en memoria + CLAUDE.md.
Todo verificado con simulación node + prueba E2E contra el relay antes de decir
"listo".
