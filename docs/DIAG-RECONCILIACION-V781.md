# Diagnóstico y reconciliación v781 — exportación privada por instancia

Estado: **PR de revisión. NO se publica ni fusiona automáticamente.**
Base: `master` v0.7.80 (PRs #735, #736, #737). No cambia el transporte, el cálculo monetario, ventas, PIN ni persistencia.

## Uso en Advanced

1. Iniciar sesión como **dueño** en la tienda correcta (PC, Safari/PWA y Opera **por separado**).
2. Abrir **Advanced → Export reconciliation report (owner only)** y aceptar la confirmación.
3. Guardar en un lugar seguro los JSON de los tres aparatos, etiquetarlos externamente con nombre físico, navegador, fecha y versión.
4. **Antes de cualquier reconciliación**, exportar además los respaldos completos y comprobar que pueden leerse. El JSON de este PR **no es un respaldo restaurable**.
5. Ejecutar en un PC, sin conexión de red del comparador:
   `node scripts/compare-reconciliacion.cjs PC.json Safari.json Opera.json > comparacion.json`
6. Repetir las pruebas físicas **PC → Safari/PWA → PC**, dos ciclos **A→B→A**, y abrir Opera como tercer testigo. Comparar nuevas capturas de cada etapa con las anteriores.

## Qué contiene

| Dominio | Evidencia | Limitación |
| --- | --- | --- |
| Inventario | Hash estable por ID de producto, stock, PN por actor seudónimo, base/epoch/deficit/conflicto | No es certificado físico de conteo; no transfiere stock |
| Ventas | Hash estable por ID de venta, opId disponible, cantidad, precio, flags | Precio unitario NO es ingreso neto ni comprobante financiero |
| Dinero | Hash por línea de payouts, gastos, transferencias, ajustes y movimientos | Los campos sin representación numérica en su registro quedan null, nunca se inventan |
| Fotos | Hash por ID, punteros de foto doblemente hasheados | NO incluye ni verifica bytes de fotografías; inspección OCFotos por separado |
| Acceso | Hash por ID, rol/activo/borrado | No incluye PIN, nombres, emails, teléfono ni secretos |
| Persistencia | `persistenciaConfirmadaLocal`, recuperación/hidratación Yjs, contadores del outbox | No demuestra confirmación en otro aparato |
| Eventos | Id, opId, tipo, hash de cadena local; log legacy y opsMap | Historial legacy limitado de origen, no se promete reconstrucción de lo ya podado |
| Outbox | Sobres Yjs por canal (ID seudónimo, clase, inFlight, huérfano, confirmados agregados), cola legacy por opId | **Un sobre cifrado no equivale a un opId; no se fabrica la equivalencia** |
| ACK | Estado expreso `acuseRemotoPorOpId.disponible=false` | Requiere ampliar protocolo de recibos para certificar ACK remoto individual |

Todo se calcula tras gesto voluntario. Solo dueño: doble autorización en Advanced y en el backend.
La ruta `GET /api/diagnostico/reconciliacion` es de **solo lectura**, lista blanca y no exporta payloads en bruto.
Los JSON contienen **cifras comerciales**: mantenerlos privados y evitar adjuntarlos a issues públicos.

## Reglas de reconciliación

- Todos los estados parten de **no verificado**. Si un hash cambia entre capturas, se informa como **divergencia observada**, no pérdida definitiva (las capturas no son simultáneas).
- Diferencias de opId se separan por **presentes/ausentes en opsMap**, sin confundirlo con ausencia definitiva en un receptor.
- **NUNCA GO** por igualdad de hashes: falta ACK individual remoto y pruebas físicas. El comparador fija **NO-GO** por diseño.
- No se elige automáticamente instancia canónica, no se restaura, no se borran datos, no se hace fusión, no se reenvían operaciones.
- Preservar tres respaldos verificados, identificar opIds exclusivos, decidir manualmente qué conservar o descartar, documentar decisiones y SOLO entonces planear cambios con aprobación específica.

## Pruebas y publicación

- `node --test test/p0-v781-reconciliacion-export.test.cjs`: prueba de privacidad, autorización, rechazo backend y no suponer ACK.
- CI existente, `build-app-entry --check`, validación del manifest/SW, test Safari/WebKit y pruebas físicas reales siguen siendo gates obligatorios.
- **Antes del merge**: ejecutar scripts de release para registrar versión, generation/manifest/precaché y asegurar que `diagnostico-export.js` está disponible sin red. No declarar CI ni Safari físico verificados sin una ejecución real.
- En particular, NO reiniciar ni forzar una actualización de PWA durante una venta. No modificar datos reales de clientes al probar.

### Alcance deliberadamente pendiente

- Prueba durable end-to-end `opId → ACK relay → recepción durable A/B/C` todavía no está expuesta por el transporte actual.
- SHA exacto de cada runtime y nombre visible del aparato: quedan como `null` cuando no hay testigo fiable.
- Huella del contenido binario de fotos y conexión con el panel histórico deben verificarse en una iteración posterior de solo lectura.
