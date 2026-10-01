---
name: jfc-context-reranker
description: Re-rank broad candidate context for JFC projects before reading full files. Use when a task spans Notion, GitHub, Drive/Files, prior notes, or many candidate sources.
---

# JFC Context Re-Ranker

1. Identify project and intent from the current user request. Current explicit user instructions are mandatory constraints.
2. Retrieve broadly from the relevant connectors/tools.
3. Convert results to `.ai/reranker` candidate JSON.
4. If there are more than 8 candidates, run the reranker in `deep` mode; use `forensic` for bugs/deploy/incidents.
5. Read full content only for the top ranked canonical sources and mandatory constraints.
6. Surface contradictions and superseded sources; never silently blend them.
7. Memory is not canonical when repo/Notion contain newer project state.
8. Before completion claims use verification-before-completion. For bugs use systematic-debugging first.
