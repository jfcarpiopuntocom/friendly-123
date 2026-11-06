# Diagnóstico Ponytail de guardado local — optativo y privado

Este cambio NO acelera por sí mismo el guardado ni altera el contrato de inventario/dinero. Sirve para distinguir la espera del guardado previo, la serialización, el commit IndexedDB y el tiempo total. No hay envío de datos por red, PostHog ni herramientas externas; solo cuatro nombres de etapa, milisegundos enteros y el booleano de éxito. Ring en RAM de 120 eventos; sin producto, cantidades, licencias, PIN, ventas, fotos, nombres ni detalles de error.

## Para instrumentar una tienda DE PRUEBA (no cliente real)

En su propia pestaña, en consola de desarrollador, ejecutar `sessionStorage.setItem('f123_perf_local','1')` y recargar la pestaña **solo si no hay operación ni sincronización pendiente**. Instrumentación desactivada por defecto. Usar una tienda sintética con datos sintéticos. Tras una operación local, ejecutar `window.OCPerfLocal.leer()` para copiar los tiempos; `window.OCPerfLocal.limpiar()` vacía el historial RAM y `sessionStorage.removeItem('f123_perf_local')` desactiva nuevas mediciones.

## Interpretación y límites

- `prior_save_wait`: espera por un guardado espejo/catálogo anterior. `ok:false` significa que venció el plazo de 4000 ms; no implica que la operación actual haya fallado.
- `snapshot_serialize`: JSON.stringify + JSON.parse del estado exportable; no incluye construir el estado inicial.
- `strict_idb`: costo de la transacción CAS en IndexedDB, incluido ordenamiento en la cola de IDB.
- `strict_commit`: duración en el guardado estricto después de entrar a `_guardarEstadoLocalAhora`. `ok` refleja únicamente el resultado del guardado local.
- Las etapas **se superponen**; no sumarlas como si fueran disjuntas. El análisis de extremo a extremo click→paint requiere instrumentación aparte.
- Los errores no incluyen causa específica; CAS stale, AbortError y cuota deben investigarse con pruebas sintéticas separadas. Nunca convertir un fallo en ACK.
- Los registros no sobreviven a recarga o cierre y no se correlacionan entre aparatos (deliberado para privacidad).

## Aceptación

1. `node --test test/p0-local-save-performance-opt-in.test.cjs` green y contraprueba RED sin helper.
2. `release-control` integral, stock CAS/rollback, dinero, fotos, Sync3 y navegador green en SHA exacto.
3. Ninguna variación de respuesta, IDB, A/B ni latencia perceptible al estar desactivado.
4. No publicar si algún gate falla.
