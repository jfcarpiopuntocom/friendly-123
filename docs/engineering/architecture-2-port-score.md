# friendly-123 · arquitectura 1.0 → 2.0 · indicadores auditables

**Corte de ingeniería:** 19 de noviembre de 2026. **SHA base de rúbrica C13:** `83790575a369a5d6d1f044232c4e049e9b49433d`; **último cambio de calidad verificado:** [PR #796](https://github.com/jfcarpiopuntocom/friendly-123/pull/796), merge `49fe066024ab529b182327bd98ae76884b13ded2` (foto CAS v804). Este archivo describe el código **de la app real**; el workshop es laboratorio. **Sync3 ya es 2.0 y queda fuera del denominador.**

| Indicador | Antes comparable | Ahora | Delta |
| --- | ---: | ---: | ---: |
| Capacidades portadas 1.0→2.0 | 68,5/100 (pos-D7, pre-C8) | **81,5/100** | **+13,0** (+3,0 en C13) |
| Calidad arquitectónica de ingeniería | 67,0/100 (17-nov) | **73,2/100** | **+6,2** (+1,2 en C13) |

**PORT ≠ autorización comercial**. Se puntúan capacidades 2.0 implementadas y ensambladas en `friendly-123`, con pesos/versiones fijos y rutas de código testadas. No es porcentaje de teléfonos migrados ni fiabilidad estadística. Los seis gates GO se gestionan aparte (actualmente **0/6**). No confundir con un viejo 61/100 que incluía aceptación física en un denominador diferente.

## PORT 81,5/100: desglose reproducible

| Capacidad | Hecho | Total | Falta |
| --- | ---: | ---: | ---: |
| SQLite/Yjs, diario, reapertura y merge | 15,5 | 17,0 | 1,5 |
| Historia congelada, importación y R2 | 13,5 | 18,0 | 4,5 |
| Operaciones tipadas: venta, stock, fiado, ACK | 14,0 | 17,0 | 3,0 |
| Tickets Owner/Team y salas separadas | 12,5 | 14,0 | 1,5 |
| Fotos por SHA fuera del documento Yjs | 7,0 | 9,0 | 2,0 |
| Catálogo público C8–C12: proyección, firewall, escritor, HEAD y lector compilado | 10,0 | 10,0 | 0,0 |
| Conexión efectiva del navegador y retiro del relay antiguo | 6,0 | 10,0 | 4,0 |
| Outbox, Safari, failback físico | 3,0 | 5,0 | 2,0 |
| **TOTAL** | **81,5** | **100,0** | **18,5** |

La mejora **+13,0** sobre el corte pos-D7 se compone de **C8 3,0 + C9 2,5 + C10 1,5 + C11 2,0 + C12 1,0 + C13 3,0**. **C13** cablea el lector público certificado C12 dentro del ciclo real de `docs/sync-yjs.js` detrás del doble switch QA (apagado por defecto en `docs/sync-rollout.json`), esperando recuperación del canal sombra legado + IDB + cero deuda causal (`pendingStructs`/`pendingDs`), con cierre automático en `hidden`/`pageshow.persisted` (BFCache)/`destroy`, cooldown con tope de intentos y acceso de solo lectura `API.leerCatalogoPublicoCertificado()`. El score falla automáticamente si falta el cableado o si el SHA-256 de `docs/sync-yjs.js` no coincide con `docs/version-manifest.json`.

Archivos canónicos y comando: [`docs/engineering/architecture-2-port-score.json`](./architecture-2-port-score.json), [`docs/engineering/architecture-2-quality-score.json`](./architecture-2-quality-score.json) y `node scripts/architecture-2-port-score.cjs`.

## Calidad 73,2/100

Es una **revisión explícita de ingeniería**, no tasa de disponibilidad. Frente al 67,0 histórico: Sync 12,5→14,9 (+1,2 en C13 por cableado de lector certificado con guardas de ciclo de vida y fail-closed), seguridad 8,5→10,0 por C9/C10/C11, migración 5,5→7,3 por R2/D6/D7. Dinero 17,5, durabilidad 16,5 y físico 0,0 quedan constantes. **Fotos 6,5→7,0 (+0,5)** por CAS efectivo A→B→C de los tres escritores de perchas y rechazo de un PUT sin preimagen (test real RED 20/21, GREEN 21/21, 27 checks de SHA), acreditado automáticamente contra `docs/vista-perchas.js` y `docs/version-manifest.json`. Todavía no se ha probado convergencia física PC–iPhone: 0,0 físico.

## Próximos cortes por causa raíz

1. **R2 está activado y se ha verificado sin buckets, pero JFC prohíbe cualquier costo nuevo (USD 0,00)**. Hasta contar con límites de gasto realmente bloqueantes, cero escrituras R2/importaciones/deploys: desarrollar y verificar con Miniflare local. El emisor `/ws/ticket` tiene compuerta de despliegue manual protegida por PR #797, pero no equivale a un despliegue. Preparar historia Firebase QA íntegra, origen certificado, binding R2 y `WS_CATALOG_ORIGIN_QA` únicamente cuando la restricción de gasto y los gates lo permitan.
2. Pasar los deltas de catálogo por un escritor autorizado único y venta/ajuste/fiado por comandos tipados con ACK `business-committed`; demostrar reversión y reconciliación sin perder `opId`.
3. Prueba física A→B→A×2 en Opera PC y Safari iPhone sobre la misma tienda para el GO independiente (`0/6`).
