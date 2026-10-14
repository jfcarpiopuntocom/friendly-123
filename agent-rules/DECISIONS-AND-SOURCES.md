# Razonamiento y procedencia de la reforma
Referencias externas: [Anthropic — CLAUDE.md](https://claude.com/resources/articles/using-claude-md-files), [Anthropic — Claude Code](https://www.anthropic.com/engineering/claude-code-best-practices), [OpenAI — AGENTS.md](https://github.com/openai/codex/blob/main/codex-rs/protocol/src/prompts/base_instructions/default.md), [Google SRE](https://sre.google/sre-book/service-best-practices/). Principios: contexto pequeño, reglas por alcance, ejemplos medibles, comprobación del resultado, guardas reversibles y aprendizaje desde fallas. Ninguna fuente tiene autoridad para reinterpretar instrucciones de JFC.

## Contradicciones eliminadas del texto activo
- `CLAUDE.md` anterior pedía suite completa / 33 min / canario obligatorio; hoy gobierna hotfix del 14/oct.
- «cambio a archivo» no es «cambio a runtime»: .md fuera de docs/ NO genera shell.
- «avísame» no se convierte en «no lo hagas» ni «pregunta permiso por cada paso».
- «he abierto el PR» no se declara «el cliente ya tiene la reparación».
- Un test aislado verde no demuestra descarga real de PDF, escritura de dashboard o adopción.
- El archivo remoto de skill no instala nada en una laptop ajena.
- La regla empresarial de avisar al cambiar un número de versión no debe perderse tras una decisión técnica rápida.

## Prueba editorial mínima
Comprobar manualmente escenarios 01,02,03,05,06,15,17,18,20; preservar original íntegro en archive/; chequear enlaces relativos; comparar diff con `docs/`, `.github/workflows/` y versiones: no deben estar tocados.
