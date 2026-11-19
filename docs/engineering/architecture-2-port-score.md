# friendly-123 · arquitectura 1.0 → 2.0 · indicadores auditables

**Corte de ingeniería:** 19 de noviembre de 2026. **SHA de producto inspeccionado:** `e2279fb2a8a39ad71b5a1d7421447d2c6f247591`. Este archivo describe el código **de la app real**; el workshop es laboratorio. **Sync3 ya es 2.0 y queda fuera del denominador.**

| Indicador | Antes comparable | Ahora | Delta |
| --- | ---: | ---: | ---: |
| Capacidades portadas 1.0→2.0 | 68,5/100 (pos-D7, prec-C8) | **78,5/100** | **+10,0** |
| Calidad arquitectónica de ingeniería | 67,0/100 (17-nov) | **71,5/100** | **+4,5** |

**PORT ≠ autorización comercial**. Se puntúan capacidades 2.0 implementadas y ensambladas en `friendly-123`, con pesos/versiones fijos y rutas de código testadas. No es porcentaje de teléfonos migrados ni fiabilidad estadística. Los seis gates GO se gestionan aparte (actualmente **0/6**). No confundir con un viejo 61/100 que incluía aceptación física en un denominador diferente.

## PORT 78,5/100: desglose reproducible

| Capacidad | Hecho | Total | Falta |
| --- | ---: | ---: | ---: |
| SQLite/Yjs, diario, reapertura y merge | 15,5 | 17,0 | 1,5 |
| Historia congelada, importación y R2 | 13,5 | 18,0 | 4,5 |
| Operaciones tipadas: venta, stock, fiado, ACK | 14,0 | 17,0 | 3,0 |
| Tickets Owner/Team y salas separadas | 12,5 | 14,0 | 1,5 |
| Fotos por SHA fuera del documento Yjs | 7,0 | 9,0 | 2,0 |
| Catálogo público C8–C12: proyección, firewall, escritor, HEAD y lector compilado | 10,0 | 10,0 | 0,0 |
| Conexión efectiva del navegador y retiro del relay antiguo | 3,0 | 10,0 | 7,0 |
| Outbox, Safari, failback físico | 3,0 | 5,0 | 2,0 |
| **TOTAL** | **78,5** | **100,0** | **21,5** |

La mejora **+10,0** sobre el corte pos-D7 se compone de **C8 3,0 + C9 2,5 + C10 1,5 + C11 2,0 + C12 1,0**. Los créditos son hitos con archivos y pruebas; no puntúan el mero número de PR. **C12** está en `src/yparty-piloto.js` y en el bundle real `docs/vendor/yparty-piloto.min.js`; el score falla si falta ese método o no coincide el hash del manifiesto. El lector es explícito, no sustituye automáticamente el relay 1.0.

Archivos canónicos y comando: [`docs/engineering/architecture-2-port-score.json`](./architecture-2-port-score.json), [`docs/engineering/architecture-2-quality-score.json`](./architecture-2-quality-score.json) y `node scripts/architecture-2-port-score.cjs`. CI C12 valida la suma, vínculos exactos a SHA, fuente, bundle compilado y manifiesto. Actualizar después de cada injerto: nuevo SHA + nuevas pruebas, **sin modificar los pesos para perseguir una cifra deseada**.

## Calidad 71,5/100

Es una **revisión explícita de ingeniería**, no tasa de disponibilidad. Frente al 67,0 histórico: Sync 12,5→13,7 por reapertura certificada, seguridad 8,5→10,0 por C9/C10/C11, migración 5,5→7,3 por R2/D6/D7. Dinero 17,5, durabilidad 16,5, fotos 6,5 y físico 0,0 quedan constantes hasta nueva evidencia. Los criterios y enlaces de prueba están en el archivo de calidad.

## Próximos cortes por causa raíz

1. Certificar historial Firebase hasta HEAD sin ancestros pendientes; fijar manifest y Service Binding R2 de tienda QA, con validación C11 en servidor.
2. **Cablear la lectura pública C12 al flujo cliente**, sin reautorizar ni sembrar una segunda historia: hoy el método está en el bundle pero el canal comercial regresa a legacy.
3. Pasar los deltas de catálogo por un escritor autorizado y venta/ajuste/fiado por comandos tipados con ACK comercial; demostrar reversión y reconciliación sin perder opId.
4. A→B→A×2 en Opera PC y Safari iPhone sobre la misma tienda para el GO independiente.

PR que implementa esta revisión y lector: [#792](https://github.com/jfcarpiopuntocom/friendly-123/pull/792). Los CI globales y fusión se consultan por el SHA exacto, nunca por un resultado de otra ejecución.
