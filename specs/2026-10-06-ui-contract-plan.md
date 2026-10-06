# Contrato de UI por rol: plan de implementación

> **Para agentes ejecutores:** SUB-SKILL REQUERIDA: `ejecutar-con-sonnet` (hard rule de JFC), con `superpowers:subagent-driven-development`. Cada tarea la ejecuta un subagente con `model: "sonnet"` y la revisa Opus con evidencia. Los pasos usan checkbox (`- [ ]`).

**Objetivo:** que ningún cambio pueda publicarse si le quita a un rol un control aprobado por JFC (o se lo muestra a un rol que no debe verlo), con 4 defectos de hoy detectados en rojo y luego arreglados.

**Arquitectura:** un contrato JSON (`release/ui-contract.json`) dice qué controles ve cada rol en cada pantalla. Un test de Playwright entra con el PIN real de cada rol, abre cada pantalla por el camino normal y compara lo visible contra el contrato. `release-control` (de `9a7dafd`) exige ese test en verde y exige `changeApproval` de JFC para cambiar el contrato. Graphiti guarda el contrato y la historia como memoria de agentes (último paso).

**Tech stack:** Node 22, `node:test`, Playwright (Chromium + WebKit, ya en `node_modules`), backend simulado `docs/mock-backend.js`, helper `test/helpers/sin-red-produccion.cjs`.

**Spec:** `specs/2026-10-06-ui-contract-design.md` (rama `spec/ui-contract-2026-10-06`).

## Restricciones globales

- **Nunca datos de clientes.** Solo el escenario ficticio de la Tarea 1. Nunca licencias completas (F123-/AMG-/C123-) en código, tests ni commits (`check-sw.sh` G5).
- **Admin = dueño** en toda la UI, salvo borrar el negocio (JFC 2026-10-06).
- **Shell:** el congelamiento de v448 está levantado. El primer cambio a un archivo del SHELL (`const SHELL=[...]` en `docs/sw.js`) usa `f123-shell-v449` (verificar antes con `git log -S"f123-shell-v449" --all` que no exista; si existe, usar el siguiente entero libre). Una sola subida de shell para todo el lote de arreglos (Tarea 6e), con `node scripts/gen-manifest.js` y `bash check-sw.sh`.
- **Trampa CRLF:** en Windows, `check-sw.sh` OK no prueba los hashes de producción. Verificar con `git show HEAD:docs/<archivo> | sha256sum` contra `docs/version-manifest.json`.
- **Respaldo** antes de cada lote: `backups/<YYYY-MM-DD_HH-MM>_<motivo>/` con copia y `SHA256-LINES.txt` (bytes, líneas, SHA-256 de cada archivo tocado).
- **Reglas visuales de JFC:** nada de texto gris, opacidad ni texto bajo 12px; texto nuevo en `i18n.js` (EN y ES), nunca fijo.
- **TDD:** rojo contra el código actual, luego verde. Un test de fijación se rotula como tal.
- **Nada a master sin OK de JFC.** Trabajo en la rama `feat/ui-contract-2026-10-06` (worktree), base `origin/master`.
- **Prohibido** quitar un control del contrato o relajar una expectativa del test para obtener verde.

## Review Focus

1. **Producto vendido en 2 perchas con 2 personas:** en By product NO debe aparecer un botón que pague una percha o persona equivocada; debe llevar a una selección explícita (Tarea 6b, test `product-multi-rack`).
2. **Integridad pendiente (`integridad.ok === false`):** el botón de pago debe seguir visible (los 3 incidentes previos). Tarea 4 corre el escenario también con integridad pendiente.
3. **Idioma ES:** cada texto del contrato se comprueba en ES y EN; un texto fijo en inglés falla (Tarea 4).
4. **WebKit (iPhone de Belén):** todo el test corre también en WebKit 390×844 (Tarea 4).
5. **Admin creado por el dueño con PIN propio:** el login de admin pasa por `/api/usuarios/verificar`, no por `rolActual` forzado (Tarea 1).

---

### Tarea 1: Escenario fijo y login real por rol

**Archivos:**
- Crear: `test/fixtures/ui-contract-scenario.cjs`
- Crear: `test/helpers/ui-contract-login.cjs`
- Test: `test/ui-contract-login.test.js`

**Interfaces:**
- Produce: `seedScenario(page, { integridadPendiente = false }) -> Promise<{ personId, rackId, productId }>` y `loginAs(page, rol) -> Promise<void>` con `rol ∈ {"dueno","admin","empleado","contador"}`; `PINS = { dueno: "682", admin: "514", empleado: "260", contador: "357" }`.

