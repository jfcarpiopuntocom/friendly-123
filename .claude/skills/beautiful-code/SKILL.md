---
name: beautiful-code
description: Audit and tidy code for readability and maintainability using the Beautiful Code principles (after Pavle Pesic), adapted to vanilla JS/HTML PWAs. Use when JFC asks to "adecentar", clean up, review readability, or before declaring a release. Readability and correctness win over any size rule.
---

# Beautiful Code — adaptado a friendly-123 / amigable-123 / consultorio-123

Basado en los 8 principios de *Beautiful Code Principles* (Pavle Pesic, 2019),
escrito para iOS/Swift. Aquí van traducidos a este stack: PWA en JS vanilla sin
framework, archivos grandes a propósito, datos reales de clientes en producción.

## La regla que manda sobre todas
**Adecentar NUNCA puede cambiar comportamiento.** Un refactor de legibilidad
que rompe una venta es un bug, no una mejora. Por eso: respaldo con SHA-256
antes, suite completa después, y si el cambio no es claramente neutro, no se
hace. Esto es más estricto que el artículo a propósito: aquí hay clientes reales.

## Los 8 principios, qué aplica y qué no

1. **Estándares de código — APLICA.** Nombres en español del dominio
   (`percha`, `fiado`, `abono`, `comisionista`), consistentes entre las 3 apps.
   El código de una sesión no debería distinguirse del de otra.

2. **Notación `self` — NO APLICA** (es de Swift). El análogo útil en JS: dejar
   claro qué es estado del módulo y qué es local. Los IIFE de este repo ya lo
   resuelven con el cierre.

3. **Marcas de navegación — APLICA, ya existe.** El análogo de los `MARK:` de
   Xcode son los bloques de comentario `// --- Sección ---` y `/* ===== */`.
   OJO: algunos tests aíslan tramos por esos marcadores (p. ej.
   `business-header` corta hasta "// --- Navegación ---"). Mover código entre
   marcadores puede romper tests: ubicar por TEMA.

4. **Constantes — APLICA, y es donde más se gana.** Un número mágico que
   aparece dos veces es un bug esperando: si alguien cambia uno y no el otro,
   falla en silencio. Priorizar: (a) números que SON reglas de negocio (el SLA
   de 2000 ms, topes de plan, límites de frame del relay); (b) números
   duplicados. Un número usado una vez y explicado por su comentario puede
   quedarse.

5. **Tamaño de clase ≤300 líneas — SE RECONOCE, NO SE PERSIGUE A CIEGAS.**
   `index.html` (~8.800 líneas) y `mock-backend.js` (~4.500) lo violan de
   lejos. Partirlos es un cambio de arquitectura grande y arriesgado, NO un
   adecentado: no se hace como parte de una limpieza. Las piezas NUEVAS sí van
   en módulos propios y chicos (ej. `sync-latencia.js`, 143 líneas).
   El propio artículo lo dice: la legibilidad manda sobre el tamaño.

6. **Componentes reutilizables — APLICA.** Reusar lo probado antes que
   duplicar. Ej.: el botón "Scan a label" dispara el botón del nav existente en
   vez de reimplementar la navegación.

7. **Patrones de diseño — APLICA con moderación.** Los que ya viven aquí:
   observador (`CustomEvent` como `oc-catalogo-cambiado`), espejo/cache de
   lectura (Durable Object delante de KV), CRDT (Yjs). No introducir patrones
   nuevos sin necesidad real.

8. **Code review — APLICA.** Funcionalidad primero, legibilidad después. Y el
   review incluye el trabajo propio: los peores bugs de una sesión suelen ser
   de la misma sesión.

## Cómo auditar (barato en tokens)
- No leer archivos enteros. `git diff --stat <base>..HEAD` para acotar a lo
  tocado, luego grep por patrón.
- Buscar números repetidos: `grep -on "[0-9]\{4,\}" archivo | sort | uniq -c`.
- Comentarios que describen QUÉ hace el código en vez de POR QUÉ: sobran.
  Comentarios que explican una trampa, un bug real o un límite: se quedan
  (regla de JFC: comentario copioso de mantenimiento, nunca estrategia).
