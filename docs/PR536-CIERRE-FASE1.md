# PR #536 · aceptación del canario JFC · 1 noviembre 2026

**Candidato, NO publicado.** JFC aprueba; Claude revisa. No tocar clientes ni sus PIN. Producción v636.

## Corrección de límite v637 (1 nov 2026)

El cambio anterior `ed12129` solo ampliaba el ciphertext práctico de **191.904 a ~196.500 B (+2,4 %)**: el transporte cerraba cualquier JSON de más de 256 KiB, pese a que el servidor `save_checkpoint` acepta **262.144 B cifrados decodificados**. La candidata ahora separa el límite del checkpoint RPC del límite normal de operaciones: **262.144 B cifrados**, solo cuando el adaptador `F123Relay` anuncia `ckptFrameBytes`; los adaptadores antiguos conservan el límite JSON y los mensajes no-checkpoint siguen con 256 KiB de transporte. El checkpoint no se emite por broadcast.

**Bloqueo de integración detectado:** el `docs/index.html` actual carga `peer-sync.js`, que instala `window.F123Relay = create()` (WebRTC), y **no** carga `docs/vendor/supabase-relay.min.js`. Por eso `ckptFrameBytes` no se anuncia en el camino activo de ese shell y el escritor conserva el fallback de ~196,5 KB. Los tests del transporte Supabase prueban el componente aislado, **no su activación en la app**. No cambiar de transporte ni activar salas sin revisión de cutover, censo, reconciliación y aprobación expresa. **No declarar S3 resuelto para el shell hasta verificar el adaptador realmente cargado.**

La causa estructural no cambia: `API.doc` incluye historiales crecientes. Se añade `OCYjs.medirTamanoColecciones()` para cifras por mapa (bytes de JSON visible, **estimación**, no bytes exactos de Yjs) y se deja la separación de historiales para el [plan v638](./V638-PLAN-SEPARAR-HISTORIALES-CATALOGO.md). **No se ha medido todavía ninguna colección real.**

## Evidencia de tamaños (solo lectura)

El relay guarda ciphertext y no conoce licencias ni contenido de las salas. La consulta de solo lectura devolvió los diez checkpoints cifrados más grandes: **191866, 170566, 155239, 130144, 39765, 26600, 20468, 11944, 2381 y 626 bytes**. El mayor está a 38 bytes del máximo práctico del cliente (191904 bytes). Esas diez cifras **no identifican diez tiendas** ni prueban el tamaño actual de los documentos de los aparatos. No se midió ningún aparato real desde esta sesión.

En cada aparato autorizado, una vez que los tres canales estén completamente sincronizados, abrir la consola del navegador y ejecutar exclusivamente:

```js
console.table(window.OCYjs.medirTamanoCanales())
console.table(window.OCYjs.medirTamanoColecciones())
```

Copiar **solo los números**: `canal`, `bytesPlano`, `bytesCifrados`, `entradas`, `dataImageInline`, `hidratado`, `checkpoint`, `bytesSobre`, `margenBytes`. La segunda tabla contiene `coleccion`, `entradas`, `bytesJSONVisibles`, `hidratado`; `bytesJSONVisibles` **no equivale** a los bytes reales Yjs y no incluye historial borrado. Si `hidratado=false`, la medida no es concluyente. Nunca copiar registros, licencia, PIN ni contenido. `dataImageInline` debe ser **0** para catálogo y operaciones; en fotos es normal que sea positivo porque ese canal almacena los blobs y no hace checkpoint. Los bytes cifrados son **cálculo exacto de longitud AES-GCM** (plaintext + IV 12 + tag 16 + frame 1), sin transmitir nada.

### Por qué S3 es todavía un bloqueo

