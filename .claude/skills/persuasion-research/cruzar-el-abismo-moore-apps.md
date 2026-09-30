# Cruzar el abismo (Geoffrey Moore) aplicado a las tres apps

Fecha: 2026-09-30 · Fuente: resumen de *Crossing the Chasm* (Moore) que pegó JFC.
**Uso interno.** Jamás nombrar "abismo", "cabeza de playa", "bolera" ni "pragmáticos" en textos
públicos (regla de agencia-jfc: los frameworks no se nombran). Aquí solo se anota qué dice
la obra y qué hipótesis nos deja. Las hipótesis NO son decisiones: JFC decide.

## 1. La idea en dos líneas
Entre quienes compran una posibilidad (visionarios) y quienes compran una solución segura
(pragmáticos) hay un abismo. Los pragmáticos minimizan riesgo, piden referencias de su propio
gremio y solo compran soluciones completas y estándar.

## 2. Las cinco piezas del método (resumen fiel del texto de JFC)
1. **Cabeza de playa.** Un solo nicho, no el mercado masivo. Criterios: dolor agudo sin solución
   adecuada; acceso y presupuesto real, con una comunidad donde los compradores se hablan
   (boca a boca); nicho lo bastante chico para ser #1 o #2 rápido.
2. **Producto completo.** Cuatro capas: central (el software), esperado (uso sencillo, instalación
   fácil), ampliado (soporte, formación, integración, compatibilidad, seguridad), potencial
   (mejoras y escala futura). Se arma para el nicho elegido, con aliados si hace falta.
3. **Posicionamiento.** Seguridad del valor de negocio y facilidad de adopción, no especificaciones.
   Plantilla: *Para* [cliente del nicho] *que* [tiene este dolor], *nuestro* [producto] *es una*
   [categoría] *que* [beneficio clave]. *A diferencia de* [alternativa actual], *nuestro producto*
   [diferenciador único].
4. **Canal y precio.** Canal en el que el comprador ya confía. Precio por valor y por lo que ese
   gremio está acostumbrado a pagar, no por costo.
5. **Bolera.** Ganado el primer bolo: convertir al 100% de los clientes en referencias activas;
   derribar por aplicación adyacente (misma clase de cliente, función nueva) y por industria
   adyacente (misma aplicación probada, segmento nuevo).

## 3. Lo que ya tenemos y encaja (hechos del repo, no hipótesis)
- **Un dolor agudo concreto ya probado:** Belén (idiomARTE) necesitaba repartir comisión distinta
  por producto (30/70 en vez de 15/85). Se construyó (v424) y llegó a clientes. Es el caso de
  uso de "percha con consignación" de friendly-123.
- **Referencia real con nombre:** idiomARTE (Belén). Diego Peñaherrera ya es testimonio publicado.
  La bolera exige convertir cada cliente en referencia: pedir permiso por escrito antes de citar.
- **Producto ampliado ya existe en parte:** demo con PIN 456, talleres de 2 h, diagnóstico
  por WhatsApp, dashboard de comisiones, respaldo, tres idiomas de trabajo (EN/ES).
- **Precio ancla ya definido:** pago único (friendly-123: $399 por 5 años) frente a mensualidades.

## 4. Hipótesis para decidir (una por app; JFC elige, no se ejecutan solas)
| App | Posible primer bolo (nicho) | Por qué cumple los tres criterios | Qué falta comprobar |
|---|---|---|---|
| friendly-123 | Talleres, colectivos de artistas y tiendas de consignación que reparten ventas por percha | Dolor: no saber a quién se le debe cuánto. Comunidad: ellos se conocen entre sí. Ya hay caso (idiomARTE). | Cuántos hay a mano y si pagan $399. |
| amigable-123 | Igual gremio, en español, para Ecuador y Latinoamérica | Misma función, mismo boca a boca, sin barrera de idioma. | Si conviene un solo nicho para ambas o dos frentes. |
| consultorio-123 | Consultorios y profesionales independientes con foco contable, sin perchas | Dolor distinto (caja y cobros), PIN de 4 dígitos por diseño. | Elegir UNA profesión (no "todos los consultorios"). |

Borrador de posicionamiento (plantilla de Moore) para friendly-123, **solo para que JFC lo corrija**:
*Para dueños de talleres y tiendas que reparten sus ventas con artistas o socios, friendly-123 es una
app de caja e inventario que muestra a cada quien lo que le toca, hasta por producto. A diferencia de
una hoja de cálculo o una app con mensualidad, se paga una vez y funciona en el teléfono sin nube.*
(Sin nube: la app guarda los datos en el aparato; el relay de sync cifrado es opcional. No afirmar
más de eso.)

## 5. Reglas que se desprenden (para textos y para decidir)
- Un solo nicho por vez en el mensaje principal. El "abrir el panorama" de la Historia de dos
  negocios queda como capa de ideas, no como promesa a todos.
- El texto público habla del dolor del nicho y de resultados con nombre, no de funciones.
- Cada cliente satisfecho = una referencia pedida y autorizada. Es la moneda de la bolera.
- Precio: anclar contra lo que ese gremio ya paga, con el dato real, nunca inventado.
- Canal: donde el nicho ya confía (comunidades, talleres, gremio). Anotar el canal elegido aquí.
- Jev: pasada de rankeo de nichos pendiente (sin crédito). Decir una vez, no insistir.

## 6. Preguntas abiertas que solo JFC puede cerrar
1. ¿Cuál es el primer nicho de friendly-123 y amigable-123: talleres y colectivos de artistas?
2. ¿Qué profesión concreta para consultorio-123?
3. ¿Cuántos clientes reales hay hoy por app y cuántos aceptarían ser referencia?
