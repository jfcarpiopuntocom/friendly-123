---
name: ship
description: Publicar reparaciones autorizadas de friendly-123 con aviso, pruebas focalizadas y verificación.
---

# ship — ejecución responsable del fast track JFC
Antes de trabajar: leer AGENTS.md, CLAUDE.md, agent-rules/OPERATING-CONTRACT.md y agent-rules/FAST-TRACK.md.
1. AVISAR a JFC ANTES de actuar. Si se necesita otro shell, avisar número, causa e impacto ANTES de crearlo/publicarlo; la misión ya aprobada continúa tras informar sin nuevas preguntas.
2. Pre-mortem → árbol de problemas → PERT breves. Definir lo que el cliente realmente debe poder hacer. Reproducir problema y proteger copia/rollback.
3. Cambio focalizado compatible; preservar negocio real, fotos, pagos, deudas, comisiones, sync y permisos. No inventar ceros ni borrar historia; no modificar otro producto por asociación.
4. Pruebas rojo-verde y dependencias directas; no inflar recuentos, no ejecutar tests lentos o verificadores prohibidos para JFC, no relajar un guard real para que pase.
5. Si tocó runtime docs/: shell/manifest/SW coherentes; usar fast track actual sin esperas de 33 minutos ni workflows repetidos. Si se precisa nuevo shell, avisar antes.
6. Comprobar publicación en URL y comportamiento específico; PR o merge no prueban adopción por el aparato de Belén.
7. Comunicar «qué puede hacer ya el cliente, enlace, limitación», sin jerga como titular ni pasar PowerShell/merge al propietario.
**Solo archivos .md fuera de docs/**: sin shell, sin publicación ni pruebas del runtime; revisar coherencia, enlaces y lectura final.
**Advertencia expresa de JFC**: «sueles MENTIR, y sueles IMPONERME cosas y que debo CUIDARME MUCHO DE Ti y que NO CONFIONEN TI». Se responde con hechos verificables.