- [ ] **Paso 1: Leer el flujo real de login.** Leer `docs/auth-ui.js` líneas 1009-1130 (`alinearYEntrar`, `validar(code)`, `verificarUsuarioNombrado`) y 2023 (`alCompletar`). El teclado se re-baraja (`nuevoTeclado()`): el helper debe hacer clic en la tecla por su texto, no por posición. Leer `test/pin-owner-integrity.test.js` para `OCSecure.guardarSecreto(ownerPin, [empleadoPins], contadorPin, email)` y `fijarOwnerPin`.

- [ ] **Paso 2: Escribir el test que falla.**

```js
// test/ui-contract-login.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { openApp, seedScenario } = require('./fixtures/ui-contract-scenario.cjs');
const { loginAs } = require('./helpers/ui-contract-login.cjs');

for (const rol of ['dueno', 'admin', 'empleado', 'contador']) {
  test(`login real por PIN entra como ${rol}`, async () => {
    const web = await chromium.launch({ headless: true });
    try {
      const page = await openApp(web, { locale: 'en-US' });
      await seedScenario(page);
      await loginAs(page, rol);
      const visto = await page.evaluate(() => window.OCAuth.rolActual());
      assert.equal(visto, rol);
    } finally { await web.close(); }
  });
}
```

- [ ] **Paso 3: Correr y ver que falla.** `node --require ./test/helpers/sin-red-produccion.cjs --test test/ui-contract-login.test.js`. Esperado: FAIL, `Cannot find module './fixtures/ui-contract-scenario.cjs'`.

- [ ] **Paso 4: Implementar el escenario.**

```js
// test/fixtures/ui-contract-scenario.cjs
// Escenario FICTICIO para el contrato de UI. Nunca datos de clientes.
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const INDEX = pathToFileURL(path.resolve(__dirname, '../../docs/index.html')).href;

async function openApp(browser, { locale = 'en-US' } = {}) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, locale });
  await page.goto(INDEX, { waitUntil: 'load' });
  await page.waitForFunction(() => window.OCSecure && window.OCAuth);
  return page;
}

async function seedScenario(page, { integridadPendiente = false } = {}) {
  return page.evaluate(async ({ integridadPendiente }) => {
    await window.OCSecure.guardarSecreto('789', ['260'], '357', 'owner@example.invalid');
    await window.OCSecure.fijarOwnerPin('682');
    const req = async (u, m = 'GET', b) => (await fetch(u, { method: m,
      headers: b ? { 'Content-Type': 'application/json' } : undefined,
      body: b ? JSON.stringify(b) : undefined })).json();
    // balance-due: 1 producto -> 1 percha -> 1 persona
    const ana = await req('/api/promotoras', 'POST', { nombre: 'Ana Prueba', comisionBase: 40 });
    const rack = await req('/api/ubicaciones', 'POST', { nombre: 'Percha Prueba', tipo: 'socio' });
    await req('/api/ubicaciones/' + rack.id, 'PUT', { promotoraId: ana.id });
    const taza = await req('/api/productos', 'POST', { nombre: 'Taza Prueba', barcode: 'TAZA-001', precio: 100, costo: 30, stockInicial: 5, ubicacionId: rack.id });
    await req('/api/productos/' + taza.id + '/venta', 'POST', { cantidad: 1 });
    // product-multi-rack: mismo producto en 2 perchas con 2 personas
    const beto = await req('/api/promotoras', 'POST', { nombre: 'Beto Prueba', comisionBase: 30 });
    const rack2 = await req('/api/ubicaciones', 'POST', { nombre: 'Percha Dos', tipo: 'socio' });
    await req('/api/ubicaciones/' + rack2.id, 'PUT', { promotoraId: beto.id });
    const vela = await req('/api/productos', 'POST', { nombre: 'Vela Prueba', barcode: 'VELA-001', precio: 50, costo: 10, stockInicial: 4, ubicacionId: rack.id });
    await req('/api/productos/' + vela.id + '/venta', 'POST', { cantidad: 1 });
    await req('/api/productos/' + vela.id + '/venta', 'POST', { cantidad: 1, ubicacionId: rack2.id });
    // customer-debt
    await req('/api/clientes', 'POST', { nombre: 'Cliente Prueba' });
    // team-member: admin con PIN propio (lo crea el dueño)
    await req('/api/usuarios', 'POST', { nombre: 'Admin Prueba', pin: '514', rol: 'admin' });
    if (integridadPendiente) {
      // Simula `info.integridad.ok === false` (los 3 incidentes del pago). El ejecutor
      // busca el mecanismo REAL (grep -n "integridad" docs/mock-backend.js) y lo usa aquí.
      // Si no hay forma de provocarlo, este bloque LANZA error: nunca se ignora en silencio.
      throw new Error('integridadPendiente: falta implementar con el mecanismo real del mock');
    }
    return { personId: ana.id, rackId: rack.id, productId: taza.id };
  }, { integridadPendiente });
}
module.exports = { openApp, seedScenario };
```

