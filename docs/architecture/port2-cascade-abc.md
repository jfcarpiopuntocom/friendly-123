# friendly-123 — contrato operativo de cascada A/B/C (arquitectura 2.0)

Orden del propietario (22 noviembre 2026): arquitectura interna 2.0 como base de sincronización; dos rutas adicionales B/C como failback silencioso. Texto íntegro de la orden en la MDD de Notion.

## Regla de autoridad

El commit de cada operación comercial se ancla a un solo `opId` y a un único libro durable por licencia. Cambiar de transporte **nunca** cambia la autoridad de escritura, el cuaderno, la licencia ni el significado de un ACK. La ruta de transporte no es el motor de negocio.

## A — ruta principal

Coordinador tipado 2.0 + Yjs/y-indexeddb + Y-PartyServer/Cloudflare Durable Objects, únicamente para operaciones y datos que la ruta 2.0 realmente soporta. Un fallo de conectividad no autoriza automáticamente a reejecutar la venta en el motor 1.0.

## B — transporte secundario independiente

Debe transportar el mismo sobre cifrado, `opId` y secuencia causal, sin nuevo escritor de negocio. Requiere endpoint probado, límites de cuota y ACK durable de la misma autoridad. El relay histórico sólo califica como B si la inspección del adaptador demuestra que **no depende del Supabase agotado** y puede entregar ACK real. La URL de Cloudflare por sí sola no lo demuestra.

## C — tercera vía independiente

Canal adicional o buzón durable cifrado, independiente de A y B, con replay por cursor, retención, deduplicación por `opId` y recepción causal. WebRTC puede acelerar la entrega directa cuando hay pares simultáneamente conectados, pero no reemplaza por sí solo un buzón durable para recuperar dispositivos que estuvieron desconectados días.

## Conmutación y regreso

- Persistir localmente la operación **antes** de intentar A, B o C.
- Circuit breaker por ruta: tras fallos reales y límites de cuota, dejar de insistir en la ruta enferma; reintentos acotados con jitter y pruebas de recuperación sin ráfagas.
- Un único despachador toma la decisión A→B→C; no hay tres publicadores independientes de la misma venta.
- Un ACK de socket, evento DOM, HTTP no durable o conexión abierta **no** retira la operación del outbox.
- Tras recuperar A, reconciliar cursor/ACK/historia antes del failback C/B→A; evitar dos escritores concurrentes.
- En ausencia de todas las rutas, mantener venta local durable y estado de sincronización pendiente verídico, recuperable al volver una ruta.

## Bloqueantes comprobados que debe resolver la implementación

1. `src/port2-cross-device-failback.mjs` usa modo `failback-legacy-1.0` y para nuevos `opId` en ese modo retorna `fallbackLegacy:true`; **esto no implementa** B/C como transportes alternativos del coordinador 2.0.
2. `src/yparty-piloto.js` llama `usarRelayHabitual()` en fallos de Y-PartyServer; verificar la ruta real del adaptador y su dependencia de Supabase.
3. `docs/sync-rollout.json` tiene `yparty:true` únicamente en la licencia JFC y `allOutboxV2:true` general. La bandera no demuestra convergencia física.
4. Cold join Yjs con antecedentes causales faltantes y cuotas/egress requieren pruebas específicas, no healthchecks superficiales.

## Aceptación mínima

- A disponible: PC→iPhone→PC y vuelta, mismo cuaderno y operaciones, sin duplicados.
- A caído: B conserva y entrega opId con ACK durable, sin invocar segundo motor comercial.
- A+B caídos: C entrega o mantiene en buzón durable; si no hay ruta disponible, offline local y posterior replay.
- Recuperación C→B→A, cambios repetidos, navegador nuevo, reconexión tras días, fotos, ventas, dinero, stock, PIN y outbox intactos.
- Simular Supabase bloqueado por cuota; cero bucles de reintentos y egress acotado.
- Pruebas con Safari/PWA iPhone y Opera PC, no solamente CI sintética.

**Estado:** contrato registrado. Ningún transporte B/C se considera certificado hasta demostrar independencia, ACK durable y pruebas A/B/C. No equivale a despliegue.
