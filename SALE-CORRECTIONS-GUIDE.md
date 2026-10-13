# Correct a recorded sale / Corregir una venta registrada

## English
1. In Sold, find the sale and open its edit button. Check the customer, item and quantity before saving.
2. To correct cash to on account, the sale needs a registered customer. If it was recorded as walk-in (no customer), choose the customer in Customer, then On account, and save. The debt uses the current quantity and unit price.
3. To mark it cash again, change Payment method and save. The original credit receipt remains in history; it contributes no debt while the sale is cash.
4. If the price was corrected while cash, switching back to on account reuses the same receipt. Do not enter another manual charge for the same sale.
5. A sale with a credit receipt cannot change customer through this editor/API. Review its history first; debtor transfers require a separate financial correction.
6. A paid commission keeps its quantity, price and customer protected. Payment-method corrections do not recalculate the paid split.
7. If saving fails, the correction is not confirmed. Keep the error and check the sale before retrying. Export a recoverable backup before any recovery; never erase storage to fix a balance.

## Español
1. En Sold/Vendido, busca la venta y abre el lápiz. Comprueba cliente, producto y cantidad antes de guardar.
2. Para corregir efectivo a fiado, la venta necesita un cliente registrado. Si se guardó sin cliente (walk-in), elige el cliente en Customer, luego On account, y guarda. La deuda toma cantidad y precio unitario vigentes.
3. Para volver a efectivo, cambia la forma de pago y guarda. El comprobante original permanece en el historial; no aporta deuda mientras la venta sea efectivo.
4. Si corriges el precio en efectivo y vuelves a fiado, se reutiliza ese comprobante. No añadas un cargo manual por la misma venta.
5. Una venta con comprobante de fiado no permite cambiar de cliente en esta edición/API. Revisa primero la historia; transferir un deudor requiere una corrección financiera separada.
6. Si hay comisión pagada, cantidad, precio y cliente siguen protegidos. Corregir la forma de pago no recalcula el reparto pagado.
7. Si falla el guardado, no se confirma la corrección. Conserva el error y revisa la venta antes de reintentar. Antes de recuperar datos, exporta un respaldo; nunca borres almacenamiento para cuadrar un saldo.

Examples and demo use synthetic data. These instructions do not authorize altering real customer history or prove cross-device latency.