Si una ruta del backend simulado no existe con ese nombre (`/api/clientes`, venta con `ubicacionId`), buscar la real con `grep -n 'path === "/api/' docs/mock-backend.js` y usarla; anotar el cambio en el commit. Si `/api/usuarios` POST exige sesión de dueño, crear el admin **después** de `loginAs(page,'dueno')` y volver a la pantalla de PIN con `window.OCAuth.salir()`. `customer-debt` y `shelf-photo` se completan en la Tarea 4 si el contrato los necesita.

- [ ] **Paso 5: Implementar el login.**

```js
// test/helpers/ui-contract-login.cjs
// Entra por el teclado real (re-barajado): clic por texto de cada dígito.
const PINS = { dueno: '682', admin: '514', empleado: '260', contador: '357' };
async function loginAs(page, rol) {
  const pin = PINS[rol];
  if (!pin) throw new Error('rol desconocido: ' + rol);
  await page.evaluate(() => window.OCAuth.salir && window.OCAuth.salir());
  await page.waitForSelector('#oc-gate', { state: 'visible' });
  for (const d of pin) {
    await page.locator('#oc-gate button', { hasText: new RegExp('^' + d + '$') }).first().click();
  }
  await page.waitForSelector('#oc-gate', { state: 'hidden', timeout: 10000 });
}
module.exports = { loginAs, PINS };
```

- [ ] **Paso 6: Correr y ver verde.** Mismo comando del Paso 3. Esperado: 4/4 PASS. Si `admin` falla porque el rol queda `empleado`, revisar `alinearYEntrar(code, uNom.rol === "admin" ? "admin" : "empleado")`. Es la ruta real; no forzar `rolActual`.

- [ ] **Paso 7: Commit.** `git add test/fixtures/ui-contract-scenario.cjs test/helpers/ui-contract-login.cjs test/ui-contract-login.test.js && git commit -m "test(ui-contract): escenario ficticio y login real por rol"`

---

### Tarea 2: Inventario por rol e idioma

**Archivos:**
- Crear: `scripts/ui-inventory.cjs`
- Salida: `release/ui-inventory/<rol>.<lang>.json` (8 archivos)

**Interfaces:**
- Consume: `openApp`, `seedScenario`, `loginAs` (Tarea 1).
- Produce: JSON `[{ screen, view, tag, id, dataAttrs, text, fontSize, color }]` por rol e idioma.

- [ ] **Paso 1:** Portar la lógica de `C:\00 Projects\_FORENSICS_friendly-123\vivo.cjs` (recorre `nav button`, lista controles visibles con `getBoundingClientRect`) a `scripts/ui-inventory.cjs`, usando `loginAs` en vez de forzar `rolActual`. En pantallas con pestañas (`[data-commissions-view]`), registrar primero la vista por defecto y después hacer clic en cada pestaña; guardar `view`.
- [ ] **Paso 2:** Correr `node scripts/ui-inventory.cjs` y verificar que haya 8 archivos y que cada uno tenga más de 0 controles en cada una de las 9 pantallas. Si un rol no ve una pantalla, el archivo lo registra con `controls: []` (no es un error del script).
- [ ] **Paso 3:** Commit: `git add scripts/ui-inventory.cjs release/ui-inventory && git commit -m "chore(ui-contract): inventario real por rol e idioma"`

---

### Tarea 3: Contrato v1 y validador

**Archivos:**
- Crear: `release/ui-contract.json`
- Crear: `scripts/ui-contract.cjs` (validate)
- Test: `test/ui-contract-schema.test.js`

**Interfaces:**
- Produce: `validateContract(json) -> string[]` (lista de errores; vacía = válido) y `diffNeedsApproval(prev, next) -> boolean`.

- [ ] **Paso 1: Test que falla.**

