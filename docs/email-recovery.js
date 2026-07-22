// email-recovery.js — PIN recovery via Cloudflare Worker + Resend.
// Replaces the EmailJS dependency (credentials were placeholders, never worked).
// Uses the same Worker already in use for license heartbeats, with a new
// /recover-pin endpoint.
//
// Flow:
//   1. auth-ui.js calls OCEmailRecovery.enviarCodigo(email, pin, instanceId).
//   2. We call Worker /recover-pin with those 3 fields.
//   3. Worker validates instanceId against KV (light anti-abuse) and sends
//      the email via Resend (API key stored as Worker secret RESEND_API_KEY).
//   4. If Worker fails for any reason (no internet, not deployed, Resend down,
//      timeout), we return { enviado: false, codigo: pin } and auth-ui.js
//      shows the PIN on screen — the owner is never left without a way out.
//
// CURRENT STATE (JFC 2026-07-22): ALREADY DEPLOYED AND WORKING.
//   RESEND_API_KEY is set as a secret and the Worker sends from
//   onboarding@resend.dev (the Worker's fallback), which works on any Resend
//   account WITHOUT domain verification. Nothing else to do.
//
// IF you ever want email to come from your own domain:
//   1. Resend → Domains → Add Domain → verify your domain (DNS records).
//   2. wrangler secret put FROM_EMAIL   ← e.g. noreply@yourdomain.com
//   3. wrangler deploy
//   NOTE: do NOT set FROM_EMAIL to an unverified domain — Resend rejects it
//   and delivery fails silently. When in doubt, leave the default.

(function () {
  // Same obfuscated URL as auth-ui.js — read at call time to honor any
  // override the owner may have saved in localStorage.
  var _amgEp = "=YXZk5ycyV2ay92du8WawJXYjZmauMXYpNmblNWas1SZsJWYnlWbh9yL6MHc0RHa";
  function workerBase() {
    try {
      var ov = (localStorage.getItem("f123_cf_worker_url") || "").trim();
      if (ov) return ov.replace(/\/+$/, "");
    } catch (_) {}
    try { return atob(_amgEp.split("").reverse().join("")).replace(/\/+$/, ""); } catch (_) { return ""; }
  }

  async function enviarCodigo(email, pin, instanceId) {
    // JFC FINAL DECISION 2026-07-22 (see memory feedback_metodo_autoenvio_html5):
    // the PIN is SELF-SENT with the SAME method as the backup — the owner's own
    // email client, via mailto:. NO backend, NO Resend. The PIN is ALSO always
    // shown on screen (auth-ui uses the returned codigo), so even if the mailto
    // doesn't open, the owner is never left without their key. The email goes
    // from them to them: it never passes through any server.
    try {
      if (email && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        var asunto = "Your access key — friendly-123";
        var cuerpo = "Your owner key in friendly-123 is: " + pin
          + "\n\nKeep it somewhere safe. This email goes from you to you: it never passes through any server."
          + "\nIf you didn't request it, change it in Advanced → Keys.";
        window.location.href = "mailto:" + encodeURIComponent(email)
          + "?subject=" + encodeURIComponent(asunto)
          + "&body=" + encodeURIComponent(cuerpo);
      }
    } catch (_) {}
    return { enviado: false, codigo: pin };
  }

  /* =====================================================================
     DORMANT (JFC 2026-07-22) — PIN delivery via Cloudflare Worker + Resend.
     Disabled by FINAL DECISION: the PIN is self-sent via mailto (above), never
     through a server. DO NOT DELETE (dormant-feature rule). To re-enable (NOT
     recommended, violates NO-CLOUD): move this body into enviarCodigo and drop
     the return above.

     async function _enviarCodigoResendDORMANT(email, pin, instanceId) {
       var base = workerBase();
       if (!base) return { enviado: false, codigo: pin };
       var ctrl = null, timeout = null;
       try { ctrl = new AbortController(); timeout = setTimeout(function(){ try{ctrl.abort();}catch(_){} }, 8000); } catch (_) {}
       try {
         var resp = await fetch(base + "/recover-pin", {
           method: "POST",
           headers: { "Content-Type": "application/json" },
           body: JSON.stringify({ email: email, pin: pin, instanceId: instanceId || "" }),
           signal: ctrl ? ctrl.signal : undefined,
         });
         if (timeout) clearTimeout(timeout);
         if (!resp.ok) { console.warn("[email-recovery] Worker responded", resp.status); return { enviado: false, codigo: pin }; }
         var result; try { result = await resp.json(); } catch (_) { result = {}; }
         if (result && result.enviado === true) return { enviado: true };
         return { enviado: false, codigo: pin };
       } catch (err) {
         if (timeout) clearTimeout(timeout);
         console.warn("[email-recovery] network or timeout:", err && err.message);
         return { enviado: false, codigo: pin };
       }
     }
     ===================================================================== */

  window.OCEmailRecovery = {
    enviarCodigo: enviarCodigo,
    // configurado() — backward-compat in case any code checks this
    configurado: function () { return !!workerBase(); },
  };
})();
