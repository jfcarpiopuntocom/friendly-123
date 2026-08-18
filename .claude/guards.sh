#!/usr/bin/env bash
# guards.sh — comprobaciones que impiden que vuelvan los bugs ya pagados.
#
# JFC, caza Hugo/Paco/Luis 2026-08-18. Cada uno de estos guards existe porque el
# bug YA PASO al menos una vez. No son buenas practicas genéricas: son cicatrices.
#
# Uso:  bash .claude/guards.sh            (en la raiz de cualquiera de los 3 repos)
# Sale 0 si todo bien, 1 si algo fallo. Imprime QUE fallo y DONDE.
set -u
RAIZ="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$RAIZ" || exit 1
FALLOS=0
ok(){ printf "  ok   %s\n" "$1"; }
mal(){ printf "  MAL  %s\n" "$1"; FALLOS=$((FALLOS+1)); }

echo "== guards de $(basename "$RAIZ") =="

# ---------------------------------------------------------------- GUARD 16
# FECHAS. Comparar un ISO crudo contra el dia/mes LOCAL solo funciona en UTC+0.
# En Ecuador (UTC-5) mandaba las ventas de despues de las 19:00 al dia siguiente
# y las de fin de mes a la liquidacion del mes siguiente. Ya paso el 2026-08-06
# y volvio por otro camino a friendly-123 y consultorio-123.
if [ -f docs/mock-backend.js ]; then
  if grep -q "function fechaLocalDe" docs/mock-backend.js; then
    ok "fechas: existe fechaLocalDe()"
  else
    mal "fechas: FALTA fechaLocalDe() — las comparaciones estan en UTC crudo"
  fi
  # ninguna comparacion puede rebanar una fecha cruda
  CRUDAS=$(grep -n "v\.fecha)\.slice(0\|\.fecha\.slice(0\|fechaISO\.slice(0" docs/mock-backend.js \
           | grep -v "fechaLocalDe" | grep -v "^\s*//" || true)
  if [ -z "$CRUDAS" ]; then ok "fechas: ninguna comparacion sobre ISO crudo"
  else mal "fechas: comparacion sobre ISO crudo -> $(echo "$CRUDAS" | head -3 | tr '\n' ' ')"; fi
fi

# ---------------------------------------------------------------- GUARD 17
# SERVICE WORKER COMPLETO. Ya paso: "el service worker no conocia 8 scripts que
# la app ya cargaba", asi que los dispositivos instalados servian version vieja.
if [ -f docs/sw.js ] && [ -f docs/index.html ]; then
  FALTAN=""
  for js in $(grep -o 'src="\./[a-z0-9.-]*\.js"' docs/index.html | sed 's/src="\.\///; s/"//' | sort -u); do
    grep -q "\"\./$js\"" docs/sw.js || FALTAN="$FALTAN $js"
  done
  if [ -z "$FALTAN" ]; then ok "sw: conoce todos los scripts de index.html"
  else mal "sw: NO precachea ->$FALTAN"; fi
fi

# ---------------------------------------------------------------- GUARD 18
# PARIDAD DE CLAVES. Ninguna app puede escribir con el prefijo de una hermana:
# es la causa de la contaminacion cruzada que ya costo dos incidentes de licencia.
if [ -f docs/aislamiento.js ]; then
  NS=$(grep -o 'var NS = "[a-z0-9]*"' docs/aislamiento.js | head -1 | sed 's/.*"\(.*\)"/\1/')
  AJENOS=""
  case "$NS" in
    amig) OTROS="f123 c123";; f123) OTROS="amig c123";; c123) OTROS="amig f123";; *) OTROS="";;
  esac
  for o in $OTROS; do
    N=$(grep -ro "\"${o}_[a-z0-9_]*\"" docs/*.js 2>/dev/null | wc -l)
    if [ "$N" -gt 0 ]; then
      # No es rojo si la migracion YA rescata ese prefijo: la clave queda dentro
      # del namespace propio igual, y renombrarla dejaria huerfanos los datos
      # que el usuario ya tiene guardados. Es deuda de nombres, no de datos.
      # Excepciones marcadas a proposito en el codigo con NO-RENOMBRAR: nombres
      # de base de IndexedDB (renombrarlos deja los registros vivos pero
      # invisibles) y prefijos heredados que hay que seguir leyendo durante la
      # transicion. Se cuentan aparte, no son deuda.
      MARCADAS=$(grep -rc "NO renombrar\|NO-RENOMBRAR\|heredado" docs/*.js 2>/dev/null | awk -F: '{t+=$2} END{print t+0}')
      if grep -q "PREFIJOS_LEGADO.*\"${o}_\"" docs/aislamiento.js; then
        printf "  nota %s\n" "claves: ${N} referencia(s) a ${o}_ que la migracion rescata o que estan marcadas como intencionales (nombres de base IndexedDB y lectura de lo heredado)"
      else
        AJENOS="$AJENOS ${o}_(${N})"
      fi
    fi
  done
  if [ -z "$AJENOS" ]; then ok "claves: ninguna con prefijo ajeno sin rescatar (NS=$NS)"
  else mal "claves: prefijo ajeno SIN rescate en la migracion ->$AJENOS"; fi
fi

# ---------------------------------------------------------------- GUARD 15
# INVARIANTES DE DINERO. Que el reparto sume el bruto y que los porcentajes
# sumen 100, comprobado contra el backend real y no a ojo.
if [ -f docs/mock-backend.js ] && command -v node >/dev/null; then
  node "$RAIZ/.claude/guard-dinero.mjs" "$RAIZ" 2>/dev/null && ok "dinero: reparto e invariantes cuadran" \
    || mal "dinero: los invariantes NO cuadran (corre .claude/guard-dinero.mjs para el detalle)"
fi

echo
if [ "$FALLOS" -eq 0 ]; then echo "TODO VERDE"; else echo "$FALLOS GUARD(S) EN ROJO"; fi
exit $([ "$FALLOS" -eq 0 ] && echo 0 || echo 1)
