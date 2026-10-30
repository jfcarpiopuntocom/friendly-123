# friendly-123 · Shell v629 / golden175 · evidencia de hotfix

**Fecha:** 30 de octubre de 2026. **Alcance:** confirmación duradera de dinero y existencias.
**Código de negocio integrado:** `82eff76de037bc8f7e9d6933e240588f2d4b4133`. El commit de esta nota no modifica runtime.

## Defecto reproducido y corrección
El adaptador atómico de IndexedDB podía devolver valores distintos de `true` pero truthy (`1`, `"true"`, `{}`). El backend trataba esos valores como ACK de almacenamiento al utilizar `if (!ok)`, con posible respuesta HTTP 200 sin confirmación literal. La corrección puntual exige `ok === true`. El camino normal no agrega esperas, Web Locks ni consultas de sincronización.

## Evidencias en datos de prueba (sin cuadernos reales)
- [RED: tres falsos positivos detectados al probar el contrato actual](https://github.com/jfcarpiopuntocom/friendly-123/actions/runs/41060631579).
- [GREEN: 8 contratos de ACK exacto y 31 adyacentes de stock, PN y reloj](https://github.com/jfcarpiopuntocom/friendly-123/actions/runs/41060912293).
- [GREEN: 39/39 pruebas completas A/B, 8/8 CAS y 31/31 stock](https://github.com/jfcarpiopuntocom/friendly-123/actions/runs/41062375534). La recuperación PREPARED desconocida bloquea escrituras y conserva copia, puntero y journal; una alteración física de terceros durante readback permanece intacta.
- [GREEN: E1–E6, PIN, ventas entre pestañas en Chromium/WebKit, benchmark de ventas](https://github.com/jfcarpiopuntocom/friendly-123/pull/484).
- Código verificado: `docs/mock-backend.js`, 8.663 líneas; SHA-256 `3f2dd9ebe06f3020b4971436f033713db9a88c3e3b11f24e984758fc30d72103`. Manifiesto de 120 entradas, `shell v629`, `golden175`.

## Estado y límite
La publicación de esta versión depende del flujo oficial `hotfix.yml`, que valida el SHA final y promueve `estable`. Un merge de este documento no acredita por sí solo publicación ni adopción por los aparatos.

La regresión histórica integral mantiene fallos anteriores no clasificados como resueltos. La convergencia **real** PC–celular continúa **SIN CERTIFICAR**: requiere dos exportaciones independientes y comparación no destructiva por ID, época, PN, existencias, recibos y movimientos. No se han inspeccionado cuadernos de clientes.

**Operación:** sin cambios de arquitectura, PIN, interfaz, motor de sincronización, fotos o contratos comerciales. No purgar ni restaurar un aparato sobre otro. `previo` conserva el SHA estable anterior cuando el flujo oficial promociona.
