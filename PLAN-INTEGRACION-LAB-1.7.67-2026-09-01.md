# PLAN — Integrar el lab 1.7.67 al repo + micro-mejoras de UI (2026-09-01)

> REGLA 5: el plan va en el chat ANTES de hacer. Este .md es la copia portátil.
> Estado: **SOLO PLAN. No se ejecuta nada hasta el OK de JFC.** (JFC: "solo quiero
> un maravilloso plan… no hagas NADA nuevo adicional no mencionado o en los files,
> hasta mi aprobación").

## Contexto medido (no asumido)

- Repo (git, rama `claude/ui-integration-jfc-process-nc2lj7`): **1.7.36 / shell v149**.
- Tus zips del lab: **v59 (1.7.59/v172)**, **v65 (1.7.65/v178)**, **v67 (1.7.67/v180)**.
  v59 = snapshot del repo completo; v65 y v67 = solo `docs/` (lo que sirve Pages).
- **v67 es el más avanzado y ninguna de las previas tiene nada que v67 pierda**
  (medido: v67 ⊇ v65 ⊇ v59 en todo salvo lo de abajo).
- Delta real repo→v67: **9 archivos de código** + `version.json` + `version-manifest.json`.
  `i18n.js` es **idéntico** repo↔v67 (no se toca).

## Lo que aporta el lab v67 (medido, por archivo)

| Archivo | Δ líneas repo→v67 | Qué trae |
|---|---|---|
| `sync-realtime.js` | 1384→1396 | **Fix P0 identidad Lord** (`f123_lord_licencia_canonica`, "LORD NUNCA ADOPTA", tu `SYNCIDENTITYFIX.md`) |
| `mock-backend.js` | 3416→3478 | PIN reservado 2026-08-31; sidecar (PIN del cuaderno TAMBIÉN abre); blindaje sufijo de invitado (no mapear a `""`) |
| `crypto-store.js` | 646→795 | Default dueño 789 (no 888); identidad canónica del Lord (1 escritura); 10 intentos + backoff estilo iOS/NIST (documentado) |
| `avanzado-extra.js` | 3066→3134 | "Back to top" — uno por subsección, sin huérfanos apilados (riel) |
| `aislamiento.js` | 391→395 | `reafirmarIdb()` — re-afirma el wrapper de IndexedDB al load (fase 5 debug) |
| `index.html` | 7156→7174 | **Apodo del dispositivo en el HEADER** (`pintarApodoHeader`, `oc-header-apodo`) + lápiz de nombre de negocio |
| `sw.js` | v149→v180 | bump de shell |
| `help-ui.js` | 382→409 | (ya presente en repo vía v65; delta menor) |
| `version.json` / `version-manifest.json` | — | metadata de versión + hashes SRI |

## Riesgo REAL de pérdida encontrado (por esto NO se hace `cp` — REGLA 1b)

1. **`auth-ui.js`: el REPO va ADELANTE del lab (1644 vs 1624).** El lab NO tiene:
   - **Pre-chequeo anti fuerza-bruta** antes de `verificarOwner/Empleado`
     (repo llama `verificarOwner` 3×/`segundosBloqueo` 2×; v67 solo 1×). Sin esto,
     a un dueño con la clave correcta la UI le diría "clave incorrecta" durante el
     bloqueo → **adoptar v67 tal cual reintroduce ese bug**.
   - Resolución de rol **admin nombrado** (JFC 2026-08-25: "al admin le dice
     employee en la pastillita naranja").
   - **Subclave de contador** funcionando directo en el candado principal (2026-07-15).
   → `auth-ui.js` se mergea **por hunks a mano**, conservando lo del repo.
2. **Apodo: no se perdió, se MOVIÓ.** El repo lo tenía en el gate del PIN
   (`oc-gate-apodo`); v67 lo lleva al header (`oc-header-apodo`). Adoptar v67
   (auth-ui sin gate-apodo + index con header-apodo) es coherente y es la decisión
   más nueva. Se verifica que el header-apodo cubre todo lo que hacía el gate-apodo.
3. **Intentos de PIN: repo=5, lab=10.** El lab **gana** (decisión documentada
   2026-08-30: NIST 800-63B / iOS ~10 fallos). Se adopta 10. Se avisa en 1 línea.
4. **Promotoras (commits repo 08-29): presentes por igual en repo y lab.** No hay
   pérdida (medido: 5/31/20 ocurrencias iguales).

## Coherencia de idiomas (i18n)

- `i18n.js` idéntico repo↔v67; claves `header.editBizName`, `header.bizNameDefault`,
  `adv.backToTop` ya existen.
- **Pendiente detectado (micro-mejora, NO se toca sin OK):** el apodo del header en
  v67 usa **"Name this device" hardcodeado en inglés**, sin `data-i18n` → rompe la
  bilingüidad. Propuesta en la Fase C.

---

# EL PROCESO — orden exacto pedido por JFC

## FASE A — Integrar el lab v67 (tu trabajo de estos días)

Sigue el **"proceso JFC"** literal: backup → debug → audit → check → coherencia de
idiomas → double-check del código → line count → checksum → audit.

**A0. Backup** — `bash .claude/snapshot.sh "antes-integrar-lab-1.7.67"` (rama fechada
+ tar fuera del repo + sha256). REGLA 1.

**A1. Injerto por archivo (NUNCA `cp` global):**
   - Copia directa segura (lab puramente aditivo sobre repo, ya medido):
     `sync-realtime.js`, `mock-backend.js`, `crypto-store.js`, `avanzado-extra.js`,
     `aislamiento.js`, `index.html`, `sw.js`, `help-ui.js`,
     `version.json`, `version-manifest.json`.
   - **Merge manual por hunks:** `auth-ui.js` — base = repo (conserva pre-chequeo
     anti fuerza-bruta + admin nombrado + subclave contador), y se le injertan del
     lab: `BLOQUEO_TRAS_INTENTOS 5→10` y el retiro del gate-apodo (superado por el
     header-apodo de index.html). Se revisa hunk por hunk.

**A2. Debug/verificación (3X, REGLA –1):**
   - `node --check` a cada `.js` tocado.
   - `bash check-sw.sh` (si aplica) + confirmar que `sw.js` = v180 y `version.json`
     coherente (shell v180, version 1.7.67).
   - Compuerta `test-todo.sh` / `harness-failsafe.cjs` en verde (9/9). Rojo = no push.
   - Regenerar `version-manifest.json` con la herramienta del repo (no a mano) para
     que los hashes SRI casen con los archivos finales del merge.

**A3. Coherencia de idiomas:** grep de textos hardcodeados nuevos; confirmar que
   todo string visible nuevo tiene `data-i18n`. (El "Name this device" queda anotado
   para Fase C, no se corrige aquí salvo tu OK — es lo mínimo para no romper.)

**A4. Line count + checksum + audit final:** wc -l de los 9 archivos = valores del
   lab (salvo auth-ui, que será repo+injertos); sha256 de `docs/`; leer el diff
   final entero una vez, adversarialmente.

**A5. Cierre de ciclo (REGLA 2d):** commit descriptivo → push → sacar PR de borrador
   → mergear **cuando verde y comprobado**. Nota fechada en `docs/` (REGLA 4) +
   diario `DIARIO-2026-09-01.md` + bitácora.

## FASE B — Skills de Emil Kowalski (YA HECHO en esta sesión)

- Clonado el repo oficial `emilkowalski/skills` (commit `d23d7f8`, 2026-08-21) y
  vendorizado en **`.claude/skills/emil-kowalski/`** (12 skills: emil-design-eng,
  review-animations, animate, animation-vocabulary, apple-design, ask-sonner,
  find-animation-opportunities, improve-animations, pick-ui-library, prototype,
  animate-expo, write-swift).
- Son CSS/UX agnósticos de framework → aplican a esta PWA de JS puro. Los principios
  (ease-out fuerte `cubic-bezier(0.23,1,0.32,1)`, <300ms, `:active` scale, no animar
  acciones frecuentes, nada aparece de la nada) alimentan la Fase C.
- **NO existe un "paquete Emil" en tu catálogo de claude.ai** — el del tuit es
  aspiracional; esto es la fuente oficial real, sin alucinar.

## FASE C — Micro-mejoras de UI (SOLO PLAN — requiere tu OK, no se hace ahora)

Objetivo tuyo: que todo en la UI tenga sentido, haga lo que dice, y ofrezca **2+
formas** de lograr lo mismo (REGLA de prioridad 4). Candidatas medidas, sin
implementar:

1. **Editar datos ya ingresados** (auditar cobertura de lápices ✎): producto,
   cliente, PIN/persona, nombre de negocio, apodo de dispositivo, gasto, comisión.
   Donde falte "editar", proponer el flujo de edición (2ª vía además de borrar+crear).
2. **i18n del apodo del header** ("Name this device" → `data-i18n` con clave nueva
   EN/ES). Coherencia bilingüe.
3. **2+ caminos** ya existentes a reforzar: teclado + botón, escáner + tipeo,
   panel + app. Auditar cuáles pantallas ofrecen solo 1 vía.
4. **Pulido Emil (aditivo, sin romper paleta del semáforo):** `:active { scale .97 }`
   en botones; transiciones con propiedad explícita (no `all`) y `ease-out` fuerte
   <300ms; popovers escalan desde su origen; nada de popups/banners nuevos (REGLA UI
   cliente en vivo intocable).
5. Cada micro-mejora saldrá como su propio mini-plan en el chat antes de tocar.

---

## Invariantes que NO se negocian (checklist de release)

- Paleta EXACTA semáforo: `#00C87A / #FFC700 / #F97316 / #E8365D / #0A0A0F`, sin azul
  extra (salvo el `azul-medio` ya existente en helpers).
- Sin nube nueva (relay zero-knowledge). Sin popups/banners nuevos en UI de cliente.
- PIN de 4 dígitos es de consultorio-123, NO de friendly (friendly = 3, dueño 789).
- Nunca romper datos del usuario. Compuerta verde o no se pushea.
- snapshot → guards → check-sw → bump shell **y** version → push.

## Orden de ejecución al aprobar

A0 → A1 → A2 → A3 → A4 → A5. (Fase B ya hecha.) Fase C: solo tras tu OK, mini-plan
por mini-plan.