```js
// test/ui-contract-schema.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateContract, diffNeedsApproval } = require('../scripts/ui-contract.cjs');
const contract = require('../release/ui-contract.json');

test('el contrato publicado es válido', () => {
  assert.deepEqual(validateContract(contract), []);
});
test('quitar un control exige changeApproval de JFC', () => {
  const next = JSON.parse(JSON.stringify(contract));
  next.screens[0].controls.pop();
  assert.equal(diffNeedsApproval(contract, next), true);
  assert.ok(validateContract(next, contract).some(e => /changeApproval/.test(e)));
});
test('admin aparece en todo control que tenga dueno, salvo borrar el negocio', () => {
  for (const s of contract.screens) for (const c of s.controls) {
    if (c.roles.includes('dueno') && c.id !== 'advanced.delete-business') assert.ok(c.roles.includes('admin'), c.id);
  }
});
```

- [ ] **Paso 2:** Correr `node --test test/ui-contract-schema.test.js`. Esperado: FAIL, `Cannot find module`.
- [ ] **Paso 3: Validador.**

```js
// scripts/ui-contract.cjs
const ROLES = ['dueno', 'admin', 'empleado', 'contador'];
function validateContract(c, prev) {
  const e = [];
  if (c.schema !== 1) e.push('schema debe ser 1');
  const ids = new Set();
  for (const s of c.screens || []) for (const k of s.controls || []) {
    if (ids.has(k.id)) e.push('id duplicado: ' + k.id); ids.add(k.id);
    if (!k.selector) e.push(k.id + ': falta selector');
    if (!k.text || !k.text.en || !k.text.es) e.push(k.id + ': falta text.en o text.es');
    if (!Array.isArray(k.roles) || k.roles.some(r => !ROLES.includes(r))) e.push(k.id + ': roles inválidos');
  }
  if (prev && diffNeedsApproval(prev, c)) {
    const nuevas = (c.changeApproval || []).length - (prev.changeApproval || []).length;
    const ult = (c.changeApproval || []).at(-1);
    if (nuevas < 1 || !ult || ult.approvedBy !== 'JFC' || !ult.date || !ult.reason) e.push('cambio de contrato sin changeApproval de JFC');
  }
  return e;
}
function diffNeedsApproval(prev, next) {
  const strip = c => JSON.stringify({ ...c, changeApproval: undefined });
  return strip(prev) !== strip(next);
}
if (require.main === module) {
  const fs = require('node:fs'); const { execSync } = require('node:child_process');
  const cur = JSON.parse(fs.readFileSync('release/ui-contract.json', 'utf8'));
  let prev = null; try { prev = JSON.parse(execSync('git show ' + (process.argv[2] || 'HEAD^') + ':release/ui-contract.json', { encoding: 'utf8' })); } catch (_) {}
  const errs = validateContract(cur, prev); if (errs.length) { console.error(errs.join('\n')); process.exit(1); }
  console.log('ui-contract OK');
}
module.exports = { validateContract, diffNeedsApproval, ROLES };
```

- [ ] **Paso 4: Contrato v1.** Crear `release/ui-contract.json` con, como mínimo, estos 4 controles (son los que deben salir rojos en la Tarea 4). Los selectores usan lo que existe hoy; `data-ui` se agrega en la Tarea 6.

```json
{
  "schema": 1,
  "roles": ["dueno", "admin", "empleado", "contador"],
  "screens": [
    { "id": "commissions", "open": "nav:Commissions", "controls": [
      { "id": "commissions.pay-person", "selector": "[data-ui='commissions.pay-person'], [data-comm-pay-person]",
        "text": { "en": "Record {amount} payment", "es": "Registrar pago de {amount}" },
        "roles": ["dueno", "admin"], "when": "balance-due", "views": ["product", "rack"], "action": "opens:payment-dialog" } ] },
    { "id": "customers", "open": "nav:Customers", "controls": [
      { "id": "customers.rate-reliability", "selector": "[data-ui='customers.rate-reliability'], button[aria-label^='Reliability'], button[aria-label^='Confiabilidad']",
        "text": { "en": "Reliability", "es": "Confiabilidad" }, "roles": ["dueno", "admin", "empleado"], "when": "customer-exists" } ] },
    { "id": "advanced", "open": "nav:Advanced", "controls": [
      { "id": "advanced.load-log", "selector": "#oc-log-cargar",
        "text": { "en": "Load history", "es": "Cargar historial" }, "roles": ["dueno", "admin"] } ] }
  ],
  "changeApproval": [
    { "approvedBy": "JFC", "date": "2026-10-06", "reason": "Contrato v1 inicial (spec aprobada 2026-10-06); el resto entra por aprobación pantalla por pantalla.", "previousContract": null }
  ]
}
```

