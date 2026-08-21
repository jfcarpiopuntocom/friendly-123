# Apunte — pedidos por anticipado (discutir martes 2026-08-25, 2am)
**Origen:** JFC, 2026-08-21, a raíz de una sobreventa real desde el celular
que dejó un ítem en stock -1.

## La regla decidida
El stock NUNCA queda en negativo. La única vía legítima de "vender lo que no
hay" sería una feature formal de **pedidos por anticipado, con o sin abono**.
Mientras esa feature no exista, cualquier delta que dejaría negativo se aplica
hasta 0 y el faltante queda visible como alerta de descuadre (ver P6 del
PLAN-JERARQUIA-SYNC-PIN-2026-08-21.md).

## Preguntas para el martes
- ¿Pedido anticipado reserva stock futuro o vende sin stock?
- ¿Abono parcial: cómo entra a caja y a la comisión (se liquida al entregar
  o al abonar)?
- ¿Quién puede tomar pedidos anticipados: solo dueño/admin o también staff?
- ¿Aplica a las tres apps o solo a friendly/amigable? (consultorio no tiene
  stock; ahí el pariente sería el plan de pagos que ya existe.)

Recordatorio programado para el martes 2026-08-25 02:00 (tarea
`apunte-pedidos-anticipados`).
