# P0 dashboard v789 · verificación de PIN/foto en canal efímero · 2026-11-18

- Base producción: `4f1551717b9722d7c501566e43b60e41cb99f81c` / v0.7.88.
- Diagnóstico reproducido: `responderPin` y `responderFoto` dependían de `ws.readyState===OPEN` incluso cuando la solicitud se recibió en `__dashboardBroadcast` suscrito. Esto bloquea el canal cifrado nuevo si legacy WebRTC está CONNECTING.
- RED exacta: [GitHub Actions 44363444752](https://github.com/jfcarpiopuntocom/friendly-123/actions/runs/44363444752): 3 PASS, 2 FAIL; los fallos nuevos son PIN sin respuesta y snapshot sin partes.
- GREEN focal tras corrección de fixture: [GitHub Actions 44364100379](https://github.com/jfcarpiopuntocom/friendly-123/actions/runs/44364100379): 5/5 PASS, incluido PIN Owner válido, PIN inválido, fotoToken válido e inválido, bridge cerrado y socket legacy CONNECTING. Test ejecuta los dos manejadores reales extraídos de `docs/sync-realtime.js`; no reemplaza la aceptación física.
- Cambio Ponytail: helper `dashboardRespuestaDisponible(op)` en `docs/sync-realtime.js`, guard por origen de solicitud. La validación real de PIN/rol y fotoToken permanece. Sin modificaciones a ventas, inventario, Yjs, Supabase DB ni Cloudflare.
- Identidad candidata: `v0.7.89`, `f123-shell-v789`, `golden325`, manifiesto regenerado desde 128 assets con workflow [seal 44364384357](https://github.com/jfcarpiopuntocom/friendly-123/actions/runs/44364384357). 
- Pendiente: compuertas exactas del SHA final y promoción Pages antes de considerarlo publicado. Prueba real de tienda, números y fotos y unión fría siguen sin certificar.
- Fallo independiente heredado: Yjs `recorrido/union-fria` [44359796502](https://github.com/jfcarpiopuntocom/friendly-123/actions/runs/44359796502) FAILURE, 9 padres faltantes, catálogo en recuperación; no confundirlo con autenticación efímera de dashboard.
- Regla de intervención: resultado y evidencia (SHA/URL), sin discursos justificativos; mantener `friendly123workshop` actualizado.
