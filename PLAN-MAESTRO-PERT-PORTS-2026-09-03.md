# PLAN MAESTRO — Ports friendly-123 → amigable + consultorio (ruta PERT)

**Fecha:** 2026-09-03 · **Estado:** SOLO PLAN (`/make-plan`). No se toca código de
ninguna app todavía. · **Autor:** sesión Claude, proceso JFC.

Este archivo es la **ruta crítica (PERT)** que orquesta los dos ports. El detalle
por app está en:

- `PLAN-PORT-AMIGABLE-2026-09-03.md` — port puro, regla hipocrática (producción viva).
- `PLAN-PORT-CONSULTORIO-2026-09-03.md` — app distinta (centro contable), con menú
  propio definido tras research de necesidades reales de médicos/dentistas.

---

## 0. Por qué integrado y en esta secuencia

friendly-123 es el repo de testeo y **va adelante** (ver CLAUDE.md). Lo bueno y
probado aquí baja a las hermanas. Pero las dos hermanas son casos MUY distintos:

- **amigable** comparte linaje y modelo (unidad = la percha). El port es
  **injerto quirúrgico módulo por módulo** de lo que friendly tiene de más. Riesgo:
  romper producción en español (idiomARTE-equivalente). Regla hipocrática manda.
- **consultorio** NO es amigable para médicos. Es una app **contable/financiera**
  centrada en el paciente: abonos, planes de pago, cuentas por cobrar, recibos,
  visualización financiera fácil. NO lleva perchas, variantes, comisiones a
  asociados, eventos ni reposición. El port es **selectivo**: se lleva la
  **infraestructura** (worker, relay, sync, crypto, backup, i18n, dashboard, panel)
  y se **reescribe la capa de negocio** con vocabulario y menú médico.

**Secuencia racional:** primero amigable (menor incertidumbre, valida el método de
injerto y deja producción al día), luego consultorio (mayor incertidumbre: requiere
research + divergencia de modelo). El trabajo de **infraestructura común** que
consultorio necesita se **extrae y verifica en el port de amigable primero**, así
no se reinventa ni se arrastran los errores de estos días.

---

## 1. Inventario del "delta friendly" (lo nuevo/bueno a portar)

Fuente: módulos en `docs/` + notas de esta ventana. Se clasifica por si es
**infra** (sirve a las tres) o **negocio** (solo amigable; consultorio lo reescribe).

### Infra (candidata a las TRES apps)
- `crypto-store.js` (friendly +13 KB vs amigable) — cifrado en reposo.
- `mock-backend.js` — orden de sacrificio de espacio; dedup `_opsAplicadas` 2000;
  `estaLicenciado()` fail-open (Prime Directive 1A); tracking usuario+rol+dispositivo
  en `mov()`.
- `sync-realtime.js` / `sync-watchdog.js` / `sync-queue.js` / `sync-outbox.js` —
  cola offline tope 1000 + `f123_sync_cola_desbordada`; modelo multi-tienda
  (`OCTienda.cambiar` = switch, no merge).
- `micelio-vivo.js` / `micelio-ui.js` — descubrimiento de pares; poda >24h.
- `reconciliacion.js`, `backup-scheduler.js`, `respaldo-empleado.js`,
  `avanzado-extra.js` (respaldo autoverificado), `estado-idb.js`,
  `storage-durabilidad.js`, `audit-store.js`, `logger.js`, `telemetry.js`,
  `geo-ping.js`, `red-segura.js`, `aislamiento.js`, `device-identity.js`,
  `identity-context.js`, `email-recovery.js`.
- `i18n.js` (sistema completo `window.t`/`tf`, EN+ES) — para consultorio (ES) es la
  base de textos.
- Failsafes de integridad del sync (FASE 2, 2026-08-27): dedup no dobla stock, cola
  no pierde en silencio, poda de micelio.

### Negocio (solo amigable; consultorio NO lo lleva)
- `cartera.js` + `hechos.js` — crédito/abono ligado a ítem con expiración
  `[for:<item>][exp:...]`. **Concepto SÍ reutilizable en consultorio** pero
  re-anclado a *tratamiento/paciente*, no a ítem de inventario.
- `borradores.js` (`OCCategorias`) — categorías; fix renombrar PUT→PATCH (v1.7.87).
- `plan-pagos.js` + `plan-pagos-ui.js` — **núcleo directamente valioso para
  consultorio** (planes de pago / installments).
- `percha-reposicion.js`, `vista-perchas.js` — perchas. **NO a consultorio.**
- Comisiones/asociados (en `mock-backend.js` + `avanzado-extra.js`). **NO a
  consultorio.**
- `feature-gate.js`, edición/cancelación de venta por encargado con tracking,
  eventos/ferias + lista de archivados (v1.7.88). Eventos/ferias **NO a
  consultorio**; edición con tracking SÍ (como "corregir un cobro mal hecho").

### UI/UX de esta ventana (candidatas)
- Fix toggle EN/ES del candado (delegación en el gate).
- `estaLicenciado()` fail-open → **CRÍTICA para amigable** (fue el bug de idiomARTE).
- Lápiz único naranja de precaución; paleta del dinero; fechas locale.
- Cartera con expiración, edición de evento/comprador.

