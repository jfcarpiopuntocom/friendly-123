# PLAN — Repasada (microbugs cazados) + micromejoras world-class (2026-09-10)

Revisión de todo lo de hoy (v243→v258, sync nuevo + dashboard + fixes de Belén/
Sarah). Lo verificado que SÍ enchufa bien queda arriba; los hallazgos abajo, con
los 2 ya arreglados y el resto en cola por riesgo/valor.

## LO QUE SE VERIFICÓ QUE ENCHUFA BIEN
- #7 (stock de bebidas): la fórmula reescala conservando volumen (copas×mlViejo =
  copas'×mlNuevo), solo `bar`, solo `servingMl`. Correcto.
- #3 (admin→dashboard): aislamiento usa `NS="f123"` CONSTANTE → index.html y
  dashboard.html leen la misma clave `f123_admins_pins`. Verificado: crear admin
  la escribe; el gate la acepta.
- #8 (detalle de compras): despliega y lista con chips fiado/pagado/cortesía.
- #6 (deep-link editar venta): cambia de vista, encuentra y resalta la venta, abre
  su editor con precio+guardar (en el demo todas están liquidadas, sin editable).

## MICROBUGS / IMPRECISIONES CAZADAS
1. **[ARREGLADO v258]** Restock "Order +N" salía en blanco sin umbral amarillo.
2. **[ARREGLADO v258]** El redimensionado de foto no tenía piso duro (imagen
   patológica podía pasar el frame de 256 KB).
3. **[cola] #8 homónimos:** "See purchases" empareja por `clienteNombre` cuando no
   hay `clienteId` → dos clientes con el mismo nombre mezclan compras. Preferir
   SIEMPRE `clienteId`; si falta, avisar "varios clientes con este nombre".
4. **[cola] #6 venta liquidada:** el deep-link resalta la venta pero, si está
   liquidada (bloqueada), no abre editor y NO dice por qué. Falta un aviso
   ("Esta venta ya está liquidada; para corregirla, reabre el período").
5. **[cola] E — chip "Synchronized":** refleja SOLO el sync viejo (help-ui.js
   escucha su `notificarEstado`), no los 3 canales del sync nuevo. Debe considerar
   `OCYjs._diag().ws` (verde solo si hay canal abierto de verdad).
6. **[cola] J — aviso de merge:** `window.__syncMergeAviso` se re-pinta en cada
   `cargarHoy` hasta recargar. Darle expiración (ts + ~2 min) o una (x) para
   descartar.
7. **[cola] #3 lockout:** un PIN de empleado válido (no admin) en el dashboard
   suma un "éxito" al lockout y luego se rechaza. Inofensivo pero inconsistente;
   no contar éxito si al final no entra.
8. **[cola] #6 producto:** la rama `#editar=producto:<id>` usa un selector
   `[data-id],[data-producto]` que quizá no cuadra con las tarjetas de Inventario
   → no-op silencioso. Verificar el atributo real y ajustar (la rama venta sí anda).

## PENDIENTES DE MISIONES ANTERIORES (no microbugs, features en cola)
- **#2 — resúmenes de comisión** en la pantalla de gestión de perchas (traer el
  bueno del módulo de Comisiones): sumar por percha/comisionista "vendido · comisión ·
  queda en casa" del período. Es el que faltó implementar.
- **C — multiplexar los 3 WebSockets del sync nuevo en 1** (escala: 3→1 DO/negocio).
- **D — hibernación del Durable Object** en el worker (deploy con JFC): el cambio
  que hace barato a 3000 dueños.

## MICROMEJORAS WORLD-CLASS (pulido, por tanda)
- **K — cuadrar KPIs:** confirmar que "Ganancia de hoy" del dashboard y el hero de
  Hoy dan el MISMO número (mismo cálculo, dos pantallas). Riesgo de "dos verdades".
- **I — fotos en más vistas:** miniatura de la percha en el dashboard/Inventario,
  no solo en Perchas (el `fotoHash` ya viaja).
- **H — feedback al prender el sync nuevo:** un microestado "Sincronizando con tus
  otros aparatos…" en vez de recargar en seco.
- **Restock/Promoters:** ordenar Promoters por comisión pendiente; en Restock,
  mostrar "días para agotarse" si hay ritmo de venta.
- **Deep-link #6:** que el lápiz también funcione desde la vista Sales del dashboard
  a nivel producto (corregir el precio de catálogo, no solo de una venta).

## ORDEN (por riesgo/valor)
Cola de bugs 3→8 (baratos, esta tanda) → #2 (feature) → C/D (escala, con deploy) →
micromejoras K,I,H,… (pulido).

## LO QUE NO ENTRA
- Retirar el sync viejo (respaldo hasta probar el nuevo en aparatos reales).
- Reescribir el dashboard como editor directo de dinero (usa deep-link a la app).
- Rediseños visuales grandes.
