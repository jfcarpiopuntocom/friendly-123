# ADR-001: Arquitectura financiera de friendly-123

- **Estado:** ACEPTADA por JFC el 2026-10-06 (opción múltiple, 4 decisiones).
- **Alcance:** solo friendly-123. Se porta a amigable-123 y consultorio-123 cuando esté estable.
- **Motivo:** JFC: "quiero no tener que rediseñar a cada rato dinero y finanzas, hagamos lo worlds best practices pero tambien considerando que es para small business". En 96h el botón de pago se perdió 3 veces y hubo que rehacer la UI de dinero; cada vista calculaba y mostraba el dinero a su manera.
- **Base:** principios de cierre y conciliación (skill `finance:close-management`) adaptados a un negocio pequeño, y la contabilidad estándar de consignación. El Payout Ledger v1 (`docs/core/payout-ledger.js`) se conserva.

## Regla de oro

**El dinero se rige por 3 capas, y una capa solo lee de la anterior. Ninguna vista calcula dinero por su cuenta.**

### Capa 1: Hechos (inmutables)
- Cada evento con dinero se anota una sola vez: venta, devolución, pago, reverso, ajuste, cierre de mes, apertura/cierre de reserva.
- Nunca se edita ni se borra. Corregir = agregar un hecho nuevo (reverso/ajuste) con su motivo y quién lo hizo.
- Importes en **centavos enteros**. Cada acción humana confirmada lleva un **`opId` idempotente**.
- Ya existen: Payout Ledger (pagos, reversos, clawback) y hechos de cartera. Los hechos nuevos (cierre, reserva) son **aditivos**: un campo o tipo nuevo, sin cambiar el esquema existente.

### Capa 2: Libro de doble entrada (derivado)
Cada hecho genera asientos que suman cero, sobre un plan de cuentas fijo:

| Código | Cuenta | Tipo |
|---|---|---|
| 1000 | Caja / Banco | Activo |
| 1100 | Por cobrar a clientes (fiado) | Activo |
| 2000 | Por pagar a consignadores y comisionistas | Pasivo |
| 2100 | Reserva por devoluciones | Pasivo |
| 2200 | Impuesto por pagar | Pasivo |
| 4000 | Ventas propias | Ingreso |
| 4100 | Comisión de la casa | Ingreso |
| 4900 | Devoluciones | Ingreso (contra) |
| 5000 | Gastos | Gasto |

Ejemplo, venta en consignación de $130 con trato 85/15:
- Debe 1000 Caja $130.00
- Haber 2000 Por pagar a consignador $110.50
- Haber 4100 Comisión de la casa $19.50

Ejemplo, pago de $110.50 al consignador:
- Debe 2000 Por pagar $110.50
- Haber 1000 Caja $110.50

- El libro **se recalcula a partir de los hechos**, como función pura en `docs/core/` (arquitectura hexagonal, CLAUDE.md 2026-10-04). Nadie escribe asientos a mano.
- Invariantes: (a) todo asiento suma cero; (b) el saldo de 2000 por persona = Pendiente de esa persona; (c) Ganado − Pagado ± ajustes = Pendiente, al centavo.
- Agregar una cuenta nueva exige un ADR nuevo aprobado por JFC.

### Capa 3: Vistas (proyecciones)
- Por producto, Por percha, Por persona, dashboard, CSV, estado de cuenta y recibos **leen solo del libro**.
- Una vista nueva no toca el dinero. Si dos vistas muestran montos distintos, es un bug del test de conciliación, no un diseño.
- Toda vista que muestre un Pendiente > 0 muestra la acción de pago (contrato de UI, `commissions.pay-person`).

## Decisiones de JFC (2026-10-06)

| Tema | Decisión | Detalle |
|---|---|---|
| Recibos | **Serie por aparato** | Cada aparato tiene su serie (A-0001, B-0001…), sin huecos dentro de la serie y funcionando sin internet. La letra sale del registro del aparato. Un recibo anulado conserva su número con estado Anulado; nunca se reutiliza un número. |
| Cierre de mes | **La app propone y el admin confirma** | El día 1 la app muestra el mes cuadrado y "Cerrar <mes>". Lo puede cerrar el dueño o el admin. Si nadie cierra, avisa (solo en Advanced, por la regla de modales), sin bloquear ventas. Un mes cerrado queda bloqueado: una corrección entra como ajuste en el mes abierto, con su motivo. |
| Reserva por devoluciones | **Apagada; se activa por persona** | Nadie cambia cómo cobra hoy. Se activa por consignador con N días de espera (sugerido: 14). Mientras dure la espera, la parte de esa venta va a 2100 y no es pagable. |
| Alcance | **Solo friendly-123** | Se porta a las otras apps cuando esté estable. |

## Conciliación continua (negocio pequeño)
- En cada cambio, y al abrir Comisiones, se verifican los invariantes (a)-(c) y que app = dashboard = CSV para el mismo período y la misma persona.
- Si algo no cuadra: aviso visible para dueño y admin, con el monto y la persona. **Nunca se corrige solo.** Diagnóstico con evidencia, igual que la Prime Directive.
- Reemplaza la conciliación de fin de mes de una empresa grande: no hay contador interno, así que el sistema la hace todo el tiempo.

## Lo que NO se adopta (y por qué)
- Acumulaciones, moneda extranjera, intercompañías, depreciación y consolidación: no aplican a un negocio de este tamaño.
- Doble aprobación de pagos: choca con "admin = dueño" y no aplica con un solo operador.
- Cierre de 5 días: se reemplaza por cierre de 1 clic con conciliación continua.

## Cómo se protege
- Tests de invariantes del libro (unitarios, en `docs/core/`).
- Test de conciliación app = dashboard = CSV (navegador).
- Contrato de UI (`release/ui-contract.json`) para las acciones y los textos de dinero.
- `release/capabilities.json`: capacidad `money-three-layer-ledger` atada a esos tests.

## Orden de implementación (lote de dinero 2, después del contrato de UI)
1. Libro derivado de doble entrada más tests de invariantes, sin UI nueva.
2. Conciliación continua y su aviso.
3. Recibos con serie por aparato.
4. Cierre de mes propuesto/confirmado y bloqueo.
5. Reserva por devoluciones (apagada por defecto).

Cada paso lleva su spec corta, su TDD y su shell nuevo, y se aprueba por separado.
