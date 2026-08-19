# Panel de licencias de friendly-123 — por que no puedes aprobar, y como se arregla

**Fecha:** 2026-08-19 · **Estado:** diagnosticado, falta UN paso que solo puede
dar JFC desde su terminal.

## Lo que SI esta bien

- El Worker **esta desplegado y vivo**: `https://friendly123-licencias.jfcarpio.workers.dev`
- `POST /checkin` responde `{"ok":true,"estado":"minima"}` — las instancias se
  estan registrando bien.
- La KV es propia de friendly-123 (`f1599c69...`), no comparte con AMIGABLE.
- `wrangler` esta autenticado con jfcarpio@gmail.com y tiene permisos de escritura.

## Lo que esta MAL — la causa exacta

`wrangler secret list` devuelve `[]`. **El secreto `MASTER_KEY` nunca se creo.**

En `worker.js`:

```js
function requireMasterKey(req, env) {
  const k = req.headers.get("X-Master-Key") || "";
  return env.MASTER_KEY && k === env.MASTER_KEY;
}
```

Si `env.MASTER_KEY` no existe, esto es `undefined` = falso **siempre**, sin
importar que pongas en el panel. Por eso `GET /licencias` contesta 401 y el
panel no lista nada ni deja cambiar estados. No es el panel: es el secreto.

Consecuencia directa para Sarah (idiomARTE): su instancia esta en `minima`
(plan gratis: 25 productos, 100 ventas/mes, 1 encargado) y **no hay forma de
subirla a `full`** mientras el secreto no exista.

## Los 3 pasos (JFC, en su terminal)

**1. Crear el secreto.** Escoge una clave larga (o deja que la genere tu gestor
de contrasenas). Se pega cuando wrangler la pida — no va en ningun archivo del
repo:

```bash
cd "C:/00 Projects/friendly-123/cloudflare-worker" && npx wrangler secret put MASTER_KEY
```

**2. Redesplegar.** El Worker en vivo es del 2026-07-29 y `worker.js` cambio
despues:

```bash
cd "C:/00 Projects/friendly-123/cloudflare-worker" && npx wrangler deploy
```

**3. Cargar el panel.** Abre `docs/panel.html`, pestana Config, y pon:

- URL del Worker: `https://friendly123-licencias.jfcarpio.workers.dev`
- Master key: la misma del paso 1

La clave queda en el localStorage de ESE navegador. Si abres el panel en otra
PC hay que volver a pegarla. No se guarda en el repo a proposito.

## Como comprobar que quedo (sin abrir el panel)

```bash
curl -s -H "X-Master-Key: TU-CLAVE" https://friendly123-licencias.jfcarpio.workers.dev/licencias
```

Con la clave buena devuelve la lista en JSON. Si sigue dando 401, el secreto no
se guardo o el deploy no corrio.

## Sobre la licencia de Sarah

Una vez que el panel liste, su instancia aparece en `minima`. Pasarla a `full`
es un boton en el panel. **NO la cambio yo**: que plazo y que condiciones lleva
friendly-123 es decision comercial tuya y todavia no esta definida (en
amigable-123 son 10 anos; friendly-123 sigue sin decidir). Dime el estado y lo
dejo aplicado.

## Lo que el punto 6 resulto ser

El 555 de Sarah no era cambiar un PIN: era **crear un admin**. En el codigo,
los admins estan EXENTOS del tope del plan gratis a proposito
(`mock-backend.js`, POST `/api/usuarios`), asi que el tope no deberia haberla
frenado. Queda por reproducir con su caso real cual fue el rechazo — los dos
candidatos son que el PIN 555 ya lo usara otro miembro, o que el mensaje de
error le salio en espanol y no lo entendio (ver el barrido de i18n de este
mismo dia). Pendiente de confirmar con ella que texto exacto vio.