Antes de escribirlo, comprobar en `release/ui-inventory/*.json` el `aria-label` real de los botones de calificación y el texto ES de cada uno; ajustar el selector y `text.es` a lo que use `i18n.js`. **No** inventar textos ES: si no existe la clave, la Tarea 6 la crea y el contrato usa el texto de esa clave.

- [ ] **Paso 5:** `node --test test/ui-contract-schema.test.js`. Esperado: 3/3 PASS.
- [ ] **Paso 6:** Commit: `git commit -am "feat(ui-contract): contrato v1 y validador con changeApproval"` (con `git add` de los archivos nuevos).

---

### Tarea 4: Test del contrato en navegador (tiene que salir ROJO)

**Archivos:**
- Crear: `test/ui-contract.browser.test.js`

**Interfaces:**
- Consume: `openApp`, `seedScenario`, `loginAs` (Tarea 1), `release/ui-contract.json` (Tarea 3).

- [ ] **Paso 1: Escribir el test.**

```js
// test/ui-contract.browser.test.js
// Recorre la UI REAL por rol x idioma x motor y la compara con release/ui-contract.json.
// Falla de ENTORNO (no cargó, timeout) se informa aparte y nunca cuenta como verde.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chromium, webkit } = require('playwright');
const contract = require('../release/ui-contract.json');
const { openApp, seedScenario } = require('./fixtures/ui-contract-scenario.cjs');
const { loginAs } = require('./helpers/ui-contract-login.cjs');

const NAV = { commissions: /commission|comisi/i, customers: /customer|client/i, advanced: /advanced|avanzad/i };
async function abrir(page, screen) {
  await page.locator('nav button', { hasText: NAV[screen.id] }).first().click();
  await page.waitForTimeout(800);
}
async function visibles(page, selector) {
  return page.$$eval(selector, els => els.filter(e => {
    const r = e.getBoundingClientRect(); const s = getComputedStyle(e);
    return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden';
  }).map(e => e.innerText.replace(/\s+/g, ' ').trim()));
}
function textoOk(real, plantilla) {
  const re = new RegExp('^' + plantilla.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\\\{amount\\\}|\{amount\}/g, '.+') , 'i');
  return re.test(real);
}

for (const [motor, engine] of [['Chromium', chromium], ['WebKit', webkit]])
for (const lang of ['en', 'es'])
for (const integridadPendiente of [false, true])
for (const rol of contract.roles) {
  test(`ui-contract · ${rol} · ${lang} · ${motor}${integridadPendiente ? ' · integridad pendiente' : ''}`, async () => {
    const web = await engine.launch({ headless: true });
    const fallos = [];
    try {
      const page = await openApp(web, { locale: lang === 'es' ? 'es-EC' : 'en-US' });
      await seedScenario(page, { integridadPendiente });
      await loginAs(page, rol);
      if (lang === 'es') await page.evaluate(() => window.OCI18n && window.OCI18n.setLocale && window.OCI18n.setLocale('es'));
      for (const screen of contract.screens) {
        await abrir(page, screen);
        for (const c of screen.controls) {
          const vistas = c.views || [null];
          for (const v of vistas) {
            if (v) { const tab = page.locator(`[data-commissions-view="${v}"]`); if (await tab.count()) await tab.first().click(); await page.waitForTimeout(600); }
            const textos = await visibles(page, c.selector);
            const debe = c.roles.includes(rol);
            const tag = `${c.id}${v ? '[' + v + ']' : ''} · ${rol} · ${lang} · ${motor}`;
            if (debe && textos.length === 0) fallos.push(`${tag}: NO visible`);
            if (!debe && textos.length > 0) fallos.push(`${tag}: visible y no debería`);
            if (debe && textos.length && !textos.some(t => textoOk(t, c.text[lang]))) fallos.push(`${tag}: texto "${textos[0]}" no coincide con "${c.text[lang]}"`);
          }
          if (screen.controls.some(k => k.views)) await abrir(page, screen); // volver a la pestaña por defecto
        }
      }
      if (fallos.length) await page.screenshot({ path: `test-results/ui-contract/${rol}-${lang}-${motor}.png`, fullPage: true }).catch(() => {});
    } catch (err) {
      throw new Error('ENTORNO: ' + err.message);
    } finally { await web.close(); }
    assert.deepEqual(fallos, [], 'PRODUCTO:\n' + fallos.join('\n'));
  });
}
```

