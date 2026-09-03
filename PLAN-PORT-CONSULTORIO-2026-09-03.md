# PLAN — friendly-123 → consultorio-123 (app contable para consultorios)

**Fecha:** 2026-09-03 · **Estado:** SOLO PLAN. No se toca consultorio todavía. ·
Orquestado por `PLAN-MAESTRO-PERT-PORTS-2026-09-03.md` (nodos I→N).

> **consultorio NO es amigable para médicos.** Es una app **distinta**: su centro es
> lo **contable y financiero** del paciente — abonos, pagos, cuentas por cobrar,
> control y visualización financiera fácil. NO lleva perchas, variantes, comisiones
> a asociados, eventos ni reposición de stock (CLAUDE.md). Unidad básica = **el
> paciente**. PIN **4 dígitos por diseño** (no "corregir" a 3).

---

## 1. Qué se porta vs qué se reescribe

- **Se PORTA (infra, tal cual, namespaceada a su prefijo):** worker/service-worker,
  relay zero-knowledge, sync (realtime/watchdog/queue/outbox + failsafes),
  `crypto-store.js`, backup autoverificado, `audit-store.js`, `logger.js`,
  `telemetry.js`, identidad de dispositivo/micelio, `estaLicenciado()` fail-open,
  dashboard base y "mi panel" (maintenance/support), `i18n.js` en **español**.
- **Se REESCRIBE (capa de negocio):** el modelo de datos y la UI. Fuera perchas,
  inventario de productos, comisiones, ferias. Entra paciente, presupuesto,
  tratamiento, plan de pagos, cuenta por cobrar, recibo.
- **Se REUTILIZA como base (re-anclado):** `plan-pagos.js`/`plan-pagos-ui.js` (planes
  de pago) y `cartera.js`/`hechos.js` (abonos/saldo) — **anclados a paciente y
  tratamiento**, no a ítem de inventario.

---

## 2. Menú y subsecciones (definido tras research)

Research de necesidades reales de médicos/dentistas de práctica pequeña (fuentes al
final): lo que valoran es **planes de pago / installments, depósitos, presupuestos
de tratamiento que separan lo estimado del saldo del paciente, recibos, avisos de
cobro, y visualización financiera sencilla y asequible**. Eso encaja exacto con el
centro contable que JFC definió para consultorio. Adaptado a Ecuador/LatAm:
efectivo, cultura de **abono**, factura SRI (sí/no, con RUC/cédula).

### Menú propuesto (raíz)
1. **Pacientes** (la unidad)
   - Ficha: nombre, cédula/RUC, teléfono, email, notas. (Datos personales:
     protegidos para rol maintenance/support — REGLA 7.)
   - Búsqueda viva (reusar `lista-dinamica.js`).
   - Historial de tratamientos y de pagos del paciente.
2. **Presupuestos / Tratamientos** (reemplaza "Inventario")
   - Crear presupuesto: lista de procedimientos con costo estimado.
   - Estado: propuesto / aceptado / en curso / terminado.
   - Depósito inicial y saldo (base para el plan de pagos).
3. **Cobros** (el corazón, reemplaza "Sold")
   - **Abonos / planes de pago**: installments sobre el saldo del tratamiento
     (reusa `plan-pagos`). Registrar abono, ver saldo, próxima cuota.
   - **Recibo** por cada pago; factura SRI sí/no (checkbox), RUC/cédula.
   - Corregir un cobro mal hecho (edición con tracking usuario+rol+dispositivo).
4. **Cuentas por cobrar** (vista financiera clave)
   - Saldos pendientes por paciente, con **aging** (0-30 / 31-60 / 60+ días).
   - Avisos de cuota vencida / próxima (a consola/panel, **sin popups** a la UI viva).
5. **Dashboard financiero** (`dashboard.html`)
   - Ingresos del período, por cobrar total, cobrado vs pendiente, tratamientos
     activos. Visualización simple (la prioridad de JFC para esta app).
6. **Mi panel (JFC, maintenance/support)**
   - Ve integridad (que las fichas y el sync estén sanos) pero **NO** montos ni datos
     personales de pacientes (REGLA 7). Dispositivos, PINs (eventos, sin PIN en claro),
     errores, hashes parciales (REGLA 8).
