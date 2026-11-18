# P0 dashboard remoto · transporte efímero Supabase Realtime (18 nov 2026)

**Síntoma:** dashboard remoto no supera PIN tras 12 s cuando WebRTC no conecta; app abierta sí usa peer+durable, dashboard HTML carga solo peer. Public TURN compartido OpenRelay falló en prueba real ICE 701 sin candidatos, host ICE funciona [workflow 44342616469](https://github.com/jfcarpiopuntocom/friendly123workshop/actions/runs/44342616469).

**Prueba de nueva vía ANTES de implementar:** [workflow LIVE #44349907853](https://github.com/jfcarpiopuntocom/friendly123workshop/actions/runs/44349907853), 2 navegadores Chromium, mismo vendor Supabase REAL v2.118.0 extraído del bundle publicado, canal broadcast pub/sub efímero entregó mensaje, 1/1 PASS; no DB writes. Firebase hermano `/dashboard/m` 401; en nueva sala `/o` permite 200 escritura pero rechaza DELETE 401: abandonado.

**Diseño Ponytail**
- `docs/vendor/supabase-relay.min.js`: exportar handle del SDK existente como `window.F123DashboardRealtime` (sin cambiar instancia ni transportes existentes).
- `docs/dashboard-broadcast.js`: adaptador WebSocket-shaped `F123DashboardBroadcast.connect(url)`. Public Realtime channel `f123-dash-<40hex>`, rooms hashed de la licencia (misma URL LEGACY). Enviar exclusivamente ArrayBuffer cifrado desde `cifrar`; fragmentos base64 <=8KiB, 64 piezas/grupo, límites de memoria/tiempo, ordenar reconstrucción, ignorar propio remitente. Nada persistido, PIN y datos nunca en claro. Emitir open solo ante SUBSCRIBED.
- `docs/sync-realtime.js`: en la app suscribir un segundo socket limitado al cuaderno activo; inyectar mensajes del broadcast al mismo handler autenticado por secreto y generación; solo `__pin__`, `__foto_pedida__`, `__orden__` que lleguen por broadcast reciben respuesta mediante el broadcast. Validación Owner/Admin y fotoToken existente intactos.
- `docs/index.html`: cargar bus antes de sync-realtime; `docs/dashboard.html`: vendor+bus, seleccionar bus para el lienzo remoto; local-first no cambia; `dashboard-main.min.js` intacto.
- Tests RED primero (contrato app+dashboard/harness) → fuente mínima → GREEN, CI JS sintaxis+browser Supabase, exact SHA, versión shell y manifest, publicación con fallback previo. Test live sintético PIN aprobado y foto completa. Revertible por `previo` y bandera `window.F123_DASH_BROADCAST=false` (si activada antes del script).
- Prohibido confundir login socket con PIN válido, almacenar plaintext, habilitar YParty 2.0 o tocar ventas/inventario.

**Riesgo:** el canal público publica datos cifrados; seguridad depende del secreto de licencia y verificación Owner PIN. Realtime egress subject to existing provider quota: test sintético confirma canal, no SLA multi-tienda. Implementar solo si pruebas de cliente completas.