> **Regla de higiene del inventario:** antes de portar, para CADA módulo se corre
> `stat -c%s` en ambas apps y `diff` dirigido. **Nunca asumir que friendly va
> adelante** en todo (CLAUDE.md). Si amigable va adelante en algo, ESO no se pisa.

---

## 2. Ruta crítica PERT

Nodos = hitos; aristas = dependencias. `[Ln]` marca la **ruta crítica** (la más
larga; determina el tiempo total). Duraciones en "unidades de trabajo" (U), no horas,
para no alucinar tiempos.

```
        A ── B ── C ─────────────┐
       (infra base, en friendly)  │
                                   ▼
   [L] D ── E ── F ── G ── H       (amigable al día)
                          │
                          ▼
        I ── J ── K ── L ── M ── N (consultorio funcional)
```

| ID | Hito | Depende de | Dur (U) | Crítico |
|----|------|-----------|---------|---------|
| A | Congelar "delta friendly" verificado (inventario §1 con `stat`/`diff`) | — | 2 | sí |
| B | Extraer capa infra común a lista portable (qué módulos, qué claves LS, qué endpoints) | A | 2 | sí |
| C | Definir el **método de injerto** (snapshot destino → injerto módulo×módulo → guards → gate) y checklist anti-omisión | B | 1 | sí |
| D | **AMIGABLE**: snapshot + rama de respaldo fechada; auditar qué de A ya está y qué falta | C | 1 | sí |
| E | Injertar infra faltante en amigable (crypto/sync/failsafes/backup) módulo×módulo | D | 4 | sí |
| F | Injertar negocio faltante (cartera-expiración, categorías fix, edición con tracking, ferias-archivadas) | E | 3 | sí |
| G | `estaLicenciado()` fail-open + verificación explícita "instancia activada nunca ve tope" | F | 1 | sí |
| H | Gate verde (guards + node --check + check-sw + smokes + `verificar-ui` con OK de JFC) + version/shell bump + push + merge amigable | G | 2 | sí |
| I | **CONSULTORIO**: definir menú y subsecciones (§ plan consultorio, con research) | C | 2 | — |
| J | Snapshot + rama; llevar SOLO infra común (worker, relay, sync, crypto, backup, i18n-ES, dashboard, panel) | I, H | 3 | — |
| K | Reescribir capa de negocio: paciente, presupuesto, plan de pagos, cuenta por cobrar, recibo | J | 5 | — |
| L | Conectar dashboard + "mi panel" (maintenance/support: ve integridad, NO precios/datos personales — REGLA 7) | K | 2 | — |
| M | Worker + relay zero-knowledge probados end-to-end (dos aparatos, sin nube) | L | 2 | — |
| N | Gate verde consultorio + version/shell + push + merge | M | 2 | — |

**Ruta crítica:** A→B→C→D→E→F→G→H (= 16 U) y luego I→J→K→L→M→N cuelga de C y H.
El cuello de botella es **E/F/K** (los injertos grandes). Mitigación: batches
ligeros y pushes frecuentes (REGLA 2) para que, si se corta, quede lo más avanzado.

**Holgura:** I (definir menú consultorio) puede arrancar en paralelo apenas termina
C, sin esperar a amigable — es el único paralelismo real. Todo lo demás es serie por
la regla hipocrática (no tocar dos apps vivas a la vez sin validar el método).

---

## 3. Anti-omisiones (los errores de estos días, y su vacuna)

Cada regla nace de un fallo real de esta ventana:

1. **Editar a ciegas → romper UI.** Vacuna: `verificar-ui` (con OK de JFC) antes de
   cada merge que toque UI; screenshots de candado, cards, "Join my team".
2. **Portar por `cp` de archivo entero → borrar trabajo de la hermana** (REGLA 1b).
   Vacuna: injerto módulo×módulo; `diff` dirigido; rama de respaldo fechada en destino.
3. **Gate no corrido / corrido a medias.** Vacuna: `test-todo.sh` VERDE completo es
   condición de merge; los harnesses de navegador son lentos → correrlos en fondo,
   nunca saltárselos por tiempo.
4. **Clave/endpoint faltante al portar** (una función llama a algo que no existe →
   "se aumenta en vez de reemplazar" tipo v1.7.87). Vacuna: por cada módulo portado,
   listar sus claves LS y rutas `/api/*` y verificar que TODAS existan en el destino.
5. **Romper a un dueño activo** (idiomARTE, Prime Directive 1A). Vacuna: `estaLicenciado()`
   fail-open + test explícito "instancia con instanceId nunca cae al tope".
6. **Dejar sin pushear / esperar permiso de git** (REGLA 2d/2e). Vacuna: yo cierro
   el ciclo hasta merge; workshop-first cuando aplique.

---

## 4. Entregables de este `/make-plan`

- Este archivo (ruta PERT integrada).
- `PLAN-PORT-AMIGABLE-2026-09-03.md`.
- `PLAN-PORT-CONSULTORIO-2026-09-03.md`.

**Nada se ejecuta hasta que JFC apruebe el plan.** Cuando apruebe, se arranca por el
nodo A y se baja por la ruta crítica, con pushes en batches ligeros.
