# Caza de bugs Hugo/Paco/Luis — amigable-123 y friendly-123
**Fecha:** 2026-08-18 · **Pedido:** JFC — "de 11 a 22 bugs o daños que hayas
hecho TÚ en los últimos 2 días, luego otros culpa de nadie, luego guards"

**21 hallazgos** (18 planeados + 3 que destaparon los propios guards), todos medidos con `git`, `grep` y comparación entre apps. No se
leyó ningún archivo grande entero.

---

## TANDA 1 — Daños míos, de los últimos 2 días (8)

| # | Dónde | Qué pasa | Gravedad |
|---|---|---|---|
| 1 | `borradores.js` (A+F) | 3 listeners en `document`/`window` y **0** `removeEventListener`. Cada apertura de formulario suma tres más; en una jornada de cien altas hay trescientos oyentes guardando el mismo borrador. | Alta |
| 2 | `ocConfirmEscribiendo` (A) | No atiende Escape ni clic afuera. Quien abre el diálogo de borrar y se arrepiente **no puede salir**: la promesa nunca resuelve y el modal queda trabado con el `<input>` del reto encima. | Alta |
| 3 | `eliminarProductoUI` (A) | Quité el patrón "toca otra vez" y no puse `btn.disabled`. Doble toque = **dos DELETE** al mismo producto. El segundo da 404 y muestra un error falso sobre algo que sí se borró. | Alta |
| 4 | rescate IDB (A+F+C) | Al recuperar estado desde IndexedDB repinto Inventario, Perchas y Ubicaciones, pero **no `cargarHoy`** — que es la vista donde el encargado está todo el día. Ve cifras viejas sin saberlo. | Alta |
| 5 | `borradores.js` → `aplicar()` (A+F+C) | Al restaurar dispara `input` y `change` por campo, y el propio módulo escucha esos eventos: cada restauración provoca una tormenta de guardados del borrador que acaba de restaurarse. | Media |
| 6 | `pintarDesdeLocal` (A+F) | Deja `modoLocal = true` para siempre. Si el WebSocket se cae después, el pulso dice "desde este dispositivo" cuando los datos vinieron del equipo. Un indicador que miente. | Media |
| 7 | `estado-idb.js` (A+F+C) | El espejo se escribe en **cada** venta, sin agrupar. En una feria con ventas seguidas son decenas de escrituras de todo el estado por minuto. | Media |
| 8 | `panorama` de F123 | Publica `contribFija: liq.contribFija \|\| 0`, pero el `getLiquidaciones` de F123 no calcula aporte fijo: **siempre 0**. Un dato mudo que parece real. | Baja |

## TANDA 2 — Culpa de nadie, preexistentes (6)

| # | Dónde | Qué pasa | Gravedad |
|---|---|---|---|
| 9 | `esDelMesActual` (F+C) | Compara `fechaISO.slice(0,7)` —**UTC crudo**— contra el mes local. amigable-123 lo arregló el 2026-08-06 con `fechaLocalDe()`; las hermanas nunca lo recibieron. En Ecuador (UTC−5) **toda venta después de las 19:00 del último día del mes cae en la liquidación del mes siguiente.** Es plata mal repartida. | **Crítica** |
| 10 | `ventasHoyDe` (F+C) | Mismo defecto: `String(v.fecha).slice(0,10)`. Después de las 19:00 la venta **desaparece del "hoy"** y reaparece mañana. El cierre de caja no cuadra. | **Crítica** |
| 11 | `mock-backend.js` (F+C) | La función `fechaLocalDe()` **no existe** en ninguna de las dos. Es la causa raíz de #9 y #10, y de los otros 12 sitios que comparan fechas. | **Crítica** |
| 12 | `aislamiento.js` (F+C) | Diez claves con prefijo `amg_` heredadas de amigable (`amg_hechos_db`, `amg_audit_db`, `amg_cartera_alertas_v1`…) y `PREFIJOS_LEGADO` sólo rescata `f123_`. Lo que se hubiera escrito sin namespace antes del aislamiento **no se migra**. | Media |
| 13 | `guardarEstadoLocal` (C) | El orden de sacrificio buscaba sólo `f123_foto_percha_`, pero `crypto-store.js` de ese repo libera `vp_foto_percha_`: no liberaba las fotos que de verdad ocupaban el espacio. **Ya arreglado** al portar. | Media |
| 14 | `getLiquidaciones` (F) | No resuelve la comisión por comisionista (`fuenteComisionDe`), sólo por percha. Un asociado con trato propio distinto al de la percha cobra el de la percha. Divergencia de modelo, no defecto de código — se documenta, no se fuerza. | Baja |

