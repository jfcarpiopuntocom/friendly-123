# PLAN — Port friendly-123 → amigable-123 (regla hipocrática)

**Fecha:** 2026-09-03 · **Estado:** SOLO PLAN. No se toca amigable todavía. ·
Orquestado por `PLAN-MAESTRO-PERT-PORTS-2026-09-03.md` (nodos D→H).

> **Regla hipocrática (la más alta aquí):** amigable es PRODUCCIÓN en español con
> dueños de licencia `AMG-` ya activos. **Ante todo, no matar al paciente.** Ningún
> cambio puede capar, bloquear ni degradar a una instancia activada. Tweaks al
> margen, aditivos, módulo por módulo. Ante la duda: no se hace, se pregunta.

---

## 1. Naturaleza del port

amigable y friendly comparten modelo (unidad = **la percha**, PIN 3 dígitos, español
nativo). friendly va adelante en varios sistemas (CLAUDE.md). Este port **nivela**
amigable con el delta bueno y probado de friendly, **sin** reescribir nada que
amigable ya tenga funcionando ni asumir que friendly gana en todo.

**friendly está en inglés (`i18n.js`); amigable es español nativo.** Al portar UI se
lleva la **lógica**, y el **texto** se deja en el español propio de amigable (no se
le mete el toggle EN/ES ni claves inglesas salvo que amigable ya use i18n).

---

## 2. Método de injerto (obligatorio, por cada módulo)

1. **Foto:** `bash .claude/snapshot.sh "antes-port-<modulo>"` en amigable (rama
   fechada + tar fuera del repo + sha256). REGLA 1.
2. **Comparar antes de tocar:** `stat -c%s` en ambos + `diff` dirigido. Si amigable
   va adelante en ese módulo → **no se pisa**; se anota y se salta.
3. **Injertar el cambio, no el archivo.** Nunca `cp` de friendly a amigable
   (REGLA 1b). Se lleva la función/bloque, adaptando nombres y textos al español.
4. **Verificar dependencias:** listar claves `localStorage` y rutas `/api/*` que el
   bloque portado usa; confirmar que TODAS existen en amigable (vacuna anti-error #4
   del plan maestro).
5. **Compuerta:** `node --check`/`check-inline` → `guards.sh` → `test-todo.sh` VERDE.
6. **Nota + bitácora + DIARIO.** Push en batch ligero.

---

## 3. Cola de injertos (orden sugerido, de menor a mayor riesgo)

### Bloque 0 — la vacuna idiomARTE (PRIMERO, crítico)
- `estaLicenciado()` fail-open y su uso en los gates de plan gratis.
- **Verificación explícita:** instancia con `instanceId`/licencia **nunca** ve el
  tope del plan gratis (test dedicado). Esto es Prime Directive 1A; va primero
  porque es la protección misma que este port no puede violar.

### Bloque 1 — infra de integridad (fail-safes, prioridad REGLA-PRIORIDADES #2)
- Failsafes FASE 2: dedup `_opsAplicadas` 2000, cola offline tope 1000 +
  `f123/amg_sync_cola_desbordada`, poda de micelio >24h.
- Watchdog de sync, reconciliación, backup autoverificado (`avanzado-extra.js`),
  `respaldo-empleado.js`, `storage-durabilidad.js`, `audit-store.js`.
- `crypto-store.js` (si amigable va atrás): cifrado en reposo.
- **Verificar:** los harnesses `harness-*.cjs` pasan en amigable con las claves
  namespaceadas a `amg`/legacy correctas (propiedad de seguridad: sin marcador de
  tienda activa, byte-idéntico a antes).

### Bloque 2 — negocio aditivo
- Cartera/abono con expiración (`cartera.js`+`hechos.js`): crédito ligado a ítem +
  fecha de expiración. Texto español.
- `borradores.js` fix categorías (renombrar PUT→PATCH) — reemplaza en vez de sumar.
- Edición/cancelación de venta **por encargado** con tracking usuario+rol+dispositivo
  (defensa = el log, no capar). Corrige "me jalé en el precio y vendí mal".
- Ferias/eventos + **lista de eventos archivados** con acceso a su liquidación.

### Bloque 3 — UX de pulido (solo si amigable no lo tiene ya)
- Lápiz único + naranja de precaución; paleta del dinero (verde crédito / rojo deuda);
  fechas locale; "Type to search"; impresora con palabra "print"; pulldowns
  (edad/país/personas en reserva).
- **NO** portar el toggle EN/ES a amigable (es monolingüe español) salvo que JFC lo
  pida.

---

## 4. Lo que NO se porta (o se porta con cuidado)
- Nada que amigable ya tenga adelante (se detecta con `diff`, no se asume).
- La `caja-chica.js` fue **removida intencionalmente** de friendly; no re-introducir
  en amigable si allá también se decidió quitar — confirmar con JFC.
- Textos/claves en inglés: la lógica sí, el texto se queda español.

---

## 5. Cierre (nodo H)
- `verificar-ui` (con OK de JFC) sobre candado, cards de inventario, "unirse al equipo".
- Bump de **shell Y version** en amigable; regen manifest.
- Snapshot final → commit → push → PR draft → merge cuando **verde y comprobado**
  (REGLA 2d). Notas en `docs/NOTA-*`, bitácora y DIARIO.

## 6. Preguntas abiertas para JFC (no bloquean el plan, sí la ejecución)
1. ¿amigable ya usa `i18n.js` o es español hardcodeado? (define cuánto texto se toca).
2. ¿`caja-chica` se quedó o se quitó en amigable?
3. ¿Hay algún módulo donde amigable vaya adelante que debamos preservar sí o sí?
