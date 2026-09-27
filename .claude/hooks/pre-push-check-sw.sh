#!/usr/bin/env bash
# pre-push-check-sw.sh — hook PreToolUse (Bash) de Claude Code.
#
# POR QUE EXISTE (JFC 2026-09-27): check-sw.sh es la guarda que impide publicar
# un shell mezclado (bug del "Avanzado roto", 2026-08-16). Hasta hoy dependia de
# que el modelo se acordara de correrlo; en sesiones de la nube que nadie mira,
# se olvida. Este hook lo corre SOLO antes de cualquier `git push` y, si falla,
# BLOQUEA el push (exit 2 = Claude Code cancela el comando y le muestra el error).
#
# No toca nada: solo lee. Si el comando no es un push, sale 0 al instante.
set -u
entrada="$(cat)"
comando="$(printf '%s' "$entrada" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(String(JSON.parse(s).tool_input.command||""))}catch(e){}})')"
case "$comando" in
  *"git push"*|*"git -C "*" push"*) ;;
  *) exit 0 ;;
esac
raiz="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
salida="$(bash "$raiz/check-sw.sh" 2>&1)"
if [ $? -ne 0 ]; then
  printf 'PUSH BLOQUEADO: check-sw.sh fallo. Arreglalo antes de pushear.\n%s\n' "$salida" >&2
  exit 2
fi
exit 0
