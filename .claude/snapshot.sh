#!/usr/bin/env bash
# snapshot.sh — foto verificable del repo ANTES de tocar nada.
#
# JFC, 2026-08-18: "quiero que te acostumbres y apuntes que debes hacer backup
# de todo y hasta foto checksum de todo".
#
# Hace tres cosas, y las tres importan por separado:
#   1. RAMA de respaldo fechada  -> retroceder con git, aunque se pierda el disco
#   2. TAR fuera del repo        -> rescata hasta lo NO rastreado por git, que es
#                                   justo lo que no sobrevive a un clon nuevo
#   3. CHECKSUMS sha256          -> saber DESPUES si un archivo cambió, y cuál
#
# Uso:  bash .claude/snapshot.sh "antes-del-port-a-f123"
set -u
ETIQUETA="${1:-snapshot}"
SELLO="$(date +%Y%m%d-%H%M%S)"
RAIZ="$(git rev-parse --show-toplevel)"
NOMBRE="$(basename "$RAIZ")"
DESTINO="${SNAPSHOT_DIR:-/home/user/_snapshots}"
mkdir -p "$DESTINO"

cd "$RAIZ" || exit 1

# 1. Rama de respaldo, sin movernos de donde estamos
RAMA="backup/${SELLO}-${ETIQUETA}"
git branch "$RAMA" 2>/dev/null && echo "rama:      $RAMA"

# 2. Copia completa, incluyendo lo que git no rastrea
TAR="$DESTINO/${NOMBRE}-${SELLO}-${ETIQUETA}.tar.gz"
tar -czf "$TAR" --exclude=.git --exclude=node_modules -C "$(dirname "$RAIZ")" "$NOMBRE" 2>/dev/null
echo "tar:       $TAR ($(du -h "$TAR" | cut -f1))"

# 3. Checksums de todo archivo servido o de código
SUMS="$DESTINO/${NOMBRE}-${SELLO}-${ETIQUETA}.sha256"
find . -type f \( -name '*.js' -o -name '*.html' -o -name '*.json' -o -name '*.md' -o -name '*.css' \) \
  -not -path './.git/*' -not -path './node_modules/*' -print0 \
  | sort -z | xargs -0 sha256sum > "$SUMS" 2>/dev/null
echo "checksums: $SUMS ($(wc -l < "$SUMS") archivos)"

# Estado del momento, para saber qué se fotografió
{ echo "# $NOMBRE — $SELLO — $ETIQUETA"
  echo "rama:   $(git branch --show-current)"
  echo "HEAD:   $(git rev-parse HEAD)"
  echo "limpio: $([ -z "$(git status --porcelain)" ] && echo si || echo NO)"
  git status --porcelain
} > "$DESTINO/${NOMBRE}-${SELLO}-${ETIQUETA}.estado.txt"
echo "OK $NOMBRE"
