// worker.js — license ping for friendly-123 / amigable-123.
// Handles both products. Endpoints:
//   POST /checkin  — public, called on activation & login (body.accion = "register"|"login")
//   POST /register — alias for /checkin (legacy)
//   GET  /licencias                    — requires X-Master-Key header
//   POST /licencias/:id/estado         — requires X-Master-Key header
//
// SCOPE, ON PURPOSE (JFC 2026-07-16): this worker exists ONLY to register/
// license-check instances and let JFC reach an owner via the WhatsApp number
// they optionally register. It does NOT and must NOT store business data
// (products, sales, backups). NO CLOUD is core to the product manifesto —
// local-first, no server, no SaaS, no POS. A "cloud backup" feature was
// built and then ripped out the same day for contradicting this. If a
// future request smells like "store the user's data on our server", stop
// and ask before building — see feedback_no_cloud_manifiesto memory.
//
// Deploy:
//   1. wrangler kv:namespace create LICENCIAS     → paste the ID below in wrangler.toml
//   2. wrangler secret put MASTER_KEY             → choose any password, paste in panel.html Config
//   3. wrangler deploy

function cors(resp) {
  resp.headers.set("Access-Control-Allow-Origin", "*");
  resp.headers.set("Access-Control-Allow-Headers", "Content-Type, X-Master-Key");
  // FIX (homologado de amigable-123, JFC 2026-07-28/29): DELETE was missing
  // here. The browser sends a preflight OPTIONS before any DELETE (because
  // of the custom X-Master-Key header), and if this list doesn't include
  // DELETE, the preflight rejects it before it ever reaches the endpoint —
  // shows up in the panel as "failed to fetch", which has nothing to do
  // with the network: it's CORS blocking in the browser.
  resp.headers.set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  return resp;
}
function json(obj, status = 200) {
  return cors(new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } }));
}
function requireMasterKey(req, env) {
  const k = req.headers.get("X-Master-Key") || "";
  return env.MASTER_KEY && k === env.MASTER_KEY;
}

/* ─────────────────────────────────────────────────────────────────────
   VERSION CONTROL FOR LICENSES (homologado de amigable-123, JFC 2026-07-28)

   Two real incidents in amigable-123: JFC's own name went blank once, and a
   customer's email reverted to an old value after a KV hiccup. Neither was
   bad luck — KV only ever held the latest state, with no way to see or
   undo the step before it.

   guardarConHistorial() is the ONLY place that should write to
   `inst:<instanceId>`: before overwriting the record, it pushes the current
   state onto `hist:<instanceId>` (JSON array, newest first, capped at 30
   versions so a free-tier KV doesn't grow unbounded). With that, ANY
   accidental overwrite — a bug, a bad deploy, a fat finger in the panel —
   is reversible via /licencias/:id/historial + /licencias/:id/restaurar. */
const HISTORIAL_TOPE = 30;
async function guardarConHistorial(env, instanceId, registroNuevo) {
  const key = `inst:${instanceId}`;
  const anteriorRaw = await env.LICENCIAS.get(key);
  if (anteriorRaw) {
    try {
      const histKey = `hist:${instanceId}`;
      const histRaw = await env.LICENCIAS.get(histKey);
      const hist = histRaw ? JSON.parse(histRaw) : [];
      hist.unshift({ ts: Date.now(), registro: JSON.parse(anteriorRaw) });
      await env.LICENCIAS.put(histKey, JSON.stringify(hist.slice(0, HISTORIAL_TOPE)));
    } catch (_) { /* history must never block the real save */ }
  }
  await env.LICENCIAS.put(key, JSON.stringify(registroNuevo));
}

/* ─────────────────────────────────────────────────────────────────────
   LICENSE STATES (model defined by JFC, 2026-07-28)

     minima     Free forever, for anyone, no permission needed.
                Caps: 25 products, 100 sales per month (resets monthly)
                and 1 employee. Default state for every new instance.
     full       Unlimited. JFC flips it from the panel when a customer pays.
     bloqueada  Cut off for abuse or non-payment. The only punitive state.

   "observada" was removed: there was no point watching someone who is on a
   legitimate free plan. Old records carrying it read as "minima".

   normalizarEstado() keeps records written BEFORE this change working with
   no migration. It runs on read, on list and on write, so KV cleans itself
   as instances check in. Do NOT drop it until no old names remain. */
