# Comisiones mixtas — lo que quedo hecho y lo que falta si piden el modo aditivo

**Fecha:** 2026-08-19 · **Decision:** JFC, en el chat de ese dia.

## Lo que quedo hecho (modo PISO)

El motor de reparto (`repartir()` en `docs/mock-backend.js`) ya sabia hacer
tratos mixtos desde antes. Lo que faltaba era el formulario: la percha se
creaba mandando solo `comisionSocio` y `metaMensual`, asi que **todo trato
salia como % puro** aunque el motor supiera hacer mas.

Ahora el formulario de percha manda tambien `minimoGarantizado` y
`contribFija`, que es lo unico que faltaba. Con eso quedan disponibles:

| Trato | Como se arma |
|---|---|
| % puro | los dos campos nuevos vacios (comportamiento de siempre) |
| minimo + % (PISO) | llenar "Guaranteed minimum $" |
| aporte fijo antes del % | llenar "Fixed contribution $" |
| por tramos segun meta | `escalasComision` + `metaMensual` (ya existia) |

**Vacio = 0 = se comporta exactamente igual que antes.** Cero migracion,
ningun trato existente cambia de valor. Eso importa porque friendly-123 ya
esta en produccion con usuarios reales.

### Como calcula el PISO hoy

```js
var base = trato.contribFija > 0 ? Math.max(0, bruto - trato.contribFija) : bruto;
var comision = base * pct / 100;
if (trato.minimoGarantizado > 0 && comision < trato.minimoGarantizado) {
  comision = Math.min(trato.minimoGarantizado, bruto);  // nunca mas que lo vendido
}
```

El asociado se lleva **el mayor de los dos**, nunca la suma. Venta de $100 al
10% con minimo $25 deja $25; venta de $500 al 10% con minimo $25 deja $50.
El tope `Math.min(..., bruto)` existe para que el minimo no pueda pagar mas
plata de la que entro por esa venta.

## Lo que NO se hizo, y como se haria si lo piden urgente

JFC pidio dejar apuntado el **modo aditivo** y el **selector por percha**
(opcion 3 de la pregunta), por si aparece un negocio que lo necesite. No se
implemento porque toca un motor que ya esta repartiendo dinero real y todavia
no hay un caso concreto que lo pida.

### Modo ADITIVO (sueldo base + comision encima)

El asociado cobra el minimo **siempre**, y ademas el % completo. Venta de $100
al 10% con minimo $25 dejaria $35.

Lo que hay que resolver ANTES de escribir una linea, y es la razon de no
haberlo hecho a ciegas: **el minimo aditivo no puede cobrarse por venta.** Si
se cobra por venta, 40 ventas de $10 pagan 40 minimos y el negocio quiebra en
un dia. Tiene que ser un fijo POR PERIODO (mes, o evento en el caso de feria),
y eso significa:

1. Un campo nuevo `modoMinimo: "piso" | "aditivo"` en la percha (default
   `"piso"`, para que nada existente cambie).
2. El fijo aditivo NO entra en `repartir()`, que es por venta. Entra en la
   **liquidacion**, que es donde ya se suma el periodo completo — buscar donde
   se arma `f.comisionSocio` acumulado.
3. Decidir que pasa si el periodo cierra con pocas ventas y el fijo supera lo
   vendido: si el negocio lo paga igual (que es el sentido de un sueldo base)
   o si se topa como en el modo piso. Es una decision de JFC, no tecnica.
4. La liquidacion tiene que mostrar las dos lineas separadas — "base del mes"
   y "comision de N ventas" — o el dueno no entiende de donde sale el total.

### Selector por percha

Un `<select>` con las tres formas en el mismo formulario donde ahora estan los
dos campos nuevos, que muestre u oculte los campos segun el modo. Es la parte
facil; lo de arriba es lo que hay que decidir primero.

**Regla al implementarlo:** default `"piso"` y migracion cero. Cualquier trato
guardado sin `modoMinimo` se lee como piso, que es como se comporta hoy.