Se eligió la opción **(a), reconstrucción Yjs conservando la causalidad**, únicamente para intentar reducir un checkpoint tag0 que ya excede el límite. No se reescriben mapas con IDs nuevos ni se borra historial: se re-aplica el update completo a un Y.Doc temporal, se comprueban el estado visible y el snapshot causal, y se usa el resultado **solo si es más pequeño**. El intento está limitado a 2 MiB para no triplicar memoria con documentos gigantes. Si no reduce suficiente, se mantiene la alarma visible y NO se marca el checkpoint como guardado. El lector v636 sigue recibiendo tag0; gzip/tag7 continúa apagado mientras haya un aparato antiguo. Esta medida **no garantiza** reducir los 191866 B ni demuestra que todas las tiendas quepan; las mediciones reales deciden si se requiere un diseño por periodos, que necesitaría una migración de protocolo y compatibilidad propia.

La prueba de whitelist del catálogo evalúa el exportador real con un producto que tiene una foto inline sintética y verifica que solo sale `fotoHash`. No se mueve ninguna foto ni se cambia la colección de operaciones.

## Cloudflare Workers Builds

Build fallido `ec0fa5a9-d9b1-495d-b9f5-eb3caf200a91`: [abrir el log en Cloudflare](https://dash.cloudflare.com/c4d8aa3b3e1db0d80b0beb4abc7c1364/workers/services/view/friendly-123/production/builds/ec0fa5a9-d9b1-495d-b9f5-eb3caf200a91). El token OAuth de Wrangler recibe HTTP 403, código 12004, al pedir logs; **causa aún no leída**. Hipótesis comprobable, no diagnóstico: el build de rama ejecuta `wrangler versions upload` sin resolver el `wrangler.jsonc` raíz o desde un directorio distinto (incidencia histórica documentada en ese archivo). La configuración existe y apunta a `./docs`; hay 204 archivos estáticos, ~7,1 MB en total y ninguno supera 616 KB, por lo que no hay evidencia de exceder el tamaño individual.

Desde el checkout del **SHA exacto** en un terminal, sin credenciales de producción y sin desplegar:

```sh
npm ci
npx wrangler deploy --dry-run --config wrangler.jsonc
```

Después comparar el resultado con el primer error del log del panel; no modificar configuración hasta conocer la causa.

## Prueba física para JFC: diez pasos, sin tocar clientes

1. Trabaja **solo con tu tienda de prueba**. Guarda primero una copia de seguridad y confirma que el PIN sigue funcionando.
2. Comprueba que PC Chrome, iPhone Safari y PWA instalada muestran la **misma licencia de prueba**; no compartas el código ni el PIN en capturas.
3. Prepara el reinicio único S2 en cada aparato de prueba con acompañamiento; **no lo hagas en ninguna tienda real**. Anota qué aparatos lo completaron. No está ejecutado todavía.
4. Abre la candidata en PC, cierra y vuelve a abrir: cronometra desde el toque hasta que puedas usarla. Debe tardar **menos de 3 segundos**.
5. Repite la apertura en Safari y en la PWA instalada; captura los tres tiempos y la versión mostrada.
6. Cuando la sincronización termine, ejecuta en PC la medición numérica anterior. Guarda solo la tabla de cifras y el estado `hidratado`.
7. Haz diez ventas **de prueba** en PC y mira cuándo aparecen en iPhone/PWA. Guarda los tiempos; la mitad deben verse en **200 ms o menos** y el 95 % en **1 segundo o menos**.
8. Repite diez operaciones de prueba en sentido iPhone/PWA → PC. No cuentes como éxito una venta que aparece solo después de recargar.
9. Recarga tres veces sin hacer nada: deben aparecer **cero operaciones nuevas**. Después realiza dos recorridos PC→iPhone→PC y compara `huellaInventario()`: debe ser idéntica en todos.
10. Comprueba que un aparato con v636 no se queda desconectado y que **gzip sigue apagado**. Sube a la PR solo capturas sin datos personales, tiempos, conteos y resultado de los dos recorridos; solicita aprobación expresa antes de publicar.

**Aún no ejecutado:** reinicio S2 en aparatos reales, pruebas físicas, log autenticado Cloudflare y confirmación de checkpoint suficiente para todos los negocios. El código de reinicio JFC debe retirarse del cliente general tras ejecutar el canario y antes de la fase 3.

**Decisión pendiente de JFC:** ¿apruebas publicar **únicamente** el shell 637 a tu tienda de prueba, después de cerrar las comprobaciones anteriores?
