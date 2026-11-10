# H2 · medición física de guardado local (2026-11-09)

**Estado:** protocolo de diagnóstico, no prueba física completada, no hotfix. Basado en los hooks que YA existen en `docs/mock-backend.js`: `sessionStorage.f123_perf_local` y `window.OCPerfLocal.leer()`. No introduce código ni interfaz nueva en la PWA.

## Objetivo y límites

Distinguir si el tiempo de **guardado local** se concentra en esperar la cola anterior, serializar el snapshot, confirmar IndexedDB o completar el commit. **No** mide el tiempo completo del toque, Sync3, fotos, CPU/RAM del proceso ni convergencia entre aparatos. Ningún valor sintético reemplaza mediciones en un aparato físico.

Los registros solo contienen `{etapa,ms,ok}` y se limitan a los últimos 120. No incluyen nombre, SKU, PIN, licencia, dinero o datos personales. No hay envío externo. El indicador de 14 días de **operación crítica exitosa al primer intento** se mantiene separado: estas observaciones son *etapas*, no intentos únicos.

## Protocolo, solo cuaderno QA

1. Identifica físicamente **navegador/dispositivo**, shell/SHA y momento local. Usa una licencia de pruebas; no modifiques ventas ni datos reales. Antes de una recarga verifica que no haya un guardado local inconcluso ni una venta dudosa.
2. En las herramientas de desarrollo de **la pestaña QA** ejecuta `sessionStorage.setItem('f123_perf_local','1')`. Recarga *solo la pestaña QA*, no una venta en curso. La captura está apagada en cualquier otra pestaña/sesión.
3. Haz operaciones **de prueba autorizadas**: una venta, un ajuste de stock, y reapertura comprobando un solo recibo y stock correcto. Registra también si tardó más de 2 s de manera independiente (cronometraje de extremo a extremo).
4. Sin cerrar la pestaña, ejecuta `JSON.stringify(window.OCPerfLocal.leer())` en su consola y copia la **cadena JSON** a un archivo privado local `qa-stage-metrics.json`. Nunca copies el estado de la base, `localStorage`, PIN, licencia, fotos ni tickets.
5. En una copia del repo, genera resumen local con `node scripts/h2-perf-local-summary.cjs qa-stage-metrics.json`. Comparte solo las cuatro filas agregadas, dispositivo y SHA; no publiques capturas de datos de clientes.
6. Apaga la medición con `sessionStorage.removeItem('f123_perf_local')`. Si deseas borrar solo los contadores en memoria, `window.OCPerfLocal.limpiar()` **no borra ventas ni IndexedDB**.

**Safari / PWA de iPhone:** la consola de Safari requiere un inspector remoto compatible (habitualmente Safari Develop en un Mac emparejado). Opera/Chromium en PC permite DevTools directamente. No se debe afirmar que H2 está medido en iPhone si no existe acceso real a esa consola. Diseñar una interfaz de exportación segura y opt-in requeriría revisión aparte; no está autorizada por este protocolo.

## Condiciones de evidencia

- Registrar (n), p50, p95, máximo y fallos por etapa para cada navegador y SHA, sin confundir observaciones repetidas con operaciones únicas.
- Para un `ok=false`, conservar únicamente etapa, tiempo y tipo de error **clasificado localmente** si la app ya lo ofrece. No importar mensajes de error, direcciones ni payloads a la tabla.
- Guardar un diagnóstico **antes** de cambiar performance. H3 decide un único cuello de botella causal y exige RED→GREEN con ventas, stock, dinero y fotos intactos.
- **NO-GO** si se omiten fallos, se confirma una venta no duradera, se borra información local, se limita la historia de Sync3 o se ejecuta una recarga mientras una operación permanece incierta.

Fuente técnica: [PR #659](https://github.com/jfcarpiopuntocom/friendly-123/pull/659) (comparación v442–v706) y [War Room Fable](https://app.notion.com/p/4141642b67f38163b2cfdd9332a02dcd) (propuestas H1–H9). La fase H2 fue propuesta allí; este documento la operacionaliza, pero **no constituye aprobación de las tres modificaciones UX/sync pendientes**.