Notas para el ejecutor: si `OCI18n.setLocale` no es el nombre real, buscarlo con `grep -n "OCI18n *=" docs/i18n.js` y usar la API real; si el cambio de idioma recarga la página, volver a hacer login después. Crear la carpeta `test-results/ui-contract/` en el test (`fs.mkdirSync(..., { recursive: true })`).

- [ ] **Paso 2: Correr y comprobar el ROJO esperado.** `node --require ./test/helpers/sin-red-produccion.cjs --test test/ui-contract.browser.test.js 2>&1 | tee test-results/ui-contract/rojo-inicial.txt`. **Tienen que aparecer, como mínimo:**
  - `commissions.pay-person[product] · dueno|admin · …: NO visible`
  - `commissions.pay-person[rack] · dueno|admin · es · …: texto "Record $… payment" no coincide`
  - `customers.rate-reliability · admin · …: NO visible`
  - `advanced.load-log · dueno|admin · en · …: texto "CARGAR HISTORIAL" no coincide`

  Si alguno **no** aparece, el test está mal: corregir el test, nunca el contrato. Si aparece un fallo que no está en esta lista, anotarlo para Opus (puede ser un hallazgo nuevo).

- [ ] **Paso 3:** Commit con la salida roja como evidencia: `git add test/ui-contract.browser.test.js test-results/ui-contract/rojo-inicial.txt && git commit -m "test(ui-contract): contrato en navegador, ROJO inicial con 4 defectos conocidos"`

---

### Tarea 5: Aprobación del contrato completo en Notion (Opus, no Sonnet)

- [ ] **Paso 1:** Opus genera desde `release/ui-inventory/*.json` una página de Notion por pantalla (hijas de "friendly-123 — SPEC Contrato de UI por rol · 2026-10-06"), con la tabla: control · selector · texto EN · texto ES · roles · condición · ✅/corrección. Marca en rojo lo que contradice "admin = dueño".
- [ ] **Paso 2:** JFC aprueba pantalla por pantalla. Cada pantalla aprobada entra a `release/ui-contract.json` con una entrada `changeApproval` (approvedBy JFC, fecha, "pantalla X aprobada en Notion").
- [ ] **Paso 3:** Volver a correr la Tarea 4 y anotar los nuevos rojos como tareas 6x adicionales. Esta tarea no bloquea las Tareas 6a-6d.

---

### Tarea 6a: Admin puede calificar clientes

**Archivos:** Modificar `docs/index.html:3532`.

- [ ] **Paso 1:** Respaldo de `docs/index.html` (regla global).
- [ ] **Paso 2:** Confirmar el rojo: `customers.rate-reliability · admin` en la Tarea 4.
- [ ] **Paso 3:** Cambiar:

```js
// antes
const puedeEvaluar = window.OCAuth && window.OCAuth.rolActual && (window.OCAuth.rolActual() === "dueno" || window.OCAuth.rolActual() === "empleado");
// después
// JFC 2026-10-06: admin = dueño en la UI (salvo borrar el negocio). El admin quedaba sin calificar clientes.
const puedeEvaluar = window.OCAuth && window.OCAuth.rolActual && ["dueno", "admin", "empleado"].includes(window.OCAuth.rolActual());
```

- [ ] **Paso 4:** Tarea 4 sin ese rojo. Commit `fix(customers): admin puede calificar clientes (admin = dueño)`.

### Tarea 6b: Botón de pago en Commissions → By product

**Archivos:** Modificar `docs/index.html` (panel `comm-panel-product`, desde la línea ~8377; el botón por persona vive en ~8646). Opus diagnostica la causa antes de que Sonnet edite (`friendly-123:systematic-debugging`).

- [ ] **Paso 1:** Respaldo. Confirmar el rojo `commissions.pay-person[product]`.
- [ ] **Paso 2 (Opus):** leer cómo se arma cada fila de "Summary by product" y qué datos tiene (`perchas`, `personas`, saldo). Regla (plan de dinero de Codex + golden14): mostrar `Record {amount} payment` en la fila **solo si** todas las ventas pendientes de ese producto pertenecen a **1 percha y 1 persona**. Si son varias, mostrar un botón "Choose who to pay" / "Elegir a quién pagar" que cambia a la vista By rack con esa fila filtrada. Nunca pagar en bloque desde un saldo de producto.
- [ ] **Paso 3 (Sonnet):** implementar reutilizando `marcarComisionPagada(ubicacionId, nombre, monto, payeeId)` y los mismos `data-pay-*` del botón por persona; agregar `data-ui="commissions.pay-person"` a ambos botones (rack y producto) y `data-ui="commissions.choose-payee"` al de selección. Texto vía la clave de la Tarea 6c.
- [ ] **Paso 4:** Agregar al contrato `commissions.choose-payee` (roles dueno, admin; when `product-multi-rack`; views `product`) **con `changeApproval` de JFC** (pedir OK en el chat antes).
- [ ] **Paso 4b: prueba negativa (Review Focus 1).** Agregar a `test/ui-contract.browser.test.js` un caso: en By product, la fila de "Vela Prueba" (2 perchas, 2 personas) **no** contiene `[data-ui='commissions.pay-person']` y **sí** contiene `[data-ui='commissions.choose-payee']`; la fila de "Taza Prueba" contiene `pay-person` y al hacer clic el diálogo nombra a "Ana Prueba" y "Percha Prueba".
- [ ] **Paso 5:** Tarea 4 sin rojos de `commissions.*[product]`. Correr también `test/commissions-money-ux-browser-v448.test.js`, `test/payout-ledger-*.test.js` y `test/commissions-*.test.js`. Commit `fix(commissions): acción de pago en By product (1 percha/1 persona) o selección explícita`.