const MAPA_ESTADOS_VIEJOS = {
  activa: "full",
  limitada: "minima",
  observada: "minima",
};
const ESTADOS_VALIDOS = ["minima", "full", "bloqueada"];
function normalizarEstado(e) {
  const v = String(e || "").toLowerCase();
  if (ESTADOS_VALIDOS.includes(v)) return v;
  // Unknown or empty degrades to the free plan, never to blocked:
  // when in doubt we give service, we do not punish.
  return MAPA_ESTADOS_VIEJOS[v] || "minima";
}

async function handleCheckin(req, env) {
  // Hardening (2026-07-16): endpoint publico — cap de tamano y validacion de formato
  // para que un bot no pueda llenar el KV con basura ni payloads gigantes.
  const raw = await req.text();
  if (raw.length > 4096) return json({ error: "Payload too large" }, 413);
  let body;
  try { body = JSON.parse(raw); } catch (_) { return json({ error: "Invalid JSON" }, 400); }
  const instanceId = String(body.instanceId || "").slice(0, 120);
  if (!instanceId) return json({ error: "Missing instanceId" }, 400);
  // instanceId legitimo: uuid o token alfanumerico corto (el cliente genera uuid/base36)
  if (!/^[a-zA-Z0-9-]{6,120}$/.test(instanceId)) return json({ error: "Invalid instanceId" }, 400);

  const ip = req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for") || "";
  const existenteRaw = await env.LICENCIAS.get(`inst:${instanceId}`);
  const existente = existenteRaw ? JSON.parse(existenteRaw) : {};

  // Determine product
  const producto = body.producto === "amigable" ? "amigable-123" : "friendly-123";

  const registro = {
    instanceId,
    producto,
    // FIX (homologado de amigable-123, JFC 2026-07-28): used "!= null" —
    // a passive heartbeat sending "" (which IS != null) silently wiped a
    // value the owner had already saved. checkin is automatic, not
    // deliberate: it must never be able to blank a field, only fill it in
    // when empty or bring a new non-empty value. Deliberately clearing a
    // field is the job of an explicit panel action (editar-correo).
    nombreNegocio: body.nombreNegocio || existente.nombreNegocio || "",
    email: body.email || existente.email || "",
    licenseCode: body.licenseCode || existente.licenseCode || "",
    // Mejora #5 (JFC 2026-07-16): telefono de contacto del dueno, para el
    // link clickeable a wa.me en panel.html. Contacto deliberadamente
    // unidireccional (JFC -> dueno) — ver copy en avanzado-extra.js.
    whatsapp: (body.whatsapp ? String(body.whatsapp).replace(/\D/g, "").slice(0, 15) : "") || existente.whatsapp || "", // Fix-11: strip non-digits so wa.me link always works; never blanks an already-saved whatsapp
    nombre: body.nombre || existente.nombre || "",
    apellido: body.apellido || existente.apellido || "",
    cedula: body.cedula || existente.cedula || "",
    // Every new instance starts on "minima": the free plan is the floor,
    // not a punishment. JFC raises it to "full" from the panel when paid.
    estado: normalizarEstado(existente.estado),
    ip,
    activatedAt: existente.activatedAt || (body.activatedAt ? body.activatedAt : null),
    firstSeen: existente.firstSeen || Date.now(),
    lastSeen: Date.now(),
    lastAccion: body.accion || "checkin",
  };
  await guardarConHistorial(env, instanceId, registro);
  return json({ ok: true, estado: registro.estado });
}

