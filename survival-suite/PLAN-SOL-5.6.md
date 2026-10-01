# Plan para GPT-5.6 Sol — matar licenseKey y montar OAuth 2.1 + entitlement

## Como trabaja Sol 5.6 (guia de OpenAI, jul-2026) y como lo aprovechamos
- Prompts cortos y por resultado. OpenAI midio +10-15% en evals y 41-66% menos tokens al podar.
  Nada de bloques de "persiste", "piensa paso a paso" ni MAYUSCULAS de ansiedad: Sol ya lo hace.
- Estructura: Rol, Meta, Criterios de exito, Restricciones, Herramientas, Salida, Cuando parar.
- Esfuerzo: `medium` por defecto; `high` para el diseno OAuth; `xhigh` solo para la revision de
  seguridad final. Nunca subirlo "por las dudas".
- Pedir evidencia: salida de comandos y citas de archivo; rotular Oficial / Independiente / Inferencia.
- Cercar el alcance: sin refactors, sin dependencias nuevas salvo la libreria OAuth elegida.
- Punto de control: si tras 8 pasos no hay causa raiz, reportar y parar; no adivinar.

## Tandas (una sesion de Sol por tanda; cada una termina con CI verde)
1. Inventario (effort medium): listar cada tool, su schema y si pide `licenseKey`. Sin cambios.
2. Free limpio (medium): tools SSS y Stock Semaphore sin auth, anotaciones read/destructive/openWorld,
   output schema, test de que el servidor no escribe el request body en ningun log.
3. OAuth 2.1 (high): metadata de recurso protegido, PKCE, scopes minimos (`entitlement:read`),
   validacion del access token, entitlement resuelto en el servidor. Tests: sin token, token vencido,
   token sin entitlement (mensaje sobrio, sin precio ni "upgrade"), token valido.
4. Borrar `licenseKey` (medium): de schemas, widget, textos y tests. Grep final = cero.
5. Revision de seguridad y cumplimiento (xhigh): checklist de la HARDRULE seccion 10, punto por punto
   con evidencia.

## Prompt base para Sol (copiar en cada tanda, cambiando solo Meta)
```
Rol: ingeniero del servidor MCP de Survival Suite (plugin de ChatGPT).
Meta: <tanda N>.
Exito: tests nuevos y existentes en verde; grep de licenseKey en schemas = 0 (desde tanda 4);
ningun request body financiero persistido ni logueado.
Restricciones: cumplir las reglas vigentes de OpenAI para plugins (auth, privacy, app guidelines);
dentro del plugin cero precios, planes, checkout o "upgrade"; no pedir secretos como input;
no guardar cifras financieras del usuario; no tocar lo que la tanda no nombra.
Herramientas: terminal y tests del repo; docs oficiales developers.openai.com si dudas de una regla.
Salida: diff, comandos corridos con su salida, y una tabla Oficial/Inferencia de cada regla aplicada.
Para: al cumplir el exito, o tras 8 pasos sin avance (reporta lo hallado).
```