### Tarea 6c: Texto del botón de pago en ES/EN

**Archivos:** Modificar `docs/index.html:8615` (diccionario `mx`) y `:8648`.

- [ ] **Paso 1:** Agregar `pay` a ambos lados de `mx`: EN `` amount => `Record ${amount} payment` ``, ES `` amount => `Registrar pago de ${amount}` `` (glosario STE: REGISTRAR = RECORD). Usar `mx.pay(fmtMoney(due))` en el botón.
- [ ] **Paso 2:** Tarea 4 sin rojos de texto en `commissions.pay-person`. Commit `fix(commissions): botón de pago traducido`.

### Tarea 6d: "CARGAR HISTORIAL" traducido

**Archivos:** el que define `#oc-log-cargar` (buscar con `grep -rn 'oc-log-cargar' docs/*.js docs/index.html`) y `docs/i18n.js`.

- [ ] **Paso 1:** Crear la clave (ej. `adv.log.load`: EN "Load history", ES "Cargar historial") en ambos bloques de `i18n.js` y usarla.
- [ ] **Paso 2:** Tarea 4 sin rojo de `advanced.load-log`. Commit `fix(advanced): botón de historial traducido`.

### Tarea 6e: Shell nuevo, manifest y suite completa

- [ ] **Paso 1:** Verificar el siguiente shell libre (`git log -S"f123-shell-v449" --all --oneline`). Subir `CACHE` en `docs/sw.js` y `shell` en `docs/version.json` a ese valor, con generación coherente.
- [ ] **Paso 2:** `node scripts/gen-manifest.js` y `bash check-sw.sh` (todo OK). Verificar hashes contra `git show HEAD:docs/<archivo> | sha256sum` (trampa CRLF).
- [ ] **Paso 3:** `npm test`: suite completa en verde, **incluido** `test/ui-contract.browser.test.js`. Guardar la salida en `test-results/ui-contract/verde-final.txt`.
- [ ] **Paso 4:** Commit `release: f123-shell-v449 contrato de UI y arreglos de pago/admin/i18n`.

---

### Tarea 7: Bloqueo de publicación

**Archivos:** Modificar `release/capabilities.json`, `scripts/release-control.cjs` (función `validate`), `.github/workflows/release-control.yml`.

- [ ] **Paso 1: Test que falla**, agregado a `test/release-control.test.js`:

```js
test('release-control validate falla si ui-contract cambia sin changeApproval', () => {
  const { validateContract } = require('../scripts/ui-contract.cjs');
  const prev = require('../release/ui-contract.json');
  const next = JSON.parse(JSON.stringify(prev)); next.screens[0].controls = [];
  assert.ok(validateContract(next, prev).length > 0);
});
```

- [ ] **Paso 2:** En `validate(base)` de `release-control.cjs`, llamar a `validateContract(actual, contratoEn(base))` y sumar los errores. Agregar a `capabilities.json`:

```json
{"id":"ui-contract-by-role","contract":"Every control approved in release/ui-contract.json is visible, correctly labelled and actionable for its roles, in the default path, in EN and ES, in Chromium and WebKit.","tests":["test/ui-contract.browser.test.js","test/ui-contract-schema.test.js","test/ui-contract-login.test.js"]}
```

- [ ] **Paso 3:** En `release-control.yml`, después de `npm test`, agregar `node scripts/ui-contract.cjs "${BASE_SHA:-HEAD^}"`.
- [ ] **Paso 4:** `node --test test/release-control.test.js` en verde. Commit `ci: el contrato de UI bloquea la promoción y exige changeApproval`.