// /recover-pin — envía el PIN del dueño a su correo vía Resend.
// NO almacena el PIN en ningún lado. Recibe { email, pin, instanceId },
// valida el instanceId contra KV (anti-abuso leve), manda el correo y listo.
// Si RESEND_API_KEY no está configurado, devuelve { enviado: false } y el
// cliente cae al fallback en pantalla — sin error fatal.
async function handleRecoverPin(req, env) {
  const raw = await req.text();
  if (raw.length > 512) return json({ error: "Payload too large" }, 413);
  let body;
  try { body = JSON.parse(raw); } catch (_) { return json({ error: "Invalid JSON" }, 400); }

  const email = String(body.email || "").slice(0, 240).trim();
  const pin   = String(body.pin   || "").slice(0, 3).trim();
  const instanceId = String(body.instanceId || "").slice(0, 120).trim();

  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: "Email inválido" }, 400);
  if (!/^\d{1,3}$/.test(pin)) return json({ error: "PIN inválido" }, 400);

  // Anti-abuso (JFC 2026-07-22). Dos blindajes, ambos fail-open para NUNCA
  // romper una recuperación legítima si el KV tiene un hipo:
  //   1) El correo destino es el REGISTRADO en KV para esa instancia, no el
  //      que venga en el request. Sin esto, cualquiera con un instanceId
  //      válido podía usar el endpoint como relay de spam hacia direcciones
  //      ajenas (gastando además la cuota de Resend). Si la instancia aún no
  //      tiene correo guardado, caemos al del request (primer registro).
  //   2) Rate-limit leve por instancia (5/hora) con contador en KV con TTL.
  let emailDestino = email;
  if (instanceId && env.LICENCIAS) {
    let reg = null;
    try { const r = await env.LICENCIAS.get(`inst:${instanceId}`); reg = r ? JSON.parse(r) : null; } catch (_) { reg = null; }
    if (!reg) return json({ error: "Instancia desconocida" }, 403);
    if (reg.email && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(reg.email)) emailDestino = reg.email;
    try {
      const rlKey = `rl:recover:${instanceId}`;
      const n = parseInt((await env.LICENCIAS.get(rlKey)) || "0", 10) || 0;
      if (n >= 5) return json({ ok: true, enviado: false, motivo: "rate_limited" });
      await env.LICENCIAS.put(rlKey, String(n + 1), { expirationTtl: 3600 });
    } catch (_) { /* fail-open: si el KV falla, dejamos pasar */ }
  }

  // Sin RESEND_API_KEY → respuesta "soft" para que el cliente use fallback en pantalla.
  if (!env.RESEND_API_KEY) {
    return json({ ok: true, enviado: false, motivo: "email_no_configurado" });
  }

    // Fallback: onboarding@resend.dev works on all Resend accounts without domain
  // verification. noreply@amigable-123.com would fail — that domain is not verified.
  const fromEmail = (env.FROM_EMAIL || "onboarding@resend.dev").trim();
  const pinDisplay = pin.padStart(3, "0"); // siempre 3 dígitos con ceros

  let resendResp;
  try {
    resendResp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: `amigable-123 <${fromEmail}>`,
        to: [emailDestino],
        subject: "Tu clave de acceso — amigable-123",
        text: [
          `Tu clave de dueño en amigable-123 es: ${pinDisplay}`,
          "",
          "Si no solicitaste esto, alguien intentó recuperar tu clave.",
          "Cámbiala en Avanzado → Claves.",
          "",
          "— amigable-123",
        ].join("\n"),
        html: [
          `<p style="font-family:sans-serif;font-size:15px;color:#0F1923;">`,
          `Tu clave de dueño en <strong>amigable-123</strong> es:</p>`,
          `<p style="font-size:40px;font-weight:bold;letter-spacing:0.25em;`,
          `color:#E86040;font-family:monospace;">${pinDisplay}</p>`,
          `<p style="font-family:sans-serif;font-size:14px;color:#555;">`,
          `Si no solicitaste esto, alguien intentó recuperar tu clave.<br>`,
          `Cámbiala en <strong>Avanzado → Claves</strong>.</p>`,
          `<p style="font-family:sans-serif;font-size:12px;color:#999;">— amigable-123</p>`,
        ].join(""),
      }),
    });
  } catch (err) {
    console.error("[recover-pin] fetch a Resend falló:", err);
    return json({ ok: false, enviado: false, motivo: "resend_network_error" });
  }

  if (!resendResp.ok) {
    const errBody = await resendResp.text().catch(() => "");
    console.error("[recover-pin] Resend respondió", resendResp.status, errBody);
    return json({ ok: false, enviado: false, motivo: "resend_error" });
  }

  return json({ ok: true, enviado: true });
}


/* ---------------------------------------------------------------------
   ONE LICENSE, MANY DEVICES (JFC 2026-07-28)

   KV is keyed by instanceId and every device makes its own, so activating
   the same license on a second phone creates a second row. The panel used
   to paint them one under the other, as if they were two customers.

   This is NOT fixed by deleting the second row. Both rows are real and both
   are needed: a device has its own IP and last-seen and can be lost or
   stolen; a license is the business, and the sync room. Merging them in KV
   would destroy the per-device trail, which is exactly what you need the day
   someone says "I lost my phone". So it is fixed in the PRESENTATION.

   Instances with no license code are NOT grouped together: those are demo
   devices, each independent. Grouping them all under "" would have put
   strangers in the same row.
   --------------------------------------------------------------------- */
