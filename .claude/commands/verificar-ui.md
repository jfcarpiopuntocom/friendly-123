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