---

### Tarea 8: Graphiti (bloqueada hasta que haya credencial)

- [ ] **Paso 1:** Confirmar que no corre ningún FalkorDB expuesto (`docker ps`); si hay uno con `0.0.0.0:6379`, avisar a JFC (no detenerlo sin su OK).
- [ ] **Paso 2:** Con la credencial puesta por JFC en `C:\Users\JFC\.jfc-memory-lab\graphiti\graphiti.env` y `GRAPHITI_GROUP_ID=friendly-123`, correr `START-GRAPHITI.ps1` y `SMOKE-TEST-GRAPHITI.ps1` (escuchan solo en 127.0.0.1).
- [ ] **Paso 3:** Ingerir como episodios: `release/ui-contract.json`, la cronología de incidentes de la página "CODEX — friendly-123 forensics 96h", las decisiones de la spec (sección 3). Pasar todo por un filtro que rechace licencias (`/\b(F123|AMG|C123)-/`), PINs reales y claves.
- [ ] **Paso 4:** Consulta de prueba: "¿qué controles tiene Commissions para el admin y qué incidentes hubo ahí?". Pegar la respuesta en Notion como evidencia.
- [ ] **Paso 5:** Agregar a `AGENTS.md` y al `CLAUDE.md` del repo: "antes de cambiar una pantalla, consultar Graphiti grupo friendly-123; la autoridad es `release/ui-contract.json` y su test".

---

## Entrega

- PR desde `feat/ui-contract-2026-10-06` a `master`, **sin fusionar** hasta que JFC dé el OK.
- Antes de fusionar: el check de Workers Builds "website" (CLAUDE.md, incidente 2026-09-29) y `verification-before-completion`.
- Reporte a JFC en VERIFICADO / INFERIDO / PENDIENTE, con la salida roja inicial y la verde final.

---

## Enmienda 2026-10-06 (PDF "Reporte de mejora: pagos y comisiones", decisiones de JFC)

Decisiones de JFC, tomadas por opción múltiple después de leer el PDF:
- **Vista Por persona:** se agrega como tercera pestaña de Commissions, en este lote.
- **Estados visibles (los del PDF):** Pendiente, Pago registrado, Pagado, Parcialmente pagado, Anulado y Revertido. "Pago registrado" significa que el pago está anotado en el ledger pero su recibo todavía no se envió.
- **Versión:** el número interno de shell sube (v449). Lo que ve el cliente ("friendly-123 1.0") no cambia.
- **Textos ES oficiales (del PDF):** Ganado / Pagado / Pendiente; "La persona gana"; "La casa retiene"; "Monto a pagar"; "Registrar pago". En EN: Earned / Paid / Still due; "Record payment".

### Tarea 6f: Pestaña "Por persona" / "By person"
- Agregar `[data-commissions-view="person"]` junto a product y rack. Mostrar ahí las tarjetas por persona que hoy están en la vista rack (reusar el mismo render y los mismos handlers `data-comm-*`; no duplicar lógica de dinero).
- Cada tarjeta muestra Ganado / Pagado / Pendiente y el botón `commissions.pay-person` (mismo `data-ui`) cuando Pendiente > 0.
- Contrato: `commissions.pay-person.views` pasa a `["product","rack","person"]`, con `changeApproval` (JFC 2026-10-06, PDF lámina 9 "Mismo comportamiento en Por producto, Por percha y Por persona").
- TDD: primero el rojo de la Tarea 4 con la vista person en el contrato; después implementar.

### Tarea 6g: Estados visibles del PDF
- Badge por persona: Pendiente (`due`), Parcialmente pagado (`partially-paid`), Pagado (`paid`), Anulado (`voided`), Revertido (`reversed`), y **Pago registrado** = pago en el ledger con recibo aún no enviado.
- Opus decide antes de que Sonnet edite: dónde se guarda "recibo enviado" (campo aditivo en el payout, p. ej. `receiptSentAt`, sin cambiar el esquema existente; ver el core de `docs/core/payout-ledger.js`). Si exige un cambio de esquema, se para y se consulta a JFC.
- Textos en `i18n.js`, ES y EN; contrato `commissions.status-badge` con sus 6 textos.

### Ajuste a la Tarea 3
- `commissions.pay-person.text.es` = "Registrar pago de {amount}"; agregar al contrato `commissions.earned` / `commissions.paid` / `commissions.due` con ES "Ganado" / "Pagado" / "Pendiente" y EN "Earned" / "Paid" / "Still due".