// Defined locally: this worker is the trimmed twin and has no normLicencia.
// Compare normalized, never raw — "f123-abcd" and "F123-ABCD " are the same
// license, and treating them as different would split one business in two.
function normCodigoLic(s) { return String(s || "").trim().toUpperCase(); }

function anotarHermanos(registros) {
  const porCodigo = {};
  registros.forEach((r) => {
    if (!r) return;
    const cod = normCodigoLic(r.licenseCode);
    if (!cod) return;
    (porCodigo[cod] = porCodigo[cod] || []).push(r.instanceId);
  });
  registros.forEach((r) => {
    if (!r) return;
    const cod = normCodigoLic(r.licenseCode);
    const grupo = cod ? (porCodigo[cod] || []) : [];
    r.dispositivos = grupo.length || 1;
    r.hermanos = grupo.filter((id) => id !== r.instanceId);
  });
}

// POST /editar-correo — master-only (homologado de amigable-123). Edits
// email/nombre/apellido/nombreNegocio from the panel's pencil icon. Name
// kept for compatibility, but it's no longer just email — see below.
//
// HARD RULE (JFC 2026-07-28, real incident: wiped his own name, a
// customer's email reverted to a stale value): an empty field in the body
// NEVER blanks an already-saved field. If the owner really wants to clear
// a field, that's not an action this endpoint supports — it edits to a new
// value, never to "nothing". Each non-empty field that arrives is
// validated and replaces; each empty/absent field is simply ignored and
// the existing value stays. licenseCode is never touched here — it's
// hard-generated and immutable.
async function handleEditarCorreo(req, env) {
  let body; try { body = await req.json(); } catch (_) { return json({ error: "Invalid JSON" }, 400); }
  const instanceId = String(body.instanceId || "").slice(0, 120).trim();
  if (!instanceId) return json({ error: "Falta instanceId" }, 400);
  const raw = await env.LICENCIAS.get(`inst:${instanceId}`);
  if (!raw) return json({ error: "Instancia no encontrada" }, 404);
  const reg = JSON.parse(raw);

  if (body.email !== undefined) {
    const email = String(body.email).slice(0, 240).trim();
    if (!email) return json({ error: "El correo no puede quedar vacio." }, 400);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: "Correo invalido" }, 400);
    reg.email = email;
  }
  if (body.nombre !== undefined) {
    const nombre = String(body.nombre).slice(0, 120).trim();
    if (!nombre) return json({ error: "El nombre no puede quedar vacio." }, 400);
    reg.nombre = nombre;
  }
  if (body.apellido !== undefined) {
    const apellido = String(body.apellido).slice(0, 120).trim();
    if (!apellido) return json({ error: "El apellido no puede quedar vacio." }, 400);
    reg.apellido = apellido;
  }
  if (body.nombreNegocio !== undefined) {
    const nombreNegocio = String(body.nombreNegocio).slice(0, 240).trim();
    if (!nombreNegocio) return json({ error: "El nombre del negocio no puede quedar vacio." }, 400);
    reg.nombreNegocio = nombreNegocio;
  }

  await guardarConHistorial(env, instanceId, reg);
  return json({ ok: true, email: reg.email, nombre: reg.nombre, apellido: reg.apellido, nombreNegocio: reg.nombreNegocio });
}

// GET /licencias/:id/historial — master-only. Up to 30 previous versions
// (newest first), so JFC can see what changed and when before restoring.
async function handleHistorial(env, instanceId) {
  const raw = await env.LICENCIAS.get(`hist:${instanceId}`);
  return json({ ok: true, historial: raw ? JSON.parse(raw) : [] });
}

