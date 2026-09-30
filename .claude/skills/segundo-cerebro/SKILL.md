---
name: segundo-cerebro
description: Como usar el segundo cerebro de JFC (Notion, Obsidian, Outbox de Dropbox) desde una sesion en la nube o en la laptop. Cargar al empezar cualquier sesion de trabajo o cuando JFC diga "mira mi Dropbox", "mi vault" o "el pulso".
---
# Segundo cerebro de JFC (2026-09-29)

## Las tres piezas
1. **Notion** (siempre disponible, laptop y nube): bitacora "Bitacora Claude + Codex - apps Made In Cuenca", id `3ea1642b-67f3-8105-9534-d4a7437d3850`. Es el relevo entre modelos. Leerla al empezar; al cerrar, entrada fechada con "Para Juan" y "Para el otro asistente".
2. **Obsidian** (solo laptop): `C:\Users\JFC\OneDrive\Documentos\Obsidian Vault`, carpeta `00 Projects/Made In Cuenca (Claude)/` con `Pulso.md` y `Outbox Dropbox - Indice.md`.
3. **Outbox de Dropbox** (laptop: `C:\Dropbox\Outbox Dropbox`). En la nube solo se llega con el conector de Dropbox de claude.ai, si JFC lo conecto. Comprobar primero con ToolSearch "dropbox"; si no esta, decirselo a JFC en una linea y trabajar con el repo y Notion.

## Reglas
- La nube NO ve Obsidian ni Dropbox por el disco. No inventar su contenido: leerlo con el conector o pedirle a JFC que lo pegue.
- Nunca copiar a Notion ni al repo (que es publico) contenido de Dropbox/Obsidian, licencias (F123-/AMG-/C123-), PIN, claves ni datos de clientes. Nombres de archivo si; contenido no.
- El pulso en la laptop lo corre `C:\Users\JFC\.claude\segundo-cerebro\pulso.mjs` (tarea programada de Claude a las 08:00 y 20:00 y tarea de Windows cada 30 min).
- Reglamento para Codex: `PARA-CODEX.md` en la misma carpeta y en `Outbox Dropbox\_cerebro\`.
