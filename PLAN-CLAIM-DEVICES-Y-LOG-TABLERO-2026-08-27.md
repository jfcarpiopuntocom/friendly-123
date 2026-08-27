# PLAN portátil — (A) Claim/merge de dispositivos propios + (B) Log en el tablero

Fecha: 2026-08-27. Para ejecutar en Codex/AbacusAI **sin** el contexto de esta
sesión. Todo vive en `docs/`. Repo: friendly-123 (app PWA, sin build step; los
`.js` van directo, no hay bundler). Rama de trabajo:
`claude/hybrid-proxy-tunnel-sync-ymq8d6`.

## INVARIANTES QUE NO SE PUEDEN ROMPER (probar SIEMPRE, ver "Verificación")
1. El merge es **ADD-ONLY**: `OCSync.aplicarCatalogo()` solo agrega lo que falta;
   NUNCA borra ni pisa datos existentes. No cambiar esto.
2. Entrar con la licencia de otro (cliente) siendo **lord** = invitado/observador:
   no adopta la licencia ajena, deja rastro en `f123_accesos`. No romperlo.
3. Sin `f123_tienda_activa`, el estado es byte-idéntico al legacy.
4. Una licencia de cliente NUNCA desaparece (el heartbeat nunca manda `licenseCode`
   vacío; el Worker `/checkin` nunca vacía un campo).

## CÓMO SE VERIFICA (obligatorio antes de dar por hecho / pushear)
```bash
bash .claude/test-todo.sh        # verde = OK. Corre guards + check-sw + 2 arneses de navegador
```
Requiere Chromium (ya instalado en este repo; en otro entorno: `npx playwright install chromium`).
Si se toca el SHELL (cualquier `.js` de `docs/` listado en `docs/sw.js`), SUBIR el
número de CACHE en `docs/sw.js` **y** el `shell` en `docs/version.json` (mismo valor,
ej. `f123-shell-v117`). `panel.html` y `dashboard.html` NO están en el shell (no
requieren bump; se sirven por GitHub Pages y se ven al recargar).

---

# A) CLAIM / MERGE DE DOS DISPOSITIVOS DE LA MISMA PERSONA

## Problema real (medido)
Una persona queda con dos aparatos/tiendas sueltos (ej. "James Bond Store" en PC y
"007 Store" en el cel), cada uno con su `instanceId` y a veces con
`licenseCode`/`syncCode`/sala de sync **divergentes** (estado enredado tras probar).
Hoy no hay forma de: (1) reconciliar los 3 campos en un aparato, ni (2) juntar los
datos regados de ambos en una sola licencia sin perder nada.

## Idea de la solución (mínima y segura)
El merge YA ocurre solo cuando dos aparatos apuntan a la **misma sala de sync**
(= misma licencia) y están online: `aplicarCatalogo`/`aplicarCheckpoint` fusionan
add-only. Entonces "claim" = **re-apuntar ambos aparatos a UNA licencia canónica,
SIN vaciar los datos locales**. Al reconectar, el sync los junta.

### A1. `OCTienda.reconciliar(licencia)` — nuevo método (mock-backend.js)
Archivo: `docs/mock-backend.js`. Cerca de `window.OCTienda = { ... }` (~línea 1817)
y de `cambiar(licencia)` (~línea 1840). Agregar un método hermano:

```js
// Deja los TRES campos de identidad en el MISMO código, sin tocar los datos
// locales (NO vacía). Arregla el "mismatch" (licenseCode vs syncCode vs sala) y
// es la base del claim: el aparato queda como device de esa licencia canónica.
reconciliar(licencia) {
  const norm = _normLic(licencia);
  if (!norm) return { ok: false, error: "Empty license." };
  try {
    const ow = JSON.parse(localStorage.getItem("f123_owned") || "null") || {};
    ow.licenseCode = norm;
    ow.syncCode = norm;              // la cajita de compartir deja de mostrar residuo
    localStorage.setItem("f123_owned", JSON.stringify(ow));
  } catch (_) {}
  try { if (window.OCSyncControl && window.OCSyncControl.fijarSala) window.OCSyncControl.fijarSala(norm); } catch (_) {}
  // NO se llama a _vaciarTiendaFresca(): los datos locales se conservan para que
  // el merge posterior los sume a la tienda canónica.
  try { if (window.OCSyncControl && window.OCSyncControl.resincronizar) window.OCSyncControl.resincronizar(); } catch (_) {}
  try { window.dispatchEvent(new CustomEvent("oc-negocio-actualizado", { detail: {} })); } catch (_) {}
  return { ok: true, licencia: norm };
},
```
Nota: `_normLic`, `_licenciaPropia`, `_vaciarTiendaFresca` ya existen en el mismo
archivo. `fijarSala`/`resincronizar` ya existen en `OCSyncControl` (sync-realtime.js).

