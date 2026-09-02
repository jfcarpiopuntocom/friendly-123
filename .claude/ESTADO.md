# ESTADO — memoria de trabajo mutable (patrón SKILL.state)

> **Qué es esto.** Implementación del paper *SKILL.state: Scalable Long-Horizon
> Agent Skills* (arXiv:2608.26263) aplicada a mi trabajo con JFC. En vez de
> re-derivar todo del chat gigante (historial append-only → crece, envenena el
> contexto, mete errores evitables), cada sesión lee ESTE archivo primero:
> compacto, estructurado, **mutable**. Se **sobrescribe**, no se acumula. El
> razonamiento intermedio se descarta; aquí solo queda el estado validado.
>
> **DIARIO-*.md y PROMPTS-Y-BITACORA.md siguen siendo el LOG histórico
> (append-only, para retroceder). ESTADO.md es el ESTADO VIVO (mutable).** Son
> complementarios: el log recuerda qué pasó; el estado dice dónde estamos AHORA.

Actualizado: 2026-09-02 · Rama: `claude/ui-integration-jfc-process-nc2lj7`

---

## 0. PRIME DIRECTIVE 1A (JFC 2026-09-02) — la más alta después de REGLA –1

**NUNCA romper a un dueño de licencia que YA usa la app** (experiencia, datos,
confianza). idiomARTE (primer cliente pagado) recibió un límite del plan gratis
por un `instanceId` transitoriamente null → arreglado con `estaLicenciado()`
(fail-open, re-lee f123_owned en vivo; mock-backend.js). Los cambios son SOLO
tweaks/adiciones ENANAS al margen; nada de gates nuevos sobre flujos vivos, nada
que pueda capar/bloquear/degradar una instancia activada. Ante la duda: no se
hace, se pregunta. Detalle en `CLAUDE.md` (PRIME DIRECTIVE 1A).

## 1. ESPECIFICACIÓN INMUTABLE (punteros — NO copiar aquí, leer la fuente)

- **Reglas y constitución:** `CLAUDE.md` (REGLA –1 a 8) y
  `.claude/commands/modus-operandi.md`. Mandan siempre.
- **Invariantes duros:** paleta semáforo `#00C87A/#FFC700/#F97316/#E8365D/#0A0A0F`
  (sin azul extra salvo `--azul-medio` ya existente); **sin nube** (relay
  zero-knowledge); **sin popups/banners nuevos** en UI de cliente en vivo; PIN
  friendly = 3 dígitos, dueño **789**, demo **456** (4 dígitos es de
  consultorio-123, NO de friendly); nunca romper datos/plata del usuario.
- **Compuerta (ley):** `.claude/test-todo.sh` (9 pasos). En este sandbox el
  wrapper cuelga por el relay/fuentes bloqueadas → correr cada paso con
  `env -u HTTPS_PROXY … node …` (proxy off) y con `p.route(/googleapis|gstatic|workers\.dev/, r=>r.abort())` en Playwright. Rojo = no se pushea.
- **Proceso JFC (orden exacto):** backup → debug → audit → check → coherencia de
  idiomas → double-check → line count → checksum → audit.
- **Prioridades:** ESTABILIDAD > redundancia/fail-safe > híbridos > flexibilidad
  UX (2+ formas) > innovación > investigación.

## 2. INSTRUCCIONES DURADERAS DE JFC (verbatim — se podan cuando se superan)

- «no tengo permitido ser estupido … no parar y arruinarle su dia a JFC, no
  dejar sin pushear idiotamente» (2026-08-18).
- «Acostúmbrate a terminar tus misiones» / «YA EJECUTA CABRON, DEJA DE PARARTE
  A CADA RATO COMO HUEVOTIBIO» — **no re-preguntar en lo ya pedido/aprobado; no
  parar a mitad; yo cierro el ciclo (commit→push→merge), JFC no sabe ni debe
  saber de git** (2026-08-25/09-01).
- **Pulido de animación/look:** «muéstrame ANTES los cambios … solo haz los que
  yo apruebe explícitamente» (2026-09-01). (Los defectos que él reporta se
  arreglan directo; el pulido estético discrecional se muestra antes.)
- **Mobile-first, regla dura:** «tus tablas no se leen bien en celular con vista
  vertical y eso es terrible … es una app mobile first, nos guste o no»
  (2026-09-01). → nada de `<table>` en vistas; tarjetas/flex.
- **PINs visibles a owner/admin** en la lista del Team para no repetirlos
  (2026-09-01).
- **Commissions = idéntico a AMIGABLE** (cliente real: Belen C / idiomARTE)
  (2026-09-01).
- **Frugal en tokens**, usar archivos estratégicamente para contexto, capturar
  instrucciones exactas (2026-09-01, este mismo pedido).
- Vocabulario: **encargado/a** (no empleado), **asociado/a** (no promotor/a),
  **casa anfitriona**; Bar incluye licores. Español natural, sin «vive en».

## 3. ESTADO DE EJECUCIÓN (mutable — se sobrescribe cada trabajo)

- **Versión (rama, por mergear):** `1.7.79` · shell `f123-shell-v192`.
- **friendly-123** es el repo de TESTEO (inglés/i18n); suele ir ADELANTE de
  AMIGABLE. AMIGABLE (español) clonado read-only en
  `/home/user/jfcarpiopuntocom/amigable` para ports.
- **Skills externos disponibles:** `.claude/skills/emil-kowalski/` (12, craft/animación).

