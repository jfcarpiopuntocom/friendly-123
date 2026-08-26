# reglas-friendly

Invariantes duras de friendly-123 (y sus hermanas amigable-123 / consultorio-123)
que TODA sesión de Claude debe respetar SIN excepción. Cargar y aplicar antes de
tocar código o UI. Estas reglas nacen de errores reales que costaron días.

## PALETA DEL SEMÁFORO — EXACTA, NO NEGOCIABLE
Es la BASE de toda la experiencia de usuario (solo se le sacó el azul). Los mismos
hex en alertas, hero, filtros y bordes de tarjeta:
- verde  `#00C87A`
- amarillo/dorado `#FFC700`  (NUNCA el olivo `#9E7C00` ni `#B8860B`)
- naranja `#F97316`
- rojo    `#E8365D`
- negro   `#0A0A0F`
**Nunca inventar un color ni cambiarlo por estética.** Si algo se ve "feo", es un
bug de que NO se usó la paleta, no una licencia para inventar.

## UI DEL CLIENTE EN VIVO — INTOCABLE SIN PERMISO
- **Prohibido** introducir popups, banners o avisos nuevos a la UI. Los avisos de
  storage/persistencia/aislamiento van SOLO a consola. El único aviso visible
  permitido es el fallo REAL de guardado.
- Mensajes/errores van en texto ABAJO del campo, nunca dentro de la cajita de
  entrada (ej. la de pegar licencias).
- No cambiar la experiencia esencial de usuario sin aprobación explícita de JFC.

## RELEASE — CHECKLIST OBLIGATORIO
1. `bash .claude/snapshot.sh "antes-de-X"`
2. `bash .claude/guards.sh` → TODO VERDE
3. `node --check` de cada .js tocado; JSON válido
4. **Bump de SW `shell` (vNN) Y del campo `version`** en version.json (el refresh
   forzado compara AMBOS; si no subís `version`, el cliente sigue con código viejo)
5. `bash check-sw.sh` → coinciden
6. commit + push; sacar de borrador y mergear cuando esté verde y comprobado

## NUNCA PERDER TRABAJO
- Jamás sobrescribir un archivo completo entre apps hermanas: injertar cambio por
  cambio. Ante duda de si algo es trabajo propio de esa app: preguntar.
- El rol interno sigue siendo el string `"empleado"`; solo cambió el texto visible.
- consultorio-123 PIN = 4 dígitos POR DISEÑO. friendly/amigable = 3.

## NOTA
Este archivo es referencia viva. Si un apunte más reciente lo contradice, gana el
apunte y se actualiza esto en el mismo commit.
