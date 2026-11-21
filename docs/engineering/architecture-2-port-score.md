# Estado vigente, 20 de noviembre de 2026: C106

**Implementación de arquitectura 2.0: 100,0/100. Calidad arquitectónica: 81,2/100.** Las dos mediciones son independientes.

Fuente canónica actual: [`architecture-2-port-score.json`](./architecture-2-port-score.json) y [`architecture-2-quality-score.json`](./architecture-2-quality-score.json). Auditoría C106: [PR #916](https://github.com/jfcarpiopuntocom/friendly-123/pull/916), SHA publicado `fc66d92693f520d2ec1d2746d1204975db962976`. Calidad sube de 80,4 a 81,2 por mejoras acreditadas en Business, Durability, Sync, Security y Migration. La activación comercial y la aceptación física se controlan por separado y no son el porcentaje de implementación.

**Archivo histórico:** las secciones desde C85 hacia abajo son registros de auditorías anteriores. Sus cifras 92,0/100, 80,0/100 y anteriores son históricas, no el estado actual. Consultar siempre los dos JSON vigentes para las puntuaciones actuales.

---
# friendly-123 · PORTANDO LA MISMA APP 1.0 → arquitectura 2.0

## C85 · 20-nov-2026 Ecuador · seguridad origen R2 estricto, calidad80,0/100

Se PORTA la MISMA friendly-123 de arquitectura 1.0→2.0, Sync3 intacto; taller exclusivamente PRECODE, QA y evidencia. La rúbrica original100 permanece congelada; certificación comercial y pruebas físicas no se infieren de CI.

| Métrica original /100 con un decimal | Previa C81 | C85 | Delta |
| --- | ---: | ---: | ---: |
| Transición arquitectura 1.0→2.0 misma app | 92,0 | **92,0** | 0,0 |
| Calidad arquitectónica | 79,9 | **80,0** | +0,1 |
| Security (peso15) | 11,0 | **11,1** | +0,1 |
| Business (peso20) | 19,0 | **19,0** | 0,0 |
| GO comercial | 0/6 | **0/6** | 0 |
| Físico PC Opera↔iPhone Safari/PWA | 0/5 | **0/5** | 0 |

**Fuente C84 en el producto REAL:** [PR #883 fusionada](https://github.com/jfcarpiopuntocom/friendly-123/pull/883) SHA `8c34cb3d40fc987d537ce2c0ba54d75d6224027b` verifica opt-in `WS_R2_MANIFEST_REQUIRED_QA==='1'` y niega lector V1 sin manifiesto externo; V1 flag OFF sigue compatible y V2 válido pasa. [RED autentico 3/5 con 2 errores de rechazo ausente](https://github.com/jfcarpiopuntocom/friendly-123/actions/runs/44774691139), GREEN suite C84 y validación Yjs OSS, D2/D6/D7 en GH CI. Cloudflare Workers Builds GET cuenta real **SUCCESS** para SHA exacto `8c34cb3d40fc987d537ce2c0ba54d75d6224027b`, build UUID `6116411e-29a2-44de-a2ab-b0757719d28c`.

**C85 puntuación TDD:** [PRECODE previo](https://github.com/jfcarpiopuntocom/friendly123workshop/blob/main/projects/assembled-v783/plans/2026-11-20-c85-c84-r2-strict-source-security80p0-precode.md); [PR #884](https://github.com/jfcarpiopuntocom/friendly-123/pull/884) RED test-only [run44780907216](https://github.com/jfcarpiopuntocom/friendly-123/actions/runs/44780907216) `79.9 !== 80` por puntaje antiguo, no harness. GREEN exige fuente SHA C84 real, pruebas C84 y no atribuye puntos de historia/port: Business original19,0, Security11,1, previous79,9 y calidad80,0, GO0/6, físico0/5. No se alteraron código funcional, flags, datos ni secretos.

**Pendiente transición8,0:** Firebase HEAD económico auténtico2,0 **no auditado desde Firebase en esta ejecución**; fuente histórica R2/Service Binding real2,0; operación/roles/fotos/failback físico4,0. Un bucket QA R2 vacío no certifica Firebase ni autorización comercial. La bandera R2 estricto OFF no convierte una respuesta V2 autocertificada en HEAD real. Mantener QA OFF, sin activar gastos, sin tocar Sync3 ni reservas otras IA (#871 Yjs, #868 fotos, #841 ledger).


## C81 · 20-nov-2026 Ecuador · recuento físico ABSOLUTO original, calidad79,9, transición92,0

Se PORTA la **MISMA friendly-123** 1.0→2.0 mediante componentes OSS maduros, **Sync3 YA es 2.0 y se conserva**; workshop solo PRECODE/QA/evidencia, funcionalidad integrada en producto real. [PR #881 C80 FUENTE MERGED](https://github.com/jfcarpiopuntocom/friendly-123/pull/881), `master@52dd4b6f7d854387a578cc53a8be9c761ffc8105`. **17/17 GitHub Actions** source HEAD `f74cac4040e364d2b173217514cf828fe303acdf` SUCCESS; **Cloudflare Workers Builds API GET cuenta real SHA exacta master `52dd4b6f7d854387a578cc53a8be9c761ffc8105` SUCCESS**, UUID `39f2a22c-5fbc-4bd4-8ed5-8bb75e5da2ec`.

| DOS métricas originales con un decimal y presupuesto fijo100 | C79 antes | C81 | Delta |
| --- | ---: | ---: | ---: |
| **Transición de MISMA friendly-123 1.0→2.0** | 92,0/100,0 | **92,0/100,0** | 0,0 |
| **Calidad arquitectónica** | 79,8/100,0 | **79,9/100,0** | +0,1 |
| Dimensión Business | 18,9/20,0 | **19,0/20,0** | +0,1 |
| Dimensión Security | 11,0/15,0 | **11,0/15,0** | 0,0 |
| GO comercial | 0/6 | **0/6** | 0 |
| Física PC Opera↔iPhone Safari/PWA | 0/5 | **0/5** | 0 |

**P0 causa raíz original distinta C74/C76/C78:** `stock.adjust` es un recuento ABSOLUTO `quantity:N` firmado por SHA del payload del receipt. El servidor SQL registra delta N−stockAnterior. Reentrada C72→C79 sumaba los deltas y comprobaba stock FINAL, pero no verificaba N original por cada opId, de modo que alterar count5 con delta−4 y stock6 obtenía falso `already:true`, pese al receipt original count5 sin modificar. **RED fuente real [Actions44763936393](https://github.com/jfcarpiopuntocom/friendly-123/actions/runs/44763936393)** Node22 SQLite nativo + ledger original: **4/7 PASS, 3/7 FAIL por Missing expected exception** (single count5 adulterado, count entre ventas adulterado y count0→1 adulterado). Controles de ventas, fiados, 202 y opIds inversos PASS.

**Ponytail GREEN y preservación auditoría:** primera fuente [Actions44764234653](https://github.com/jfcarpiopuntocom/friendly-123/actions/runs/44764234653) 7/7 C80 + regresiones Workerd, pero cambió firma auditada de `verifyTypedBusinessEffects` y el validador original100 rechazó; ese HEAD NO se fusionó. Corrección completa [Actions44764713480](https://github.com/jfcarpiopuntocom/friendly-123/actions/runs/44764713480) mantiene firma original, devuelve Map opId→N desde payload SHA validado y reconciliador original aplica movimientos en `ORDER BY rowid` (secuencia de inserción local SQLite, no certificación externa Firebase), comprueba `stockAnterior+delta===N` después de cada recuento y rechaza saldo transitorio negativo. **GREEN C80 7/7, C78 6/6, C76 6/6, C74 5/5, C72 11/11, C68 8/8, Workerd pagos2/2 y ventas2/2, CLI score original100 PASS, 17/17 workflows**. Solo fuente `cloudflare-yparty-worker/src/authoritative-business-sql.mjs`, test y workflow; sin nuevo hash ni escritor, usa OSS `@noble/hashes@2.4.0` existente. No tocar Sync3, PIN, fotos, cliente, hot sale ni Cloudflare settings.

**C81 score** separado, [PRECODE ANTES de score](https://github.com/jfcarpiopuntocom/friendly123workshop/blob/main/projects/assembled-v783/plans/2026-11-20-c81-c80-physical-absolute-count-quality79p9-precode.md): RED test-only `79,8!==79,9`; GREEN Business +0,1 SOLO 18,9→19,0, sum `dimensions.previous` exactamente79,8, demás ejes fijos, `lastAuditedProductSha` C80 merged real. Transición permanece92/100, **8,0 puntos no ganados** (HEAD Firebase económico auténtico2,0; Service Binding R2 REAL2,0; operativo/roles/fotos/failback físico4,0). GO0/6 físico0/5 y QA OFF. Ni SQLite rowid local ni GH CI verde ni Build autentican cabeza económica original de Firebase o pruebas físicas de Belén. Reservas otras IA PR #871 Yjs, #868 fotos, #841 ledger intactas.

---

### Histórico · C79 y anteriores

## C79 · 20-nov-2026 Ecuador · Integridad SHA en gastos y pagos de clientes 202, calidad79,8

Se PORTA la **MISMA friendly-123** 1.0→2.0 con injertos OSS maduros. Sync3 YA forma parte de2.0 y se conserva; workshop es solo QA/PRECODE, funcionalidad en `jfcarpiopuntocom/friendly-123`. [C78 PR fuente #879 MERGED](https://github.com/jfcarpiopuntocom/friendly-123/pull/879), producto `master@2980aa59f3345b757a9e504465c54fd6b703987d`. **16/16 GitHub Actions** en el HEAD fuente `a6beab3e8a5c6046824c6776bfffa804c6f01e9e` GREEN, **Cloudflare Workers Builds API GET cuenta real, branch master, SHA EXACTA `2980aa59f3345b757a9e504465c54fd6b703987d` SUCCESS**, build `8540651c-9dfc-4d52-ae59-aa46377e44d3`. Sin cambios en cliente, Sync3, Cloudflare settings, R2 ni PIN.

| Indicadores sobre **dos presupuestos originales fijos100** | C77 previo | C79 actual | Cambio |
| --- | ---: | ---: | ---: |
| **Transición de misma friendly-123 1.0→2.0** | 92,0/100,0 | **92,0/100,0** | 0,0 |
| **Calidad arquitectónica** | 79,7/100,0 | **79,8/100,0** | +0,1 |
| Dimensión Security | 10,9/15,0 | **11,0/15,0** | +0,1 |
| Dimensión Business | 18,9/20,0 | **18,9/20,0** | 0,0 |
| GO comercial | 0/6 | **0/6** | 0 |
| Física PC Opera↔Safari/PWA iPhone | 0/5 | **0/5** | 0 |

**Causa raíz C78 (independiente de C76):** El ledger SQL tipado ya guarda cinco kinds, incluyendo gastos `expense.record` y pagos de clientes `credit.customer.payment.record` como `stored-for-application` 202 **sin efecto económico**. Al reabrir una base certificada C72/C76, `verifyTypedBusinessEffects` validaba JSON canónico/SHA256 de venta, stock y fiado pero **omitía** las dos clases queued-only con `if(!contract)...continue`. Alterar importe de gasto202 o el `clienteId` de un pago202 conservando el hash original obtenía falso `already:true`; también aceptaba `kind` desconocido sintético como 202. **RED genuino [Actions44758958830](https://github.com/jfcarpiopuntocom/friendly-123/actions/runs/44758958830)** nativo Node22 SQLite+ledger REAL: 3/6 PASS y 3/6 FAIL por `Missing expected exception`; controles de ambos 202 válidos, venta200+abono parcial y tenant isolation PASS. **GREEN definitivo [Actions44759148908](https://github.com/jfcarpiopuntocom/friendly-123/actions/runs/44759148908)** C78 **6/6**, C76 6/6, C74 5/5, C72 11/11, C68 8/8, Workerd cobros2/2 y ventas2/2, score original100 PASS. Cambio mínimo en `cloudflare-yparty-worker/src/authoritative-business-sql.mjs`: ampliar `contracts` a cinco tipos, los dos nuevos `queuedOnly:true`, verificar SHA existente con injerto MIT `@noble/hashes@2.4.0` a todos, rechazar tipos desconocidos y cualquier efecto/200 de clase queued-only, conservar dinero y stock. No hay módulo nuevo de pagos ni rediseño.

**C79 SCORE solo calidad Security +0,1** porque protege integridad y autenticidad interna del payload 202 con SHA, sin duplicar crédito de C76 (payload→receipt) o C74 (precio certificado). Budget original100 se conserva; **transición92,0 con 8,0 puntos no ganados**, Firebase HEAD económico REAL2,0, Service Binding/R2 REAL2,0, operacional/roles/fotos/failback físico4,0. GO0/6 físico0/5, flags QA OFF. [C78 PRECODE](https://github.com/jfcarpiopuntocom/friendly123workshop/blob/main/projects/assembled-v783/plans/2026-11-20-c78-pending-expense-customer-payment-sha-precode.md), [C79 PRECODE](https://github.com/jfcarpiopuntocom/friendly123workshop/blob/main/projects/assembled-v783/plans/2026-11-20-c79-c78-queued-expense-customer-sha-security79p8-precode.md) persistidos ANTES de edit. Reservas PR871 Yjs, PR868 fotos y PR841 ledger intactas. La verificación SHA dentro de DO SQL no es prueba de firma externa ni del estado económico real de Belén; Cloudflare build tampoco es autorización de uso comercial.

---

### Histórico · C77 y anteriores

## C77 · 20-nov-2026 · payload↔recibo económico 202 completo y dos métricas originales /100

Se PORTA la **MISMA friendly-123** 1.0→2.0 mediante componentes OSS maduros, Sync3 YA es2.0 y se conserva, workshop solo QA/PRECODE. [C76 source PR #877 MERGED](https://github.com/jfcarpiopuntocom/friendly-123/pull/877) en `master@53d4aa15fbd486dd593fc407814adc6cc707cd0a`. **15/15 GitHub workflows del HEAD fuente `e46f587ee5a00710a5041fa7bab76d3adf404773` SUCCESS**, Cloudflare Workers Builds GET cuenta real SHA exacta master **SUCCESS** UUID `b35b11b1-134f-4576-8f96-edce535e5333`. No se modificó cliente/Sync3/Cloudflare settings ni datos de clientes.

| DOS métricas independientes (peso original100 invariable) | C75 anterior | C77 actual | Delta |
| --- | ---: | ---: | ---: |
| **Transición de misma friendly-123 1.0→2.0** | 92,0/100,0 | **92,0/100,0** | 0,0 |
| **Calidad arquitectónica** | 79,6/100,0 | **79,7/100,0** | +0,1 |
| Calidad Business | 18,8/20,0 | **18,9/20,0** | +0,1 |
| Calidad Durability | 18,6/20,0 | **18,6/20,0** | 0,0 |
| Comercial GO | 0/6 | **0/6** | 0 |
| Física PC Opera↔Safari/PWA iPhone | 0/5 | **0/5** | 0 |

**Causa raíz (distinta C72, C74):** el ledger tipado atómico ya guarda recibo 202/200 y su payload en dos tablas; la reentrada certificada verificaba sólo receipt→payload, permitiendo **falso `already:true`** si se conservaba un payload huérfano o se perdía SOLO el recibo 202 de una operación pendiente, sin efecto económico ni obligación reconocida. [RED fuente real Actions44753135356](https://github.com/jfcarpiopuntocom/friendly-123/actions/runs/44753135356), `node:sqlite` nativo y `createTypedCommercialLedger` real: **3/6 PASS y 3/6 FAIL por Missing expected exception**, casos (1) venta200 válida+payload huérfano; (2) receipt202 eliminado con payload original intacto; (3) payload extra junto a 202 legítimo. Controles de venta3998+abono fiado1000+recuento5, 202 sin efecto y licencia ajena PASS. **GREEN [Actions44753281288](https://github.com/jfcarpiopuntocom/friendly-123/actions/runs/44753281288)**: **6/6 C76 nativo, 5/5 C74, 11/11 C72, 8/8 C68, 2/2 Workerd cobros y 2/2 Workerd ventas/caja**, rubric original100 PASS, 15/15 global GH workflows. Cambio mínimo SOURCE `cloudflare-yparty-worker/src/authoritative-business-sql.mjs`: durante read-only `verifyTypedBusinessEffects` en duplicado `installBusinessBaseline`, exigir `saved.length===receipts.length` y unicidad de IDs por licencia, conservando comprobación receipt→payload previa y su SHA OSS `@noble/hashes`. No borra payload, fabrica ACK ni cambia hot path.

**Ocho puntos PORT siguen sin ganar**: HEAD económico Firebase ORIGINAL autenticado2,0, R2 Service Binding real2,0, operación/roles/fotos/failback físico4,0. No confundir test/Build sintético con GO comercial ni con datos de Belén reales. [PRECODE C76](https://github.com/jfcarpiopuntocom/friendly123workshop/blob/main/projects/assembled-v783/plans/2026-11-20-c76-typed-payload-202-orphan-reopen-precode.md), [PRECODE C77](https://github.com/jfcarpiopuntocom/friendly123workshop/blob/main/projects/assembled-v783/plans/2026-11-20-c77-c76-payload-202-architecture-quality-79p7-precode.md) antes de los edits. PR871 unión Yjs, PR868 fotos, PR841 ledger reservadas intactas. QA OFF, GO0/6 y físico0/5.

---

### Histórico · C75 y anteriores

## C75 · 20-nov-2026 Ecuador · calidad 79,6 y transición 92,0, DOS rúbricas fijas100

Se PORTA la **MISMA friendly-123** 1.0→2.0 con injertos maduros; Sync3 ya es 2.0 y permanece. [C74 fuente real PR #875 MERGED](https://github.com/jfcarpiopuntocom/friendly-123/pull/875) `master@45d54fbdec1fb07fbca52f090c2abcc75528c040`, **14/14 GH Actions** del source HEAD `76e9f9969d46f8df0f81905ad7a7826f86d6f307` verdes. Cloudflare Workers Builds GET rama master **SHA exacta** `45d54fbdec1fb07fbca52f090c2abcc75528c040` **SUCCESS** UUID `d4c8a595-0ef2-4b26-8788-7966307703fa`. Fuera del scope quedan cliente/Cloudflare settings/Sync3/PIN.

| DOS MÉTRICAS /100, original peso inmutable | C73 anterior | C75 actual | Delta |
| --- | ---: | ---: | ---: |
| **Transición de la misma friendly-123 1.0→2.0** | 92,0/100,0 | **92,0/100,0** | 0,0 |
| **Calidad arquitectónica** | 79,5/100,0 | **79,6/100,0** | +0,1 |
| Calidad Business | 18,7/20,0 | **18,8/20,0** | +0,1 |
| Calidad Durability | 18,6/20,0 | **18,6/20,0** | 0,0 |
| GO comercial | 0/6 | **0/6** | 0 |
| Físico PC Opera↔iPhone Safari/PWA | 0/5 | **0/5** | 0 |

**Causa raíz nueva C74 distinta de C72:** cotejo de recibos y efectos por opId con `@noble/hashes` no sustituye el **precio original congelado e independientemente SHA-certificado**. Podía aceptar efecto+caja+receipt+SHA coherentes por 4998 centavos aun cuando el SKU originalmente certificado tenía precio1999 por unidad y se vendían 2 (=3998). También podía iniciar baseline económico nuevo sobre `typed_commercial_payloads` pendiente o `f123_frozen_unions` preexistente sin certificación de corte. **RED fuente [Actions44749696133](https://github.com/jfcarpiopuntocom/friendly-123/actions/runs/44749696133)** 2/5 native Node22 SQLite PASS, tres negativos FAIL por falta de excepción; un run anterior 44749545420 fue **error sintáctico de harness** reparado antes del RED genuino, no se contabilizó como defecto. **GREEN [Actions44749881266](https://github.com/jfcarpiopuntocom/friendly-123/actions/runs/44749881266)** C74 5/5 native SQL, regresión C72 11/11, C68 8/8, Workerd fiados 2/2 y venta/caja 2/2. El mínimo cambio fuente está SOLO en `cloudflare-yparty-worker/src/authoritative-business-sql.mjs`, comparación `BigInt(c)===BigInt(-q)*certifiedPrices` durante reentrada y guard de bootstrap `hasRows` para los dos historiales omitidos. Mantiene precio negocio hot path, 202, cobros parciales, Sync3 y fotos intactos.

**C75 crédito acotado de ingeniería:** +0,1 SOLO Business de calidad por source C74 merge/CI/CF; la transición queda92,0/100 y NO se acredita Firebase HEAD económico verdadero2,0, binding Service/R2 real2,0 ni operacional/roles/fotos/failback físico4,0. GO0/6 físico0/5. El SHA y precio congelado en mismo DB no significan firma independiente de hechos económicos de clientes. [PRECODE C74 antes de source](https://github.com/jfcarpiopuntocom/friendly123workshop/blob/main/projects/assembled-v783/plans/2026-11-20-c74-certified-price-and-occupied-economic-bootstrap-precode.md), [PRECODE C75 antes de score](https://github.com/jfcarpiopuntocom/friendly123workshop/blob/main/projects/assembled-v783/plans/2026-11-20-c75-c74-quality-79p6-source-evidence-precode.md). Reservas PR871 Yjs, PR868 fotos, PR841 ledger intactas.

---

### Histórico · C73 y anteriores

## C73 · 20 nov 2026 Ecuador · source C72 / calidad Business 18,7, GO independiente

La **MISMA friendly-123** se PORTA de arquitectura1.0→2.0 mediante injertos maduros; Sync3 ya pertenece a 2.0 y se conserva. [C72 source PR #872 MERGED](https://github.com/jfcarpiopuntocom/friendly-123/pull/872) `master@e68ab10634721d3e0315055f47a226a0736c3e91`. **13/13 GH Actions full fuente head `303701ddd` GREEN**, Cloudflare Workers Builds cuenta real SHA exacto merge **SUCCESS** UUID `6f5697c2-49e7-4657-b5ac-6b05938ab190`. No cambio de acceso cliente/flags QA ni servicio R2. Workshop sólo PR/PRECODE/QA, no producto distinto.

| Rúbrica original /100 y dim. Business | C69 anterior | C73 vigente | Cambio |
| --- | ---: | ---: | ---: |
| **Transición de misma app 1.0→2.0** | 92,0/100,0 | **92,0/100,0** | 0,0 |
| **Calidad arquitectónica** | 79,4/100,0 | **79,5/100,0** | +0,1 |
| Calidad Business | 18,6/20,0 | **18,7/20,0** | +0,1 |
| Calidad durabilidad (C67 anterior) | 18,6/20,0 | **18,6/20,0** | 0,0 |
| GO comercial | 0/6 | **0/6** | 0 |
| Físico PC Opera↔iPhone Safari/PWA | 0/5 | **0/5** | 0 |

**Causa raíz y TDD auténtico C72:** C68E ya conciliaba saldos caja/stock/fiados contra `f123_business_effects` pero **falso ACK `already:true`** si un SQL efecto conservaba saldos válidos sin receipt `business-committed`, o si una venta 200 perdía su efecto y se revertían juntos caja/stock. [RED original run44743811549](https://github.com/jfcarpiopuntocom/friendly-123/actions/runs/44743811549) en módulos reales `authoritative-business-sql` y `typed-commercial-ledger` sobre SQLite nativo **2/10 PASS, 8 FAIL**. Primera versión green 10/10; una prueba más [RED run44744532376](https://github.com/jfcarpiopuntocom/friendly-123/actions/runs/44744532376) 10/11 al modificar conjuntamente `payload_json`, efecto y caja conservando antiguo SHA. El intento de usar `node:crypto` de runtime causó error de bundling neutral en Workerd, detectado en [run44744688791](https://github.com/jfcarpiopuntocom/friendly-123/actions/runs/44744688791). Se **injertó el proyecto OSS maduro `@noble/hashes@2.4.0`**, ESM MIT cero dependencias, SHA-256 síncrono, versión e integridad SHA512 de tarball fijada en Worker package+lock: ningún hash propio. [GREEN FINAL run44745296534](https://github.com/jfcarpiopuntocom/friendly-123/actions/runs/44745296534) **11/11 C72 SQLite nativo real, 8/8 C68, 2/2 Workerd fiado y 2/2 Workerd ventas/caja**. Fuente `verifyTypedBusinessEffects` se ejecuta SOLO en reintento de certificado 2.0 y verifica relación bilateral por `opId` recibos 200+payload SHA con efectos SQL, 202 sin efecto admitido. No se modifica ruta caliente de ventas ni hay ajustes ficticios.

**Límites:** el hash coincide con SHA guardado por el ledger tipado y evita inconsistencias dentro de SQL; no implica firma externa si alguien puede reescribir todos los campos de SQL coordinadamente. **Faltan 8,0 puntos de transición** no pagados con tests: HEAD económico Firebase original real2,0, Service Binding R2 real2,0, operación/roles/fotos/failback/corte físico4,0. Comercial GO0/6, físico0/5. La [PR #873 C71](https://github.com/jfcarpiopuntocom/friendly-123/pull/873) de otra IA se abrió simultáneamente sobre `authoritative-business-sql.mjs` partiendo de C69; en su conversación [se documentó la colisión](https://github.com/jfcarpiopuntocom/friendly-123/pull/873) y **NO debe fusionarse sin rebase y reconciliación**: su posible aporte separado es verificación de precio exacto y bootstrap sin tablas previas. [C73 PRECODE](https://github.com/jfcarpiopuntocom/friendly123workshop/blob/main/projects/assembled-v783/plans/2026-11-20-c73-c72-typed-receipts-quality-79p5-precode.md) antes de score. PR871 unión Yjs, PR868 fotos y PR841 ledger reservadas intactas.

---

### Histórico · C69 y anteriores

## C69 · 20 nov 2026 · reentrada económica SQL certificada y métricas /100

Se PORTA la **MISMA friendly-123** a arquitectura 2.0 mediante injertos maduros; Sync3 se mantiene. [C68 económica PR #869 MERGED](https://github.com/jfcarpiopuntocom/friendly-123/pull/869) en producto `master@df43c24ac081fc9530e45cc595c1f2edcd6ae0f5`, 12/12 GitHub Actions del HEAD `b8a9190` GREEN. Cloudflare Workers Builds de la cuenta real, rama master, commit SHA idéntico: **SUCCESS**, UUID `6c3c2215-0810-4bbb-9541-9765a0fc348e`. QA OFF, sin tocar Sync3, PIN, clientes ni R2.

| Dos indicadores independientes, denominador original fijo100,0 | C67 anterior | C69 actual | Delta |
| --- | ---: | ---: | ---: |
| **Transición misma app 1.0→2.0** | 92,0/100,0 | **92,0/100,0** | 0,0 |
| **Calidad arquitectónica** | 79,3/100,0 | **79,4/100,0** | +0,1 |
| Calidad Business (20 pts) | 18,5/20,0 | **18,6/20,0** | +0,1 |
| Comercial GO | 0/6 | **0/6** | 0 |
| Físico Opera PC↔Safari/PWA iPhone | 0/5 | **0/5** | 0 |

**Problema real corregido por C68:** el reintento de un certificado de tienda 2.0 podía dar `already:true` aunque un fiado congelado hubiera desaparecido, su deuda se alterase sin pago, caja/stock cambiasen sin opId o un cobro confirmado perdiese su efecto SQL. RED [Actions 44739485973](https://github.com/jfcarpiopuntocom/friendly-123/actions/runs/44739485973) con el `authoritative-business-sql.mjs` verdadero más `node:sqlite` nativo: 1/8 PASS, siete faltas de rechazo `Missing expected exception`; control de venta/cobro parcial/recuento legítimos PASS. GREEN [Actions 44739725091](https://github.com/jfcarpiopuntocom/friendly-123/actions/runs/44739725091): 8/8 nativo SQLite, 2/2 cobros Workerd y 2/2 ventas/caja Workerd. El injerto `reconcileCertifiedBusinessReadback` se ejecuta **únicamente en la rama de reentrada con certificado ya existente**, verifica stock inicial+Σdelta, caja inicial+Σefectos de cobro/venta y fiado inicial−Σabonos con `BigInt` y comparación de IDs exactos. **No repara balances ficticiamente, no modifica la vía viva de transacciones ni prueba causalidad completa del histórico Firebase real.** Los efectos SQL no sustituyen la certificación de cada recibo original: este crédito es **solo +0,1 de confianza de ingeniería Business**.

**8,0 puntos de transición SIGUEN pendientes:** HEAD económico Firebase auténtico2,0; Service Binding/R2 real2,0; operaciones/roles/fotos/corte físico4,0. La [PR #868 de fotos SHA](https://github.com/jfcarpiopuntocom/friendly-123/pull/868) paralela tiene otros archivos y su propia evidencia; el score C69 no la puntúa. `docs/core/ledger.js` PR841 reservado se conservó. [C68 PRECODE](https://github.com/jfcarpiopuntocom/friendly123workshop/blob/main/projects/assembled-v783/plans/2026-11-20-c68-economic-reopen-immutable-effect-reconciliation-precode.md) y [C69 PRECODE antes del score](https://github.com/jfcarpiopuntocom/friendly123workshop/blob/main/projects/assembled-v783/plans/2026-11-20-c69-economic-reopen-source-backed-quality-79p4-precode.md).

---

### Historial · C67 y anteriores

## C67 · 20-nov-2026 Ecuador · dos puntuaciones vigentes /100, misma aplicación

**C66 fuente real [PR #866 MERGED](https://github.com/jfcarpiopuntocom/friendly-123/pull/866)**: `master@a46da3753ec23ecee2606f5ed206fe4c6ba10f25`, **15/15 GH Actions** del head source GREEN, Cloudflare Workers Builds **SUCCESS** mismo merge SHA UUID `b091735c-0cc5-4351-9c29-f5894c836544`. El injerto reusa Yjs nativo para preservar el vector causal de cada escritor congelado en la misma transacción SQL de importación y certificarlo en reaperturas tras compactación. **Sync3 intacto**, flags QA OFF, workshop solo laboratorio/planes.

| Indicador original100 inmutable | C65 anterior | C67 real source | Diferencia |
| --- | ---: | ---: | ---: |
| **Transición 1.0→2.0 de la MISMA friendly-123** | 92,0/100,0 | **92,0/100,0** | 0,0 |
| **Calidad arquitectónica** | 79,2/100,0 | **79,3/100,0** | +0,1 |
| Subdimensión calidad durabilidad | 18,5/20,0 | **18,6/20,0** | +0,1 |
| GO comercial certificado | 0/6 | **0/6** | 0 |
| Físico PC Opera↔iPhone Safari/PWA | 0/5 | **0/5** | 0 |

**Evidencia causal real (QA):** [RED 44735648192](https://github.com/jfcarpiopuntocom/friendly-123/actions/runs/44735648192) verdadero defecto fuente `true !== false`: un bloque Yjs válido podía haber perdido completamente un escritor importado y aun así recibir `opened:true` al reabrir. [GREEN 44736130197](https://github.com/jfcarpiopuntocom/friendly-123/actions/runs/44736130197): 6/6 pruebas con SQLite nativo real e importador real (bloque sustituto, certificado perdido, SHA alterado, recibo anterior sin vector, borrado legítimo después de importación), 9/9 importador, 3/3 regresión C64 y 5/5 YParty Workerd real. `Y.encodeStateVectorFromUpdate` + `Y.decodeStateVector` comprueban los relojes del origen congelado contra snapshot+journal. **Dominancia vectorial es condición causal necesaria, no hash criptográfico de cada evento/importe.** No se certifica historia económica Firebase real ni unión física por esta prueba.

**8,0 puntos PORT pendientes sin alterar:** historial Firebase HEAD económico REAL **2,0**, binding Service/R2 REAL **2,0**, operación/roles/fotos/corte físico **4,0**; GO comercial0/6, físico0/5. Las otras dimensiones de calidad y pesos originales no se reponderan. [Plan primero C67](https://github.com/jfcarpiopuntocom/friendly123workshop/blob/main/projects/assembled-v783/plans/2026-11-20-c67-c66-vector-continuity-quality-79p3-precode.md), Notion y workshop guardan la evidencia de RED→GREEN. No se tocó ledger PR841 reservado.

---

### Histórico · C65 y anteriores

## C65 · 20 nov 2026 · score actual fuente C64 fusionada, rúbrica invariable100,0

Misma `friendly-123`, Sync3 intacto, workshop solo laboratorio. [C64 PR #864](https://github.com/jfcarpiopuntocom/friendly-123/pull/864) fue fusionada a código real `master@ca86aa4bbe7df1d9da0293e803896edbac53380b` después de **14/14 GitHub Actions SUCCESS** sobre head final `d94685c`, **Workerd real 5/5** y prueba aislada source-executed **3/3**. Cloudflare Workers Builds exact SHA fusionado **SUCCESS**, build `b09be442-96ae-4802-a5b6-21f6256ceee3`. QA OFF; sin migración ni cambio de datos de clientes.

| Dos indicadores independientes | C63 anterior | C65 source audited | Variación |
| --- | ---: | ---: | ---: |
| **Transición 1.0→2.0 de la MISMA app** | 92,0/100,0 | **92,0/100,0** | 0,0 |
| **Calidad arquitectónica** | 79,1/100,0 | **79,2/100,0** | +0,1 |
| Comercial GO | 0/6 | **0/6** | 0 |
| Pruebas físicas PC Opera↔iPhone Safari/PWA | 0/5 | **0/5** | 0 |

**C64 root cause y crédito estrictamente acotado:** recibo de import congelado podía aceptar un journal Yjs sintácticamente válido aun perdiendo su instantánea original, o una instantánea antigua `documento` podía sustituir fraudulentamente la base `documento_bloques`. RED1 [44731412320](https://github.com/jfcarpiopuntocom/friendly-123/actions/runs/44731412320) 1/2; RED2 [44731901974](https://github.com/jfcarpiopuntocom/friendly-123/actions/runs/44731901974) 2/3; GREEN [44732002319](https://github.com/jfcarpiopuntocom/friendly-123/actions/runs/44732002319) 3/3 source-executed, 5/5 Workerd. Guarda real de `openExistingStore`: solo `snapshotKind==='blocks'` para certificado anterior. Puntuar **solo +0,1 de durabilidad 18,4→18,5/20** por confianza de ingeniería, no asignar nada a Firebase HEAD, R2 ni pruebas físicas. La prueba adversarial de pérdida de base usó SQL *stub* con el módulo real; la suite Workerd positiva prueba no regresión, no pérdida real en dispositivo físico.

**Presupuesto pendiente port 8,0/100,0 (NO MOVED):** HEAD Firebase económico REAL 2,0, R2 Service Binding instalado REAL 2,0, operacional y aceptaciones físicas 4,0. Proyección pública `-cat` y eventos privados `-ops` siguen separados; Sync3 continúa. La fuente `assessedProductSha` en JSON del PORT permanece anclada al C62 meritorio `6e802e6`, mientras que `lastAuditedProductSha` del reporte de calidad acredita el C64 funcional `ca86aa4`; son dos evidencias diferentes, no motores distintos.

---

### Historial anterior: cierre C63

**C63 · 20-nov-2026 Ecuador.** Fuente real [C62 PR #862](https://github.com/jfcarpiopuntocom/friendly-123/pull/862) **MERGED** en producto `master@6e802e6e0df0988922220dd634a40f7788638f05` v0.8.24 / shell v824 (no tocar versión para cambios del Worker). Mismos injertos Yjs/YParty/Cloudflare DO SQLite, **Sync3 intacto**, workshop laboratorio/documentación, QA OFF.

| Indicadores independientes con presupuesto original 100,0 | C61 anterior | C63 real source | Delta |
| --- | ---: | ---: | ---: |
| **Migración de la MISMA friendly-123 arquitectura1.0→2.0** | 91,8/100,0 | **92,0/100,0** | **+0,2** |
| **Calidad arquitectónica** | 78,9/100,0 | **79,1/100,0** | **+0,2** |
| GO comercial | 0/6 | **0/6** | 0 |
| Físico PC Opera↔Safari/PWA iPhone | 0/5 | **0/5** | 0 |

Este porcentaje mide capacidades verificadas en código real, NO aceptación comercial; el progreso neto desde post-D7 68,5 es +23,5 de migración. No se han certificado operaciones Firebase económicas reales ni R2 Service Binding.

## Presupuesto invariable total 100,0 puntos

| Grupo | Ganado | Peso original | Pendiente |
| --- | ---: | ---: | ---: |
| Yjs/IndexedDB/Sync3/Web Locks | 16,5 | 17,0 | 0,5 |
| **Historia congelada (C60 orden semántico y C62 raíces privadas)** | **14,0** | 18,0 | **4,0** |
| Economía tipada/DO receipts | 16,5 | 17,0 | 0,5 |
| Salas, roles, auth/leases | 13,5 | 14,0 | 0,5 |
| Fotos SHA/CAS | 8,0 | 9,0 | 1,0 |
| Catálogo público/lector | 10,0 | 10,0 | 0,0 |
| Navegador/retiro legado QA | 9,5 | 10,0 | 0,5 |
| Offline/failback | 4,0 | 5,0 | 1,0 |
| **TOTAL** | **92,0** | **100,0** | **8,0** |

## C62 · cerrar filtración de raíces desconocidas de fuente legacy v1

- Hallazgo: `cloudflare-yparty-worker/src/trusted-frozen-source.mjs` validaba raíz PUBLIC exacta cuando v2 paged o cuando ya hubiera `productos/ubicaciones`; en v1 legacy numérica con **solo raíces privadas desconocidas** (p. ej. `products`, `banco_privado`, `eventos`) solo verificaba una blacklist parcial, aceptando falsamente `completeToHead` y SHA independiente. P0 de límite de privacidad, no fallo del motor Yjs.
- [PRECODE C62](https://github.com/jfcarpiopuntocom/friendly123workshop/blob/main/projects/assembled-v783/plans/2026-11-20-c62-frozen-catalog-legacy-root-allowlist-precode.md) guardado antes de modificar. [RED GH Actions 44720698975](https://github.com/jfcarpiopuntocom/friendly-123/actions/runs/44720698975) **30/31 PASS, 1 FAIL**: el catálogo private-only `products` fue aceptado con SHA válido en vez de rechazarse. **GREEN** activa allowlist obligatoria `productos/ubicaciones` en TODAS las variantes v1/v2 sin modo compatibilidad inseguro.
- El test Workerd real `p0-gate-d-real-onstart-workerd.test.mjs` antes mezclaba `products` privados y `eventos` en el catálogo -cat; corregido para construir **Y.Doc PUBLIC solo `productos`** (id,nombre,precio,stockActual) y **Y.Doc separado `eventos` exclusivo -ops**, conservando pruebas cold join, forward, restart, separación de salas, Yjs parent faltante y PITR. No se tocó el Worker SQL económico ni el ledger.
- [C62 GREEN focal GH Actions 44721086871](https://github.com/jfcarpiopuntocom/friendly-123/actions/runs/44721086871) **31/31 PASS 0 FAIL/SKIP** incluyendo tres raíces maliciosas, C60 productos públicos con orden diverso y campos privados PIN/costo rechazados. [C62 PR #862 MERGED](https://github.com/jfcarpiopuntocom/friendly-123/pull/862), head `bcaf288ac9619e2e18faa9d05d4b3e8e588295aa`, **15/15 workflows GREEN**, incluido REAL Tienda.onStart/Workerd, D3, D5 PITR, hotfix, release-control. Cloudflare Workers Builds exact source merge `6e802e6e0df0988922220dd634a40f7788638f05` **SUCCESS**, build UUID `06b63e28-43a4-481a-9722-ffd801f95f5b`.
- Esta seguridad es ensayo Workerd/SQLite real de datos **sintéticos**, no prueba de confidencialidad en clientes con historial real. QA OFF, GO0/6.

## C63 · crédito limitado; original HEAD y R2 todavía NO ganados

- [PRECODE puntuación C63](https://github.com/jfcarpiopuntocom/friendly123workshop/blob/main/projects/assembled-v783/plans/2026-11-20-c63-c62-trusted-frozen-roots-security-score-precode.md) previo. [RED score Actions 44721765202](https://github.com/jfcarpiopuntocom/friendly-123/actions/runs/44721765202): `91.8 !== 92` antes de score JSON; corrección posterior con script guard de source/QA/Workerd.
- En rubrica fija `frozen-history`18,0: `c62-legacy-frozen-private-root-rejection` **0,2 DONE**, quitado del anterior `real-firebase-head-complete` **2,2 PENDING**, deja `real-firebase-head-complete` **2,0 PENDING**, `r2-service-binding-installed` **2,0 PENDING**. C60 QA0,3 previamente acreditado y no duplicado. Calidad `security`10,7→10,9/15, total78,9→79,1; `durability`18,4, `sync`15,9, `physical`0 sin cambios.
- El score nuevo se acredita SOLO al fusionar la PR C63, 11/11 CI y Cloudflare exact master SHA. **Aún requiere historial económico comercial real completo hasta HEAD, SHA/causalidad/fiados/stock, PITR, R2 binding y A→B→A físico**; GO0/6, físico0/5, flags QA OFF.

## Historial C61 / C59 y anteriores

## Historial C59 / C57 y anteriores

## Historial C57 / C55 y anterior

## Historial C55 y anterior

## Historial previo

## Historial C49 / C51 / C52 y métricas previas

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
