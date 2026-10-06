# Spec: Libro de doble entrada, paso 1 de ADR-001

- Estado: aprobado por JFC el 2026-10-06 ("Libro primero").
- ADR: `specs/2026-10-06-ADR-arquitectura-financiera.md` (rama spec/ui-contract-2026-10-06).
- Alcance: capa 2 del ADR. Sin UI nueva. Ninguna vista cambia todavia.

## Que se construye
`docs/core/ledger.js`: modulo puro, mismo patron UMD que `docs/core/payout-ledger.js`
(exporta a `module.exports` y a `globalThis.OCLedger`). Sin DOM, sin storage, sin red, sin reloj.

`buildLedger({ ventas, ajustes, payouts, gastos, cartera, ubicaciones })` -> `{ entries, balances, errors }`
- `entries`: lista de asientos `{ id, factKind, factId, fecha, mes, lines:[{account, debitCents, creditCents, personId?, productId?, locationId?}] }`.
- `balances`: saldo por cuenta, y por (cuenta, persona) para 2000.
- `errors`: hechos que no se pudieron asentar, con motivo. Nunca se descartan en silencio.

Plan de cuentas fijo (no agregar cuentas): 1000, 1100, 2000, 2100, 2200, 4000, 4100, 4900, 5000.

Reglas de asiento (importes en centavos enteros, reusar `OCPayoutLedger.cents`):
1. Venta en consignacion/comision: Debe 1000 (o 1100 si es fiado) por el total cobrado. Haber 2000 por la parte de cada persona (respetar `split.reparto` igual que `obligationsForSale`). Haber 4100 por el resto. Haber 2200 si la venta trae impuesto.
2. Venta propia (sin persona a pagar): Debe 1000/1100, Haber 4000.
3. Venta anulada o devuelta: asiento de reverso exacto del original (4900 para la parte de la casa), nunca se borra el original.
4. Ajuste: Debe/Haber 2000 por persona contra 4100.
5. Pago (payout paid): Debe 2000 persona, Haber 1000. Voided/reversed: asiento inverso.
6. Gasto: Debe 5000, Haber 1000.
7. Cobro de fiado (cartera): Debe 1000, Haber 1100.
8. Reserva 2100: no se usa en este paso (apagada por defecto, ADR).

## Invariantes (tests que deben pasar)
(a) Cada asiento suma cero.
(b) Saldo de 2000 por persona = `balancesByPayee` de `OCPayoutLedger` para esa persona, al centavo.
(c) Ganado - Pagado +/- ajustes = Pendiente, al centavo.
(d) Determinista: los mismos hechos en otro orden dan el mismo libro.
(e) Idempotente: un hecho repetido (mismo id/opId) no duplica asientos.

## Entregables
- `docs/core/ledger.js`
- `test/ledger-v1.test.js` (node:test, TDD: RED primero)
- Shell nuevo v453 + golden18 + manifest (lo exige `scripts/release-control.cjs`).
- Capacidad `money-three-layer-ledger` en `release/capabilities.json` atada a `test/ledger-v1.test.js`.
