# Auditoria de la lista de Belen sobre v556 (corte parcial)

Base: produccion v556, commit fd3ccb88daf42b086947547c663ab9c83cc0160e (comprobado: sw.js y version-manifest de https://friendly123.com/app/ dicen f123-shell-v556).
Rama de trabajo: auditoria-belen-v556. Candidato conjunto con Codex: ver "Estado al corte".
Capturas (celular 390x844 y escritorio 1366x900): `C:\00 Projects\friendly-123-v556-audit\auditoria-belen-v556-capturas\`
Prueba de dos aparatos reales: `test/auditoria-belen-v556-e2e.test.js` (dos contextos de Chromium con almacenamiento propio, app servida desde docs/, sin red de produccion, solo datos sinteticos; ayudante en `test/helpers/e2e-app.cjs`).

## Estado al corte

| Item | Estado antes (v556) | Evidencia | Arreglo hecho | Estado despues | Commit |
|---|---|---|---|---|---|
| 1 Inicio lleno de rojo | Parcial: v554 solo plegaba las obras sin existencias; con stock 1 seguian en rojo a la vista | `docs/mock-backend.js` (alertas) e `docs/index.html` (panel `ocRestockHoy`); prueba `test/hoy-restock-fold-v554.test.js` | Todo aviso de reposicion de un producto no perecedero va al panel plegable "Avisos" (cerrado por defecto). Vencimientos y perecederos siguen a la vista. | Parcial: falta la casilla "Pieza unica / no se repone" por producto y que el semaforo general deje de pintarse rojo por avisos plegados (no iniciado) | 5491c41 |
| 2 Stock 1 en computadora y 0 en celular | Resuelto en el modelo probado | e2e item 2: vender en A deja 0 solo esa pieza en B; ajustar 0 a 1 converge; un reseed viejo no lo revierte; ventas simultaneas se suman | Ninguno necesario | Resuelto (en simulacion de dos aparatos; falta comprobar con los aparatos de Belen) | 00eb785 |
| 3 Productos nuevos/ediciones no aparecen en otro aparato | Resuelto en el modelo probado | e2e item 3: Johnny Walker y "ceramic con puntitos" aparecen; editar nombre y precio en B llega a A; recargar conserva la edicion | Ninguno necesario. Limite: la edicion se hizo por la API de la app, no tecleando el formulario | Resuelto en prueba | 00eb785 |
| 4 Cliente nuevo en la venta con edad, pais, residencia | Parcial: v553 puso edad, pais y residencia; faltaba genero (el formulario de Clientes lo pide) | `docs/index.html` bloque `vi-newcli-*`; prueba en `test/sale-customer-contact-v551.test.js` | Se agrego el genero con las mismas opciones | Parcial: el formulario "+ Agregar cliente" de Clientes sigue sin edad ni pais al crear (si se pueden poner al editar). No iniciado | 1d2a48a |
| 5 WhatsApp y correo duplicados en la venta | Resuelto desde v552 | `test/sale-customer-contact-v551.test.js` (no existen `vi-email` ni `vi-whatsapp`) | Ninguno | Resuelto | ya en fd3ccb8 |
| 6 Aviso negro intermitente | No resuelto: el aviso se podia cerrar pero la causa seguia | Sentry FRIENDLY-123-1: "ResizeObserver loop completed with undelivered notifications", 10 eventos, versiones hasta v547, sin pila. Origen: `docs/index.html` `new ResizeObserver(ajustar)` cambia `--riel-top` dentro de su propio callback | El ajuste se mide en el siguiente cuadro (requestAnimationFrame); el aviso ya no se muestra para esa notificacion benigna del navegador (se sigue registrando); `docs/canarios.js` tampoco la manda a Sentry. Pruebas en `test/error-toast-lifecycle.test.js` | Resuelto para esa causa. Quedan sin reproducir: FRIENDLY-123-3 (error de Tabulator en el tablero, v523, 2 eventos) y FRIENDLY-123-2 (v495, 1 evento), ninguno visto desde entonces | 67ffdb8 |
| 7 Perchas "cargando" | No resuelto | La carga no tenia plazo | Lo hace Codex (`docs/vista-perchas.js`); integrado sin cambios | Codex | 185e4ef |
| 8 Comisiones | Sin regresion buscada aun | Se corrio la suite completa (ver resultado abajo) | Ninguno | Resuelto si la suite pasa | n/a |
| 9 Fiados por compra: pagado y pendiente | No resuelto | `docs/index.html` `pintarSaldoCartera` solo muestra un libro plano de cargos y pagos | No iniciado. Nota de diseno: la nota de Notion prohibe repartir los abonos por orden automatico (FIFO); hace falta que quien cobra elija a que compra se aplica cada abono | No iniciado | n/a |
| 10 "Gastos este mes $2.300" | Sin explicar | El filtro de mes usa `OCBusinessReadModel.monthly` con la zona horaria; en la prueba, un gasto de 2300 aparece en la tarjeta (capturas gastos-*) | No iniciado (propuesta: mostrar el nombre del mes y la cantidad de gastos en la tarjeta) | No iniciado | n/a |
| 11 "Ventas del mes" = todo el dinero recibido | No resuelto | Hoy la tarjeta es venta neta devengada | No iniciado. Regla acordada: mostrar las dos cifras, venta neta y dinero recibido, nunca fundidas | No iniciado | n/a |
| 12 Dueña y Admin ven gastos distintos | Sin causa conocida (Belen: 2.313,00 contra 1.358,46) | e2e item 12: altas en ambos, ediciones del mismo gasto, anulacion cruzada, trabajo sin conexion, aparato que entra tarde, recarga: totales y filas identicos en los dos aparatos | Ninguno. No se pudo reproducir en simulacion. Hallazgo de Codex: el conjunto Yjs pendiente tiene 417 hechos financieros distintos, todos ya presentes identicos en el catalogo; no se reimporta ni se inventan movimientos | Sin reproducir, sigue abierto con Belen (propuesta: huella de gastos visible en ambos aparatos para comparar) | 00eb785 |
| 13 Gastos con efectivo/transferencia y foto | Sin verificar en pantalla | e2e item 13: se llena el formulario real, se adjunta foto, el gasto guarda medio de pago y hash de foto y llega al otro aparato | Ninguno necesario | Resuelto en prueba | 00eb785 |
| Regla "navaja suiza" | n/a | Solo Inicio tocado: avisos en un panel cerrado | Mantener cambios minimos, sin rediseno | Parcial | 5491c41 |
| Supabase: todos los datos por el relay de Supabase | Pendiente | Lo prepara un agente aparte (inventario de destinos de red + prueba) | Ver seccion siguiente | En curso | n/a |
| Licencias en Supabase detras de un interruptor | Pendiente | Lo prepara el mismo agente (SQL, adaptador, importador, pruebas) | No se ejecuta contra produccion. Decision del dueno: Codex considera deliberado dejar las licencias en Cloudflare | En curso | n/a |
| Version | v556 | `docs/sw.js`, `docs/version.json`, manifiesto | Subida a v557, generacion de cache golden121 | Hecho | 9604c38 |

## Que debe aprobar JFC antes de que llegue a clientes

1. Publicar el candidato (cambios en `docs/`: v557). Nada de esto se ha publicado.
2. Si le parece bien que los avisos de reposicion de todo producto no perecedero queden dentro del panel cerrado "Avisos".
3. Decidir el diseno de fiados (item 9): abono asignado a una compra elegida por quien cobra.
4. Decidir si las licencias se quedan en Cloudflare o pasan a Supabase (solo preparado).

## Riesgos que quedan

- Items 2, 3, 12 y 13 se probaron con dos navegadores reales pero moviendo las actualizaciones a mano, no por el relay de Supabase ni con los aparatos de Belen. Falta la medicion en vivo.
- La diferencia de gastos de Belen no se reprodujo: no se debe dar por resuelta.
- Items 9, 10 y 11 no se iniciaron.
