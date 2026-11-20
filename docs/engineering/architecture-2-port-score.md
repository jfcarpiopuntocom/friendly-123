# friendly-123 · PORTANDO arquitectura 1.0 → 2.0 · indicadores decimales verificables

**Corte más reciente (C45, 19 nov Ecuador / 20 nov UTC 2026):** app REAL `jfcarpiopuntocom/friendly-123` master **`be032b2b27fd52c299d8e1b6942d9b7bb2596934`**, shell **v0.8.19 / v819 / golden355**. Sync3 ya es 2.0 y se conserva; friendly123workshop es solo laboratorio, PRECODE, auditoría y memoria de ingeniería, nunca otra app.

| Indicador | Antes (C43) | Después (C44 fusionado / C45 auditado) | Delta |
| --- | ---: | ---: | ---: |
| **Migración 1.0→2.0, capacidades realmente ensambladas** | 87,0/100,0 | **87,5/100,0** | **+0,5** |
| **Calidad arquitectónica auditada** | 76,8/100,0 | **77,0/100,0** | **+0,2** |
| Aceptación comercial (por separado) | 0/6 | **0/6** | 0 |

**Definición:** 87,5 mide el cumplimiento de una rúbrica fija de capacidades de la misma app, no 87,5% del tráfico ya conmutado, ni disponibilidad comercial. La calidad es revisión de ingeniería, no un SLO. Base comparable tras D7: **68,5/100,0**; avance acumulado desde entonces **+19,0**. La ruta comercial 2.0 sigue QA OFF y ningún test sustituye el A→B→A físico.

## Desglose bajo los mismos pesos originales (100,0)

| Capacidad | Hecho | Peso | Falta |
| --- | ---: | ---: | ---: |
| SQLite/Yjs, diario, reapertura y merge | 16,0 | 17,0 | 1,0 |
| Historia congelada, certificación, R2 | 13,5 | 18,0 | 4,5 |
| Economía tipada (ventas, stock, abonos, recibos DO) | 16,5 | 17,0 | 0,5 |
| Tickets Owner/Team y salas | 12,5 | 14,0 | 1,5 |
| Fotos SHA fuera de Yjs | 7,0 | 9,0 | 2,0 |
| Catálogo público y lector certificado | 10,0 | 10,0 | 0,0 |
| Cableado navegador y retiro parcial 1.0 | 8,5 | 10,0 | 1,5 |
| Outbox, Safari y failback | 3,5 | 5,0 | 1,5 |
| **TOTAL** | **87,5** | **100,0** | **12,5** |

## Evidencia concreta C44 fusionada y crédito C45

