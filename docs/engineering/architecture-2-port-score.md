# friendly-123 · PORTANDO arquitectura 1.0 → 2.0 · indicadores decimales verificables

**Último corte auditado:** 2026-11-19, producto real `jfcarpiopuntocom/friendly-123`, SHA base inspeccionado `cc9365aad373ded56f6118cdfd1f116e97d13068`. **Sync3 ya pertenece a 2.0 y se conserva**. `friendly123workshop` solo es laboratorio, PRECODE y auditorías; jamás producto destino.

| Indicador | Antes comparable | Revisión actual | Delta |
| --- | ---: | ---: | ---: |
| Capacidades de ingeniería 1.0→2.0 ensambladas | 68,5/100 (pos-D7, pre-C8) | **81,5/100** | **+13,0** (C8–C13) |
| Calidad arquitectónica de ingeniería | 74,1/100 (revisión previa del 19-nov) | **74,6/100** | **+0,5** (#808 +0,3; #809 +0,2) |
| Autorización de salida comercial | 0/6 gates | **0/6** | **0** |

**Definición crítica:** el primer indicador mide contratos/componentes integrados y acreditados en `friendly-123`, no porcentaje de tráfico, teléfonos migrados ni autorización para vender. El segundo es una **valoración de calidad auditada**, no un SLO de disponibilidad ni certeza estadística. **La métrica de GO comercial es independiente.** La vieja cifra del workshop 61/100 mezclaba pruebas físicas y no es comparable.

## Desglose reproducible de la portada 1.0→2.0 (pesos FIJOS)

| Capacidad | Hecho | Peso total | Falta |
| --- | ---: | ---: | ---: |
| SQLite/Yjs, diario, reapertura y merge | 15,5 | 17,0 | 1,5 |
| Historia congelada, certificación, R2 | 13,5 | 18,0 | 4,5 |
| Economía tipada (venta, stock, fiado, ACK) | 14,0 | 17,0 | 3,0 |
| Tickets Owner/Team y salas | 12,5 | 14,0 | 1,5 |
| Fotos SHA fuera de Yjs | 7,0 | 9,0 | 2,0 |
| Catálogo público C8–C12 | 10,0 | 10,0 | 0,0 |
| Cableado navegador y retiro parcial 1.0 | 6,0 | 10,0 | 4,0 |
| Outbox, Safari, failback verificado | 3,0 | 5,0 | 2,0 |
| **TOTAL** | **81,5** | **100,0** | **18,5** |

C8 +3,0; C9 +2,5; C10 +1,5; C11 +2,0; C12 +1,0; C13 +3,0. Los hitos pendientes NO se marcan completados solo porque existen APIs detrás de flags QA.

## Progreso nuevo de esta jornada: cuatro PR auditadas en el PRODUCTO

- [#805 C16b+C17b](https://github.com/jfcarpiopuntocom/friendly-123/pull/805), MERGED: `src/yparty-piloto.js`, bundle y `docs/sync-yjs.js` exportan despachador económico tipado con **store durable obligatorio** y tickets Team con scopes mínimos, bajo QA OFF. 44 GitHub checks verdes; CodeRabbit omitido. La ruta `Confirm Sale` cotidiana sigue legacy, por lo que los **3,0 puntos de `production-business-dispatch` permanecen pendientes**.
- [#808 C16b P0 Safari IDB](https://github.com/jfcarpiopuntocom/friendly-123/pull/808), MERGED: store del **único** adaptador de Gemini #803, `indexedDB.open` con watchdog y cierre tardío, validación allowlist de C15, rechazo de dos pestañas mismo `opId` distinto importe. 13/13 checks verdes; [#806](https://github.com/jfcarpiopuntocom/friendly-123/pull/806) cerrada como antecedente SIN fusionar. **Calidad durabilidad 17,0→17,3** (+0,3). Sigue pendiente prueba Safari física.
- [#809 C18a fotos SHA](https://github.com/jfcarpiopuntocom/friendly-123/pull/809), MERGED: se injertó cliente foto de Antigravity y se corrigió timeout tras HTTP 200 para abarcar **lectura completa del cuerpo y recibo de PUT**, con hash SHA-256 exacto, Team solo lectura, recuperación Workerd SQLite y ninguna escritura R2. RED reproducible; GREEN **7/7 Node y 1/1 Workerd**, 14/14 checks. Se cerró [#807](https://github.com/jfcarpiopuntocom/friendly-123/pull/807) como rama antigua. **Calidad fotos 7,1→7,3** (+0,2). Los **2,0 puntos de `browser-photo-cutover`** aún no se ganan hasta conectar el componente con la UI y probar CAS en aparatos.
- [#794 C14](https://github.com/jfcarpiopuntocom/friendly-123/pull/794), [#795 C15](https://github.com/jfcarpiopuntocom/friendly-123/pull/795): proteger opIds históricos inmutables tras cold restart y evitar doble cobro por HTTP 202, pérdida de ACK y 503 ambiguos; ya incluidos en la puntuación anterior, sin volver a sumarlos.

**Evidencia viva:** `docs/engineering/architecture-2-port-score.json`, `docs/engineering/architecture-2-quality-score.json`, y `node scripts/architecture-2-port-score.cjs` comprueban sumandos, SHA de fuentes y del bundle. Las pruebas CI `test/p0-architecture-2-port-score.test.cjs` validan los decimales.

## Bloqueos reales para seguir ganando puntos

1. Certificar HEAD histórico real con 0 padres pendientes; fuente R2 por `WS_FROZEN_HISTORY_SOURCE`, origen QA exacto. Sin mezclar doc privado con `-cat`.
2. Conectar el dispatcher económico a una sola ruta de escritura comercial autorizada **tras** certificación; mantener `opId` durable y reconciliar siempre contra el mismo DO. Sin duplicar ventas al alternar legacy y 2.0.
3. Conectar fotos SHA a `vista-perchas` con CAS hash/rev y ACK de lectura real entre Owner y Team. Por ahora hay módulo y QA sintética, **no UI migrada**.
4. Prueba física PC Opera ↔ Safari/PWA iPhone A→B→A×2; existencias, finanzas, fotografías, PIN y rol idénticos en menos de 10 s. GO comercial sigue 0/6 hasta evidencia física.

## Cloudflare / presupuesto obligatorio

Cuenta R2 activada, pero última lectura confirmó **0 buckets**, flags QA en `0` y sin binding de historia. **NUEVO GASTO AUTORIZADO: USD 0,00; ni USD 0,01.** R2 Standard gratuito NO cuenta con hard cap específico: sin creación de buckets, importaciones automáticas, PUTs, cambio de plan, ni despliegues que puedan facturar hasta un control técnico que impida sobrepasar cuota. Continuar pruebas Node/Miniflare locales, sin gastos ni datos de clientes.

[Orden JFC vinculante en Notion](https://app.notion.com/p/41d1642b67f38156a1beeabf03acf607).
