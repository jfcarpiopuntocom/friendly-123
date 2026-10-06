# Spec: Contrato de UI por rol para friendly-123

- **Fecha:** 2026-10-06
- **Autor:** Claude (Opus 5.5), con brainstorming de superpowers
- **Aprobó el diseño:** JFC, partes 1 a 4 aprobadas en el chat del 2026-10-06
- **Estado:** spec escrita. Falta que JFC la revise, y después el plan.
- **Evidencia de base:** forensics de 96h (Notion, "CODEX — friendly-123 forensics 96h", 2026-10-06), `C:\00 Projects\_FORENSICS_friendly-123\`

## 1. Problema

Entre el 2026-10-03 y el 2026-10-06 (57 versiones de master):

- El botón para pagar comisiones dejó de verse 3 veces (v443 `d7b9c95`, golden13 `42af880`, golden14 `802c80f`). Hoy, en `master` (`9a7dafd`, con la app igual a `d4d4ab1`), sigue faltando en la pestaña por defecto **Commissions → By product / SKU**. Solo aparece en By rack / event. Lo verificó `pagar.cjs` en un navegador.
- Las fotos de perchas se parcharon 10 veces en 9 horas.
- El admin (Belén, idiomARTE, la primera clienta) no puede calificar clientes: `index.html:3532` deja afuera el rol `admin`.
- El botón de pago está fijo en inglés (`index.html:8648`) y "CARGAR HISTORIAL" sale en español dentro de la interfaz en inglés.

**Causa común:** ninguna prueba recorre la interfaz real con cada rol y por el camino normal. Las pruebas actuales comprueban que el control esté en el código o abren una pestaña secundaria. El diff de código (`uidiff.py`) también falló, porque no detecta controles que existen pero no se ven.

## 2. Objetivo y criterio de éxito

**Objetivo:** que ningún cambio, venga de Codex, de Claude o de quien sea, pueda publicarse si le quita a un rol un control que JFC aprobó, o si se lo muestra a un rol que no debe verlo.

**Éxito:**
1. Existe un contrato aprobado por JFC, pantalla por pantalla.
2. El test del contrato sale **rojo** hoy en los 4 defectos de la sección 1, y **verde** después de los arreglos.
3. Un control quitado o escondido en el futuro hace fallar el QA de master y bloquea la promoción automática a `estable`.
4. Graphiti responde a un agente "¿qué controles tiene <pantalla> para <rol>?" con el contrato vigente.

## 3. Decisiones de JFC (no se cambian sin `changeApproval`)

| Decisión | Fecha | Motivo |
|---|---|---|
| **El admin ve y usa todo lo que ve el dueño, salvo borrar el negocio** | 2026-10-06 | Belén es admin y venía perdiendo controles |
| Camino A: contrato + pruebas en navegador + Graphiti como memoria | 2026-10-06 | Graphiti recuerda pero no bloquea, las pruebas sí |
| El PUSH de JFC sigue siendo una emergencia que se salta el QA (heredado de `9a7dafd`) | 2026-10-05 | Decisión vigente de JFC |
| Opus planea a effort medio; Sonnet 5.5 ejecuta (skill `ejecutar-con-sonnet`) | 2026-10-06 | Costo y velocidad |

Roles que existen en el código (`docs/auth-ui.js`): `dueno` > `admin` > `empleado` (encargado), además de `contador` (PIN 357, solo lectura contable) y demo (PIN 456, acceso de dueño sin claves ni correo).

## 4. Componentes

### 4.1 `release/ui-contract.json` (el contrato)

```json
{
  "schema": 1,
  "roles": ["dueno", "admin", "empleado", "contador"],
  "screens": [
    {
      "id": "commissions",
      "open": "nav:Commissions",
      "controls": [
        {
          "id": "commissions.pay-person",
          "selector": "[data-ui='commissions.pay-person']",
          "text": { "en": "Record {amount} payment", "es": "Registrar pago de {amount}" },
          "roles": ["dueno", "admin"],
          "when": "fixture:balance-due",
          "views": ["product", "rack"],
          "action": "opens:payment-dialog"
        }
      ]
    }
  ],
  "changeApproval": []
}
```

- **Selector estable:** cada control del contrato lleva en el HTML el atributo `data-ui="<pantalla>.<control>"`, y las pruebas lo usan en vez de clases CSS o texto. Agregar `data-ui` no cambia lo que se ve.
- **`roles`** dice quién lo ve. Los roles que no están en la lista no deben verlo (prueba negativa).
- **`when`** nombra una condición del escenario de prueba (sección 4.3). Sin `when`, el control debe verse siempre.
- **`views`** se usa en pantallas con pestañas: el control debe verse en cada una de las vistas listadas.
- **`action`** es opcional: lo que debe pasar al hacer clic (se abre un diálogo o editor, o se navega).
- **Alcance de la v1:** solo controles que hacen cosas (button, input, select, a, summary) y textos que nombran dinero o acciones. Los datos (nombres de productos, montos de la tabla) no entran.

### 4.2 `test/ui-contract.browser.test.js` (el verificador)

Para cada combinación de **rol × idioma (en, es) × motor (Chromium, WebKit)**, son 16 recorridos:

1. Abre `docs/index.html` con el backend simulado y la red bloqueada (helper `sin-red-produccion.cjs`).
2. Carga el escenario fijo (sección 4.3).
3. **Entra con el PIN real del rol en el fixture.** No fuerza `OCAuth.rolActual`.
4. Abre cada pantalla **por el camino normal**: clic en la barra de navegación, y en la pestaña que abre por defecto. Las otras vistas se abren después con clic en su pestaña.
5. Por cada control del contrato, comprueba que:
   - se ve: `getBoundingClientRect()` mayor que 0, `display` distinto de `none`, `visibility` distinto de `hidden`;
   - su texto coincide con el del idioma de ese recorrido;
   - si tiene `action`, el clic produce ese efecto, y después se cierra sin guardar nada.
6. **Prueba negativa:** para los roles que no están en `roles`, el control no se ve.
7. Si falla, informa `<control> · <rol> · <idioma> · <motor>: <motivo>` y guarda una captura en `test-results/ui-contract/`.
8. Si la página no carga o se agota el tiempo, lo informa como **ENTORNO**, separado de **PRODUCTO**. Un fallo de entorno nunca cuenta como verde.

`dashboard.html` y `panel.html` se cubren con el mismo mecanismo, en una sección `pages` del contrato.

### 4.3 Escenario de prueba fijo (`test/fixtures/ui-contract-scenario.cjs`)

Solo datos ficticios y backend simulado. **Nunca datos de clientes.** Debe hacer verdaderas todas las condiciones `when`:

| Condición | Datos |
|---|---|
| `balance-due` | Persona "Ana Prueba", 40 %, Percha Prueba, Taza Prueba vendida (1 producto → 1 percha → 1 persona) |
| `product-multi-rack` | Un producto vendido en 2 perchas con 2 personas |
| `partial-payment` | Un pago parcial ya registrado para otra persona |
| `customer-debt` | Cliente con fiado pendiente |
| `shelf-photo` | Percha con foto |
| `team-member` | Un miembro del equipo con rol empleado y otro con rol admin |

### 4.4 Bloqueo de publicación

- Se agrega una capacidad a `release/capabilities.json` (formato de Codex, `9a7dafd`): `{"id": "ui-contract-by-role", "contract": "Every control approved in release/ui-contract.json is visible, correctly labelled and actionable for its roles, in the default path.", "tests": ["test/ui-contract.browser.test.js"]}`.
- `npm test` ya lo ejecuta. `release-control` exige verde del commit exacto antes de promover. El PUSH de emergencia de JFC sigue sin bloqueo.
- **Regla de cambio:** si un commit cambia `ui-contract.json` sin una entrada nueva en `changeApproval` (`approvedBy: "JFC"`, `date`, `reason`, `previousContract`), `release-control validate` falla. Ningún agente puede quitar un control del contrato, ni una línea del test, para obtener verde.

### 4.5 Graphiti (memoria de agentes)

- Instancia del laboratorio: `C:\Users\JFC\.jfc-memory-lab\graphiti`, solo en `127.0.0.1:8000`, grupo `friendly-123`.
- **Ingesta:** el contrato aprobado, los incidentes del forensics (commit, causa, arreglo, estado), las decisiones de la sección 3 y el test que protege cada control.
- **Prohibido ingerir:** datos de clientes, PINs, licencias (F123-, AMG-, C123-) y keys.
- **Uso:** antes de cambiar una pantalla, el agente consulta Graphiti. La respuesta es contexto; la autoridad sigue siendo el contrato del repo y el test.
- **Bloqueo:** Graphiti necesita una credencial de LLM en `graphiti.env`, que la pone JFC con Notepad, o un endpoint compatible con OpenAI (OmniRoute, hoy sin proveedores disponibles). Este paso va al final y no bloquea los demás.

## 5. Proceso de aprobación del contrato

1. **Inventario:** se corre `vivo.cjs` adaptado con login por PIN, una vez por rol e idioma (8 corridas) sobre `master`.
2. **Borrador:** `ui-contract.json` sale de ese inventario y marca en rojo lo que ya contradice las decisiones de la sección 3.
3. **Aprobación:** una página de Notion por pantalla, con la tabla control · texto ES/EN · roles · condición · ✅/corrección. JFC aprueba pantalla por pantalla.
4. Solo lo aprobado entra al contrato. Después rige la regla de cambio (4.4).

## 6. Orden de trabajo

1. Inventario por rol (Sonnet).
2. Borrador del contrato y páginas de aprobación en Notion (Sonnet); JFC aprueba.
3. Test del contrato (Sonnet). **Tiene que salir rojo** en: pago en By product, botón de pago en inglés, admin sin calificaciones y "CARGAR HISTORIAL". Si no sale rojo, el test está mal.
4. Arreglos uno por uno con TDD. La causa la diagnostica Opus y la ejecución la hace Sonnet. Cada arreglo lleva respaldo, suite completa, shell nuevo creciente y manifest regenerado (regla post-congelamiento de `9a7dafd`). El arreglo del pago sigue el plan de Codex: el pago desde By product solo cuando el producto mapea a 1 percha y 1 persona; si no, selección explícita.
5. Registro en `capabilities.json` y `release-control` (Sonnet).
6. Graphiti: encenderlo, ingerir y probar 1 consulta (cuando haya credencial).

Nada se sube a `master` sin el OK de JFC.

## 7. Fuera de alcance

- Rediseño visual. El contrato congela lo que hay; los cambios de diseño son otra decisión.
- La lógica financiera del Payout Ledger, más allá del botón y su texto. La conciliación al centavo sigue en el plan de dinero de Codex.
- La recuperación de fotos de perchas, más allá de comprobar que la foto se ve.
- Pruebas en dispositivos físicos. El contrato no las reemplaza.

## 8. Riesgos

| Riesgo | Mitigación |
|---|---|
| Un contrato demasiado detallado se rompe con cada cambio legítimo | Alcance v1 limitado a controles y textos de acción; `changeApproval` en vez de editar a mano |
| El test tarda mucho (16 recorridos) | Concurrencia 4 (ya en `package.json` de `9a7dafd`); medir y, si pasa de 5 min, separar por motor |
| Login por PIN en el fixture se rompe con cambios de auth | El escenario usa la API pública de auth; un fallo de login se informa como ENTORNO |
| Graphiti sin credencial | Último paso, no bloquea |
