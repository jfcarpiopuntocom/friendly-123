# NOTA — Fix C1/C2 de integridad del sync (2026-08-27)

Auditoría del sync/team/Advanced (3 semanas de trabajo, "no está tip top").
Se corrigieron los 2 hallazgos CRÍTICOS de integridad del relay. El resto de
hallazgos (A1–A5, M1–M5) quedan documentados en el informe de auditoría y
pendientes de decisión.

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
- `check-sw.sh`: shell `f123-shell-v123` coincide en sw.js y version.json.
- Guard preexistente en rojo (NO causado por este cambio): `c123_` en
  `aislamiento_2026-08-15_04-15.js` (archivo de backup fechado).

## Pendiente (de la auditoría, NO tocado)

- A1 doble motor de sync con dedup por IDs distintos; A2 `/api/sync/push|pull`
  inertes en local; A3 race en merge multi-dispositivo; A4 `activar()` vs
  `unirse()`; A5 `reconciliar` no cambia namespace de tienda.
- M1 `LOG_TOPE(500) < COLA_TOPE(1000)`; M2 `reproducir()` corrompe bodies no-JSON;
  M3 sync-queue marca synced en dry-run; M4 sync-outbox sin reintento; M5 vista
  Advanced accesible a cualquier rol.
- m1 precio de venta remota usa precio actual; m2 huella no incluye stock.

## Respaldo (REGLA 1)

Rama git: `backup/20260827-123219-antes-fix-C1C2-relay`
Copia + checksums: `C:\00 Projects\sandbox\_backups\friendly-123-20260827-123219-antes-fix-C1C2-relay`
