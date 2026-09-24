# PRE-MORTEM — friendly-123 (Opus 5.5, 2026-09-24, shell v387 en vivo)

Ejercicio: suponer que ya fallo y explicar por que. Tres horizontes: HOY, la
TRANSICION a los features del benchmark, y DESPUES de instalarlos. Cada riesgo
trae probabilidad (A/M/B), dano si pasa, la senal temprana y la defensa.
Dueno: F = Fable 5.1 (dinero, sync, acceso, seguridad), O = Opus 5.5 (UI, copy).

Evidencia de base: auditoria en Chromium de las 9 secciones a 375 y 1280 px
(2026-09-24), 291 tests verdes, 8 carreras de dos aparatos, 11 casos Hugo/Paco/Luis.

---

## 1. HOY — lo que puede fallar con clientes reales esta semana

| # | Riesgo | P | Dano | Senal temprana | Defensa | Dueno |
|---|---|---|---|---|---|---|
| H1 | Un aparato de Belen queda en un shell viejo y mezcla archivos (el bug historico "Avanzado roto") | M | Alto | El candado muestra `shell-v38x` distinto entre aparatos | SRI fail-open + recarga diferida ya existen. Pedir a Belen que abra la app online una vez hoy y mire el numero del candado | JFC |
| H2 | Merge de ventas: un tercer aparato que vuelve de dias offline trae estado rancio | M | Alto (plata) | Commissions distinto entre aparatos | v387 hizo monotonas liquidada/devuelta/anulada. **No probado con 3 aparatos**: primera tarea de F | F |
| H3 | El Worker nuevo (lotes/pagos) tiene un error solo visible en produccion (KV real, DO real) | M | Medio | Error en la linea de mensaje del panel al emitir lote o registrar pago | Probar HOY 1 lote de 1 codigo y 1 pago de prueba con monto negativo que lo anule. Nunca borra acceso: la regla es monotona | JFC → F |
| H4 | Texto de 11 px en telefono (medido): tarjetas de Hoy ("Sales today", "Average sale"), 76 lineas en Inventario (categoria·SKU, avisos de vencimiento) y Gastos | A | Bajo-medio (legibilidad, regla de JFC) | Ya medido | Subir a 13 px en el bloque movil del CSS de index.html; shell nuevo | O |
| H5 | Contraste < 4.5:1 (medido): Etiquetas (47 textos: precios y chip "Perecible"), Commissions (7), Avanzado (10: "Owner", aviso de PIN, linea de Sync), Gastos ("+ Add expense") | A | Bajo-medio | Ya medido | Pasar esos colores a tintas del DESIGN.md; test de fijacion como el de save.html | O |
| H6 | La promesa de 24 h para entregar licencia se incumple un fin de semana | M | Alto (confianza) | Pago en PayPal sin licencia enviada | Alarma: notificacion de PayPal al telefono + plantilla de WhatsApp lista | JFC |
| H7 | Alguien pega una licencia completa en un commit o en un chat con un modelo | B | Alto | check-sw G5 rojo | G5 ya bloquea el push. Nunca pegar licencias en prompts | todos |
| H8 | Cloudflare sin 2FA o con la sesion abierta en otra PC | M | Muy alto (Worker, relay, codigo) | — | 2FA activada hoy (JFC). Revisar sesiones activas en el perfil de Cloudflare | JFC |
| H9 | GitHub Pages cae o el proxy de un pais bloquea github.io | B | Alto | La app no abre para nadie | La app ya instalada abre offline (SW). Fase E del cargador pone un segundo origen | F |

## 2. TRANSICION — lo que va a fallar al agregar los 6 features del benchmark

Orden previsto: aviso por WhatsApp → medio de pago al liquidar → estado de cuenta
→ rebaja por antiguedad → lealtad → rol comisionista.

