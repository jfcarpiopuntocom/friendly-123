# RUNBOOK — Re-enganchar "ovejas perdidas" (dispositivos rogue) — 2026-08-27

**Problema:** un dispositivo (PC, iPhone, tablet) quedó "rogue": su registro en la
KV de Cloudflare tiene una licencia trunca/vieja/ajena (ej. `F123-5HSG-JENF`, solo
2 grupos) o vacía, así que no se une a su licencia canónica ni a sus hermanos. El
síntoma que ve JFC: "mi licencia desapareció" / "mi tienda no se une".

**Causa raíz (verificado 2026-08-27):** el dispositivo reportó un código inválido
al Worker y la KV lo guardó. Antes, la autocuración del heartbeat lo empeoraba
recuperando la licencia desde la sala de sync (revert). Eso ya se quitó.

---

## Diagnóstico (leer la KV real)

```bash
# Listar instancias activas
npx wrangler kv key list --namespace-id f1599c69c4174cc2b38dd125c18ee3df --remote
# Ver un registro
npx wrangler kv key get "inst:<instanceId>" --namespace-id f1599c69c4174cc2b38dd125c18ee3df --remote
# Ver historial (reversible)
npx wrangler kv key get "hist:<instanceId>" --namespace-id f1599c69c4174cc2b38dd125c18ee3df --remote
# Ver papelera (borrados recuperables)
npx wrangler kv key get "borrado:<instanceId>" --namespace-id f1599c69c4174cc2b38dd125c18ee3df --remote
```

Una licencia F123 válida tiene 17 caracteres: `F123-XXXX-XXXX-XXXX-XXXXX`.
Si el registro tiene menos (ej. `F123-5HSG-JENF`), es trunca → rogue.

---

## Re-enganchar (2 lados)

### Lado servidor — re-apuntar el registro KV a la licencia canónica
**Opción A (recomendada, desde el panel):** abrir `panel.html` → fila del
dispositivo → botón **"Re-enganchar"** → pegar la licencia canónica. Llama a
`POST /licencias/:id/reapuntar` (master), reversible por historial.

**Opción B (CLI):**
```bash
# 1. Leer el registro actual
npx wrangler kv key get "inst:<instanceId>" --namespace-id f1599c69c4174cc2b38dd125c18ee3df --remote
# 2. Editar licenseCode a la canónica y subirlo (con historial manual si se quiere)
npx wrangler kv key put "inst:<instanceId>" --path <archivo.json> --namespace-id f1599c69c4174cc2b38dd125c18ee3df --remote
```

### Lado dispositivo — unir los datos locales
El panel NO puede tocar el localStorage del aparato. JFC (o el dueño) debe, en el
dispositivo: **Avanzado → claim & merge** y entrar la licencia canónica. Eso fija
`licenseCode` + `syncCode` + sala en el mismo código y fusiona los datos (add-only)
cuando ambos aparatos apuntan a la misma sala y reconectan.

---

## Reglas de oro (lecciones 2026-08-27)

1. **La licencia es la que el dueño pone deliberadamente.** Nada debe cambiarla
   en silencio. NO hay autocuración de licencia/heartbeat. Protección sí (nunca
   enviar `""`, nunca pisar un valor bueno con basura), autocuración no.
2. **Reversible siempre:** todo re-apunte pasa por el historial (`hist:`/`borrado:`).
3. **Confirmar la licencia canónica con JFC antes de escribir la KV.** En este
   caso JFC eligió `F123-A6YK-6V1J-BF2A-S2J24` (la que tenía anotada), no la
   `F123-HPN2-...` que mencionó al inicio.
4. **Dos tiendas del mismo dueño = misma licencia canónica.** James Bond Store
   (PC) y 007 Store (iPhone) son de JFC (jfcarpio@gmail.com) y deben apuntar a la
   misma licencia para unirse entre sí.

---

## Futuro (tier $20)
Automatizar el helpdesk con Abacus Assistant: tickets, ayudar a la gente a
re-enganchar sus ovejas. Por ahora la herramienta es el botón del panel.
