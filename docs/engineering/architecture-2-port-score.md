# friendly-123 · PORTANDO arquitectura 1.0 → 2.0 · indicadores fijos y auditables

**Corte C52 · 19 nov Ecuador / 20 nov UTC 2026.** Evaluada la **misma** app real `jfcarpiopuntocom/friendly-123` después de [PR #847 C49](https://github.com/jfcarpiopuntocom/friendly-123/pull/847) merge `b488705cfaeb4bac6e7a763696cb7af23576315d` y [PR #849 C51](https://github.com/jfcarpiopuntocom/friendly-123/pull/849) merge `1b64b3ca40d07abce9924222eea541e4c93ba283`, versión **v0.8.21 / shell v821 / golden357**. Sync3 sigue integrado; workshop es solo plan/evidencia, NO nueva app.

| Indicador de rúbrica fija | C50 anterior | C52 acreditado | Delta |
| --- | ---: | ---: | ---: |
| **Migración 1.0 → 2.0, capacidades instaladas en mismo producto** | 88,5/100,0 | **89,5/100,0** | **+1,0** |
| **Calidad arquitectónica de ingeniería** | 77,5/100,0 | **77,9/100,0** | **+0,4** |
| GO comercial certificado | 0/6 | **0/6** | 0 |
| Pruebas físicas PC↔Safari/PWA | 0/5 | **0/5** | 0 |

Migración mide partes integradas del código, NO porcentaje de tiendas realmente operando en 2.0 ni éxito comercial. Diferencia respecto a la base post-D7 de 68,5: **+21,0 puntos**, con presupuesto fijo de 100,0. Los dos flags 2.0 permanecen **OFF por defecto** y aún no se ha realizado corte comercial.

## Desglose SIN cambiar los pesos originales: 100,0

| Capacidad | Acreditado | Peso | Pendiente |
| --- | ---: | ---: | ---: |
| SQLite/Yjs, outbox, Web Locks, arranque QA C51 | **16,5** | 17,0 | **0,5** |
| Historia congelada, certificación Firebase HEAD y R2 | 13,5 | 18,0 | 4,5 |
| Economía tipada (ventas, stock, abonos, recibos DO) | 16,5 | 17,0 | 0,5 |
| Tickets Owner/Team y salas, C47 QA | 13,0 | 14,0 | 1,0 |
| Fotos SHA y CAS, C46 + C49 QA | **8,0** | 9,0 | **1,0** |
| Catálogo público y lector certificado | 10,0 | 10,0 | 0,0 |
| Cableado navegador y retiro del 1.0 | 8,5 | 10,0 | 1,5 |
| Failback, convergencia verificada dispositivos reales | 3,5 | 5,0 | 1,5 |
| **TOTAL** | **89,5** | **100,0** | **10,5** |

## C49 / C51 en master: evidencia distinta a crédito anterior

- **C49** [PR #847](https://github.com/jfcarpiopuntocom/friendly-123/pull/847) 11/11 CI + Cloudflare build SUCCESS del merge: ejecuta fuente real `docs/mock-backend.js` CAS en ubicación/percha (HTTP 200 inicial, 409 `PHOTO_POINTER_CONFLICT` con puntero preservado, 200 con revisión válida); foto guardada IDB→Sync3→Workerd SQLite `-fotos` y Team frío recupera bytes idénticos por SHA. Diferente de C46, que solo certificaba lectura fría y secuencia sintética de ventas. [Workerd C49 rerun sobre v0.8.21 combinado](https://github.com/jfcarpiopuntocom/friendly-123/pull/850/checks) GREEN, mantiene 1,0 de presupuesto foto/UI/físico sin acreditar.
- **C51** [PR #849](https://github.com/jfcarpiopuntocom/friendly-123/pull/849) 53/53 CI y Cloudflare build SUCCESS del merge: `docs/sync-yjs.js` limita la espera `navigator.locks.request` con `AbortController` (predeterminado 1.500 ms); si caduca la adquisición, conserva el arbitraje atómico IDB existente, y relanza errores reales de negocio/IDB. Instala `API.corte20QaHabilitado()`: solo con AMBOS `f123_yparty_qa=1` y `f123_corte20_qa=1`, rol efectivo Owner/Admin no demo y guardas de escritor único C38 puede intentar arranque 2.0. Por defecto ambos OFF. No prueba con iPhone físico ni promesa de cero bloqueos reales.
- En la rúbrica original, se divide el pendiente `operational-switch` 1,0 en `c51-bounded-locks-and-double-qa-bootstrap` 0,5 DONE y activación real 0,5 PENDING, y el pendiente foto `browser-photo-cutover` 1,5 en `c49-real-photo-cas-workerd-qa` 0,5 DONE y UI real/físico 1,0 PENDING. No existen puntos nuevos.
- Calidad +0,2 durabilidad y +0,2 fotos; físicos 0/5, comercial 0/6. No se acredita nada por reportes predictivos/simulados Hermes ni por PR #841 ledger intencionalmente RED bajo reserva ajena. [Plan PRECODE](https://github.com/jfcarpiopuntocom/friendly123workshop/blob/main/projects/assembled-v783/plans/2026-11-19-c49-c51-sameapp-integration-finite-precode.md).

## Historial anterior de C47/C50

## C47 producto real: causa raíz y frontera de crédito

- [PR #845](https://github.com/jfcarpiopuntocom/friendly-123/pull/845) fusionada a **v0.8.20** y **52/52 workflows verdes** en SHA candidato `5ece69610e8e9ae6383a06495b37abacd7f75725`; Cloudflare Workers Builds autenticado **SUCCESS** para SHA de master `2172eeae497cc62b96b60d86588418a6ee21fddf` (UUID `6a1e7226-1cf9-4801-9cc5-5500611a1fa5`).
- Tres tests adversariales **RED (18 PASS/3 FAIL) → GREEN (21/21)**: rol Owner falsificado en evento `oc-login`, sesión demo presentada como normal, activación antigua de escritor completada después de logout. El código real en `docs/sync-yjs.js` compara `OCAuth.rolActual()/esDemo()`, guarda una época monotónica `API.__authEpoch20`, verifica el cambio tras await y hace failback sin segundo escritor.
- **+0,5 migración** descontado de la partida `commercial-role-switch` previa de 1,5, que queda como 0,5 DONE verificación de cableado real (C47) + **1,0 pendiente de autorización comercial y físico**. **+0,2 calidad en security**, desde 10,3/15 a 10,5/15. Los 100,0 puntos totales no cambian.
- La simulación externa Hermes v509–v521 sobre identificadores `sha256(clientId+sequenceNumber)`, dashboard paginado SQLite y pipeline atómico fiado/comisiones **NO está respaldada por implementación/product CI y NO aporta puntuación**. [Triage contextual](https://github.com/jfcarpiopuntocom/friendly123workshop/blob/main/projects/assembled-v783/reports/2026-11-19-hermes-v509-v521-predictive-audit-triage.md). El conflicto real contable de IDs queda en [PR #841 RED](https://github.com/jfcarpiopuntocom/friendly-123/pull/841) y la reserva separada del ledger.

## Historial de evidencia C46/C48 (corte anterior)

## C46 fusionada, C48 puntuación con reserva física explícita

- [PR #844 C46](https://github.com/jfcarpiopuntocom/friendly-123/pull/844), fusionada en la **app real** SHA `f05cd2fa...`. Fuente ya ensamblada `docs/idb-fotos.js`, `docs/sync-yjs.js`, `docs/application/recover-shelf-photo.js` y bundle YParty ejecutados por Miniflare Workerd SQLite. Foto subida por Owner a `-fotos` SHA, sin blobs binarios legados Yjs, y leída idéntica por Team frío con otro IndexedDB. [Workerd C46 run 44660882184](https://github.com/jfcarpiopuntocom/friendly-123/actions/runs/44660882184): 1/1 TAP PASS, más 11/11 workflows completos y Cloudflare build SUCCESS para merge.
- Auditoría independiente detectó que la primera prueba solo recorría A→B→A una vez y decía ×2. Tras [plan Ponytail previo](https://github.com/jfcarpiopuntocom/friendly123workshop/blob/main/projects/assembled-v783/plans/2026-11-19-c46-second-cycle-real-workerd-precode.md) se amplió a **A1→B1→A2→B2→A3**, cinco `opId` y replays; SQL quedó en stock0, caja8000 centavos, exactamente cinco efectos y cinco recibos.
- El crédito de implementación es **+0,5** separado de los 2,0 originales pendientes de foto/UI, dejando 1,5 para UI real, CAS y aparatos. El test pasa sobre código de producto realmente fusionado, no sobre arquitectura paralela ni una mera plantilla. La calidad suma **+0,2 fotos y +0,1 sincronización**, manteniendo dispositivos físicos0/5 y GO0/6. En ningún caso se acredita `verified-cross-device-downpath` físico por una simulación.
- [PRECODE de puntuación C48](https://github.com/jfcarpiopuntocom/friendly123workshop/blob/main/projects/assembled-v783/plans/2026-11-19-c47-c46-real-product-fixed100-photo-qa-score-precode.md). Scripts `node scripts/architecture-2-port-score.cjs` y `node --test test/p0-architecture-2-port-score.test.cjs` exigen código real, manifest SHA y dos ciclos Workerd.

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