| # | Riesgo | P | Dano | Defensa (no negociable) | Dueno |
|---|---|---|---|---|---|
| T1 | Un campo nuevo en ventas/liquidaciones (medio de pago, rebaja) no viaja por sync y cada aparato muestra distinto | A | Alto | Todo campo nuevo: en `catalogoPropio` + `estadoParaCheckpoint` + merge + respaldo, con test de dos aparatos rojo-verde. Checklist en el plan de cada feature | F |
| T2 | Un aparato viejo (shell anterior) recibe el campo nuevo y lo borra al guardar (Object.assign pisa) | M | Alto | Aditivo: el merge nunca borra un campo que no entiende. Test: aparato "viejo" simulado sin el campo, merge, el campo sobrevive | F |
| T3 | La rebaja por antiguedad cambia el precio de una venta ya hecha o de una pieza ya liquidada | M | Muy alto (plata) | La rebaja toca SOLO el precio de lista futuro; cada venta congela su precio. Test Hugo/Paco/Luis nuevo antes de mergear | F |
| T4 | El estado de cuenta del comisionista expone datos de otros comisionistas o de clientes | M | Muy alto (privacidad, prime directive) | Enlace de solo lectura, firmado, con vencimiento, y que contenga SOLO lo de ese comisionista. Revision de seguridad antes de publicar. Nunca un servidor que guarde ventas | F |
| T5 | El rol "commissionist/artist" puede ver o tocar ventas ajenas | M | Muy alto | Permisos negativos por defecto: solo alta de productos en SU percha. Test de acceso por rol como team-access-hardening | F |
| T6 | Subir `schemaVersion` para un feature hace que las apps viejas rechacen el respaldo | B | Alto | Prohibido por CLAUDE.md. Campo nuevo, nunca version nueva | F |
| T7 | Se mezclan varios features en un PR y un bug no se puede aislar | A | Medio | 1 feature = 1 plan = 1 shell = 1 PR. Nunca juntar | todos |
| T8 | La UI del feature nuevo reintroduce gris, 11 px o esquinas rotas | A | Bajo | Test de legibilidad por seccion (ver H4/H5) antes de mergear | O |
| T9 | El aviso por WhatsApp se dispara dos veces (dos aparatos ven la misma venta) | M | Bajo-medio (molestia al artista) | Solo lo dispara el aparato que HIZO la venta (deviceId), nunca el que la recibe por sync | F |

## 3. DESPUES — lo que va a fallar con los features ya en vivo

| # | Riesgo | P | Dano | Defensa | Dueno |
|---|---|---|---|---|---|
| D1 | Un enlace de estado de cuenta reenviado por el artista llega a terceros | M | Medio | Vencimiento corto (7-30 dias), revocable desde Commissions, sin nombres de clientes | F |
| D2 | La rebaja automatica baja precios que el dueno queria mantener | M | Medio | Rebaja apagada por defecto, por percha, con aviso de "manana baja X" en Today. Nunca automatica sin confirmar la primera vez | F+O |
| D3 | Lealtad: un cliente acumula puntos en dos aparatos y cobra el premio dos veces | M | Medio (plata) | Puntos derivados de las ventas (no un contador aparte), asi el merge ya existente los cuadra | F |
| D4 | Soporte: con mas features, JFC no alcanza a atender (promesa "directo conmigo") | A | Alto | Manual y ayuda contextual por feature ANTES de lanzarlo; limitar cupo mensual como ya dice save.html | JFC+O |
| D5 | 1.000-10.000 licencias por gremio: el panel crece y KV lista lento | M | Medio | Panel v2 ya pagina e indexa 10k en ~200 ms; el Worker lista por DO. Medir con 2.000 reales antes de prometer | F |
| D6 | Un rival copia la UI publica | A | Bajo | El foso es el Worker + relay + cifrado + velocidad de arreglo; fase E del cargador saca el codigo del repo publico | F |

## Lo primero, en este orden
1. JFC hoy: prueba en vivo de 1 lote y 1 pago en el panel (H3); revisar sesiones de Cloudflare (H8); Belen abre la app online (H1).
2. F: carrera de TRES aparatos con estado rancio (H2).
3. O: 11 px → 13 px y contrastes medidos en Hoy, Inventario, Gastos, Etiquetas, Commissions, Avanzado (H4, H5), con test de fijacion.
4. Recien despues, el primer feature (aviso por WhatsApp), con su plan y su test de dos aparatos.

## Como se mide que el pre-mortem sirvio
- Cero incidentes de dinero entre aparatos reportados por Belen o Jose.
- Cada feature nuevo entra con su test rojo-verde y su shell propio.
- Auditoria de Chromium de las 9 secciones sin texto < 13 px ni contraste < 4.5:1.
