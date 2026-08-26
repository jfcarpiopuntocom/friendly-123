# PLAN — 7 microbugs + 11 microrrefuerzos al multi-tienda
**Fecha:** 2026-08-26 · **Estado base:** multi-tienda YA está live (PR #37 mergeado a master, SW v97)

Este plan es sobre el sistema de cambio de tienda por licencia recién diseñado.
Los microbugs son defectos reales; los refuerzos son mejoras a aprobar (varios
resuelven pendientes viejos del apunte 2026-08-25).

---

## 7 MICROBUGS (defectos en lo recién diseñado)

| # | Sev | Defecto | Dónde |
|---|-----|---------|-------|
| MB-1 | MED | No hay forma en la UI de volver a la tienda propia sin re-teclear su licencia; salir de una tienda unida es difícil. | avanzado-extra.js (falta UI) |
| MB-2 | MED | `OCTienda.cambiar` recarga aunque la licencia tenga checksum inválido (guard laxo "guard, no puerta"): un typo te mete a una tienda-fantasma keyed por el error. | mock-backend.js / sync-realtime.js |
| MB-3 | LOW | `f123_owned` global no namespaceado: en tienda ajena, `companyId`/identity-context reporta la licencia propia, no la activa → identidad/telemetría mal etiquetada. | identity-context.js |
| MB-4 | LOW | El registro `f123_tiendas` no graba la tienda actual si no tiene licencia (demo): `if (licAct && ...)` → no podrías volver a ella. | mock-backend.js `OCTienda.cambiar` |
| MB-5 | LOW | Nombre de tienda en blanco tras unirse (`nombreNegocio=""`) → header vacío/confuso; no dice "esperando equipo". | mock-backend.js / index.html |
| MB-6 | LOW | `storage` event cross-pestaña usa `OC_STATE_PTR` fijado al cargar: dos pestañas en tiendas distintas pueden cruzarse. Edge. | mock-backend.js |
| MB-7 | LOW | Tras unirse a tienda vacía, `usuarios=[]`: los PIN del equipo no entran hasta que el otro aparato sincronice (correcto por diseño), pero sin aviso el usuario cree que "no sirve". Falta feedback. | avanzado-extra.js / auth-ui.js |

---

## 11 MICRORREFUERZOS (plan, a aprobar)

1. **Selector "Mis tiendas"** en Avanzado: lista `f123_tiendas`, tap para cambiar. No re-teclear licencias. (resuelve MB-1)
2. **Botón "Volver a mi tienda"** que cambia a sufijo `""` sin pedir la licencia propia. (resuelve MB-1)
3. **Confirmación antes de cambiar**: "Vas a entrar a la tienda X. La actual (Y) queda guardada." Evita switch por typo. (mitiga MB-2)
4. **Chip persistente de identidad de tienda activa** (nombre o cola de licencia). Resuelve el pendiente 2026-08-25 #1 "claridad de a qué tienda entras".
5. **Estado de tienda unida vacía**: banner "Conectado al equipo. Esperando la primera sincronización de un aparato encendido…" en vez de vacío. (resuelve MB-5, MB-7)
6. **Confirmación extra al unir con licencia de checksum inválido** ("Esta licencia no verificó — ¿unir igual?"). (resuelve MB-2)
7. **Registrar la tienda actual en `f123_tiendas` al arrancar** (no solo al cambiar) para que volver siempre funcione. (resuelve MB-4)
8. **Nombre visible por tienda** (persistir display name) para el selector y el header. (resuelve MB-5)
9. **Endurecer renders con 0 perchas**: verificar que la app no rompa con `ubicaciones` vacías tras unirse a una tienda fresca.
10. **No usar `licenseCode` propio como `companyId`** cuando hay tienda activa distinta (namespacar identidad/telemetría). (resuelve MB-3)
11. **Indicador "Entrando a: <tienda>" en la pantalla de PIN** ANTES de teclear (confirm world-class de a qué negocio entras). Resuelve pendiente 2026-08-25 #1.

---

## Orden sugerido (por lo que desbloquea)
1. R2 + R1 (volver a mi tienda / selector) — sin esto, salir de una tienda unida es difícil.
2. R4 + R11 (claridad de a qué tienda entras) — pendiente viejo de JFC.
3. R5 (estado esperando-sync) — mata la sensación de "no sirve".
4. R3 + R6 (confirmaciones anti-typo).
5. R7, R8, R9, R10 (robustez).

## Qué NO entra
- Servidor que guarde el estado de cada tienda (rompería la regla sin-nube).
- Cambios al relay (Cloudflare Worker, fuera de este repo).
- Ports a amigable-123 / consultorio-123 — se prueba aquí primero.

*Plan escrito 2026-08-26 tras dejar el multi-tienda live. Listo para aprobación.*
