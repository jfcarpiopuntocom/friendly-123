# NOTA — Fix C1/C2/A4/A5 de integridad del sync (2026-08-27)

Auditoría del sync/team/Advanced (3 semanas de trabajo, "no está tip top").
Se corrigieron los 2 hallazgos CRÍTICOS de integridad del relay (C1/C2) y los
2 bugs de Advanced/team sync (A4/A5). El resto de hallazgos (A1, A3, M1–M5)
quedan documentados en el informe de auditoría y pendientes de decisión.

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
- `check-sw.sh`: shell `f123-shell-v125` coincide en sw.js y version.json.
- Guard preexistente en rojo (NO causado por este cambio): `c123_` en
  `aislamiento_2026-08-15_04-15.js` (archivo de backup fechado).

## Pendiente (de la auditoría, NO tocado)

- A1 doble motor de sync con dedup por IDs distintos; A2 `/api/sync/push|pull`
  inertes en local; A3 race en merge multi-dispositivo.
- M1 `LOG_TOPE(500) < COLA_TOPE(1000)`; M2 `reproducir()` corrompe bodies no-JSON;
  M3 sync-queue marca synced en dry-run; M4 sync-outbox sin reintento; M5 vista
  Advanced accesible a cualquier rol.
- m1 precio de venta remota usa precio actual; m2 huella no incluye stock.

## Respaldo (REGLA 1)

Rama git: `backup/20260827-123219-antes-fix-C1C2-relay`
Copia + checksums: `C:\00 Projects\sandbox\_backups\friendly-123-20260827-123219-antes-fix-C1C2-relay`
