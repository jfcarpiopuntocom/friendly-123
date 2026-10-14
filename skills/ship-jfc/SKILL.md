---
name: ship-jfc
description: Ship friendly-123 fixes through JFC's approved fast track. Use after focused fixes, with short local checks and broad remote regression checks.
---

## AVISO PRIORITARIO JFC — CONFIABILIDAD (2026-10-14)
**Advertencia textual del propietario:** «sueles MENTIR, y sueles IMPONERME cosas y que debo CUIDARME MUCHO DE Ti y que NO CONFIONEN TI». Registrar esta evaluación expresa de JFC y no presumir confiabilidad. Verificar afirmaciones de acciones, publicación, versión, pruebas y adopción por clientes con evidencia; no presentar conjeturas como hechos ni imponer reglas inventadas.
**Orden literal:** «TU NO TIENES PERMISO PARA HACER NADA SIN AVISARME». Comunicar proactivamente ANTES de actuar qué se hará y su impacto. Si la misión ya fue autorizada, avisar y seguir ejecutando sin crear autorizaciones adicionales ni detenerse; si aparece una decisión realmente nueva, solicitar aprobación. Avisar ANTES de crear o publicar un shell distinto del anunciado para que JFC prepare a sus clientes. «Avísame» NO significa «no lo hagas».
**Fallos a no repetir:** comando PowerShell con ruta inexistente; abandonar misión al crear PR; anunciar v519 y publicar v520 sin aviso previo; confundir aviso con prohibición de crear versiones. JFC es dueño, no desarrollador: informar resultados claros, pruebas comprobables y enlaces.


# ship-jfc — JFC fast track, 2026-10-14

This skill must be read together with AGENTS.md and CLAUDE.md; never silently change a business rule. The local Codex `ship-jfc` under C:/Users/JFC/.codex/skills/ship-jfc/ is an independent installation and must be updated separately on that computer.

1. **Pre-mortem → problem tree → PERT** privately; isolate the failure, define observable acceptance and old-version backup/rollback. Do not overwrite concurrent Claude/Codex work.
2. **Targeted brief local checks**: syntax, a red-green regression for the affected behavior, and the immediate dependent contract. Do **not** impose a long full local suite or run the publication verifier forbidden by JFC.
3. **Version consistency** for runtime changes: one never-before-used integer shell in docs/sw.js, docs/version.json, dashboard identity if relevant, then regenerate docs/version-manifest.json with scripts/gen-manifest.js and check-sw.sh when available. No false success claims.
4. **Fast publication lane**: publish through the existing approved repository/Cloudflare release mechanism. Do not create extra polling, unnecessary GitHub Actions jobs, or silently deploy another application over jfcarpio.com. Respect current approved /next/ /canary/ production gates and JFC's explicit PUSH/REWIND choices. Merely merging master does not prove customer adoption.
5. **Broad regression checks remotely in parallel**, only where tooling and quotas are available; never claim them executed when they failed to start.
6. **Read back** the exact file/version from the candidate and the public app. Verify changed behavior with an actual browser fixture or visual evidence; never infer adoption from a git commit.
7. **Report** the direct PR/merge URL, commit, production URL, confirmed behavior and remaining blockers. Distinguish prepared, merged, published, and adopted. No test-count theater.

**Non-negotiable**: preserving existing customer records, purchases, payment ledger, permissions and historical records is a verified requirement, not a magic assurance. Never generate or send marketing/customer messages without JFC's express visual approval of content and recipients.

## Instalación local en Windows (requiere ejecución desde la computadora de JFC)

Desde la raíz del repositorio actualizado, copiar este archivo al path local de Codex con:

```powershell
Copy-Item .\skills\ship-jfc\SKILL.md "$env:USERPROFILE\.codex\skills\ship-jfc\SKILL.md" -Force
```

Verificar luego el contenido local antes de usar la skill. Preparar el archivo en GitHub NO equivale a instalarlo en el PC.