## TANDA 3 — Guards que faltan (4)

| # | Qué falta | Por qué importa |
|---|---|---|
| 15 | Prueba automática de los **invariantes de dinero**: el reparto suma el bruto, los porcentajes suman 100, las dos lecturas de Comisiones dan el mismo total. | Lo comprobé a mano tres veces esta semana. Un guard lo comprueba en cada cambio, gratis. |
| 16 | Guard de **fechas con zona horaria**: ninguna comparación de fechas puede usar `.slice()` sobre un ISO crudo. | Es el bug #9/#10, y ya había aparecido antes (2026-08-06). Sin guard vuelve por un camino nuevo. |
| 17 | Guard de **service worker completo**: que `sw.js` liste todo script que `index.html` carga. | Ya pasó ("el SW no conocía 8 scripts"). Es una comparación de dos listas: no hay excusa para no automatizarla. |
| 18 | Guard de **paridad de claves** entre las 3 apps: que ninguna escriba con el prefijo de otra. | Es la causa de #12 y de la contaminación cruzada que ya costó dos incidentes de licencia. |

---

## Orden de arreglo — por riesgo, no por facilidad

1. **#11 + #9 + #10** — portar `fechaLocalDe()` y usarla en los 14 sitios de F123 y los 6 de C123. Es plata mal contada; va primero.
   *Se comprueba:* una venta fechada a las 23:00 del último día del mes tiene que caer en ESE mes y en ESE día. Prueba con fecha inyectada.
2. **#2 + #3** — el modal trabado y el doble DELETE. Bloquean o dañan con un gesto normal.
   *Se comprueba:* Escape cierra y resuelve `false`; dos clics seguidos disparan UN solo DELETE.
3. **#1 + #5 + #7** — fuga de listeners, tormenta de guardados, escrituras sin agrupar. Los tres son del mismo módulo y se arreglan juntos.
   *Se comprueba:* abrir el formulario diez veces deja UN juego de listeners; restaurar un borrador provoca UNA escritura.
4. **#4 + #6** — repintado incompleto e indicador que miente.
   *Se comprueba:* tras un rescate desde IDB, `cargarHoy` se vuelve a pintar.
5. **#15 → #18** — los cuatro guards, como script en `.claude/`.
   *Se comprueba:* corren en verde ahora y detectan el bug si se reintroduce a mano.
6. **#8 + #12 + #14** — documentar y corregir lo cosmético.

## Lo que NO entra

- Unificar el modelo de comisiones de F123 con el de amigable (#14). Es una decisión de producto, no un bug, y forzarlo cambiaría a quién se le cobra.
- Tocar consultorio-123 más allá de las fechas (#9-#11): está en focus groups.
- Refactorizar `borradores.js` o el tablero. Se arreglan los defectos, no se rediseña.


---

# RESULTADO — 2026-08-18, todo arreglado y comprobado

Los guards, al correrlos por primera vez, destaparon tres bugs más que el
barrido a mano no vio. Van aquí porque son la prueba de que valían la pena:

| # | Dónde | Qué era |
|---|---|---|
| 19 | `index.html` (C) | El rescate desde IndexedDB **no tenía quien lo escuchara** en consultorio-123: recuperaba el estado en memoria y la pantalla seguía mostrando lo viejo. Abonos y pagos que el médico no ve. |
| 20 | `sw.js` (F y C) | friendly-123 no precacheaba **16** scripts y consultorio-123 **24**. Es el mismo bug que ya pasó en amigable ("el SW no conocía 8 scripts"): dispositivos instalados sirviendo versión vieja. |
| 21 | `aislamiento.js` (C) | 71 claves con prefijo `f123_` heredado. **No se renombraron**: la migración ya las rescata y renombrarlas dejaría huérfanos los datos que el usuario tiene guardados. Es deuda de nombres, no de datos — el guard lo dice como nota, no como rojo. |

## Comprobación final

```
guards.sh          3/3 repos TODO VERDE
fechas             venta 23:00 ECU del último día -> cae en el mes correcto, en las 3
sintaxis           146 .js + todos los bloques inline, limpios
panorama/comisiones  reparto suma el bruto, % suman 100, dos lecturas = mismo total
estado-idb         con QuotaExceededError la venta sigue en 200 y el espejo recibe
tablero            eventos agrupados; vendedora 25% + artista 85% = combinado 61%
```

## Lo que quedó fuera, a propósito

- **#14** unificar el modelo de comisiones de F123 con el de amigable: es decisión
  de producto y cambiaría a quién se le cobra.
- **#21** renombrar las claves `f123_` de consultorio: se perderían datos reales.
