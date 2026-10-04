# Decisiones 2026-10-01 (JFC + Claude; Laya consultada)

Laya (local, 19 s) se ABSTUVO en las tres: confianza < 0.6, probabilidades casi empatadas.
Por la regla Laya -> Jev -> Claude, decide Claude. No se le atribuye ninguna conclusion a Laya.

| Tema | Decision | Por que | Laya (abstuvo) |
|---|---|---|---|
| Monetizacion | Hibrido: Founder self-serve (99-149/ano) + Advisor (299-499/ano) vendido 1 a 1. Accelerator solo bajo pedido. | Founder da volumen sin soporte; Advisor multiplica (un asesor = muchas pymes) y llega a 50k con ~150 cuentas. Accelerator exige servicio: no escala para una persona. | Hibrido 0.30 |
| Privacidad | Comparacion de dos periodos que da el usuario + snapshot portable (score y sub-scores, sin cifras crudas) que el usuario guarda. CERO historial server-side. | Custodia minima = cero brecha posible. | server-side 0.35: RECHAZADO, choca con la HARDRULE |
| Auth | OAuth 2.1 + entitlement resuelto en el servidor. Free = noauth. `licenseKey` sale de todos los schemas. | Unica opcion que cumple OpenAI y permite cobrar. | OAuth 0.39 |

Blocker de produccion abierto: `licenseKey` en argumentos de tools Pro del prototipo.
