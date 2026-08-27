#!/usr/bin/env bash
# ============================================================================
# test-todo.sh — LA COMPUERTA. Un solo comando: verde = se puede decir "funciona"
# y pushear; rojo = NO. (JFC 2026-08-26. "Funciona" no es opinión, es un test que
# corre solo y se pone rojo si se rompe — así ninguna de las 12 regresiones vuelve
# en silencio.)
#
# Corre, en orden de más barato a más caro:
#   1) node --check de todos los .js del shell           (sintaxis)
#   2) guards.sh                                          (invariantes de dinero/fechas/puertos)
#   3) check-sw.sh                                        (shell y version.json coinciden)
#   4) test-roster-merge.js                               (reloj lógico del roster, función real)
#   5) harness-team-sync.cjs   (navegador, 2 aparatos)   (baja propaga, tombstone, rev, PIN, switch)
#   6) harness-join-identity.cjs (navegador, 2 aparatos) (normal=device, lord=observador)
#   7) harness-claim-merge.cjs  (navegador, 1 aparato)   (claim/merge NO borra datos locales)
#   8) harness-watchdog.cjs     (navegador, 2 aparatos)  (redundancia de sync: snapshot local, consistencia, snapshot entre pares)
#   9) harness-failsafe.cjs     (navegador, 1 aparato)   (dedup no dobla stock, cola no pierde en silencio, poda de micelio)
#
# Uso:  bash .claude/test-todo.sh
# Sale 0 si TODO VERDE; !=0 si algo falla (y dice qué).
# ============================================================================
set -u
cd "$(dirname "$0")/.." || exit 2
ROJO=0
paso() { echo ""; echo "=== $1 ==="; }
fallo() { echo "  ✗ FALLA: $1"; ROJO=1; }

paso "1/6  node --check (sintaxis de todos los .js de docs/)"
for f in docs/*.js; do
  node --check "$f" 2>/dev/null && echo "  ok  $f" || fallo "sintaxis $f"
done

paso "2/6  guards.sh"
if bash .claude/guards.sh >/tmp/tt_guards.log 2>&1; then
  grep -q "TODO VERDE" /tmp/tt_guards.log && echo "  ok  guards TODO VERDE" || { cat /tmp/tt_guards.log; fallo "guards"; }
else cat /tmp/tt_guards.log; fallo "guards (exit!=0)"; fi

paso "3/6  check-sw.sh (shell == version.json)"
if bash check-sw.sh >/tmp/tt_sw.log 2>&1; then
  grep -q "coinciden" /tmp/tt_sw.log && echo "  ok  sw y version.json coinciden" || { cat /tmp/tt_sw.log; fallo "check-sw"; }
else cat /tmp/tt_sw.log; fallo "check-sw (exit!=0)"; fi

paso "4/6  test-roster-merge.js (reloj lógico, función real)"
if node .claude/test-roster-merge.js >/tmp/tt_roster.log 2>&1; then
  echo "  ok  roster converge"; else cat /tmp/tt_roster.log; fallo "test-roster-merge"; fi

# Los arneses de navegador necesitan el server estático levantado.
PORT=8127
paso "5-8  levantando server estático en :$PORT para los arneses de navegador"
if ! curl -s -o /dev/null "http://localhost:$PORT/index.html" 2>/dev/null; then
  ( cd docs && python3 -m http.server "$PORT" >/tmp/tt_srv.log 2>&1 & )
  for _ in $(seq 1 20); do curl -s -o /dev/null "http://localhost:$PORT/index.html" 2>/dev/null && break; sleep 0.5; done
  SRV_LEVANTADO=1
fi
curl -s -o /dev/null "http://localhost:$PORT/index.html" 2>/dev/null && echo "  ok  server arriba" || fallo "no se pudo levantar el server"

paso "5/6  harness-team-sync.cjs (2 aparatos: baja propaga, tombstone, rev, PIN, switch)"
if node .claude/harness-team-sync.cjs >/tmp/tt_big.log 2>&1; then
  grep -q "TODO VERDE" /tmp/tt_big.log && echo "  ok  $(grep -c '^  ok ' /tmp/tt_big.log) comprobaciones verdes" || { tail -5 /tmp/tt_big.log; fallo "harness-team-sync"; }
else tail -8 /tmp/tt_big.log; fallo "harness-team-sync (exit!=0)"; fi

paso "6/6  harness-join-identity.cjs (normal=device, lord=observador con auditoría)"
if node .claude/harness-join-identity.cjs >/tmp/tt_join.log 2>&1; then
  grep -q "TODO VERDE" /tmp/tt_join.log && echo "  ok  $(grep -c '^  ok ' /tmp/tt_join.log) comprobaciones verdes" || { tail -5 /tmp/tt_join.log; fallo "harness-join-identity"; }
else tail -8 /tmp/tt_join.log; fallo "harness-join-identity (exit!=0)"; fi

paso "7/7  harness-claim-merge.cjs (claim/merge re-apunta identidad SIN borrar datos)"
if node .claude/harness-claim-merge.cjs >/tmp/tt_claim.log 2>&1; then
  grep -q "TODO VERDE" /tmp/tt_claim.log && echo "  ok  $(grep -c '^  ok ' /tmp/tt_claim.log) comprobaciones verdes" || { tail -5 /tmp/tt_claim.log; fallo "harness-claim-merge"; }
else tail -8 /tmp/tt_claim.log; fallo "harness-claim-merge (exit!=0)"; fi

paso "8/8  harness-watchdog.cjs (redundancia de sync: snapshot local, consistencia, snapshot entre pares)"
if node .claude/harness-watchdog.cjs >/tmp/tt_wd.log 2>&1; then
  grep -q "TODO VERDE" /tmp/tt_wd.log && echo "  ok  $(grep -c '^  ok ' /tmp/tt_wd.log) comprobaciones verdes" || { tail -5 /tmp/tt_wd.log; fallo "harness-watchdog"; }
else tail -8 /tmp/tt_wd.log; fallo "harness-watchdog (exit!=0)"; fi

paso "9/9  harness-failsafe.cjs (dedup no dobla stock, cola no pierde en silencio, poda de micelio)"
if node .claude/harness-failsafe.cjs >/tmp/tt_fs.log 2>&1; then
  grep -q "TODO VERDE" /tmp/tt_fs.log && echo "  ok  $(grep -c '^  ok ' /tmp/tt_fs.log) comprobaciones verdes" || { tail -5 /tmp/tt_fs.log; fallo "harness-failsafe"; }
else tail -8 /tmp/tt_fs.log; fallo "harness-failsafe (exit!=0)"; fi

# Apagar el server solo si lo levantó este script.
if [ "${SRV_LEVANTADO:-0}" = "1" ]; then pkill -f "http.server $PORT" 2>/dev/null || true; fi

echo ""
if [ "$ROJO" = "0" ]; then
  echo "================  TODO VERDE — sync y team system tip top.  ================"
  exit 0
else
  echo "################  HAY ROJO — NO se puede decir 'funciona' ni pushear.  ################"
  exit 1
fi
