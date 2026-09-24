# PLAN — Estado de cuenta del comisionista (benchmark #1) · Opus 5.5 · 2026-09-24

## Qué gana el negocio
Ricochet y ConsignCloud venden un "portal del consignador": la artista ve qué se
vendió, qué le deben y qué ya le pagaron, sin llamar al dueño. Es la pregunta que
más le hacen a Belén. Nuestra respuesta debe cumplir la regla de oro: **ningún
servidor guarda ventas**.

## Diseño elegido (sin servidor con estado)
Un **enlace de solo lectura que lleva los datos adentro, cifrados**, generado en
el aparato del dueño desde Commissions (botón "Send statement").

1. El aparato arma un JSON mínimo SOLO de esa persona y ese mes:
   nombre de pila, negocio, mes, líneas {fecha, producto, cantidad, su comisión,
   pagada sí/no, medio}, totales, ajustes (devoluciones) y vencimiento.
   **Nunca**: clientes, precios de costo, otras perchas, otros comisionistas,
   PIN, licencia, instanceId.
2. Lo cifra con AES-GCM (WebCrypto) con una clave aleatoria de 128 bits.
3. El enlace es `https://jfcarpiopuntocom.github.io/friendly-123/estado.html#<datos>.<clave>`.
   Todo va en el **fragmento (#)**: los navegadores no lo envían a ningún
   servidor (ni a GitHub Pages), así que no queda en logs.
4. `estado.html` (página estática nueva, fuera de la app y sin acceso a su
   almacenamiento) descifra en el navegador de la artista y lo pinta. Si pasó la
   fecha de vencimiento, muestra "Pide un estado nuevo" y no pinta datos.
5. Se envía por WhatsApp con el mismo patrón del aviso de venta (enlace que la
   persona toca; nunca se envía solo).

## Revisión de seguridad (antes de codificar)
| Riesgo | Mitigación |
|---|---|
| El enlace se reenvía a terceros | Solo trae lo de esa persona; vence (7 días por defecto); sin datos de clientes |
| Alguien adivina enlaces | Clave de 128 bits aleatoria por enlace; sin índice ni listado |
| El enlace queda en un servidor | Todo en el fragmento #: no viaja en la petición HTTP |
| XSS en estado.html con datos manipulados | Pintar con textContent, nunca innerHTML; validar tipos y largos al descifrar |
| Vencimiento falsificado | El vencimiento va DENTRO de lo cifrado (AES-GCM autentica); cambiarlo rompe el descifrado |
| Revocar un enlace ya enviado | No es posible sin servidor: por eso vence corto. Documentarlo en la ayuda |
| Enlace muy largo para WhatsApp | Límite de líneas por mes (p. ej. 60) y compresión simple; si excede, dividir por quincena |
| estado.html toca datos de la app | Página separada, no carga mock-backend ni lee localStorage/IndexedDB |

## Pasos (un PR cada uno, con shell nuevo solo si toca archivos del shell)
1. `estado.html` + `estado-cifrado.js` (cifrar/descifrar, validar) con tests de
   ida y vuelta, vencimiento, datos alterados y XSS. Sin tocar la app.
2. Botón "Send statement" en la tarjeta de Commissions (dueño/admin), que arma el
   JSON mínimo y abre WhatsApp. Test: el JSON nunca contiene claves prohibidas.
3. Ayuda y manual: qué ve la artista, cuánto dura el enlace, por qué no se puede
   revocar.

## Qué NO hace (a propósito)
- No hay cuenta ni login para la artista.
- No se sincroniza nada con un servidor.
- La artista no puede cargar ni editar nada (eso sería el rol comisionista, benchmark #6).

## Decisión que necesito de JFC
Vencimiento por defecto: 7 días (propuesto) o 30 días.
