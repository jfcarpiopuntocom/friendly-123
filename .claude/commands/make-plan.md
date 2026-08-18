---
description: Planifica antes de tocar código — investiga barato, decide, y escribe el plan en un .md fechado
---

# make-plan

Arma un plan de trabajo para: **$ARGUMENTS**

Vive en el repo (no en `~/.claude/commands/`) a propósito: los comandos del
computador de JFC NO se sincronizan a las sesiones remotas de Claude Code en la
web. Commiteado aquí, funciona en cualquier máquina y en cualquier sesión.

## Reglas

1. **Investigar barato.** Nunca leer archivos grandes enteros para entender qué
   cambió. En este proyecto `index.html` pasa de 1 MB: leerlo quema el contexto
   sin dar más información que la que dan estas herramientas:
   - `git log --since="N days ago" --pretty=format:"%h %ad %s" --date=short`
   - `git diff --stat`, `git show --stat <sha>`
   - `comm` sobre listas de archivos para comparar apps hermanas
   - `grep -rl` de un marcador (`OCBorradores`, `getLiquidaciones`) para saber
     si un sistema está o no está
   Leer el código sólo cuando el plan dependa de un detalle que ninguna de esas
   vías puede contestar.

2. **Decidir, no encuestar.** El plan dice qué se va a hacer y en qué orden, con
   una recomendación. Nada de listar cinco opciones para que otro elija.

3. **Ordenar por riesgo y por lo que desbloquea**, no por lo fácil. Lo que puede
   perder datos o dejar a alguien sin acceso va primero.

4. **Decir qué NO entra.** Un plan sin recortes explícitos es una lista de deseos.

5. **Escribirlo en un `.md` fechado** en la raíz del repo
   (`PLAN-<tema>-AAAA-MM-DD.md`) y commitearlo. Un plan que sólo existe en el
   chat se pierde cuando se cierra la pestaña.

6. **Verificable.** Cada paso dice cómo se comprueba que quedó bien: qué comando
   corre, qué número tiene que dar. "Probar la app" no es una comprobación.

## Salida

Al terminar, presentar el plan en el chat (resumido) y dejar el `.md` escrito.
Si el plan implica trabajo largo, usar ExitPlanMode para que JFC apruebe antes
de ejecutar.
