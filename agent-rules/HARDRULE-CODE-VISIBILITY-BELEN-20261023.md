# HARDRULE · No operar a ciegas — mapa causal, trazabilidad Belén y Supabase
**23 octubre 2026 · documento de contexto; NO cambio de producto ni certificación.**
Fuente de autoridad: JFC → [STABLE congelado](https://app.notion.com/p/4011642b67f38177b1c9cc5b00dcf734) → [Buzón](https://app.notion.com/p/387956ba9ecf43f9b014dd538110a25a). Esta regla es **metodología**, nunca autorización de nuevas funciones.

## 1. GATE VISIBILITY FIRST — ANTES de modificar cualquier S1/E1–E6
Cada ejecutor debe traer una **cadena causal versionada** (SHA exacto), no adivinar a partir de búsquedas de texto o un grafo atractivo:
1. **Qué dijo la clienta / contrato** — cita literal, fecha, severidad, aceptación y qué NO toca; distinguir BUG / NEW REQUIREMENT / UNKNOWN.
2. **Mapa del recorrido real** — UI/acción → rol/PIN/sesión → hecho financiero/stock/foto → persistencia local/IndexedDB → Yjs encode → bundle JS distribuido → RPC/relay/índice → receptor, merge/revisión → UI remota → reinicio/reconexión.
3. **Efectos y dependientes** — llamadas entrantes/salientes, guardas, colas diferidas, migraciones, formatos históricos, SW/manifest y reversión. Exigir tanto rutas felices como fracaso parcial; marcar todo salto no comprobado.
4. **Prueba causal pequeña** — reproducir RED con el componente REAL y datos sintéticos; modificar mínimo; GREEN en misma ruta, caso de fallo y replay viejo. **Dos contextos aislados y reinstancia** para sync; CI integral UNA sola vez sobre SHA final. Grafo ayuda a descubrir; jamás demuestra convergencia ni durabilidad.
5. **Evidencia de entrega y parada** — Fuente leída ≠ fix en rama ≠ bundle/SQL activos ≠ publicación ≠ verificación de dos aparatos. Revisor independiente y DoD. Si faltan hechos, declarar DESCONOCIDO, no inventar causa ni cerrar.

**HARDRULE 1AAA:** ni borrar ni purgar registros; los dispositivos de los clientes siguen siendo fuente de verdad; el relay de Supabase NO debe convertirse en nube primaria. Actualmente almacena operaciones cifradas temporal/persistentemente (véase P0 de egress), así que «NO SOMOS NUBE» es objetivo arquitectónico, no prueba de que el servidor no guarde bytes. La política de conservación/compactación requiere demostración de seguridad y decisión del dueño: no eliminar checkpoints ni padres Yjs para ahorrar cuota.

## 2. Fuentes de Belén: dos reuniones distintas, NO 15 bugs
- **Acta literal 15/oct:** [15 notas textuales](https://app.notion.com/p/3fa1642b67f381668834c2f402c925d6) + [matriz de aceptación 01–15](https://app.notion.com/p/3fa1642b67f3813cbafece46ccd284de).
- **Audios/transcripciones 20/oct:** [auditoría v551](https://app.notion.com/p/3ff1642b67f38176a1c2fa6d4ff2129d); audio no verificado directamente, notas textuales provistas por JFC.
- **PDF aportado 23/oct:** «Problemas de v556: estado hasta v564», **solo UNA página de captura**; el 22/oct 22:10 reportaba 29 = 7 en vivo + 10 corregidos no publicados + 4 parciales + 7 abiertos + 1 decisión JFC. **No trae el tablero ni fichas de los 29**: NO declarar reconciliados individualmente esos 29 hasta tener fuente íntegra. Desde entonces PR417 avanzó; las cifras son fotografía antigua.
- **Congelamiento vigente:** solo E1–E6 y S1 aprobado; necesidades nuevas de Belén se documentan, NO se implementan sin decisión JFC.

## 3. Trazabilidad íntegra de las 15 notas originales (estado = cobertura de INVESTIGACIÓN, no «cerrado en vivo»)
| Req | Voz de Belén / problema | Recorrido obligatorio / prueba de salida | Estado exigible |
|---|---|---|---|
| 01 | Shelves: monthly sales y commissions no cuadran | Venta-ID → devolución → comisión → percha/periodo; centavos iguales al oráculo | Reconciliación real pendiente |
| 02 | Duplicación Tickets & Events / Events | UI histórica, categorías/IDs/filtros preservados | Pedido UX estacionado salvo S1 |
| 03 | Reserva $15 vs walk-in $18 (ejemplos) | Precio por modalidad congelado al vender, reembolso correcto | Código/fixtures no prueban adopción |
| 04 | Gastos: efectivo/transferencia + foto factura | Alta, edición, foto íntegra, rol, export y réplica entre aparatos | Sin E2E de dos aparatos |
| 05 | Resumen Expenses / ganancias incorrecto | Mismo período y gastos reales, sin doble contabilizar cobros/aportes | P0: oráculo externo pendiente |
| 06 | Resultado por cada shelf/taller/evento | Desglosar ventas, reparto, costos, gastos y período | Datos reales sin conciliar |
| 07 | Cuánto Casa/artista; comparación de clases | Dos eventos con mismo nombre/días distintos; ingreso casa-artista correcto | P0 pendiente de aceptación |
| 08 | Are we actually making money? bar/taller/evento | Conciliado vs estimado vs incompleto; nunca optimismo por datos faltantes | P0 pendiente |
| 09 | Reportes mes, trimestre y año con comisiones | Netos y cajas separados, totales en informes y registros al centavo | Sin oráculo real |
| 10 | Último texto PDF no se entiende | PDF/fragmento exactos, sin inventar traducción | Ejemplar exacto pendiente |
| 11 | Dashboard español para contador | ES app/dashboard/PDF/export sin términos mezclados | Prueba de tres superficies pendiente |
| 12 | Phone number → WhatsApp y dashes | Presentación y E.164 interno compatible, sin borrar contactos | UX estacionado / comprobar |
| 13 | Cliente local de Cuenca | Campo opcional, sin falsas inferencias, compatible sync | UX estacionado / comprobar |
| 14 | Género male/female/unknown | Opcional, privacy y roles, sin inferir | UX estacionado / comprobar |
| 15 | Cuánto realmente queda a la Casa | Resultado único de 01/05–09, no otro ledger ni fórmula | P0 transversal pendiente |

## 4. Feedback operativo 20/oct que precipitó la crisis del relay
| Hallazgo reportado | Riesgo/causa NO atribuida sin prueba | Evidencia de cierre |
|---|---|---|
| Dueña y Admin ven gastos distintos | Yjs merge, guardas, persistencia o permisos | Misma operación ID/rev/importe/foto visible en DOS contextos, reapertura |
| PC muestra stock 1 y teléfono 0; producto renombrado solo en PC | Replay viejo, cursor/padres, PN-counter | Misma foto, nombre, stockBase/stockPN, venta y orden de cambios tras reconexión |
| Contador «Expenses this month» cercano a 2300 dudoso | Mezcla período vs caja vs resultado | Oráculo por fecha y tipo: ventas, fiados, cobros, gastos, aportes |
| Pagos fiados múltiples/parciales por compra | Balance global no atribuido a cada venta | Aplicación explícita de abono a compra, saldo conservado tras sync |
| Modal Vender vuelve a solicitar WhatsApp/mail luego de elegir cliente | Campos duplicados | Selector único, + New conserva datos y venta sin duplicación |
| Error negro/Perchas cargando/foto ausente | Error real no aislado | Captura error real, fotos + carga limitada, sin borrar |
| Inicio rojo permanente / panel reposición | Petición de UX, no corrupción | Estacionamiento; ninguna alteración de cinco colores sin aprobación |
| Alta cliente + New carece de ciertos opcionales | Disparidad UI, no motivo de rediseño previo a STABLE | Estacionamiento salvo decisión explícita |

## 5. Barreras actuales de STABLE — fuente + rama ≠ producción
- E1: paquete del navegador de PR417 ya incorpora `head`, pero RPC activa de Supabase no; migración `20261022000100_readonly_head.sql` PENDIENTE. Gate = resguardo/restauración + autorización, test HEAD real con sala ficticia y dos aparatos. No ejecutar DDL por este documento.
- E1b / escalado: confirmar **0 páginas sin cambios**, reintentos acotados, una sesión visible; medir RPC/egress horario. Incidente P0 de quota previo documentado [aquí](../incidents/SOL6-supabase-egress-P0-2026-10-21.md). Sin inferir costo ni origen con solo recuento de logs.
- E2 / E3: SW cambia versión sin purge; pegar licencia en iPhone sin bloquear pegado nativo.
- E4: renombrado del dueño y PIN resisten snapshot antiguo, cuota agotada, reinicio, pérdida de red, dos dispositivos y colas de payout/return; fallo no responde falso éxito.
- E5 / dinero: comisiones, gastos, devoluciones, ventas, IDB, registro inmutable; una CI verde NO prueba rentabilidad.
- E6: foto histórica visible y «Cargando foto…» con salida garantizada.
- UI tema: claro ↔ oscuro solo por gesto; persistencia de preferencia tras licencia/reinicio, con paleta aprobada. Respeta reserva Codex.
- Arquitectura: **Aparato↔Aparato + relay cifrado limitado**, NO proveedor-nube de cliente. Medir almacenamiento real, reenvío histórico y consumo por licencia sintética, sin tocar licencias existentes.

## 6. Herramientas de comprensión: sí como lentes, NO como arquitectura nueva
- [Understand Anything](https://github.com/Egonex-AI/Understand-Anything): grafo AST/LLM, rutas de dependencia, tours por lógica de negocio; MIT; soporta Codex/Claude, Windows. Escaneo inicial completo puede gastar mucho contexto. **Primera prueba SOLO local sobre checkout sintético/público, limitado a nombre→IDB→Yjs→relay→receptor y gastos**; revisión de instalador/suministro, versión fija, sin API keys, licencia ni datos cliente. Si el grafo se guarda en `.ua/`, etiquetar SHA y no subirlo sin revisar privacidad/tamaño. Dashboard local no significa que TODO el pipeline LLM sea offline: validar proveedor de inferencia.
- [Graaph/Graphify](https://graaph.org/repo/): atlas público de 100 grafos para exploración / orientación. El catálogo NO demuestra indexación de friendly-123 ni sustituye un grafo de SHA propio. No cargar repo privado, datos o secretos a un tercero sin revisión y autorización.
- **Regla de vigencia:** índice/diagrama con SHA del checkout, generado en lectura; cada commit invalida la confianza hasta reindexado o análisis de diff. Grafo identifica posibles dependencias; una prueba causal e integración es la evidencia decisiva. No ejecutar `curl|bash` ni `iwr|iex` ciegamente.
- Si herramienta no está disponible, el ejecutor debe producir un **mapa manual mínimo basado en código real**, con funciones concretas y archivos, además de señalar incertidumbre. **Ausencia de plugin no autoriza operar a ciegas.**

**Salida en cada PR S1/E1–E6:** una tabla de fuente → requisito → archivos/llamadas → historia y rollback → test RED/GREEN pequeño → prueba con dos contextos → estado producción → incertidumbre. Revisor independiente. Un SHA final para regresión integral, no miles de pruebas repetidas.
