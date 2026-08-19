# Rescate de licencias — como se salva una licencia extraviada

**Creado:** 2026-08-19, a pedido de JFC, despues del caso idiomARTE.
**Aplica a:** friendly-123 hoy. amigable-123 y consultorio-123 tienen el mismo
diseno y les sirve igual — portarlo cuando toque.

---

## Para que existe

Una licencia se puede perder por tres caminos distintos, y los tres terminan en
un dueno que no puede probar cual es su negocio:

1. **Alta normal que falla a medias.** Es lo que paso de verdad: la app
   generaba el codigo, se lo mostraba en pantalla al activar, y lo guardaba
   SOLO como `syncCode`. `licenseCode` nunca se escribia, asi que el heartbeat
   mandaba `licenseCode:""` y **ninguna instancia de friendly-123 llego nunca a
   registrar su licencia**. El panel salia vacio y no habia a quien aprobarle
   nada. (Bug de raiz en `docs/auth-ui.js`, arreglado el 2026-08-19.)
2. **Rescate individual.** El dueno borro datos del navegador, cambio de
   telefono, o anoto mal el codigo.
3. **Rescate masivo.** Una migracion, un bug como el de arriba, o un cambio de
   formato deja a cientos o miles de instancias sin codigo. Llamar uno por uno
   no escala.

**Un solo mecanismo cubre los tres.** Esa es la idea entera.

---

## Como funciona

### La regla

> La licencia **se genera en silencio de nuestro lado**, y al dueno **se le
> avisa la proxima vez que entre**, con el mismo aviso que ya ve en un alta
> normal.

Un rescate callado del todo es peor que el problema: el dueno tiene que poder
anotar su codigo. Y un rescate que le pida hacer algo tampoco sirve: la mayoria
no va a hacerlo.

### Las tres piezas

**1. El Worker devuelve la licencia que conoce** (`cloudflare-worker/worker.js`,
en `handleCheckin`):

```js
return json({ ok: true, estado: registro.estado, licenseCode: registro.licenseCode || "" });
```

Es seguro devolverlo: para llegar ahi hay que traer el `instanceId`, que es un
uuid que solo tiene ese dispositivo.

**2. El dispositivo adopta lo que le falta** (`docs/auth-ui.js`). Dos ramas, en
este orden:

- **En el login:** si tiene `syncCode` pero no `licenseCode` (instalado ANTES
  del fix), adopta su propia sala como licencia. Es el MISMO valor que la app
  ya le mostro en pantalla al activarse, asi que el dueno reconoce el codigo.
- **En la respuesta del heartbeat:** si el servidor trae una licencia y el
  dispositivo no tiene ninguna, adopta la del servidor.

En las dos ramas la condicion es `!owned.licenseCode`: **solo rellena un
hueco, nunca pisa un codigo existente.**

**3. El aviso** — `mostrarAvisoLicencia(codigo, esRescate)`, expuesto tambien
como `window.OCMostrarLicencia`. Es el mismo aviso del alta normal. No se
cierra tocando afuera ni con Escape, solo con su boton: cerrarlo sin querer es
perder el codigo de vista.

### Lo que NUNCA se toca

**`syncCode` se queda como esta.** La sala del equipo y la licencia hoy valen
lo mismo, pero se guardan en campos separados a proposito. Cambiar la sala
sacaria de ella a todos los telefonos ya sincronizados del negocio. Un rescate
de licencia jamas debe tocar la sala.

---

## Rescate MASIVO — el procedimiento

Cuando haya cientos o miles de licencias en juego, no se toca ni un
dispositivo. Se escribe en la KV y cada instancia se cura sola cuando su dueno
entra:

```bash
npx wrangler kv key get "inst:<instanceId>" --namespace-id f1599c69c4174cc2b38dd125c18ee3df --remote
```

Se le pone el `licenseCode` al JSON y se vuelve a escribir:

```bash
npx wrangler kv key put "inst:<instanceId>" --path registro.json --namespace-id f1599c69c4174cc2b38dd125c18ee3df --remote
```

Al siguiente login de cada dueno, su dispositivo adopta el codigo y le muestra
el aviso. **Cero soporte uno a uno, cero pedirle nada al usuario.**

### Trampas medidas, no supuestas

- **`--remote` es obligatorio.** Sin el, `wrangler kv key list` lee el store
  LOCAL y devuelve vacio. Perdi un buen rato creyendo que la KV estaba vacia
  cuando no lo estaba.
- **El campo `producto` NO distingue las apps.** El Worker hace
  `producto = (body.producto === "amigable") ? "amigable-123" : "friendly-123"`
  y las apps mandan `"amigable-123"`, asi que TODO cae al else y queda
  etiquetado como friendly-123. **El discriminador fiable es el prefijo del
  `licenseCode`: `AMG-`, `F123-` o `C123-`.**
- **Cada app tiene su Worker y su KV.** friendly-123:
  `friendly123-licencias` + KV `f1599c69c4174cc2b38dd125c18ee3df`.
  amigable-123: `amigable-licencias` + KV `df0d18c7aada468c8c03f81793fbf1e9`.
  La cadena ofuscada `_ocEp` de `auth-ui.js` apuntaba a la de amigable, y por
  eso friendly-123 registraba sus altas en la caja equivocada. **Al portar
  `auth-ui.js` entre apps, esa linea es lo PRIMERO que hay que revisar.**

---

## Formato de la licencia

`F123-XXXX-XXXX-XXXX-XXXXX` — 16 caracteres del alfabeto Crockford base32 mas
un simbolo de verificacion mod-37 al final (17 significativos).

`ocLicenciaVerificada()` devuelve `true` sin juzgar cuando el cuerpo no mide 17.
**Eso es a proposito y no se debe "arreglar":** es lo que permite que una
licencia legitima ya emitida con un formato viejo nunca sea rechazada. El
checksum es un guard contra errores de tecleo en codigos nuevos, no una puerta.
