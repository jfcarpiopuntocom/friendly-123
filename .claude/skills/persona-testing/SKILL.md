---
name: persona-testing
description: Testea un flujo de UI corriendo la misma tarea tres veces como Hugo (IQ alto), Paco (usuario normal) y Luis (descuidado), buscando huecos entre lo que la interfaz promete y lo que el dato final guardado realmente refleja. Usar antes de dar por buena cualquier feature financiera o de flujo crítico (ventas, comisiones, cartera, caja chica, cierre de caja), o cuando JFC pide "prueba como Hugo/Paco/Luis" o "haz los 3 pases".
---

# Persona testing — Hugo, Paco, Luis

Origen (JFC, 2026-07-29): el bug real de comisión de Idiomarte. Un campo se
podía editar (precio efectivo pagado, distinto del precio de catálogo) y la
UI lo aceptaba sin quejarse — pero el cálculo de comisión, en otra pantalla,
seguía usando el precio de catálogo. La interfaz PROMETÍA (visualmente,
dejaba editar el campo) algo que el sistema NO CUMPLÍA río abajo. Nadie lo
vio hasta que fue dinero real mal calculado.

Este skill existe para cazar esa clase de bug ANTES de que llegue a
producción: no "¿funciona en el camino feliz?" sino **¿todo lo que la UI
promete se refleja de verdad en el dato final?**

## Las tres personalidades

Cada una corre la MISMA tarea de principio a fin, por separado. No es un
checklist compartido — es la misma tarea interpretada tres veces distintas.

- **Hugo — IQ alto.** Lee todo, entiende el modelo de datos detrás de la UI,
  prueba atajos deliberadamente, edita campos en orden no obvio, intenta
  romper el flujo a propósito (doble-click, atrás del navegador, editar dos
  veces el mismo campo, cancelar a medio camino). Sospecha de la UI.
- **Paco — usuario normal.** Sigue el camino visualmente obvio, no lee letra
  chica ni tooltips, confía en que el botón grande es el correcto, no vuelve
  atrás a revisar. Representa al 80% de los usuarios reales.
- **Luis — descuidado.** Toca cosas fuera de orden, dejar campos a medias,
  se equivoca de botón, confirma sin releer, cierra la pantalla a mitad de
  una acción y vuelve más tarde. Representa el caso "se hizo mal sin mala fe".

## Procedimiento

1. **Elegir el flujo** a testear (ej. "vender con precio editado y comisión
   resultante", "registrar un fiado y verificar el saldo", "cerrar caja del
   día"). Debe ser un flujo con al menos un valor que se edita en un lugar y
   se consume/calcula en otro — ahí es donde vive esta clase de bug.
2. **Correr el flujo como Hugo.** Anotar cada campo editado, cada pantalla
   visitada, y el dato final que quedó guardado (usar dev tools / inspeccionar
   storage si hace falta, no solo lo que la UI muestra).
3. **Reiniciar el estado** (o usar un cliente/venta distinta) y correr el
   MISMO flujo como Paco.
4. **Reiniciar y correr como Luis.**
5. **Comparar los tres resultados finales.** Si los tres deberían llegar al
   mismo tipo de dato correcto (ej. "la comisión se calculó sobre lo que la
   persona pagó de verdad") y alguno no lo hizo, ahí está el hueco.
6. **Reportar por hueco encontrado, no por personalidad**: qué pantalla
   prometía qué, qué pantalla lo ignoró, y el dato exacto que quedó mal.

## Qué buscar específicamente

- Un valor editable en una pantalla (precio efectivo, saldo, cantidad) que
  un cálculo en OTRA pantalla no recoge — la clase exacta del bug de comisión.
- Campos que visualmente parecen obligatorios pero no bloquean el guardado.
- Botones cuyo texto/posición sugiere una acción pero disparan otra.
- Pasos que se pueden saltar sin que el usuario note que los saltó.
- Estados a medio completar que quedan "guardados" como si estuvieran completos.
- Cualquier lugar donde el mismo número (precio, saldo, comisión) aparece en
  dos pantallas distintas: verificar que sea literalmente el mismo cálculo,
  no dos fuentes que deberían coincidir pero no están garantizadas a coincidir.

## Reporte

Un hallazgo por hueco, formato corto:

```
[Hueco] <una frase: qué prometía vs qué pasó de verdad>
Encontrado como: Hugo / Paco / Luis
Pantalla que prometió: <dónde>
Pantalla/cálculo que no lo reflejó: <dónde>
Dato real guardado: <qué quedó>
```

No hace falta un framework de testing formal ni automatizar nada — es
operar la UI real, con ojos distintos, y comparar el dato final contra la
promesa visual.