### Subsistemas — estado (2026-09-01)
| Subsistema | Estado | Nota |
|---|---|---|
| Integración lab 1.7.67 | ✅ en master | fix P0 identidad Lord incluido |
| i18n apodo dispositivo | ✅ | EN/ES, header + Avanzado |
| Animación (Emil A) | ✅ | token `--ease-out` en vistaEntra; B/C/D no requerían cambio |
| Hundimiento teclas PIN | ✅ | canto+colapso en `.oc-pad button` |
| Advanced tamaños texto | ✅ | headings 15px, acotado `#vista-avanzado` |
| Commissions Opción B (AMIGABLE) | ✅ | editor con barra+modalidad+tramos; gestión comisionistas |
| Team formidable mobile-first | ✅ | tarjetas, PIN visible, ✎; `GET /api/usuarios?pins=1` |
| Conexión FE/BE comisiones | ✅ | promotoras {hasta,comision}+comisionBase (antes {desde,pct}) |
| Sold: categorías con ✎ | ✅ | OCCategorias.agregar/renombrar; gate OCAuth.rolActual |
| Sold modal: cantidad mostrador + factura | ✅ | quita Amount paid; cantidad solo counter-sale; checkbox Add invoice |
| Sold: Sales log editable + cancelar ex-post | ✅ | PATCH /api/ventas/:id, POST /:id/cancelar (bloqueado si liquidada) |
| Logs con usuario+rol+dispositivo | ✅ | mov() añade dispositivoApodo/dispositivoId/usuarioRol (PIN nunca en claro) |
| Expenses: categorías por tipo | ✅ | rent/utilities/…/other; porCategoria; se quitó caja chica por percha |
| Cartera credit/debt colores + item | ✅ | abono=verde #00C87A, fiado=rojo #E8365D; crédito atado a item [for:] |
| My customers: edad + país | ✅ | pulldowns en panel editar; fichaCliente devuelve rangoEdad/pais |
| Daily Summary (rename) | ✅ | Close the day → Daily Summary (bilingüe) |
| Dashboard refleja todo | ✅ | cols Age/Country, Payment/Invoice; log con Who+Device |
| Crédito con fecha de expiración | ✅ | modal input date (cal+MM/DD/YYYY); exp=fecha+1; [exp:] en motivo; EXPIRED en saldo |
| Cancelar reservación de evento | ✅ | Guests → Cancel booking; libera cupo + resta pagado (reusa /ventas/:id/cancelar) |
| 12 micromejoras Emil | ✅ | lapicito único+naranja precaución, dinero coherente, fechas locale, actividad→registro, crédito↔ítem, chip filtra gastos, undo 5s, edit/cancel venta solo dueño/admin, crédito por expirar, editar evento/comprador, editar exp. crédito |

### Trampas técnicas verificadas (para no re-tropezar)
- `isDueno()/isAdmin()` **NO existen en index.html** (viven en avanzado-extra.js).
  En index.html usar `window.OCAuth.rolActual()` (`dueno`/`admin`/`empleado`/`demo`;
  **demo entra como `dueno`**).
- Modelo de comisión compartido FE/BE: escalas `{hasta,comision}` + `comisionBase`,
  `pctMeta = acumulado/metaMensual*100`, `tramo = find(pctMeta <= e.hasta)`.
- El demo (456) tiene tope de plan free: solo se crea 1 usuario de equipo (403 al 2º).
- Verificación de UI: forzar vista con `document.getElementById('vista-X').classList.add('activa')` + `refrescarVistaActiva()`; el splash tapa fullPage — usar element.screenshot.

## 4. ÚLTIMA OBSERVACIÓN / PENDIENTES

- **Hecho hoy (v1.7.77):** prompt multi-parte de JFC (2026-09-02), en 7 lotes,
  todos verdes y pusheados. Endpoints nuevos verificados por
  `.claude/smoke-multiprompt.cjs` (stock cuadra en venta/edición/cancelación).
- **Límite consciente (honesto, no alucinar):** el editar "en vivo" de registros
  se dejó en la app (superficie /api segura: Sold log, Expenses, My customers),
  NO se bolteó edición sobre el *Activity log* sellado append-only (rompería el
  sello anti-tamper) ni sobre el visor de sync `dashboard.html` (relay
  zero-knowledge, escribir por ahí es riesgoso). El dashboard REFLEJA todo
  (columnas nuevas + log con usuario+rol+dispositivo de cada acción).
- Nota histórica (v1.7.75/76): recarga de versión ya NO interrumpe el candado
  (se difiere a post-login, invisible); Demo:456 en "Current access codes";
  **inventario DEMO mejorado** — negocio cultural creíble (Galería + Consignación
  de artistas 85/15 + Bar & Café con vinos/quesos/bebidas/comida + Eventos
  culturales), 38 productos, precios/stock realistas.
- **Garantía dura verificada:** el seed del demo SOLO afecta al demo (456). Un
  usuario real carga sus buffers A/B guardados (aplicarRespaldo) y una activación
  789 arranca de cero (vaciar). Editar el seed NO escribe en localStorage de
  nadie. idiomARTE y todos los reales, intactos. (Demo ≠ fresco ≠ real.)
- Pendiente opcional (sin OK): matriz de Commissions como RFM (Champions/At-risk)
  vs «Estaciones» de AMIGABLE — mismo concepto.
- Nada roto; rama sincronizada con master.

## 5. PROTOCOLO (cómo usar y actualizar este archivo)

1. **Al abrir sesión:** leer este archivo + `CLAUDE.md` + el `DIARIO-*.md` más
   reciente. Con esto hay contexto suficiente sin quemar tokens en el chat.
2. **Al terminar cada trabajo:** SOBRESCRIBIR la sección 3 (estado) y 4 (última
   observación) con el estado nuevo. Podar la sección 2 cuando una instrucción
   quede superada. **No acumular** — esto es estado, no log.
3. El detalle narrativo va al `DIARIO-*.md` (log). Aquí solo el estado validado.
4. Mantenerlo compacto (~1 pantalla). Si crece, es señal de que hay que podar.
