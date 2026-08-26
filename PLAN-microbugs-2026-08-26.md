# PLAN — Microbugs de trabajo propio (últimas 24h)
**Fecha:** 2026-08-26  
**Rama:** claude/hybrid-proxy-tunnel-sync-ymq8d6  
**Commits revisados:** bc69a0f (UX sweep → PR #35) y 6587811 (team sync hardening → PR #36)

---

## Bugs hallados (12) — ordenados por riesgo

### HIGH

#### B-01 — Colisión de PIN revela el dígito real en pantalla  
**Archivo:** `docs/avanzado-extra.js` — listener `oc-pin-colision`  
**Problema:** El mensaje dice `"PIN ${d.pin || "???"}"` — muestra los 3 dígitos del PIN de un miembro del equipo remoto a cualquiera que vea la pantalla en ese momento.  
**Impacto:** Fuga de credencial; un tercero en el local puede leer el PIN de un colega.  
**Fix:** Omitir el número: `"uses that PIN"` sin mostrar el valor.  
**Verificación:** Simular `oc-pin-colision` con `window.dispatchEvent(new CustomEvent("oc-pin-colision", {detail:{nombre:"Ana",pin:"777",id:"x"}}))` y confirmar que el mensaje no contiene "777".

---

#### B-02 — Race condition: advertencia de colisión se borra antes de que el dueño la lea  
**Archivo:** `docs/avanzado-extra.js`  
**Problema:** `oc-equipo-sync` → `renderEmpleados()` reconstruye el panel y limpia `#oc-emp-msg`. Si llega una segunda ráfaga de sync (ej. otro chunk de catálogo) milisegundos después, el aviso de colisión desaparece antes de que el usuario lo vea.  
**Impacto:** El dueño no se entera del conflicto de PINs; dos miembros quedan con el mismo PIN en algún dispositivo.  
**Fix:** Al reconstruir el panel, rescatar el texto de `#oc-emp-msg` y restaurarlo si era un aviso de colisión (detectar por color rojo / clase).  
**Verificación:** Disparar `oc-pin-colision` y luego `oc-equipo-sync` en ≤ 500 ms; el mensaje de colisión sigue visible tras el segundo evento.

---

### MEDIUM

#### B-03 — `renderEmpleados` como listener async sin catch → promesa silenciosa  
**Archivo:** `docs/avanzado-extra.js`, línea del `addEventListener("oc-equipo-sync", renderEmpleados)`  
**Problema:** `renderEmpleados` es `async`. Pasada directamente como callback, su Promise nunca se atrapa; cualquier error interno queda silenciado y no llega a DevTools.  
**Fix:** `window.addEventListener("oc-equipo-sync", () => renderEmpleados().catch(() => {}));`  
**Verificación:** Lanzar un error intencional dentro de `renderEmpleados` y confirmar que aparece en consola (no desaparece en silencio).

---

#### B-04 — `alert()` bloqueante cuando la colisión llega fuera de la sección Team  
**Archivo:** `docs/avanzado-extra.js` — listener `oc-pin-colision`  
**Problema:** Si `#oc-emp-msg` no existe (usuario no está en la sección "Team"), el código cae al `alert(msg)`. El `alert()` bloquea el hilo UI en el peor momento (el usuario puede estar en medio de una venta).  
**Fix:** Usar un toast/snackbar no bloqueante, o encolar el aviso para cuando abra la sección Team.  
**Verificación:** Con el panel de Equipo cerrado, disparar `oc-pin-colision`; no debe aparecer `alert()` nativo.

---

#### B-05 — Strings en español en app inglesa (i18n ausente)  
**Archivo:** `docs/avanzado-extra.js` — fila de cambio de PIN  
**Problema:** `"Nuevo PIN para ${escHtml(u.nombre)}:"` y `"PIN actualizado."` están hardcodeados en español. friendly-123 es la app en inglés; todo texto visible debe pasar por `window.t()`.  
**Fix:** Reemplazar con `window.t("Nuevo PIN para") + " " + escHtml(u.nombre) + ":"` (o añadir las claves a `i18n.js`).  
**Verificación:** Con idioma EN activo, el label del input dice "New PIN for…" y la confirmación dice "PIN updated."

---

### LOW

#### B-06 — No debounce en `renderEmpleados` como listener de `oc-equipo-sync`  
**Archivo:** `docs/avanzado-extra.js`  
**Problema:** Un sync de catálogo con N chunks puede disparar `oc-equipo-sync` varias veces en rápida sucesión. Cada disparo re-fetcha y reconstruye la tabla completa — parpadeo visual y trabajo redundante.  
**Fix:** Mismo patrón que `difundirEquipo`: debounce de 300 ms antes de llamar `renderEmpleados`.  
**Verificación:** 5 eventos `oc-equipo-sync` en 100 ms → solo 1 render (verificar con `console.count` temporal).

---

#### B-07 — POST /api/usuarios: demote silencioso sin registro en `mov()`  
**Archivo:** `docs/mock-backend.js` — guard de POST  
**Problema:** Cuando un admin intenta crear otro admin, el guard lo demota silenciosamente a `"empleado"`. No se registra en el log de actividad (`mov()`). El dueño no puede auditar que alguien intentó escalar privilegios.  
**Fix:** Añadir `mov("admin-demotion-on-create", {...})` cuando `body.rol === "admin"` y `callerRol !== "dueno"`.  
**Verificación:** POST con `{rol:"admin"}` desde sesión admin → log muestra entrada de demote.

---

#### B-08 — Modal de rotación de licencia dice "Yes, change the code" — texto desactualizado  
**Archivo:** `docs/avanzado-extra.js` — botón `oc-sync-rotar`  
**Problema:** En PR #35 cambié el label del botón a "Rotate team license" pero el `confirm()` / modal de confirmación sigue diciendo el texto viejo sobre "change the code". El usuario ve inconsistencia.  
**Fix:** Actualizar el texto del `confirm()` para que diga "Rotate the team license? All devices will need to reconnect."  
**Verificación:** Hacer clic en "Rotate team license" → el diálogo dice "Rotate…" no "change the code".

---

#### B-09 — `↺` (U+21BA) puede renderizarse como cuadro en Android antiguo  
**Archivo:** `docs/avanzado-extra.js` — botón "↺ Save checkpoint now"  
**Problema:** U+21BA está fuera del rango seguro en algunas fuentes de Android ≤ 8. Se ve como □.  
**Fix:** Usar `⟳` (U+27F3, bien soportado) o texto plano "↺" con fallback `font-family` que lo incluya, o simplemente el texto sin ícono.  
**Verificación:** DevTools → Remote Devices o screenshot en Android 7/8 emulado; el botón se ve correcto.

---

#### B-10 — `scrollIntoView` de log de actividad scrollea la raíz, no el contenedor  
**Archivo:** `docs/avanzado-extra.js` — sección Activity log  
**Problema:** `element.scrollIntoView()` scrollea `<body>` / `<html>`, no el panel interno con `overflow-y:auto`. El elemento puede quedar fuera de vista dentro del panel.  
**Fix:** Usar `panel.scrollTop = element.offsetTop - panel.offsetTop` o `element.scrollIntoView({block:"nearest"})` dentro del contenedor scroll correcto.  
**Verificación:** Con 50+ entradas en el log, la más reciente queda visible sin scrollear la página.

---

#### B-11 — Botones de nav añadidos por MutationObserver no reciben estado activo inicial  
**Archivo:** `docs/avanzado-extra.js` — `activo()` y observer de sección  
**Problema:** `activo()` se llama al montar los chips iniciales. Si un MutationObserver añade un chip después (sección lazy), no recibe la clase activa aunque su sección sea la actual.  
**Fix:** Al añadir el chip en el observer, llamar `activo()` sobre él inmediatamente.  
**Verificación:** Abrir la app directamente en una sección lazy; el chip correspondiente queda marcado como activo.

---

#### B-12 — Error de PATCH sólo en inglés (no i18n)  
**Archivo:** `docs/mock-backend.js` — guard de PATCH  
**Problema:** `"Only the owner can edit an admin's name, PIN or active status."` está hardcodeado. Las respuestas de error de la API interna deben ser neutras (clave i18n) o aceptar que el backend es agnóstico al idioma — pero es inconsistente con el estilo del resto del archivo.  
**Impacto:** Cosmético; sólo aparece en DevTools si alguien inspecciona.  
**Fix:** Mínimo: añadir un comentario `// i18n pendiente`; mejor: usar una clave de error que la UI traduzca.  
**Verificación:** Ninguna automatizable; es cosmética.

---

## Qué NO entra en este plan

- Refactors de `renderEmpleados` más allá del debounce y el catch.
- Cambios al sistema de sync relay (Cloudflare Worker) — está fuera de este repo.
- Ports a amigable-123 o consultorio-123 — los bugs se arreglan aquí primero.
- Revisión de `crypto-store.js` o `email-recovery.js` — no tocados en las últimas 24h.

---

## Orden de ejecución

1. B-01 (PIN en colisión — fuga de dato)
2. B-02 (race condition colisión+sync — el más complejo del lote)
3. B-03 (async sin catch — debe ir antes de B-06 que depende del mismo listener)
4. B-04 (alert bloqueante)
5. B-05 (strings ES en app EN)
6. B-06 (debounce render)
7. B-07 (audit trail POST demote)
8. B-08 (modal rotación texto viejo)
9. B-09 (↺ Android)
10. B-10 (scrollIntoView)
11. B-11 (observer nav chips)
12. B-12 (i18n error PATCH — cosmético, puede omitirse si el tiempo aprieta)

Push después de cada grupo de 3-4 bugs, no al final.

---

*Plan escrito 2026-08-26 — listo para aprobación de JFC antes de implementar.*