### A2. UI de claim (avanzado-extra.js) — dentro del panel de sync
Archivo: `docs/avanzado-extra.js`. El panel de sync se arma en la función que
contiene `panel.innerHTML = \`...\`` (~línea 481) y tiene el `<details id="oc-sync-unirse">`
(~línea 526). Agregar OTRO `<details>` debajo, "This is also my device — claim & merge":

```html
<details id="oc-sync-claim" style="margin-top:12px;padding-top:12px;border-top:1px solid var(--azul-suave,#dde5ec);">
  <summary style="font-size:14px;font-weight:700;color:var(--azul-medio);cursor:pointer;min-height:44px;display:flex;align-items:center;">This is also MY device — claim it and merge its data</summary>
  <p style="font-size:14px;color:var(--ink-soft);margin:8px 0;">Enter the license your OTHER device shows. Both will point to the same notebook and their data merges (nothing is deleted — merge only adds).</p>
  <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
    <input id="oc-sync-claim-cod" type="text" placeholder="F123-XXXX-XXXX-XXXX-XXXXX" maxlength="40" style="flex:1;min-width:220px;padding:10px;border:2px solid var(--azul-medio);border-radius:5px;font-size:15px;">
    <button id="oc-sync-claim-btn" class="ir" style="min-height:44px;">Claim &amp; merge</button>
  </div>
</details>
```
Wire (después de `vista.appendChild(panel);`, junto a los otros listeners del panel):
```js
var claimBtn = panel.querySelector("#oc-sync-claim-btn");
if (claimBtn) claimBtn.addEventListener("click", function () {
  var lic = (panel.querySelector("#oc-sync-claim-cod").value || "").trim();
  if (!/^F123-/i.test(lic)) { /* pintar msg de error en #oc-sync-msg */ return; }
  var r = window.OCTienda.reconciliar(lic);   // re-apunta este aparato, conserva datos
  // Mensaje: "Done. Open your other device online; the two notebooks are merging now."
});
```
Aplicar la MISMA máscara autoformateada que usan `#oc-sync-codigo` y
`#oc-sync-codigo2` (buscar `_ocMascaraCodigo` en auth-ui.js: alfabeto Crockford
sin I/L/O/U, grupos 4-4-4-5, paste que reemplaza). Reusar esa función, no inventar.

### A3. Identificar aparatos propios en el panel maestro (panel.html)
Archivo: `docs/panel.html`. Ya existe `esMio(r)` = `r.email === "jfcarpio@gmail.com"`
y la fila plegada por licencia. Falta: cuando DOS licencias distintas comparten el
mismo email, marcarlas como candidatas a claim. En `licRenderTabla` (busca
`const grupos = []`), tras armar `grupos`, calcular por email:
```js
const porEmail = {};
_licData.forEach(r => { const e=(r.email||"").toLowerCase(); if(e) (porEmail[e]=porEmail[e]||new Set()).add((r.licenseCode||"").toUpperCase()); });
```
Y en la fila principal, si `porEmail[email].size > 1`, pintar un chip:
`"⚠ same email on N licenses — likely the same person (claim/merge)"`.
Es solo señalización visual; el claim se hace desde la app (A2), no desde el panel.

## Qué NO hacer en A
- NO vaciar los datos locales al reconciliar (perdería inventario).
- NO fusionar automáticamente sin que el usuario lo pida (podría juntar tiendas
  que no debían).
- NO tocar `aplicarCatalogo` (ya es add-only y correcto).

---

# B) LOG EN EL TABLERO (periscopio propio)

