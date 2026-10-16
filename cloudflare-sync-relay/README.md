# friendly123-sync-relay

Relay zero-trust del Hybrid Proxy Tunnel Sync Engine. Une los dispositivos de un
mismo negocio (misma licencia) por WebSocket. Conserva operaciones y checkpoints
cifrados en SQLite para recuperar dispositivos desconectados; no descifra su
contenido. También sirve de canal de señalización para el
atajo WebRTC (los SDP/ICE viajan como cualquier otro frame).

## Qué NO es
- No es el Worker de licencias (`friendly123-licencias`). Es OTRO Worker, otro
  nombre. No comparten name ni KV.
- No es la fuente de las reglas del negocio: conserva sobres cifrados en
  Durable Object SQLite y los reparte a los dispositivos de la sala.

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

> El relay usa `new_sqlite_classes` y consume las cuotas de Durable Object
> SQLite. Disponer del plan gratuito no elimina los límites de lectura,
> escritura y almacenamiento. No contratar ni cambiar el plan por este deploy.

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

## Resolución privada para migración

`POST /migration/resolve` acepta un cuerpo JSON firmado Ed25519 con
`v: 1`, `action: "resolve"`, `room` y `issuedAt` (milisegundos Unix).
Usa la misma clave pública y cabecera `X-Relay-Migration-Signature` que
`/migration/export`: firma sobre los bytes UTF-8 exactos, vigencia de un minuto
y cuerpo de hasta 4096 bytes. Una petición firmada para exportar no sirve para
resolver, ni a la inversa. Sin clave pública configurada, ambas rutas se deniegan.

Devuelve `{ "v": 1, "objectId": "..." }` con `cache-control: no-store`.
Solo deriva el ID con `idFromName`; no obtiene un stub, entra al objeto ni toca
su almacenamiento. El ID no acredita que exista una sala ni que contenga datos.
El operador debe cruzarlo con el inventario privado de objetos existentes antes
de exportar. No registrar nombres de salas, licencias o firmas en logs.

Esta ruta no registra salas, cambia autoridades, activa Supabase ni cierra
escrituras. La importación y el corte final consistente siguen siendo pasos
separados. Comprobación sintética: `node --test test/relay-export.test.js`.