// POST /licencias/:id/restaurar — master-only. Restores a prior version by
// timestamp. The restore itself goes through guardarConHistorial, so
// restoring the wrong version is also undoable.
async function handleRestaurar(req, env, instanceId) {
  let body; try { body = await req.json(); } catch (_) { return json({ error: "Invalid JSON" }, 400); }
  const ts = Number(body.ts);
  if (!ts) return json({ error: "Falta ts (timestamp de la version a restaurar)" }, 400);
  const raw = await env.LICENCIAS.get(`hist:${instanceId}`);
  const hist = raw ? JSON.parse(raw) : [];
  const version = hist.find((h) => h.ts === ts);
  if (!version) return json({ error: "No existe esa version en el historial" }, 404);
  await guardarConHistorial(env, instanceId, version.registro);
  return json({ ok: true, restaurado: version.registro });
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method === "OPTIONS") return cors(new Response(null, { status: 204 }));

    // Recuperación de PIN — público pero con validación de instanceId en KV
    if (url.pathname === "/recover-pin" && req.method === "POST") {
      return handleRecoverPin(req, env);
    }

    // Editar correo/nombre del dueño desde el panel (master, homologado)
    if (url.pathname === "/editar-correo" && req.method === "POST") {
      if (!requireMasterKey(req, env)) return json({ error: "Master Key incorrecta" }, 401);
      return handleEditarCorreo(req, env);
    }

    // Public checkin (activation + login heartbeat)
    if ((url.pathname === "/checkin" || url.pathname === "/register") && req.method === "POST") {
      return handleCheckin(req, env);
    }

    // Full instance list for panel
    if (url.pathname === "/licencias" && req.method === "GET") {
      if (!requireMasterKey(req, env)) return json({ error: "Master Key incorrecta" }, 401);
      const lista = await env.LICENCIAS.list({ prefix: "inst:" });
      const registros = await Promise.all(lista.keys.map((k) => env.LICENCIAS.get(k.name).then((v) => JSON.parse(v))));
      registros.forEach((r) => { if (r) r.estado = normalizarEstado(r.estado); });
      registros.sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0));
      anotarHermanos(registros);
      return json(registros);
    }

    // Delete an instance (master only). Meant for cleaning up test records,
    // not for punishing anyone: to cut service off use "bloqueada".
    const mBorrar = url.pathname.match(/^\/licencias\/([^/]+)$/);
    if (mBorrar && req.method === "DELETE") {
      if (!requireMasterKey(req, env)) return json({ error: "Wrong Master Key" }, 401);
      const instanceId = decodeURIComponent(mBorrar[1]);
      const raw = await env.LICENCIAS.get(`inst:${instanceId}`);
      if (!raw) return json({ error: "Instance not found" }, 404);
      // Archived BEFORE deleting, with no expiry. A one-click delete in a
      // panel is exactly where regrets happen, and this costs a few hundred
      // bytes. To recover: read borrado:<instanceId> and write it back.
      await env.LICENCIAS.put(`borrado:${instanceId}`, JSON.stringify({
        borradoEn: Date.now(), registro: JSON.parse(raw),
      }));
      await env.LICENCIAS.delete(`inst:${instanceId}`);
      return json({ ok: true, archivadoEn: `borrado:${instanceId}` });
    }


    // Change instance status
    const mEstado = url.pathname.match(/^\/licencias\/([^/]+)\/estado$/);
    if (mEstado && req.method === "POST") {
      if (!requireMasterKey(req, env)) return json({ error: "Master Key incorrecta" }, 401);
      const instanceId = decodeURIComponent(mEstado[1]);
      const raw = await env.LICENCIAS.get(`inst:${instanceId}`);
      if (!raw) return json({ error: "Instancia no encontrada" }, 404);
      const reg = JSON.parse(raw);
      let body; try { body = await req.json(); } catch (_) { body = {}; }
      const _e = String(body.estado || "").toLowerCase();
      if (!ESTADOS_VALIDOS.includes(_e) && !MAPA_ESTADOS_VIEJOS[_e]) {
        return json({ error: "Invalid state" }, 400);
      }
      reg.estado = normalizarEstado(body.estado);
      await guardarConHistorial(env, instanceId, reg);
      return json({ ok: true });
    }

    // Historial de versiones de una instancia (master, homologado)
    const mHistorial = url.pathname.match(/^\/licencias\/([^/]+)\/historial$/);
    if (mHistorial && req.method === "GET") {
      if (!requireMasterKey(req, env)) return json({ error: "Master Key incorrecta" }, 401);
      return handleHistorial(env, decodeURIComponent(mHistorial[1]));
    }

    // Restaurar una version anterior de una instancia (master, homologado)
    const mRestaurar = url.pathname.match(/^\/licencias\/([^/]+)\/restaurar$/);
    if (mRestaurar && req.method === "POST") {
      if (!requireMasterKey(req, env)) return json({ error: "Master Key incorrecta" }, 401);
      return handleRestaurar(req, env, decodeURIComponent(mRestaurar[1]));
    }

    return json({ error: "Not found" }, 404);
  },
};
