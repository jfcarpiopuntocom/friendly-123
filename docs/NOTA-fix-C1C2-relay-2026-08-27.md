# NOTA — Fix C1/C2/A4/A5 + Fase 2 de integridad del sync (2026-08-27)

Auditoría del sync/team/Advanced (3 semanas de trabajo, "no está tip top").
Se corrigieron los 2 hallazgos CRÍTICOS de integridad del relay (C1/C2), los
2 bugs de Advanced/team sync (A4/A5) y la Fase 2 (A2, A3, M1–M5). Queda
pendiente solo A1 (doble motor de sync) y las observaciones menores m1/m2.

## C1 — El relay sobreescribía el checkpoint con uno rancio (pérdida de stock)

**Archivo:** `cloudflare-sync-relay/worker.js` → `_guardarCkpt`.

**Bug:** `INSERT ... ON CONFLICT DO UPDATE` sobreescribía `ckpt/latest` sin
comparar lamport, y luego `DELETE FROM ops WHERE lam <= ?` podaba ops. Todo
dispositivo que reconecta sube un checkpoint a los ~1,5 s. Si ese aparato estaba
atrasado, pisaba el checkpoint bueno del relay con su estado rancio. Como el
checkpoint bueno ya había podado las ops, un dispositivo nuevo que hacía `pull`
recibía el estado rancio y perdía las ops intermedias → stock/ventas incompletas
sin forma de recuperarlas.

**Fix:** solo se acepta el checkpoint entrante si su lamport es `>=` al guardado
(igual se deja pasar: último en subir gana). Mayor lamport = estado más completo.

## C2 — El lamport del checkpoint se inflaba con ops que NO se aplicaron

**Archivo:** `docs/sync-realtime.js`.

**Bug:** `mergeLamport(op.lamport)` corre para TODA op descifrada (latidos,
pedidos de catch-up, trozos de foto, órdenes, checkpoints, snapshots) ANTES de
los type-checks. `subirCheckpoint` usaba `lamportActual()` (el contador global
inflado) como lam del checkpoint. El relay poda `ops WHERE lam <= checkpoint.lam`,
así que un lamport inflado hacía que el relay borrara ops que un par aún
necesitaba → deltas de stock perdidos en un dispositivo nuevo.

**Fix:** nuevo contador `_lamportAplicadoMax` que solo sube con ops de negocio
reales (las que pasan por `registrarEnLog`, locales y remotas, que SÍ quedan en
el estado). Se inicializa desde el log persistido (`f123_sync_log`) para reflejar
sesiones anteriores. Ser un límite inferior es seguro: nunca sobre-poda.
`subirCheckpoint` ahora usa `_lamportAplicadoMax || lamportActual()`.

## A4 — El botón "Join this notebook" de Advanced usaba activar() en vez de unirse()

**Archivo:** `docs/avanzado-extra.js` → botón `oc-sync-unirme`.

**Bug:** usaba `OCSyncControl.activar(cod)`, que solo guarda la sala y conecta.
El aparato sincronizaba a la sala correcta pero NO adoptaba la licencia ni
cambiaba de tienda → quedaba "partido" (identidad demo/otra, datos en el
namespace viejo). No contaba como device del negocio en el panel de licencias.

**Fix:** usa `OCSyncControl.unirse(cod)`, el flujo de equipo completo: marca
`instanceId` (sale de demo), fija `licenseCode` (cuenta como device) y cambia de
tienda vía `OCTienda.cambiar()`. Si cambia de tienda, `cambiar()` recarga (el
código posterior no se ejecuta, correcto). Si ya estás en esa tienda
(`mismo:true`), no recarga y se muestra el aviso de re-sync.

## A5 — reconciliar() (claim/merge) no alineaba el namespace de tienda

**Archivo:** `docs/mock-backend.js` → `OCTienda.reconciliar` y `OCTienda.cambiar`.

**Bug:** `reconciliar()` fijaba `licenseCode`/`syncCode` y la sala de sync, pero
no tocaba `f123_tienda_activa`. Un aparato en un namespace unido viejo que hacía
claim a la canónica quedaba "partido": identidad canónica pero tienda activa
vieja → el merge posterior aterrizaba en el namespace equivocado.

**Fix:** `reconciliar()` ahora llama a `OCTienda.cambiar(norm, { sinRecargar: true })`,
que registra la tienda actual, flushea sus datos bajo sus claves, apunta
`f123_tienda_activa` al namespace de la canónica y fija la sala. `cambiar()`
ganó la opción `sinRecargar` para no recargar aquí: el merge add-only ocurre en
memoria al reconectar, y recargar vaciaría el estado local que el merge debe
sumar. `unirse()` (que llama a `cambiar()`) no cambia de comportamiento.

## A2 — El push/pull automático apuntaba a un backend que no existe

**Archivo:** `docs/avanzado-extra.js` → `arrancarIntervalo`.

**Bug:** el intervalo (cada 4 min) y el listener "online" llamaban a
`push().then(pull)` contra `/api/sync/push|pull`, que el backend local NO
implementa (mock-backend.js devuelve 404). Trabajo inútil y falsa sensación de
redundancia.

**Fix:** `_comprobarSyncServer()` comprueba UNA vez si el servidor de sync
existe; si no, el automático se salta. El botón manual "Auto sync" sigue
intentando y mostrando el motivo. El relay WebSocket (licencia) es el camino
principal; el lazy sync es un respaldo manual (copiar/pegar).

## A3 — Race en el merge multi-dispositivo (preview prematuro)

**Archivo:** `docs/avanzado-extra.js` → handler `oc-catalogo-trozo`.

