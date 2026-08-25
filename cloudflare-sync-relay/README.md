# friendly123-sync-relay

Relay zero-trust del Hybrid Proxy Tunnel Sync Engine. Une los dispositivos de un
mismo negocio (misma licencia) por WebSocket. **No guarda ni puede leer el
negocio**: cada frame llega cifrado desde el cliente y el relay solo lo reparte
a los demas de la misma sala. También sirve de canal de señalización para el
atajo WebRTC (los SDP/ICE viajan como cualquier otro frame).

## Qué NO es
- No es el Worker de licencias (`friendly123-licencias`). Es OTRO Worker, otro
  nombre. No comparten name ni KV.
- No tiene almacenamiento de negocio (sin KV, sin disco). Las salas viven en
  memoria (Durable Object).

## Deploy (Windows — lo más fácil)
En PowerShell **no** uses `cd … && npx …` (el `&&` da error en PowerShell 5.1).
Usa el script:
```powershell
powershell -ExecutionPolicy Bypass -File .\deploy.ps1
```
o en macOS/Linux/Git Bash:
```bash
bash deploy.sh
```
La **primera vez** te abre el navegador para iniciar sesión en Cloudflare
(`wrangler login`); después solo despliega. Necesitas Node.js LTS instalado
(https://nodejs.org) para que exista `npx`.

Si prefieres a mano, son DOS comandos separados (no encadenados):
```powershell
npx --yes wrangler@latest login
npx --yes wrangler@latest deploy
```

Queda en `wss://friendly123-sync-relay.<subdominio>.workers.dev/sala/<idSala>`.
El cliente (`docs/sync-realtime.js`, `RELAY_URL`) ya apunta ahí. Verifica con
`https://friendly123-sync-relay.<subdominio>.workers.dev/health` →
`friendly123-sync-relay ok`.

> Plan gratis: la migración usa `new_sqlite_classes`, así que el Durable Object
> despliega sin plan pago (la sala no usa almacenamiento; el backend SQLite no
> cuesta nada aquí).

## Límites
- `MAX_CLIENTES_SALA = 12` por sala.
- `MAX_FRAME_BYTES = 256 KB` por frame (el catálogo viaja a trozos).

## Salud
`GET /` o `GET /health` → `friendly123-sync-relay ok` (no toca salas, no revela
nada).

## Pruebas
`node --test test/relay-aislamiento.test.mjs` (en la raíz del repo): verifica que
una sala distinta no descifra, que dos ventas no se pisan (ops idempotentes) y
que el relay no interpreta el contenido.
