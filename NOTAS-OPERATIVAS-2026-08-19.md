# Notas operativas — 2026-08-19

## Pulsar de conexión (micelio-ui.js) — DESACTIVADO en la app end-user

JFC, 2026-08-19: en la app que ve el cliente, el pulsar (punto flotante abajo
a la derecha que avisa "quedaste fuera del loop" / "vas rezagado") distraía y
no daba nada accionable que no estuviera ya dentro del panel del equipo.

**Qué se hizo:**
- Se apagó la UI con una bandera `PULSAR_VISIBLE = false` al inicio de
  `pintarPulsar()` en `docs/micelio-ui.js`. Es un early return.
- **NO se borró el subsistema.** `mycelium.js` sigue midiendo estado,
  `M.miEstado()` sigue devolviendo `al_dia`/`rezagado`/`ciegas`, el panel del
  equipo sigue funcionando, y toda la infraestructura de eventos y sincronía
  queda intacta.

**Uso previsto (para lo que se conserva el subsistema):**
- Los tableros de JFC (panel maestro) van a mostrar el estado de conexión de
  cada uno de sus clientes — ahí SÍ es accionable: JFC ve "cliente X quedó
  fuera del loop" y decide llamarlo/escribirle. Ese es el lugar donde el
  pulsar vuelve a ser útil.

**Cómo re-encenderlo:**
- Cambiar `var PULSAR_VISIBLE = false;` a `var PULSAR_VISIBLE = true;` en
  `docs/micelio-ui.js` (justo antes de `function pintarPulsar()`).
