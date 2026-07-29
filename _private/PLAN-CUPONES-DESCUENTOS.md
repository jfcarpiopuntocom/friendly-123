# Plan — Cupones de descuento (aprovechando el QR local ya existente)

Plan integrado, NO ejecutado. Pedido de JFC (2026-07-29): "make plan para un
esquema de cupones de descuento o de lo que sea, aprovechando el sistema
interno de QR que ya tenemos". Se construye primero en friendly-123 (testing
ground), como el resto del roadmap de agosto.

---

## 0. Qué ya existe y qué se reutiliza (cero infraestructura nueva)

- **QR 100% local** (`qrcode-local.js` + `qrDataUrl()` en mock-backend.js):
  ya genera QRs sin ninguna llamada externa. Hoy se usa para 2 cosas: el QR
  de etiqueta de producto (`?sku=XXX`, abre la demo con ese producto) y el QR
  de emparejamiento de dispositivo en Avanzado (sync).
- **Formato de código legible**: la app ya tiene el patrón "código corto,
  legible, con guiones" para licencias (`F123-XXXX-XXXX`) — un cupón puede
  seguir el mismo espíritu: fácil de leer en voz alta si el QR falla.
- **Barcode128** (`barcode128.js`): alternativa si algún negocio prefiere
  imprimir el cupón como código de barras en vez de QR (etiquetas viejas,
  impresoras térmicas sin cámara de por medio).
- **Patrón event-sourced** (Fase 0 del roadmap, `hechos.js`): un cupón
  canjeado es exactamente el mismo tipo de "cosa que pasó y no se pisa" que
  un fiado o un ingreso de caja chica. Se reusa el mismo chokepoint.

## 1. Modelo de datos — qué es un cupón

Dos partes separadas, como cartera/caja chica:

- **La emisión** — el cupón EXISTE con sus reglas (una tabla simple, no un
  hecho — es una intención, no un evento que ya pasó):
  ```
  { id, codigo, tipo: "porcentaje" | "monto_fijo",
    valor: number,                    // 15 (%) o 5.00 ($)
    aplicaA: "todo" | "categoria" | "producto",
    aplicaAId: string|null,           // categoria o productoId si aplica
    usoMaximo: number|null,           // null = ilimitado
    usosHechos: 0,                    // derivado, no se edita a mano
    vigenteDesde, vigenteHasta: ISO|null,
    activo: boolean,
    creadoPor, creadoEn }
  ```
- **El canje** — CADA vez que se usa, es un HECHO inmutable
  (`cupon_canjeado`), igual que cartera/caja-chica:
  ```
  { cuponId, codigo, clienteId|null, ventaId, montoDescuento, fecha }
  ```
  El "usosHechos" del cupón NUNCA se incrementa directo — se deriva contando
  hechos `cupon_canjeado` con ese `cuponId`. Mismo principio de Fase 0: nunca
  un contador que se sobreescribe.

## 2. El QR del cupón — mismo patrón que la etiqueta de producto

El QR codifica una URL pública, no el descuento en texto plano (para que
abrir la cámara de cualquier celular muestre algo, no JSON crudo):

```
https://jfcarpiopuntocom.github.io/AMIGABLE/?cupon=VERANO15
```

Dos flujos posibles de canje (no excluyentes — abre rutas, no restringe):

1. **El cliente muestra el QR/código** (impreso, o en su celular) y quien
   vende lo escanea con el mismo lector que ya existe en "Vender" (el input
   `inputEscaner` ya acepta cualquier código pegado/escaneado — se extiende
   para reconocer el prefijo de cupón y distinguirlo de un SKU/barcode).
2. **Quien vende teclea el código a mano** si no hay cámara a mano — el
   mismo campo de texto de siempre, cero UI nueva.

## 3. Dónde se aplica el descuento

Depende de qué tan lejos se quiera llegar. Se sugieren 2 niveles, para no
sobre-construir de una vez (regla dura: empezar simple):

- **Nivel 1 (mínimo viable)**: el cupón se aplica en la MISMA pantalla donde
  ya se captura el precio efectivo pagado (el mecanismo que ya existe para
  tickets/eventos, `precioEfectivo`/`montoPagado`). Si hay un cupón activo,
  el monto ya viene rebajado antes de guardarse — así el descuento hereda
  GRATIS la propiedad más importante del fix de comisión de esta semana: el
  descuento se refleja en TODAS las sumas de ingresos (dashboard, P&L,
  comisión de percha, historial de cliente) porque todas ya leen del mismo
  campo, no del precio de catálogo.
- **Nivel 2 (si se necesita después)**: cupón aplicable también al tap
  instantáneo del grid "Vendido" (no solo a ventas itemizadas tipo ticket).
  Requeriría que el tap-instantáneo sepa restar un descuento activo antes de
  registrar — más delicado porque ese flujo hoy es deliberadamente "sin
  fricción, sin campos". Evaluar con JFC si vale la pena o si los cupones
  viven solo en ventas itemizadas/tickets al principio.

## 4. Guard que evita reproducir el bug de esta semana

Regla dura para esta feature, aprendida del incidente de comisión: **el
descuento se resta UNA sola vez, en el chokepoint de registro de venta, y
todo lo demás lee el resultado — nunca dos lugares calculan el mismo
descuento por separado.** Ningún reporte (P&L, comisión, cliente) vuelve a
restar el cupón: todos ya ven el monto ya rebajado porque leen `precioUnit`
de la venta, no `precio` de catálogo menos el cupón calculado de nuevo.

## 5. Guards operativos (mismo espíritu que cartera/caja chica)

- **Un solo chokepoint de escritura**: `AMG.Cupones.canjear(codigo, ventaId,
  clienteId)` — valida vigencia/límite de uso y emite el hecho. Nadie más
  resta directo del `usoMaximo`.
- **Nunca permitir doble canje del mismo cupón en la misma venta** — validar
  contra `ventaId` antes de aplicar (idempotencia, mismo patrón que
  `opId` en el puente de sync).
- **Expiración visible, no silenciosa**: si el cupón venció o se agotó, el
  mensaje de error debe decir POR QUÉ (nunca un fallo mudo) — mismo principio
  de "todo saldo con su procedencia" del roadmap.

## 6. Qué preguntar a JFC antes de construir (para no adivinar)

- ¿Los cupones los crea el dueño desde una pantalla nueva en Avanzado, o
  basta con poder generarlos desde la consola/soporte para el lanzamiento
  inicial (ellos ya delegan bastante a JFC en el arranque)?
- ¿Un cupón puede combinarse con el registro de fiado/abono (Fase 1), o son
  mundos separados (cupón = venta directa, fiado = otra cosa)?
- ¿Nivel 1 basta para agosto, o hace falta Nivel 2 (cupón en el tap
  instantáneo) desde el principio?
- ¿Los cupones son por negocio entero o también por percha/promotor
  específico (ej. "cupón solo válido en la Feria Artesanal")?

---

*Este plan no toca código todavía. Ejecutar solo cuando JFC confirme alcance
(Nivel 1 vs 1+2) y las respuestas de la sección 6.*
