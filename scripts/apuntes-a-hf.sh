#!/usr/bin/env bash
# Uploads the owner's archived prompts (with SHA256SUMS.txt) to the PRIVATE dataset jfcarpio/jfc-apuntes under prompts/.
# Owner order 2026-11-04. Run by hand only; it aborts BEFORE uploading if the folder holds anything that looks like a
# license, PIN, or token. It prints counts only, never the matching lines.
set -u
SRC="C:/00 Projects/friendly-123/_private/prompts"
DATASET="jfcarpio/jfc-apuntes"
[ -d "$SRC" ] || { echo "missing folder"; exit 1; }
[ -f "$SRC/SHA256SUMS.txt" ] || { echo "missing SHA256SUMS.txt"; exit 1; }

# label|extended regex. PIN-like: the word PIN followed within a few characters by 4-8 digits.
PATRONES=(
  "licencia F123|F123-[0-9A-Za-z*~$=-]{4,}"
  "licencia AMG|AMG-[0-9A-Za-z*~$=-]{4,}"
  "licencia C123|C123-[0-9A-Za-z*~$=-]{4,}"
  "PIN|[Pp][Ii][Nn][^0-9A-Za-z]{0,12}[0-9]{4,8}"
  "token ghp|ghp_[A-Za-z0-9]{10,}"
  "token github_pat|github_pat_[A-Za-z0-9_]{10,}"
  "token hf|hf_[A-Za-z0-9]{10,}"
  "token sk|sk-[A-Za-z0-9_-]{10,}"
)
HITS=0
for p in "${PATRONES[@]}"; do
  n=$(grep -rEho -- "${p#*|}" "$SRC" 2>/dev/null | wc -l)
  echo "${p%%|*}: $n"
  HITS=$((HITS + n))
done
if [ "$HITS" -gt 0 ]; then echo "ABORT: $HITS sensitive-looking matches. Nothing was uploaded."; exit 2; fi

# Verify the checksums the folder already carries before sending anything.
(cd "$SRC" && sha256sum -c SHA256SUMS.txt >/dev/null 2>&1) || { echo "ABORT: SHA256SUMS.txt does not match. Nothing was uploaded."; exit 3; }

hf upload "$DATASET" "$SRC" prompts/ --repo-type dataset --private --commit-message "prompts $(date +%F)"
