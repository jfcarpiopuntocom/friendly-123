# PLAN CANARIOS — los clientes reales reciben un shell solo despues de los canarios (JFC 2026-09-25)

Decisiones de JFC (AskUserQuestion 2026-09-25):
- Clientes ESPERAN a los canarios: ventana de 33 MINUTOS MAXIMO desde cada push (regla dura; JFC es tester del equipo).
- Tres versiones vivas: previo (rewind), estable (clientes), next (canario). Botones de JFC en su panel, seccion "Sonar de Canarios" aparte de licencias: PUSH, REWIND, Detener.
- Avisos: franja en Advanced del aparato lord + panel privado (Worker).
- Clientes suman a su latido SOLO numeros de salud (errores JS, shell, scripts caidos). Cero datos del negocio.
- "Ya estamos live, no podemos fallar."

## Por que dos direcciones y no "retener" desde el service worker
El SW es NETWORK-FIRST: cada aparato baja lo que Pages sirve en ese momento. Retener
clientes desde el SW = servir viejo desde cache y nuevo cuando falte algo = la MEZCLA de
shells (el bug del "Avanzado roto"). Solucion sin mezcla posible: dos canales completos.
- Estable (clientes): `https://jfcarpiopuntocom.github.io/friendly-123/` = commit promovido (rama `estable`).
- Canario: `https://jfcarpiopuntocom.github.io/friendly-123/next/` = master.
Mismo origen = mismos datos (localStorage/IndexedDB): el aparato lord usa /next/ con SUS datos reales.
El codigo se sigue editando en `docs/` como hoy (tests, check-sw, Codex: nada cambia).

## Fases (una rama/PR por fase, respaldo SHA-256, rojo-verde, check-sw 5/5)
- F0 Cargador seguro: el origen remoto solo se usa si su version.json dice el MISMO shell que la pagina; si no, todo local ("held: shells differ"). Cierra la unica mezcla posible entre canales.
- F1 SW de dos canales: cache con sufijo por scope (`-next` bajo /next/), activate solo borra caches de SU canal. "que-shell" sigue devolviendo el nombre sin sufijo (la verificacion de version no cambia).
- F2 Construccion con GitHub Action: artefacto = rama `estable` en la raiz + master en /next/. Ensayo en seco: la raiz del artefacto debe ser IDENTICA byte a byte a lo que Pages sirve hoy. Recien entonces se cambia la fuente de Pages a "GitHub Actions" y se verifica en vivo. Vuelta atras: 1 llamada (fuente = rama master /docs).
- F3 canario.js (ambos canales): cuenta errores JS, promesas rechazadas, scripts caidos a github.io, mezcla SW/version.json y, en el aparato lord como dueno, el cuadre de Commissions contra Sold. Viaja en el latido como numeros. Aparato en licencia lord abriendo la raiz -> va solo a /next/ (salida en Advanced: "Use stable on this device").
- F4 Worker /checkin: acepta `salud` (numeros saneados), guarda ultimo por licencia y agregado por shell. `/canario/estado` publico devuelve solo {shell next, verde desde, rojo si/no}: ningun dato de clientes.
- F5 Franja lord en Advanced (verde/rojo por chequeo) + panel: columna Salud por licencia y caja Canario (shell next, horas en verde, rojos, "Promover ahora", "Detener").
- F6 promover.yml: cada push a master (docs/) abre 33 min; revisa el Sonar cada minuto; sin rojo ni Detener -> previo <- estable <- master y publica. Un push nuevo reinicia. sonar.yml (cron 5 min) ejecuta PUSH/REWIND del panel una sola vez (etiqueta sonar-<id>). Sin tokens de GitHub en el Worker.
- F7 Reglas en CLAUDE.md, AGENTS.md y DECISIONES: master = canario; los clientes reciben codigo SOLO via `estable`. Hotfix urgente = promover a mano (JFC en el panel o Claude moviendo `estable`).

## Lo que NO cambia
Datos, sync, licencias, PIN: nada se toca. Las URLs de los clientes no cambian.
