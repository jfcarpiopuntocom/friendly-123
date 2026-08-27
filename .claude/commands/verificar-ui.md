# verificar-ui

Verificación visual de la UI ANTES de pushear, para no entregar pantallas rotas
(basado en el skill `webapp-testing` de anthropics/skills). Este entorno ya trae
Chromium + Playwright (PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers). NO correr
`playwright install`.

## USO RACIONADO (regla de JFC, 2026-08-26)
Esta verificación QUEMA TOKENS. **Sugerir su uso y esperar el OK de JFC antes de
correrla.** No dispararla de oficio en cada cambio; usarla cuando el cambio toca
UI visible (candado de PIN, tarjetas, flujos de team/join, colores).

## QUÉ VERIFICAR (pantallas críticas)
1. **Candado de PIN**: que NO muestre el nombre del negocio propio; versión real
   abajo (una sola, no dos v seguidas); sin banners que coman pantalla.
2. **Inventory / tarjetas**: bordes = colores EXACTOS del semáforo; estrella de
   promover junto al doblez de la esquina rota, no sobre la foto.
3. **Join my team**: el aviso sale ABAJO de la cajita, nunca dentro; al pegar una
   licencia distinta, cambia de tienda.
4. Que no aparezca NINGÚN popup/banner de storage/aislamiento.

## CÓMO (esquema, cuando JFC aprueba)
- Servir `docs/` local (ej. `python3 -m http.server` en docs/) y abrir con
  Playwright en Chromium (`executablePath: '/opt/pw-browsers/chromium'` si hace
  falta).
- Navegar a cada pantalla, tomar screenshot, enviársela a JFC con `SendUserFile`.
- Comparar contra las reglas de `reglas-friendly` antes de aprobar el push.

## SALIDA
Screenshots de las pantallas tocadas + una línea por cada regla verificada
(cumple / no cumple). Si algo no cumple, arreglar ANTES de pushear.

## LAS PASADAS HUGO / PACO / LUIS (JFC 2026-08-26 — nombre oficial del método)

Las "pasadas adversariales" se llaman **Hugo, Paco y Luis**: tres usuarios de
IQ distinto que prueban la app de formas distintas. NO es probar el camino feliz;
es preguntarse *qué haría cada uno* y si la app es **FRIENDLY** con usos no
rígidos. **Prioridad 1AAA: que TODO FUNCIONE**, para empezar; luego, que funcione
aunque el usuario no siga el orden "correcto".

- **Hugo** (mete la pata sin querer): pega la licencia con espacios/guiones de
  más, teclea el PIN dos veces, borra a alguien y lo vuelve a agregar, entra con
  el aparato del otro apagado, pone su propia licencia creyendo que se une.
- **Paco** (metódico, desconfiado): edita en medio del código, cambia roles ida y
  vuelta, prueba PIN repetido, revisa que la baja de verdad desaparezca en el
  otro aparato, que dos aparatos con la hora distinta no se pisen.
- **Luis** (poder-usuario, rompe cosas a propósito): dos aparatos empujando a la
  vez, reloj de pared adelantado, estado rancio de un tercer aparato, mergear el
  mismo catálogo dos veces, invadir la tienda de un cliente para "poner tuberías".

**Cómo se corren de verdad (no funciones sueltas):** con el **arnés de dos
aparatos** `.claude/harness-team-sync.cjs` — carga el app real en contextos
aislados (dos localStorage = dos aparatos) y ejerce el camino REAL
(POST/PATCH/DELETE + catalogoPropio + aplicarCatalogo + OCTienda.cambiar),
rompiéndolo a propósito. Ese arnés ya cazó un bug real (precedencia del registro
sobre la licencia propia en `cambiar`). Ampliarlo con cada caso nuevo de
Hugo/Paco/Luis y dejarlo verde ANTES de pushear. Un "todo verde" en función
aislada NO cuenta como pasada Hugo/Paco/Luis.
