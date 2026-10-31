# friendly-123 P0 — ejecución 31 octubre 2026

**Decisión de JFC:** [MDD — autoridad y continuidad](https://app.notion.com/p/40a1642b67f381a0a02cf0bfa8b5feac). Consultar primero esa página y el [incidente #515](https://github.com/jfcarpiopuntocom/friendly-123/issues/515). Este archivo sirve de relevo portátil; **no acredita una reparación física**.

## Criterio no negociable

Cualquier navegador/PWA autorizado con la licencia y PIN válido para su rol debe abrir en unos pocos segundos el **mismo negocio completo**: mismo stock físico derivado de hechos, ventas, pagos, fotos, comisiones, gastos, historial, rol y revisión PIN. La PC, Safari, un segundo navegador móvil y la PWA son réplicas diferentes **del mismo cuaderno por licencia**. A realiza una venta, se apaga, B abre días después y la recupera; B escribe, se apaga, A reabre y recupera. La app no debe mostrar datos parciales como finales.

## Incidente físico abierto

- JFC registró en el teléfono los últimos movimientos válidos, que en una observación histórica dejaron seis productos con siete unidades. **Siete NO es un valor objetivo**. No inventar ajustes ni elegir «ganador» por reloj.
- La PC real conectada mostraba «Offline — saved locally» y cantidades anteriores (por ejemplo, James Bond 3, Hielo 4) con movimientos visibles hasta 29/oct. El conector Browser de Chat permite **solo lectura** del DOM; no accede a IndexedDB, no puede pulsar exportar ni controlar el iPhone.
- No hay todavía dos backups reales completos comparados: origen/identificador de licencia, epoch, movimientos, opIds, ventas y Yjs durable deben verificarse sin modificar originales.
- PIN Owner de dispositivos difería según JFC; el valor literal no debe guardarse en el repositorio ni en notas. PIN vigente tiene **revisión central verificada**, no una heurística de «último dispositivo usado». Ningún PIN cliente existente debe rotarse sin censo y autorización coordinada.

## Priorización aprobada

1. **#3 URGENTE**: panel JFC máxima autoridad (licencias, devices, roles, PIN Owner, recuperaciones) con lápices visibles y UI móvil responsive. Censo **primero**, edición/rotación explícita **después**, auditoría y protección contra reversiones.
2. **#1 y #5 EN PARALELO**: libro físico inmutable por opId causal integrado al Yjs existente, separado de pedido/dinero/entrega; forense read-only de PC/cel y pruebas de repetición, particiones, idempotencia y reinicio. Sin motor duplicado.
3. **#2 a continuación**, antes si necesario para garantizar aparatos nunca simultáneos: buzón cifrado durable por licencia con autorización por operación, cuota, cursor, dedup y ACK. Sin Supabase ni balance/sales en claro.
4. **#4 SOLO discusión posterior**: autoridad central de datos comerciales; NO aprobada su implementación.

Se autorizan shells útiles, comprobadas y selladas. Evitar la proliferación de versiones y candidatos que cambian SW/manifiesto sin haber demostrado el problema real resuelto. Mantener el nombre de negocio en #EFC31A y borde negro relativo .08em, sin fijo píxel.

## Cambios verificados del 31/oct

- [PR #523](https://github.com/jfcarpiopuntocom/friendly-123/pull/523) es una integración **DRAFT** mezcla durabilidad/PIN/marca/shell; HEAD inicial examinado `8595353de352fa15a11c87d97d2696a7f8de6f94`, 28 commits/26 archivos; los checks focales verdes son simulados. [CI 41241041261](https://github.com/jfcarpiopuntocom/friendly-123/actions/runs/41241041261) SUCCESS, [release-control 41241045696](https://github.com/jfcarpiopuntocom/friendly-123/actions/runs/41241045696) FAILURE (5 tests), [shell-integrity 41241045824](https://github.com/jfcarpiopuntocom/friendly-123/actions/runs/41241045824) FAILURE (hash de manifiesto). NO PUBLICAR.
- El script `scripts/p0-compare-replicas.cjs` en #523 tiene ahora **--private-local**, para comparar exactamente IDs solo en la máquina del propietario. Su modo normal continúa reportando únicamente cifras anónimas. **NO subir los informes privados con IDs a GitHub, Notion ni CI**. Esta comparación no recupera operaciones Yjs ausentes del export.
- [PR #524](https://github.com/jfcarpiopuntocom/friendly-123/pull/524) aísla una implementación de buzón en Worker: `cloudflare-worker/mailbox-api.mjs`, clase `BuzonCifrado` con DO independiente por licencia, sesión Owner HMAC 10 min y comprobación de revisión central por solicitud; envelopes AES-GCM opacos, idempotencia, conflictos por mismo opId, cursores, ACK sin borrar historial, 12MB/10k eventos y cuota 240 escrituras/min/licencia. [CI de buzon 41247188596](https://github.com/jfcarpiopuntocom/friendly-123/actions/runs/41247188596) SUCCESS con 11 pruebas y Wrangler dry-run. **No conectado todavía al Yjs de la PWA ni desplegado**; no soporta aún otros roles. NO MERGE/DESPLIEGUE antes de E2E real.
- Master productivo observado v636 SHA `795635ea0b0de262cd982d9a5dc828fd8cffcfba`; contrastar al próximo relevo.

## Runbook de aceptación y publicación

- Capturar DOS exportaciones completas originales PC y celular (resguardadas, privadas y recuperables), sin limpiar IndexedDB/PWA/SW ni sobrescribir una réplica con la otra. Pasar por comparador offline y revisar ID de cada movimiento, venta, epoch, PN/counter, adjuntos; después diseñar unión causal auditada.
- Corregir y verificar el PIN Owner y roles desde Worker/panel, **censo de PIN reales de clientes antes de cualquier edición**. Probar que PIN local obsoleto no revive y que un Worker antiguo/no disponible falla sin expulsar a clientes legítimos.
- Integrar buzón con Yjs **real**: cifrar en cliente, persistir antes de enviar, retry controlado, ACK durable y cursores, backfill incremental para nuevo navegador/PWA con recuperación de clave, aislamiento entre licencias, fotos e historial.
- E2E físico en Worker oficial: venta/ajuste y pago A→cerrar A→B nuevo en otra fecha→comprobar eventos/stock, dinero, PIN y fotos; repetir B→A y reiniciar. Medir apertura en segundos. Nada de stock ficticio, revisión por timestamps o duplicación de salidas físicas por pagos parciales.
- CI integral financiera, exportación/restauración, crashes, large notebook, SHA exacto, SW/manifest version parity, CSS; borrar o corregir cualquier test obsoleto **solo si la propiedad real queda cubierta**, sin ocultar fallos. Publicar una shell solo cuando pruebas funcionales reales y gates estén verdes, con rollback planificado.

## Registro y redundancia

Fuente primaria: [Notion MDD](https://app.notion.com/p/40a1642b67f381a0a02cf0bfa8b5feac), diario diario activo 15:00 Ecuador y [#515](https://github.com/jfcarpiopuntocom/friendly-123/issues/515). Copias de módulo/test de #524 en ChatGPT Library `/friendly-123/2026-10-31-mailbox/`. Hugging Face: no se acreditó conexión de escritura; nunca declarar copia allí si no se crea y verifica. Ningún PIN, credencial, exportación cliente, token ni licencia real en este archivo.