**Bug:** `piezas.esperados` se sobreescribía con el `deTotal` de cada trozo y
`piezas.vistos` contaba los trozos de TODOS los dispositivos. Con 2+ aparatos
respondiendo, el preview se disparaba prematuro con datos mezclados/incompletos.

**Fix:** agrupar por `deviceId` (`piezas.porDev[dev] = { recibidos, total }`). El
preview espera a que TODOS los que respondieron hayan completado sus trozos. El
timeout de 9s ahora avisa si algún dispositivo no terminó. (El mismo patrón en
`_acumularCatalogo` de sync-realtime.js queda documentado: solo afecta al
auto-aplicar en dispositivo vacío, caso raro y no corrupto.)

## M1 — LOG_TOPE(500) < COLA_TOPE(1000)

**Archivo:** `docs/sync-realtime.js` → `LOG_TOPE`.

**Bug:** un aparato offline que generaba >500 ops perdía las más viejas del log
y no podía reenviarlas por catch-up a un par que también estuvo offline.

**Fix:** `LOG_TOPE = 1000` (>= COLA_TOPE). El log nunca pierde ops que la cola
aún tiene.

## M2 — reproducir() corrompía bodies no-JSON

**Archivo:** `docs/avanzado-extra.js` → `reproducir()`.

**Bug:** el interceptor guarda el body tal cual; si era un objeto JS o FormData,
al cifrar la cola (JSON.stringify) se corrompía y se reenviaba corrupto (el
backend lo degradaba a `{}`).

**Fix:** normalizar el body antes de reproducir: si es objeto se stringifica; si
es string no-JSON se salta la op (break) en vez de corromper el estado.

## M3 — sync-queue marcaba synced en dry-run

**Archivo:** `docs/sync-queue.js` → `flush()`.

**Bug:** en dry-run se llamaba a `markSynced()`, así que si luego se activaba el
transporte real, esa telemetría ya no se reenviaba (se perdía).

**Fix:** en dry-run NO se marca como synced (no consume la cola). Solo el envío
real marca.

## M4 — guardarColaCifrada no verificaba el retorno

**Archivo:** `docs/avanzado-extra.js` → `guardarColaCifrada()`.

**Bug:** se ignoraba el retorno de `OCOutbox.guardar()`/`localStorage.setItem`:
si el storage estaba lleno, la cola de cambios offline se perdía en silencio.

**Fix:** verificar el retorno; si no se pudo persistir, avisar (evento
`oc-sync-cola-perdida` + console.warn).

## M5 — Vista Advanced accesible a admin

**Archivo:** `docs/avanzado-extra.js` → panel de sync.

**Bug:** el botón "avanzado" se ocultaba para empleados (auth-ui.js) pero un
admin podía disparar acciones de sync SENSIBLES (rotar licencia, re-emitir
licencia, claim/merge, merge de inventario).

**Fix:** gate de dueño: para rol !== "dueno" se ocultan `oc-sync-rotar`,
`oc-sync-fixlic`, `oc-sync-claim`, `oc-sync-mergear`. El admin puede ver el
estado de sync y unirse, pero no rotar la licencia ni re-apuntar la identidad.

## Verificación

- `node --check` de todos los `docs/*.js` y del relay: OK.
- Compuerta: 5 harnesses de navegador TODO VERDE (team-sync, join-identity,
  claim-merge, watchdog, failsafe) + test-roster-merge OK.
- Tests enfocados nuevos (regresión):
  - `.claude/test-checkpoint-lamport.cjs` (C2): el checkpoint usa el lamport
    aplicado, no el inflado por latidos; dedup no sube el lamport; inicialización
    desde log persistido; límite inferior seguro.
  - `.claude/test-checkpoint-guard.cjs` (C1): un checkpoint rancio no pisa al
    bueno; igual lamport deja pasar (último gana); más nuevo siempre gana.
  - `.claude/test-claim-namespace.cjs` (A5): un aparato en un namespace unido
    viejo que hace claim a la canónica queda con `f123_tienda_activa` alineado a
    la canónica y sus datos sobreviven.
  - `.claude/test-join-button.cjs` (A4): el botón "Join this notebook" de
    Advanced llama a `unirse()` (no `activar()`).
  - `.claude/test-fase2-m1m2m3a3.cjs` (M1/M2/M3/A3): LOG_TOPE>=COLA_TOPE;
    reproducir normaliza body; dry-run no consume cola; merge agrupa por deviceId.
  - `.claude/test-fase2-m5a2.cjs` (M5/A2): gate de dueño presente; el intervalo
    solo push/pull si hay backend; /api/sync/pull devuelve 404.
- `check-sw.sh`: shell `f123-shell-v126` coincide en sw.js y version.json.
- Guard preexistente en rojo (NO causado por este cambio): `c123_` en
  `aislamiento_2026-08-15_04-15.js` (archivo de backup fechado).

## Pendiente (de la auditoría, NO tocado)

- A1 doble motor de sync con dedup por IDs distintos (op.id del lazy sync vs
  op.opId del relay). Riesgo bajo en la práctica tras el fix de A2: el lazy sync
  solo funciona por copiar/pegar manual explícito (el push/pull automático ya no
  intenta). Recomendación: no usar lazy sync y relay a la vez; o unificar el
  dedup en una fase futura.
- m1 precio de venta remota usa precio actual; m2 huella no incluye stock.

## Respaldo (REGLA 1)

Rama git: `backup/20260827-123219-antes-fix-C1C2-relay`
Copia + checksums: `C:\00 Projects\sandbox\_backups\friendly-123-20260827-123219-antes-fix-C1C2-relay`
