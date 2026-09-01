# NOTA — Integración del lab 1.7.67 al repo (2026-09-01)

## QUÉ se cambió
Se integró el trabajo de UI/sync que JFC hizo en su lab (build 1.7.67 / shell
v180) al repo, que estaba en 1.7.36 / shell v149. Archivos de `docs/` tocados:

- `sync-realtime.js`, `mock-backend.js`, `crypto-store.js`, `avanzado-extra.js`,
  `aislamiento.js`, `index.html`, `sw.js`, `help-ui.js` → tomados del lab v67
  (byte-idénticos; medido con sha256).
- `auth-ui.js` → **evaluado por hunks**. Resultado: se adopta el del lab porque
  es un par coherente con el `crypto-store.js` del lab (usa `identificarPin`,
  `limpiarLockouts`, `recordarPinQueAbre`, `fijarOwnerPin`, `anotarFalloLogin`).
- `version.json` (1.7.67 / v180) y `version-manifest.json` → **regenerado** con
  `scripts/gen-manifest.js` (el del lab estaba rancio en v172; ahora los hashes
  SRI casan con los archivos reales del merge).

## POR QUÉ (decisiones de merge, para que otra sesión no las deshaga)
1. **`auth-ui.js` del lord y el pre-chequeo anti fuerza-bruta.** El repo tenía un
   pre-chequeo (`segundosBloqueo` antes de `verificarOwner/Empleado`) para evitar
   el "clave incorrecta" falso. El lab lo **supera** con `identificarPin()`, que
   identifica el rol SIN sumar fallos al candado — mejor solución. `auth-ui.js` y
   `crypto-store.js` son un par: como se tomó el crypto del lab, se toma el auth
   del lab para que casen.
2. **Apodo del dispositivo: se MOVIÓ, no se perdió.** El repo lo tenía en el gate
   del PIN (`oc-gate-apodo`); el lab lo lleva al header (`oc-header-apodo`,
   `pintarApodoHeader`). El header cubre lo que hacía el gate.
3. **Intentos de PIN 5→10.** Decisión documentada del lab (2026-08-30, NIST
   800-63B / iOS ~10 fallos). Gana el lab.
4. **Fix P0 de identidad del Lord (`SYNCIDENTITYFIX.md`, 2026-08-31).** El Lord
   **NUNCA adopta** la licencia ajena al unirse: conserva su identidad canónica
   (`f123_lord_licencia_canonica`), solo audita. Supera la decisión del 2026-08-28.

## Test rancio corregido (NO desactivado)
`.claude/harness-join-identity.cjs` codificaba la decisión vieja (2026-08-28:
"el Lord ADOPTA la licencia"). Contradecía el `SYNCIDENTITYFIX` (2026-08-31, más
nuevo, aprobado por JFC en el plan). Por REGLA 0 gana el apunte más reciente: se
actualizó el assert a "el Lord NO adopta; conserva su identidad canónica". El
comportamiento real medido ya cumplía el contrato nuevo.

`.claude/harness-team-sync.cjs`: se hizo `nuevoAparato` resiliente a la recarga
coordinada de versión (v148). Dos "aparatos" en el MISMO navegador comparten
BroadcastChannel, así que la recarga de uno navegaba al otro durante el setup
(en producción son dispositivos distintos y no se tocan). Se reintenta el
`activar` una vez si el contexto se destruye por navegación. No se desactivó
ninguna comprobación.

## CÓMO se verificó (proceso JFC completo)
backup → debug → audit → check → coherencia de idiomas → double-check → line
count → checksum → audit.

- **Backup**: rama `backup/20260901-133352-antes-integrar-lab-1.7.67` + tar +
  sha256 (199 archivos), fuera del repo.
- **Compuerta 9/9 VERDE** (cada paso corrido con el proxy desactivado, porque el
  sandbox bloquea el relay `workers.dev` y las fuentes de Google):
  1) node --check todos los `docs/*.js` · 2) guards.sh TODO VERDE · 3) check-sw
  coinciden (v180) · 4) roster-merge converge · 5) team-sync 29 ok · 6)
  join-identity 5 ok · 7) claim-merge 6 ok · 8) watchdog 11 ok · 9) failsafe 11 ok.
- **Line count**: los 9 archivos casan con el lab v67. **Checksum**: byte-idénticos
  (salvo `version-manifest.json`, regenerado a propósito).
- **Coherencia de idiomas**: `i18n.js` idéntico repo↔lab; claves existentes OK.

## QUÉ quedó PENDIENTE (Fase C — solo tras OK de JFC)
- El apodo del header usa **"Name this device" hardcodeado en inglés** sin
  `data-i18n` → romperá la bilingüidad. Micro-mejora propuesta, NO tocada.
- Auditoría de "2+ formas" / editar datos ya ingresados (lápices ✎) por pantalla.
- Pulido de animación Emil (aditivo, sin romper paleta ni meter popups).