7. **Avanzado / Equipo**
   - PINs 4 dígitos, roles (dueño/a, encargado/a, contador/a), unirse al equipo,
     respaldo, sync entre aparatos (sin nube).

### Vocabulario (español, coherente con las hermanas)
- **encargado/a** (no "empleado"), **contador/a** para el rol contable.
- **paciente**, **tratamiento**, **presupuesto**, **abono**, **saldo**, **cuota**,
  **cuenta por cobrar**, **recibo**, **factura**.
- Sin emojis en UI; no usar "vive en".

---

## 3. Modelo de datos (reescritura mínima sobre el motor existente)

`mock-backend.js` intercepta `/api/*` y guarda en localStorage con doble buffer. Se
**conserva el motor**, se cambian las **colecciones**:

| friendly (fuera) | consultorio (nuevo) |
|---|---|
| producto / percha | paciente / tratamiento |
| venta | pago (abono) |
| categoría | tipo de procedimiento |
| comisión asociado | — (no existe) |
| feria/evento | — (no existe) |
| cartera (crédito por ítem) | saldo por tratamiento/paciente |

Rutas nuevas: `/api/pacientes`, `/api/tratamientos`, `/api/pagos`,
`/api/cuentas-por-cobrar`, `/api/recibos`. Cada una con su tracking en `mov()`.

**Namespace y sin-nube:** relay zero-knowledge igual que las hermanas; el estado del
consultorio solo llega si el aparato de ese consultorio está encendido empujando su
catálogo (LÍMITE SIN NUBE, CLAUDE.md). No agregar servidor que guarde estado.

---

## 4. Secuencia de ejecución (nodos I→N del PERT)

- **I** Definir menú/subsecciones (este documento) → aprobación de JFC.
- **J** Snapshot + rama; llevar SOLO infra común (§1) ya validada en el port de
  amigable, namespaceada al prefijo de consultorio.
- **K** Reescribir negocio: pacientes → presupuestos → cobros/abonos → cuentas por
  cobrar → recibos. Batches ligeros, un módulo verde a la vez.
- **L** Conectar `dashboard.html` + "mi panel" con las restricciones de REGLA 7.
- **M** Probar worker + relay end-to-end con dos aparatos, sin nube.
- **N** Gate verde + bump shell/version + push + merge.

---

## 5. Lo que NO va a consultorio
Perchas, variantes de producto, comisiones a asociados/promotoras, ferias/eventos,
reposición de stock, matriz BCG de inventario. Un consultorio no tiene nada de eso.
Ante la duda de portar algo de negocio: **no portar todavía**, preguntar.

---

## 6. Preguntas abiertas para JFC
1. ¿consultorio arranca de un fork de friendly/amigable o de repo propio ya existente?
   (define si "reescribir" es sobre base copiada o desde el motor limpio).
2. Factura Ecuador: ¿integración SRI real algún día, o por ahora solo el flag
   sí/no + RUC/cédula como en friendly?
3. ¿Rol **contador/a** con qué permisos exactos (ve montos, no ve datos clínicos)?
4. ¿Procedimientos con catálogo fijo (aranceles) o texto libre por presupuesto?

---

## Fuentes del research (necesidades reales de consultorios)
- [Medical practice management software — Wikipedia](https://en.wikipedia.org/wiki/Medical_practice_management_software)
- [Considerations in Developing a Financial Policy — American Dental Association](https://www.ada.org/resources/practice/practice-management/considerations-in-developing-a-financial-policy)
- [How to Create a Dental Payment Plan for Your Office — Rectangle Health](https://www.rectanglehealth.com/resources/blogs/how-to-create-a-dental-payment-plan-for-your-office/)
- [Medical & Dental Payment Processing in 2026 — Apexone](https://apexonepayments.com/blog/medical-dental-payment-processing-in-2026-payment-plans-recurring-billing-pci-compliant-terminals)
- [Dental Payment Plans — Dentaly.org](https://www.dentaly.org/us/dental-payment-plans/)
