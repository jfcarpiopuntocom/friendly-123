---
title: f123 relay
emoji: 🔁
sdk: docker
app_port: 7860
pinned: false
---

# f123-relay (Hugging Face Docker Space)

Relay durable de friendly-123 (orden del dueno, 2026-11-04). Habla el mismo protocolo de salas que
`cloudflare-sync-relay/worker.js` (frames `op`, `ckpt`, `pull` v1/v2, `ts`, `lat`, mas `head` para las sondas),
sobre `wss://jfcarpio-f123-relay.hf.space/sala/<id>`. Nunca descifra: guarda y reparte sobres cifrados.
Las fotos nunca pasan por aqui. `GET /salud` responde `200 {"ok":true}`.

## Variables del Space

| Nombre | Tipo | Para que |
|---|---|---|
| `HF_TOKEN` | Space secret (obligatorio) | Token con escritura SOLO al dataset del almacen. |
| `RELAY_PROVISION_SECRET` | Space secret (opcional) | Mismo valor que el secreto de aprovisionamiento del Worker de licencias (`cloudflare-worker`); verifica tokens de sala `?t=`. |
| `HF_REQUIRE_TOKEN` | variable | `1` = token obligatorio. Sin esto, el token solo se valida si llega. Dejar sin definir hasta que el Worker de licencias lo emita. |
| `HF_DATASET` | variable (opcional) | Dataset del almacen. Por defecto `jfcarpio/f123-relay-store` (privado). |

El relay viejo de Cloudflare no verificaba token (el hash de sala de 160 bits era la capacidad); por eso la
verificacion es opcional hasta que exista el emisor de tokens (formato en `server.mjs`, `firmarToken`).

## Topes (en codigo)
12 clientes por sala, frame 256 KB (checkpoint 1088 KB), 8000 ops por sala, estado 5 MB por sala,
2 MB/dia subida y 20 MB/dia bajada por sala, y corte global al 70 % de 1 GiB/dia. Al pasarse: cierre `1013` o
HTTP `429`; la app sigue en local y por la capa siguiente sin perder nada.

## Persistencia
Un archivo `rooms/<sala>.json` por sala en el dataset, en un solo commit por lote (30 s o 256 KB, solo si hubo
cambios). La sala se carga del dataset la primera vez que alguien la abre; si el dataset no responde, la sala se
rechaza (503) para no pisar lo guardado. El ACK sale al aceptar en memoria (como en Cloudflare), no al commit.

## Pruebas
`cd hf-relay && npm ci && npm test`
