# ADR-P0 — Recuperar ventas rápidas, registrar ≤2 s, sin esperas Web Locks (2026-10-29)

**Autorización del propietario:** retirar los dos candados Web Locks que empeoran el registro de ventas. **No afirmar que aprobó su incorporación:** GitHub registra commits, no consentimiento. La app era rápida hace 15–25 días. **Conservar el modal negro de Confirm Sale intacto.**

**Estado de este ADR:** laboratorio de medición y diseño. No ha cambiado ningún archivo de aplicación, no ha eliminado garantías ni publicado una candidata. **El propietario pide intervención; los dos candados deben reemplazarse antes de desplegar la eliminación.** No reintroducir operaciones especulativas que digan «venta completada» cuando no lo está.

## Arquitectura hoy (hechos del código estable v618)

1. `docs/index.html` y `src/app/app-inline-01.js` sirven la pantalla Sold y llaman a `fetch('/api/productos/:id/venta', {method:'POST'})`.
2. `docs/mock-backend.js` intercepta ese `/api` dentro del aparato: **backend local, no servidor remoto de ventas**. En `_fetchConCandado` pide Web Lock `f123-escrituras` y tiene una ventana de espera de 10 s.
3. El manejador valida permisos, inventario, cliente, cálculo de comisión y modifica stock/venta provisionalmente.
4. `guardarEstadoLocal(true,true)` en `docs/mock-backend.js` exporta **todo** el cuaderno (`productos,ventas,movimientos,actividadCompartida,...`), llama `JSON.stringify`, `JSON.parse`, luego A/B journal en localStorage. `docs/estado-ab.js` solicita un SEGUNDO Web Lock `f123-estado-ab:<base>` con ventana de 10 s.
5. El journal A/B escribe PREPARED, dato, COMMITTED y puntero; el espejo en `docs/estado-idb.js` vuelve a clonar JSON y usa una transacción IDB `readwrite`. La implementación actual reserializa además `_huellaPublicable`.
6. Solo después del ACK local, la operación publica movimiento de stock, difunde catálogo a Yjs y devuelve respuesta. En el `finally` drena colas Yjs/reconciliación; Sold actualiza vistas y muestra el modal original.

## Historia comprobada

- 06-oct, SHA `f1dd6b315dd9`: venta **ya** esperaba guardado local durable antes de confirmar, con A/B sencillo y espejo IDB. Un Web Lock global sin timeout codificado; no había módulo `estado-ab.js`.
- 12-oct, SHA `77066d616baa`: camino parecido, venta protegida; **no había segundo Web Lock**.
- 22-oct, SHA `fa557b061dc8`: límite de 10 s en espera del lock global.
- 26-oct, SHAs `8848ed677a0f` y `601296b1015d`: módulo A/B journaling y segundo Web Lock.
- 28–29 oct, v609 mejora parsers de A/B y evita algunos copiados pero persiste el snapshot de cuaderno completo por venta.

## Cinco alternativas de eficiencia (separar diagnóstico de autorización)

| Opción | Valor para el registro | Riesgo que hay que controlar |
| --- | --- | --- |
| 1. Quitar esperas Web Locks mediante **un escritor único cercado transaccionalmente** | No suspender un tap detrás de otro origen/pestaña | `tab-session.js` tiene lease por localStorage sin atomicidad para escrituras en vuelo; quitar `navigator.locks` sin CAS puede perder ventas |
| 2. IndexedDB `readwrite` breve con validación de revisión CAS y ACK real | Serialización cruzada de pestañas en la BD, sin candado Web Locks de 10 s | WebKit/IDB, aislamiento por cuaderno, restauración A/B, fallos de cuota y recuperación |
| 3. Commit incremental atómico de venta+stock+comisiones sobre log inmutable | O(1) u O(delta) por venta; checkpoints completos ocasionales | Coherencia stock/dinero, clientes previos, idempotencia de reintentos y migración |
| 4. Eliminar JSON stringify/parse duplicados y huellas completas | Menos CPU por venta con cuadernos grandes | Mantener comprobaciones A/B y evidencia de commit validable |
| 5. Colas de Yjs incrementales y redibujado parcial POST-ACK | No repetir historial ni reconstruir pantalla para mostrar una venta | No emitir operaciones provisionales antes de ACK ni adelantar/suprimir el modal |

**Prioridad:** probar reemplazo 1+2 con una transacción corta y duradera, más optimización 4. Investigar 3 solo como alternativa si el snapshot completo es el cuello de botella demostrado. La opción 5 se mide separadamente.

**Tecnologías oficiales verificadas:** [IndexedDB transacciones](https://developer.mozilla.org/en-US/docs/Web/API/IDBDatabase/transaction), [Web Locks](https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API), [Yjs updates incrementales](https://docs.yjs.dev/api/document-updates). IndexedDB `readwrite` serializa transacciones con scope compartido, evitando que haga falta un segundo candado voluntario *si* el diseño y el ACK se realizan dentro de la transacción.

## Medición y criterios de publicación

- `node scripts/lab-venta-latencia.js`: benchmark de una fotografía sintética de 1/300/1000 productos, NO latencia real de PWA ni sincronización.
- Medir también *iPhone PWA real* y escritorio con cuaderno sintético separado, pestañas superpuestas, reanudación, ventas concurrentes, cuota llena y reinicio; `performance.mark` en cada tramo del handler de venta.
- Registro exitoso verdadero de venta **≤2 segundos**, incluyendo stock y dinero correcto. El modal negro existente permanece intacto.
- Ninguna venta duplicada/phantom, ninguna pérdida de unidades, comisiones, PIN ni foto, ninguna confirmación engañosa.
- Revisión y regresión final sobre SHA exacto; candidatos aislados, **sin publicar este laboratorio**.
- Pendientes independientes: PWA v618 no abre el cuaderno/PIN del propietario, PR #472 v619 en draft; issue #473 seguimiento de rapidez.

## HARDRULE — transparencia con el propietario

**Siempre explicar cómo funciona la app** antes de cambiar la arquitectura o añadir defensas: qué se escribe, en qué dispositivo, ruta de sincronización, qué bloquea la venta, impacto en latencia, alternativa, riesgos y aprobación real. Nunca suponer aprobación de un commit técnico ni esconder cambios tras pruebas verdes. El propietario ha pedido esta explicación explícitamente y repetidamente.
