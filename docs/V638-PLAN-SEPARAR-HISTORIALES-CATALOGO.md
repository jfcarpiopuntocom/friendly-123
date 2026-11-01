# v638 — Plan (NO implementado): separar historiales del checkpoint de catálogo

Estado: **diseño para después de que v637 sea STABLE**, sin migración de producción ni activación de flags. Referencia: revisión Claude del 1 nov 2026. La v636 sigue siendo un lector activo durante la transición.

## Problema y criterio de decisión

El documento Yjs del catálogo (`API.doc`) conserva mapas de estado vigente y mapas crecientes: `ventas`, `gastos`, `transferencias`, `ajustes`, `actividad`, `hechos_financieros` y `_stock_pn_testigos_v1`. Aumentar el máximo del checkpoint a 262.144 bytes cifrados solo retrasa el agotamiento, no lo evita. El canal `opsDoc` ya guarda `eventos` append-only, pero **no está demostrado** que represente todos los historiales y revisiones del catálogo; se debe verificar cobertura antes de mover datos.

En la v637 se añade una medición **manual, local y de solo lectura**:

```js
console.table(window.OCYjs.medirTamanoCanales());
console.table(window.OCYjs.medirTamanoColecciones());
```

`bytesCifrados` del canal completo es exacto para el sobre AES-GCM actual (update Yjs + 29 B). `bytesJSONVisibles` por colección **es una aproximación** del contenido visible (claves + JSON), NO el tamaño de su contribución al update Yjs: excluye metadatos causales, tombstones y estructuras borradas. No sumar `bytesJSONVisibles` para afirmar que equivalen al checkpoint. No copiar valores de negocio, IDs, PIN, licencias ni filas. Solo cifras, nombres de colección conocidos y `hidratado`; con `hidratado=false` la muestra no es concluyente.

## Diseño propuesto y puertas de seguridad

1. **Censo y paridad de eventos.** Identificar para cada mapa histórico las fuentes, mutaciones, anulaciones, orden y consumidores. Verificar que cada venta/gasto/transferencia/ajuste/actividad/hecho financiero tenga representación recuperable e idempotente en `opsDoc` o diseñar la que falta. Verificar también el cálculo de stock, testigos PN y reparaciones.
2. **Compatibilidad con v636.** Mientras haya un aparato v636 de una licencia, mantener las escrituras y lecturas históricas que esa versión espera en `API.doc`. Introducir doble escritura idempotente con IDs estables y pruebas de no duplicación; **no borrar ni compactar mapas históricos** durante esa fase.
3. **Backfill verificable.** Migrar historial por lotes y por licencia a eventos append-only, con cursor durable, conteos y hashes por ID; reintentos seguros y reconciliación. Nunca recrear `API.doc` desde JSON ni cambiar identidades causales Yjs.
4. **Lectura y checkpoint v638.** Solo después de demostrar paridad completa y censo de dispositivos, activar por licencia un catálogo de estado vigente, con camino de lectura para datos antiguos y corte explícito. El diseño de retirada del historial debe probar que no produce borrados visibles en v636 ni en clientes offline que vuelvan meses después.
5. **Pruebas de aceptación.** Ventas, devoluciones, gastos, transferencias, ajustes, actividad y PN: sin duplicados ni pérdidas en dos aparatos; offline largo, reconexión, migración interrumpida, reintento, cambio de versión y rollback; igualdad de huella de inventario y finanzas. Medir crecimiento de `bytesCifrados` tras 0/300/1000 productos y cientos/miles de ventas sintéticas, incluyendo Chrome, Safari y PWA.
6. **Rollback y despliegue.** Mantener un modo compatible y reversibilidad hasta que todos los dispositivos de cada licencia estén censados y actualizados. Desactivar el corte si faltan eventos o cambia la huella; nunca tocar datos de clientes ni producción sin aprobación expresa.

## Opciones que NO se activan ahora

- Subir el máximo de `save_checkpoint` a **1 MiB** requiere una migración SQL y autorización expresa de JFC; considerarlo solo si la medición muestra que 262.144 B no bastan para la ventana operativa.
- Compactar `_stock_pn_testigos_v1` o `actividad` solo si las cifras muestran que dominan; el PN requiere pruebas de semántica de stock.
- gzip/tag7 y Yjs V2 permanecen desactivados para escritores con lectores v636; no reescribir Y.Doc desde cero.

**No incluye implementación de v638, SQL, despliegue ni modificación de producción.**
