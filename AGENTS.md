# AGENTS.md — para Codex (y cualquier agente) en friendly-123

Lee COMPLETO `CLAUDE.md` antes de planificar: son las reglas de JFC y valen igual para ti.
Luego la bitacora compartida en Notion: "Bitacora Claude + Codex — apps Made In Cuenca"
(Claude y Codex dejan ahi una entrada fechada al terminar cada paso).

Reglas que ya costaron caro (2026-09-29):
1. **No fusionar a master si el commit de master muestra el check `Workers Builds: website`.**
   El Worker de jfcarpio.com quedo conectado a este repo y cada merge publico la app encima
   de la pagina de JFC. Ver `CLAUDE.md` (INCIDENTE 2026-09-29).
2. **Nada queda como blob suelto.** Subir archivos por la API de GitHub sin rama ni PR = trabajo
   perdido si te quedas sin uso. Primero rama, luego commits, luego PR en borrador.
3. **Shell:** revisa `docs/version.json` de origin/master antes de numerar: el siguiente libre es
   el entero que sigue al que figure alli. Checklist de release en `CLAUDE.md`.
4. Nunca licencias completas, PIN, claves ni datos de clientes en el repo (es PUBLICO), ni en Notion.