## Qué se quiere
"Atar mi log al fondo de mi tablero" — que en el tablero (`dashboard.html`, que
"reads live from your device") aparezca al fondo el **log de movimientos** y el
estado de sync/accesos, como termómetro del manejo de datos (también de clientes,
cuando JFC entra a revisar).

## Dónde vive el dato
- `docs/mock-backend.js`: array `movimientos` (~línea 239), escrito por `mov(...)`.
  Se incluye en el snapshot/foto (~línea 371). El tablero ya recibe una FOTO cifrada
  del dispositivo por el relay.
- `f123_accesos` (localStorage): bitácora de accesos del lord (ver diagnóstico en
  avanzado-extra.js).

## B1. Exponer el log en la foto del tablero
Si la foto que arma `dashboard.html` (vía `pedirFoto`/`TIPO_FOTO_*` en
sync-realtime.js) NO trae `movimientos`, agregarlo: en `sync-realtime.js`, la
función que construye la foto (busca el `return { productos, clientes, ventas,
resumen, liquidaciones, perchas, negocio, generadaEn }` ~línea 491) — añadir
`movimientos: (await get("/movimientos?limite=200")) || []`. Para eso, en
`mock-backend.js` agregar un endpoint GET de solo-lectura:
```js
// GET /api/movimientos?limite=N — últimos N movimientos (log), solo lectura.
if (path === "/api/movimientos" && (!opts || opts.method === "GET")) {
  const n = Math.min(Number(q.get("limite")) || 200, 500);
  return J(movimientos.slice(-n).reverse());
}
```
(Colocarlo junto a los otros `if (path === "/api/...")` del router del mock.)

## B2. Sección "Log / control" al fondo del tablero
Archivo: `docs/dashboard.html`. Al final de `<main id="tablero"><div class="wrap"> ... </div></main>`
(~línea 285+), agregar una sección plegable:
```html
<details id="oc-log-tablero" style="margin-top:28px;border-top:1px solid #2a3a4a;padding-top:14px;">
  <summary style="cursor:pointer;font-weight:700;color:#B8860B;">My log · data & sync control (periscope)</summary>
  <div id="oc-log-sync" style="font-family:monospace;font-size:12px;margin:10px 0;"></div>
  <table id="oc-log-tabla" style="width:100%;font-size:13px;border-collapse:collapse;"></table>
</details>
```
Y en el JS de `dashboard.html`, cuando llega/rinde la foto, pintar:
- `#oc-log-sync`: estado de sync (reusar los mismos hechos del diagnóstico de
  avanzado-extra: connection, sync room, active store) + `f123_accesos.length`.
- `#oc-log-tabla`: filas de `foto.movimientos` (tipo, detalle, fecha). Escapar HTML
  (usar el `licEsc`/escHtml equivalente del archivo). Solo lectura.

## Qué NO hacer en B
- El tablero NO guarda nada (es un lienzo): solo PINTA la foto. No persistir ahí.
- NO meter banners/popups a la UI del cliente en vivo (regla dura de reglas-friendly);
  esto es una sección plegable en el tablero, no un banner.

---

## ORDEN sugerido
1. A1 (`reconciliar`) — desenreda el estado y habilita el claim. Bajo riesgo.
2. A2 (UI claim) + A3 (señal en panel).
3. B1 + B2 (log en tablero).
4. Correr `bash .claude/test-todo.sh` → verde. Bump de shell si se tocó `.js` del
   shell (A1/A2/B1 sí; panel.html/dashboard.html no). Commit, push, PR, merge.

## Archivos tocados (resumen)
- `docs/mock-backend.js` — A1 (`reconciliar`), B1 (endpoint `/api/movimientos`). [SHELL → bump]
- `docs/avanzado-extra.js` — A2 (UI claim). [SHELL → bump]
- `docs/sync-realtime.js` — B1 (foto incluye movimientos). [SHELL → bump]
- `docs/panel.html` — A3 (señal same-email). [no shell]
- `docs/dashboard.html` — B2 (sección log). [no shell]
- `docs/sw.js` + `docs/version.json` — bump del shell si se tocó algún `.js`.
</content>
</parameter>
