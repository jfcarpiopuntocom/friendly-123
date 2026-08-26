# PLAN 2 — 5 microbugs más + 7 microrrefuerzos más al multi-tienda
**Fecha:** 2026-08-26 · **Base:** multi-tienda + fix crux (rótulo de tienda en PIN) YA live (SW v98)

Incorpora la aclaración de JFC: **los PIN del equipo NO dependen de que alguien
esté online AHORA, sino de que se haya sincronizado RECIENTEMENTE y quede
guardado local.** Verificado en código: el sync solo aplica el roster cuando
está COMPLETO (`vistos >= esperados`) y lo persiste en el buffer namespaceado →
una vez sincronizado, los PIN funcionan offline. El único momento que requiere al
otro aparato es la PRIMERA sincronización tras unirse.

---

## 5 MICROBUGS (verificados)

| # | Sev | Defecto | Estado |
|---|-----|---------|--------|
| NB-1 | MED | **`ROOM_KEY` es global, no por-tienda.** Un "volver a mi tienda" que cambie de namespace SIN pasar por `activar()` dejaría la sala apuntando a la tienda anterior → una tienda sincronizaría en la sala equivocada (contaminación cruzada). | CONFIRMADO. Latente hoy (unirse siempre pasa por activar). DEBE arreglarse al construir el selector. |
| NB-2 | MED | Los marcadores `f123_tienda_activa` / `f123_tiendas` NO se limpian en el autoheal-888 ni en un reset total → tras un reset, el marcador apunta a un namespace vacío y la app arranca en una tienda confusa. | CONFIRMADO (autoheal limpia OC_STATE_KEY pero no los marcadores). |
| NB-3 | MED | En Avanzado, "tu licencia"/identidad puede seguir mostrando la licencia PROPIA aunque estés en una tienda unida (lee `f123_owned`, global). Inconsistente con el rótulo del PIN ya arreglado. | Por confirmar en el panel de Avanzado. |
| NB-4 | LOW | Normalización de licencia: si `f123_owned.licenseCode` tiene distinto formato/caso que lo que se teclea, "volver a la propia" podría crear un namespace duplicado `::JAMES` en vez de regresar al sufijo `""`. | Riesgo de borde. |
| NB-5 | LOW | El rótulo/switch multi-tienda queda inerte si hay un backend remoto real conectado (`OC_PB_CONNECTED` → `OCTienda` no se define). Es local/demo-only por diseño; documentar el alcance. | Por diseño; falta documentarlo. |

---

## 7 MICRORREFUERZOS (plan, a aprobar)

1. **Namespacear `ROOM_KEY`** (o fijar la sala en CADA cambio de tienda) para que cada tienda sincronice solo en su propia sala. (arregla NB-1) — **prerequisito de seguridad del selector.**
2. **Limpiar `f123_tienda_activa` + `f123_tiendas`** en todos los flujos de reset/autoheal/borrado total. (arregla NB-2)
3. **Identidad de tienda activa consistente en Avanzado**: mostrar nombre + qué licencia/sala, no la licencia propia, cuando estás en una tienda unida. (arregla NB-3)
4. **Canonicalizar la licencia** antes de mapear a namespace (evita namespaces duplicados por caso/formato). (arregla NB-4)
5. **"Sincronizado hace X"** por tienda: hacer visible el modelo "recién sincronizado" — así JFC ve que el roster está al día aunque el otro aparato esté ahora apagado.
6. **Verificar end-to-end** que el nombre de la tienda unida se persiste al primer sync y aparece en el rótulo del PIN (cierra el círculo del fix crux).
7. **Sección "Mis tiendas" en Avanzado**: lista de tiendas conocidas con "sincronizado hace X" + botón Cambiar (subsume R1/R2 del plan 1 y añade la recencia de sync).

---

## Orden sugerido (seguridad primero)
1. NB-1/R1 (namespacear ROOM_KEY) — ANTES de cualquier selector, o hay riesgo de contaminación de sala.
2. NB-2/R2 (limpiar marcadores en reset).
3. R7 + R5 (selector "Mis tiendas" con "sincronizado hace X") — junto con R1/R2 del plan 1.
4. NB-3/R3, NB-4/R4 (consistencia e identidad).
5. R6 (verificación end-to-end).

## Regla de ejecución (cliente en vivo)
- Cambios ADITIVOS donde se pueda; el camino de la tienda propia NUNCA cambia.
- Revisar 3X cada cosa; `node --check` + guards.sh + check-sw.sh verdes antes de cada push.
- Push incremental, un refuerzo por commit, con apuntes copiosos del POR QUÉ.

*Plan escrito 2026-08-26. Los microbugs son defectos reales; los refuerzos, a aprobar.*
