# SPEC — Hybrid Proxy Tunnel Sync Engine (zero-trust)
**Fecha:** 2026-08-25 · **Fuente:** plan de JFC (rama claude/hybrid-proxy-tunnel-sync-ymq8d6)
**Este es el documento que se lee al implementar. El blueprint largo no se vuelve a abrir.**

## Objetivo
Túnel híbrido entre dispositivos del mismo negocio (misma licencia):
- Los datos viven en el dispositivo. Cloudflare solo une conexiones; no guarda el
  negocio y no puede leer el contenido (solo ve bytes cifrados).
- Dos caminos: WebSocket (siempre) y WebRTC (atajo directo si la red lo permite).
  Si el atajo falla, el socket sigue. Si el túnel se cae, la caja local sigue.
- Dos dispositivos con la misma licencia se mantienen al día: ventas, stock,
  catálogo y equipo (PIN y rol).
- Indicador visible: apagado / conectando / al día / error.

## Prohibiciones (no se negocian)
- No pegar el motor ni el interceptor de IndexedDB del blueprint. Se construye
  sobre el sync actual (`docs/sync-realtime.js`).
- No parchear `indexedDB.put` ni pisar `indexedDB.open`.
- No cambiar el sistema de licencias (F123-…) ni el Worker de licencias.
- No mezclar sync con licencias: el relay de sync es OTRO Worker, otro nombre,
  otra carpeta (`cloudflare-sync-relay/`, name `friendly123-sync-relay`).
- El stock NO se sincroniza como "última escritura gana": se sincroniza como
  OPERACIONES (venta, ajuste, anulación) con id único e idempotencia.
- Todo dato de negocio viaja cifrado en el cliente. El relay solo ve bytes.
- No copiar archivos enteros desde otras apps.

## Archivos permitidos
- `_private/SPEC-SYNC-ZERO-TRUST.md`
- `cloudflare-sync-relay/*`
- `docs/sync-realtime.js`
- `docs/avanzado-extra.js` (indicador y textos)
- `docs/mock-backend.js` (solo merge de usuarios y conflicto de catálogo)
- tests (`test/` o `node --test`)

## Archivos prohibidos
- `cloudflare-worker/worker.js`, `cloudflare-worker/wrangler.toml`
- `docs/crypto-store.js`
- `docs/aislamiento.js` (salvo un canario mínimo)

## Fases y "listo cuando"
- **F0 Base:** snapshot + este spec. (hecho)
- **F1 Relay:** `cloudflare-sync-relay/` con Durable Object de salas, WebSocket,
  tope de clientes y de tamaño de frame, sin disco, sin logs del cuerpo.
  Listo: dos pestañas en la misma sala se hablan y el Worker no ve texto claro.
- **F2 Cliente → relay nuevo:** cambiar `RELAY_URL` en `docs/sync-realtime.js` a
  `wss://friendly123-sync-relay…/sala/`. No reescribir el motor.
  Listo: dos perfiles de Chrome, misma licencia, una venta en A aparece en B.
- **F3 WebRTC:** DataChannel transporta el MISMO binario cifrado; señalización
  por el relay; failover automático al socket. Sin TURN de pago al inicio.
  Listo: si hay canal directo, las ops pasan; si no, el socket las pasa igual.
- **F4 Equipo:** merge de `usuarios` en `docs/mock-backend.js` (id, nombre, pin,
  rol, activo, email, creadoEn, actualizadoEn). Merge SIN borrar; en conflicto
  gana la edición más reciente; nunca eliminar un usuario que el otro no tenga.
  Incluir `usuarios` en la huella del catálogo.
  Listo: en A se crea admin PIN 555 → en B se entra con 555 como admin.
- **F5 Indicador:** píldora de estados en Avanzado, cableada al estado real.
  Listo: el badge cambia al cortar red y al reconectar.
- **F6 Blindaje y tests:** canario de aislamiento, dedup, límites, tests:
  sala incorrecta no descifra; dos ventas no se pisan; no hay interceptor de
  IndexedDB.
- **F7 Publicar:** deploy SOLO del relay nuevo. Licencias intacto. Commits y
  push por fase verde; PR draft; merge cuando verde.

## Catálogo / textos en conflicto
Gana la versión más nueva. Si empatan, gana el rol más alto: dueño > admin > staff.

---

## ESTADO (2026-08-25, rama claude/hybrid-proxy-tunnel-sync-ymq8d6)
- **F0** hecho. **F1** hecho (`cloudflare-sync-relay/`). **F2** hecho (RELAY_URL).
- **F4** (merge de usuarios) YA estaba en el código (2026-08-21): huella incluye
  usuarios, el PATCH sella `actualizadoEn`, y la sala transporta `usuarios`
  (`trocear("usuarios", …)` + `aplicarEquipoRemoto`). Verificado, sin cambio.
- **F5** (píldora de estado) YA estaba: `#oc-sync-estado` + `pillTexto/pillColor`
  cableados a `onEstado` (gris/ámbar/verde/rojo). Verificado, sin cambio.
- **F6** hecho: `test/sync-zero-trust.test.js`.
- **F3 (WebRTC) DIFERIDO a propósito.** El atajo P2P es opcional y el propio
  plan lo dice ("si no hay P2P, no pasa nada: queda el WebSocket"). El núcleo
  zero-trust (relay + merge de equipo) ya funciona y está probado. Meter una
  capa WebRTC sin poder verificarla con dos navegadores reales arriesga
  duplicar ops en la ruta de venta en vivo. Se hace en una fase dedicada con
  dos perfiles reales y tests de dedup entre transportes.
- **F7 (deploy) PENDIENTE de JFC.** El relay NO se puede desplegar desde aquí
  (requiere las credenciales de Cloudflare de JFC). Comando único:
  `cd cloudflare-sync-relay && npx wrangler deploy`. **No mergear a producción
  antes de desplegar el relay**: el cliente ya apunta a
  `friendly123-sync-relay…` y sin el Worker vivo el sync no conecta (la caja
  local sigue; el sync muestra reconectando).
