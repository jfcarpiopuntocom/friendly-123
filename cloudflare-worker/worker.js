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
  resp.headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  return resp;
}
function json(obj, status = 200) {
  return cors(new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } }));
}
function requireMasterKey(req, env) {
  const k = req.headers.get("X-Master-Key") || "";
  return env.MASTER_KEY && k === env.MASTER_KEY;
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
    nombreNegocio: body.nombreNegocio != null ? String(body.nombreNegocio).slice(0, 240) : (existente.nombreNegocio || ""),
    email: body.email != null ? String(body.email).slice(0, 240) : (existente.email || ""),
    licenseCode: body.licenseCode || existente.licenseCode || "",
    // Mejora #5 (JFC 2026-07-16): telefono de contacto del dueno, para el
    // link clickeable a wa.me en panel.html. Contacto deliberadamente
    // unidireccional (JFC -> dueno) — ver copy en avanzado-extra.js.
    whatsapp: body.whatsapp != null ? String(body.whatsapp).replace(/\D/g, "").slice(0, 15) : (existente.whatsapp || ""), // Fix-11: strip non-digits so wa.me link always works
    nombre: body.nombre || existente.nombre || "",
    apellido: body.apellido || existente.apellido || "",
    cedula: body.cedula || existente.cedula || "",
    // New instances start as "observada" — JFC decides activa/limitada/bloqueada from panel
    estado: existente.estado || "observada",
    ip,
    activatedAt: existente.activatedAt || (body.activatedAt ? body.activatedAt : null),
    firstSeen: existente.firstSeen || Date.now(),
    lastSeen: Date.now(),
    lastAccion: body.accion || "checkin",
  };
  await env.LICENCIAS.put(`inst:${instanceId}`, JSON.stringify(registro));
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

  // Anti-abuso leve: instanceId debe existir en KV si se proporcionó.
  if (instanceId && env.LICENCIAS) {
    const existe = await env.LICENCIAS.get(`inst:${instanceId}`).catch(() => null);
    if (!existe) return json({ error: "Instancia desconocida" }, 403);
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
        to: [email],
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

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method === "OPTIONS") return cors(new Response(null, { status: 204 }));

    // Recuperación de PIN — público pero con validación de instanceId en KV
    if (url.pathname === "/recover-pin" && req.method === "POST") {
      return handleRecoverPin(req, env);
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
      registros.sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0));
      return json(registros);
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
      if (!["activa", "observada", "limitada", "bloqueada"].includes(body.estado)) return json({ error: "Estado inválido" }, 400);
      reg.estado = body.estado;
      await env.LICENCIAS.put(`inst:${instanceId}`, JSON.stringify(reg));
      return json({ ok: true });
    }

    return json({ error: "Not found" }, 404);
  },
};
