# C197 · Opera Air Out of memory — benchmark de arranque, 22 nov 2026

Evidencia: fotografía física de Opera Air mostrando **Out of memory** durante el acceso por PIN, tras **1–2 minutos** de lentitud (reporte JFC). El proceso de la página termina. Este fallo NO queda demostrado como resuelto por el cambio C197.

## Comparación concreta con 30 días antes

Método reproducible: listar los `<script src="./...">` no comentados directamente en `docs/index.html` de cada SHA y sumar `size` de esos archivos en `git ls-tree -r -l <sha> docs/` o GitHub Git tree API; son **bytes sin comprimir de JS en HTML inicial**, excluyen scripts cargados dinámicamente, CSS, el tamaño de heap y tráfico comprimido.

| Punto | SHA | Scripts | Bytes |
| --- | --- | ---: | ---: |
| 22 oct (Ecuador) | `e898decdfc1e1932afa186fd53238cdfd0e63405` | 73 | 2.571.916 |
| 22 nov previo a C197 (C196 master) | `228777a0be144ac0586fea6bcc81dfea58d30377` | 88 | 3.710.666 |
| Límite ordenado JFC: ≤40% del actual | denominador fijo 3.710.666 | por medir | **≤1.484.266** |

La página actual carga **44,3% más bytes de JS directo** que la de hace 30 días. Para cumplir la orden hay que **dejar de cargar/ejecutar trabajo no imprescindible en el PIN**, no solo reducir bytes de código por minificación. Validar por separado RAM/heap y latencia real Opera, cold-join con datos grandes, reinicio offline y visibilidad de ventas.

## Qué corrige C197

En `src/app/app-inline-01.js`, el coordinador `OCSyncRender` recibe `oc-sync-merge` y antes cargaba Hoy (por la pestaña visible) **incluso con el candado PIN superpuesto**. Ahora pospone el render visible mientras se muestra el candado y entrega la actualización al entrar. El estado durable/sync real no se modifica.

Prueba de código fuente: `test/p0-c197-pin-sync-render-pressure.test.cjs` con 500 fusiones y reanudación. No declarar que C197 consigue ≤40%, elimina todos los snapshots o soluciona por sí solo el OOM.

## Riesgos y criterio de aceptación

Reproducir A→B→A en Opera/iPhone. Exigir login responsivo y sin OOM, mismos recibos/opId y stock, sin duplicar efectos ni perder eventos. El indicador `Sync pending — checkpoint` es salida de `docs/sync-yjs.js::diagnosticarCkpt`; no ocultarlo sin obtener ACK y causa real. El splash de actualización durante gate y la splash inicial son rutas distintas. No publicar si las verificaciones exact-head, PIN, ventas y Sync3 fallan.