- [PR #842 C44](https://github.com/jfcarpiopuntocom/friendly-123/pull/842) **MERGED** en el producto real: `docs/mock-backend.js` registra ajuste con `stockNuevo + opId` y abono con `amountCents + opId`, `docs/sync-realtime.js` preserva el ID original, y `docs/sync-yjs.js` lo traduce a comandos `stock.adjust` y `credit.payment.record` / `credit.customer.payment.record` usando los adaptadores ya injertados.
- La prueba real Workerd/Miniflare/SQLite confirma stock sintético **5→8**, cuenta por cobrar **3000→1500 centavos** y exactamente **2 efectos/2 recibos** después de repetir el mismo abono. Final candidato C44 **46/46 GitHub Actions SUCCESS**. [Workers Builds master C44](https://dash.cloudflare.com/c4d8aa3b3e1db0d80b0beb4abc7c1364/workers/services/view/friendly-123/production/builds/0d4d8889-2b95-4d70-8acc-b43852df983a) reportó `success` para SHA `be032b2b27fd52c299d8e1b6942d9b7bb2596934`.
- **Ponytail RED→GREEN:** la primera revisión reprodujo **4 fallos** de reintento de abono (Chromium/WebKit × EN/ES) por un hecho `inventario_abono` inventado después de respuesta perdida. El parche ya fusionado envía `OCSyncEmit("abono")` solo al registrar por primera vez el `movimientoId`, no toca el EventBus de inventario para un cobro. Volvieron a pasar las cuatro pruebas.
- Bajo los 17,0 puntos originales de economía, se acreditan **solo 0,5** del presupuesto previamente pendiente de 1,0 por cableado comercial QA del producto y su prueba con DO SQL real. Los otros **0,5 siguen pendientes** de despacho efectivo de producción y aceptación física. Calidad negocio **18,3→18,5**, total 76,8→77,0, por la regresión adversarial y continuidad de recibo. **GO 0/6; físico 0/5.** Sync3 intacto y flags QA OFF.
- Plan previo guardado en [workshop C45](https://github.com/jfcarpiopuntocom/friendly123workshop/blob/main/projects/assembled-v783/plans/2026-11-19-c45-c44-merged-fixed100-score-precode.md). La puntuación se comprueba con `node scripts/architecture-2-port-score.cjs`, `node --test test/p0-architecture-2-port-score.test.cjs`, manifests SHA y revisión de CI.

## Bloqueos concretos restantes (orden de raíz, sin nuevas funciones)

1. Historia comercial real: Firebase HEAD íntegro + certificación R2/binding; **4,5 puntos**.
2. Eliminar competencia de escritores solo después de certificar la instancia canónica y los opIds; activar ruta comercial tipada con ACK autorizado y respaldo reversible; el productor de ventas debe sobrevivir offline; **capacidad de activación y retiro legacy pendiente**.
3. Fotos SHA y roles conectados al UI del cliente, con CAS/ACK; confirmar con PC y Safari/PWA, sin pérdida histórica.
4. Ciclo físico A→B→A×2, misma licencia/PIN/sala, stock, dinero, ventas, fotos y roles consistentes en menos de 10 s. GO comercial sigue **0/6** hasta la evidencia real.

## Archivo histórico: cortes anteriores que no representan los indicadores actuales

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

## Revisión de calidad C19a/C20 tras integración en producto (19 nov, SHA 312201073975e3237014254fe9d87b87763c14ea)

- [#811 C19a](https://github.com/jfcarpiopuntocom/friendly-123/pull/811) MERGED: único writer de delta público `-cat`, C11/C10/C9, pruebas Workerd reales y 14 checks green (CodeRabbit skipped). Es un módulo nuevo NO conectado al camino comercial activo: por ello **81,5/100 PORT sin puntos extra**.
- [#812 C20](https://github.com/jfcarpiopuntocom/friendly-123/pull/812) MERGED: corrige un fallo real de cold-read C12, demostrado por C19a Workerd: `Y.applyUpdate` deja raíces `AbstractType` hasta `getMap`. C20 materializa solo `productos` y `ubicaciones` antes de validar la lista pública C9; `_meta`, PIN, ventas y dinero siguen prohibidos. RED 7/8→GREEN 8/8 con actual Yjs + prueba independiente de Workerd, Owner ticket real y SQL frío sin fuente. [30/30 checks completos en candidato SHA 499cf349](https://github.com/jfcarpiopuntocom/friendly-123/actions/runs/44600298131), release v0.8.07 `f123-shell-v807`, caché `golden343`, bundle SHA256 `a4730abd63a194a28a3c20a40ee78cbac4f171e9a4cee69be3962685e1b3867d`. Mejora acreditada calidad dimensión **sync 14,9→15,2 (+0,3)**, total **74,6→74,9/100**.
- Fuente de verdad en `friendly-123`, workshop solo audita: [reporte detallado C19a/C20](https://github.com/jfcarpiopuntocom/friendly123workshop/blob/main/projects/assembled-v783/reports/2026-11-19-real-c19a-c20-catalog-writer-cold-reader-merged.md). Ninguna bandera QA activada, ninguna escritura/bucket Cloudflare/R2, **gasto USD 0,00**. GO comercial **0/6**; prueba física iPhone/Opera/PC NO ejecutada.
- Pendiente real para ganar puntos PORT: integrar writer delta C19a con productor efectivo sin resiembra ni dos writers; luego componer dispatch comercial tipado contra ACK definitivo, fotos SHA y origen histórico; no sumar PRs abstractos.
