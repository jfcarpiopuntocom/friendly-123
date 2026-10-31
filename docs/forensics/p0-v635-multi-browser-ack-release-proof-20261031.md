# friendly-123 P0 · shell v635 · multidispositivo / ACK · 31 octubre 2026

## Evidencia Cornell (origen exacto, prueba antes/después)

- Reporte JFC: una licencia, tres vistas de inventario discrepantes entre PC, Safari y segundo navegador del mismo teléfono; pantalla PC «Offline — saved locally». El PIN Owner vigente también diverge por aparato. No usar las cantidades observadas como valores que se deban imponer.
- Defecto demostrado de código: `docs/peer-sync.js` eliminaba un movimiento pendiente al aceptar el primer recibo P2P, aunque otro navegador conectado aún no lo había persistido. Prueba roja [run 41180561447](https://github.com/jfcarpiopuntocom/friendly-123/actions/runs/41180561447), `1 !== 0` confirmación prematura.
- Corrección [a1f13562](https://github.com/jfcarpiopuntocom/friendly-123/commit/a1f13562a85372605078feadfde9c1c1fb10b4ac): emisor guarda la cohorte de receptores conectados y espera los ACK durables de la cohorte antes de retirar esa operación. Receptor que rechaza persistencia conserva trabajo pendiente.
- [run 41180617305](https://github.com/jfcarpiopuntocom/friendly-123/actions/runs/41180617305): pruebas unitarias 28/28, identidad Chromium/WebKit y transporte Chromium de tres contextos, 0 fallos. La versión Linux de WebKit omitió RTC nativo; no contarla como prueba real de Safari.
- [run 41180754674](https://github.com/jfcarpiopuntocom/friendly-123/actions/runs/41180754674), SHA e91241c4: **ambos jobs GREEN**. En runner macOS 15 WebKit nativo prueba directa WebRTC **1/1, 0 omitidas**; transporte directo entre tres almacenamientos de navegador, fotos/historial y recepción persistente.
- Parte previa [PR #507](https://github.com/jfcarpiopuntocom/friendly-123/pull/507): licencia de cuaderno activo gobierna sala, no la identidad local obsoleta; los movimientos salientes tienen prueba de origen, cola no borra operaciones antiguas de procedencia incierta ni las envía a negocio ajeno.

## ADR / autorización JFC

Shell nueva está permitida cuando implementa arreglos comprobados; **v635/golden181 es una candidata aislada** que puede avanzar tras certificación. No publicar a clientes hasta demostrar integridad de movimientos, dinero y PIN en aparatos reales. Ninguna rotación central de PIN existente hasta censar los aparatos/credenciales ya utilizados por los clientes; panel privado JFC manda administrativamente, con lápices e interfaz responsiva. No almacenar PIN en claro ni registros de negocio en servicios nuestros. No hacer consultas reiteradas a Supabase ni recuperar un relay de Cloudflare como segundo almacén.

## Runbook

1. Verificar `release-control` + `check-sw.sh` + SHA-256 completos del commit exacto candidato; v635/golden181 coherentes en app, dashboard y PWA, manifiesto actualizado.
2. Antes de cambio físico, respaldar/exportar por separado PC, Safari, PWA y otro navegador; comprobar integridad y procedencia de cada movimiento, venta, ajuste y época.
3. Reconciliar por identidades causales de movimientos reales; si épocas físicas independientes no prueban relación causal, mantener evidencia/mostrar conflicto y obtener decisión explícita de JFC, sin fingir una cantidad consensuada.
4. Misma licencia abre el mismo negocio y PIN autorizado desde cada entrada; movimiento en A aparece en B/C, regreso B→A, reinicio y recuperación mantienen exactamente el mismo conjunto de hechos. Pruebas físicas reales con stock arbitrario (no cifra 7 fija), ventas, pagos y fotos.
5. Publicar shell validada de forma explícita solo una vez y comparar commit servido, SHA, rendimiento, inventario, PIN y persistencia; rollback sin purgar cuadernos ni cachés de datos.

**Estado de aceptación de negocio: ABIERTO.** El arreglo de ACK y la shell preparada no equivalen a reconciliación de los cuadernos reales de JFC. El commit de sellado del manifiesto solo genera bytes y no realiza un despliegue automático.
