# Plan — por que no se mergearon las perchas, y las huellas de verificacion

**Fecha:** 2026-08-19 · **Repo:** friendly-123 · **Estado:** propuesto, SIN ejecutar.
**Origen:** JFC uso un codigo de equipo de su PC a su celular y las perchas no
se juntaron: en el celular quedo "001" y en la PC "Rack1".

---

## Vocabulario, primero

**No somos un servidor.** El Worker de Cloudflare es un **nodo de activacion y
monitoreo de licencias**, y nada mas. No guarda datos de negocio. El relay de
sync solo rebota bytes cifrados que no puede leer. Esto no es un detalle de
estilo: llamarle servidor contradice el manifiesto entero del producto.

---

## El diagnostico: no es un bug, es una capacidad que nunca existio

`aplicarOpRemota()` en `docs/mock-backend.js` empieza asi:

```js
const p = productos.find((x) => x.id === pl.productoId);
if (!p) return { ok: false, error: "That product does not exist on this device (sync the catalog first)" };
```

**El sync propaga movimientos de stock sobre productos que YA existen en los dos
lados. No propaga el catalogo: ni productos nuevos, ni perchas, ni clientes.**

El propio mensaje de error lo dice — *"sync the catalog first"* — pero **ese
paso no existe en ninguna parte de la app.**

Por eso las perchas de JFC no se juntaron. No fallo el codigo de equipo, ni el
relay, ni el cifrado: se conectaron bien y quedaron hablando, pero lo unico que
se saben decir son deltas de stock de productos que ambos ya conocen. Dos
catalogos distintos siguen siendo dos catalogos distintos para siempre.

Y hay un segundo limite encima: la puesta al dia reenvia el LOG de operaciones,
que esta topado en 500 (`LOG_TOPE`) y solo contiene lo ocurrido MIENTRAS el sync
estaba encendido. Un dispositivo que se une despues no puede reconstruir nada
anterior aunque el catalogo si viajara.

---

## Lo que hay que construir

### 1. Huella del catalogo (checksum)

Cada dispositivo calcula un hash estable y barato sobre su catalogo: perchas
(id + nombre) y productos (id + nombre + precio + costo). Determinista: dos
dispositivos con el mismo catalogo dan la misma huella, siempre.

Se muestra corta y legible, tipo `#A7F3`, para que una persona la pueda
comparar por telefono o por WhatsApp sin entender nada de hashes.

### 2. La huella viaja en cada latido

El micelio ya manda latidos entre los dispositivos del equipo. Se le agrega la
huella. Con eso el panel "Your team right now" puede decir algo que hoy no
puede decir: **"estos dos dispositivos NO estan mostrando el mismo
inventario"**, en vez de decir "sincronizado" cuando no lo estan.

Hoy el panel dice "Up to date" mirando solo el reloj — cuando fue el ultimo
latido. Decir "al dia" sin haber comparado un solo dato es exactamente lo que
hizo que JFC creyera que estaba sincronizado.

### 3. El codigo TEAM- lleva la huella (pedido explicito de JFC)

Al compartir, el codigo se muestra con su huella del momento:

```
TEAM-A6YK-6V1J-BF2A-S2J24 · #A7F3
```

El telefono que se une, al terminar de mergear, recalcula su huella. Si le da
`#A7F3`, el merge quedo verificado y se le dice en pantalla. Si le da otra
cosa, se le dice QUE falta, no un "algo salio mal".

Es un recibo comprobable por un humano, sin nodo de por medio y sin que nadie
tenga que confiar en que "seguro se sincronizo".

### 4. Merge de catalogo con jerarquia

Al unirse, el dispositivo pide el catalogo completo, no el log de ops.

**Jerarquia para resolver choques:** dueño > admin > encargado. Si el mismo id
existe en los dos con datos distintos, gana el del rol mas alto. Si dos perchas
tienen nombres distintos y el mismo id, gana la del dueño.

**Regla dura: el merge SUMA, nunca borra.** Una percha o un producto que solo
existe en el que se une NO se elimina: se conserva y se marca. Perder inventario
por unirse a un equipo seria peor que no sincronizar nunca.

### 5. El merge se muestra ANTES de aplicarse

Nada de merges silenciosos sobre datos de negocio reales:

```
Joining "Rack1"

  + 12 products you don't have
  + 1 shelf (Rack1)
  ~ 2 products with a different price (theirs wins: owner's device)
  = nothing will be deleted

  Your shelf "001" stays, with its 4 products.

  [ Join and merge ]   [ Cancel ]
```

---

## Orden de ejecucion

| # | Paso | Por que ese orden |
|---|---|---|
| 1 | Huella del catalogo + mostrarla en Avanzado | Es medir. Sin medir no se puede verificar nada, y ya sirve sola: dos duenos pueden comparar `#A7F3` por telefono hoy mismo |
| 2 | La huella en el latido + el panel dice la verdad | Deja de decir "al dia" sin haber comparado datos. Cero riesgo: solo cambia lo que se muestra |
| 3 | La huella en el codigo TEAM- y en el QR | Cierra el recibo verificable |
| 4 | Peticion de catalogo completo entre pares | Aqui empieza lo que mueve datos |
| 5 | Merge con jerarquia + pantalla de confirmacion | Lo ultimo, porque es lo unico que puede hacer dano |

Los pasos 1-3 no tocan un solo dato del negocio y se pueden soltar sin miedo.
Del 4 en adelante hay que probar con dos dispositivos de verdad antes de mergear.

---

## Como se comprueba

| Paso | La prueba, con el numero que tiene que dar |
|---|---|
| 1 | Dos dispositivos con el mismo catalogo dan la MISMA huella. Cambiar un precio en uno: las huellas difieren |
| 2 | Con catalogos distintos, el panel dice "no estan mostrando el mismo inventario", NO "Up to date" |
| 3 | El codigo compartido trae `· #XXXX` y el que se une lo compara al terminar |
| 4 | El que se une recibe las 3 perchas y los 61 productos del otro |
| 5 | El caso exacto de JFC: PC con "Rack1", celular con "001". Tras el merge los DOS tienen las dos perchas, y **ningun producto desaparecio de ninguno** |

---

## Lo que NO entra

- **No se toca el relay ni el salt de la sala.** Sacaria de la sala a los
  equipos ya sincronizados.
- **No se sube nada al nodo de licencias.** El catalogo viaja entre los
  dispositivos del equipo, cifrado, como todo lo demas. El nodo sigue sin saber
  que vende nadie.
- **No hay resolucion automatica de choques de dinero.** Si dos dispositivos
  tienen la misma venta con montos distintos, se muestra y decide una persona.
  Adivinar sobre plata no.
- **No se sube el tope del log de ops** (500). El problema no era el tope: era
  que el catalogo no viajaba. Subirlo habria escondido el bug real.
