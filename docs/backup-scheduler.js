// backup-scheduler.js — Sovereign backup by email and/or WhatsApp, going
// directly to the owner. NEVER to a central server. Philosophy: "the backup
// goes to YOU, not to us. You never lose control of your data."
//
// Ported from amigable-123 (JFC 2026-07-21), adapted for friendly-123:
// uses f123_* localStorage keys, English UI, i18n-agnostic (plain English
// strings — avanzado-extra.js is already in English).
//
// Why this exists: the only honest way to guarantee the owner doesn't lose
// data through forgetfulness is for the app itself to generate reminder
// emails/messages with an attachable backup file, to THEIR chosen address,
// at the frequency THEY choose. The monthly minimum is NON-NEGOTIABLE: if
// a client loses 30 days of data through neglect that's bad; more than 30
// days would be unacceptable.
//
// HONEST LIMITATION (we don't hide this from the user):
//   mailto: and wa.me links CANNOT attach files on their own (web standard
//   limitation). What we do:
//     1) Automatically download the .json backup file.
//     2) Open mailto: (or wa.me:) with the recipient, subject, and body
//        already written. The user taps once more (attach the freshly
//        downloaded file) and once to Send. Most automatic possible from a
//        PWA with no intermediary backend. The promise holds: the backup
//        travels to YOUR account, not ours.
//
// Depends on: window.OCAuth (role), /api/respaldo/exportar (payload).
// No EmailJS or paid services.
(function () {
  const LS_PREFS   = "f123_backup_prefs_v1";
  const LS_LAST    = "f123_backup_last_v1";    // { ts: number, canal: "email"|"whatsapp"|"both" }
  const LS_ASSURED = "f123_backup_assurance_last_v1";
  // Snooze: until when NOT to show the reminder again. Set by "Later" (24h)
  // and by auto-config (one grace cycle). Without it, toca() only looks at the
  // last backup date and the nag reappears on every login.
  const LS_SNOOZE  = "f123_backup_snooze_v1";

  function getSnooze() {
    try { return parseInt(localStorage.getItem(LS_SNOOZE) || "0", 10) || 0; } catch (_) { return 0; }
  }
  function setSnooze(ms) {
    try { localStorage.setItem(LS_SNOOZE, String(Date.now() + ms)); } catch (_) {}
  }

  // Frequency options in days. Monthly (30) is the enforced minimum: you
  // cannot choose MORE than 30 days. You can choose less (daily, weekly, biweekly).
  const FREQS = [
    { key: "daily",     dias: 1,  label: "Daily"               },
    { key: "weekly",    dias: 7,  label: "Weekly"              },
    { key: "biweekly",  dias: 15, label: "Every 2 weeks"       },
    { key: "monthly",   dias: 30, label: "Monthly (minimum)"   },
  ];

  function defaults() {
    return {
      frecKey:        "monthly",  // enforced minimum as default
      email:          "",         // owner's preferred email
      whatsapp:       "",         // wa.me accepts with or without +
      canalEmail:     true,       // email checked by default
      canalWhatsapp:  false,      // whatsapp opt-in
      configurado:    false,      // false = never opened config; used to suppress nag
    };
  }

  function getPrefs() {
    try {
      const raw = localStorage.getItem(LS_PREFS);
      if (!raw) return defaults();
      return Object.assign(defaults(), JSON.parse(raw));
    } catch (_) { return defaults(); }
  }

  function setPrefs(p) {
    try { localStorage.setItem(LS_PREFS, JSON.stringify(p)); } catch (_) {}
  }

  function getLast() {
    try { return JSON.parse(localStorage.getItem(LS_LAST) || "null"); } catch (_) { return null; }
  }

  function setLast(canal) {
    try { localStorage.setItem(LS_LAST, JSON.stringify({ ts: Date.now(), canal })); } catch (_) {}
  }

  function frecDe(key) {
    return FREQS.find((f) => f.key === key) || FREQS[3];
  }

  // Is it time for a backup reminder? true if never done, or if frequency interval has passed.
  function toca(prefs) {
    const last = getLast();
    if (!last) return true;
    const f = frecDe(prefs.frecKey);
    return (Date.now() - last.ts) >= f.dias * 24 * 60 * 60 * 1000;
  }

  function stampArchivo(d) {
    return d.toISOString().replace(/[:T]/g, "-").slice(0, 16); // 2026-07-21-02-15
  }

  function stampHumano(d) {
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const aa = d.getFullYear();
    const HH = String(d.getHours()).padStart(2, "0");
    const MM = String(d.getMinutes()).padStart(2, "0");
    return `${dd}/${mm}/${aa} ${HH}:${MM}`;
  }

  function normalizeWa(num) {
    return (num || "").replace(/[^\d]/g, "");
  }

  function waEsValido(num) {
    const d = normalizeWa(num);
    // 8 digits minimum — loose check (covers country code + local number).
    if (d.length < 8) return false;
    // wa.me needs FULL international format (country code, no +). A leading 0
    // is a national trunk prefix (e.g. 020..., 09...): wa.me/0... opens an
    // empty/invalid chat. Reject it so the owner adds their country code.
    // friendly-123 is international, so we can't guess the code for them.
    if (d[0] === "0") return false;
    return true;
  }

  // Builds the backup package (no side effects). Reuses the canonical flow:
  // /api/respaldo/exportar (intercepted by mock-backend, local).
  async function construirArchivoRespaldo() {
    const res = await fetch("/api/respaldo/exportar");
    if (res.status === 403) throw new Error("This device is not activated. Log in with PIN 789 to activate it, then come back to back up.");
    if (!res.ok) throw new Error("Could not read business data.");
    const datos = await res.json();
    const paquete = {
      app: "friendly-123",
      exportadoEn: new Date().toISOString(),
      schemaVersion: 2,
      datos,
    };
    const texto = JSON.stringify(paquete, null, 2);
    const now = new Date();
    const nombre = `backup-friendly-123-${stampArchivo(now)}.json`;
    return { texto, nombre, humano: stampHumano(now) };
  }

  // Downloads the file (fallback for laptop / browsers without Web Share).
  // iOS/webview FIX (JFC 2026-07-22) — do NOT reduce to a bare a.click(): on
  // iPhone/iPad the download attribute is ignored (opens a tab) and some
  // locked-down webviews throw. try/catch + fallback to a tab: we never leave
  // the owner without their file.
  function descargarArchivo(texto, nombre) {
    const blob = new Blob([texto], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = nombre;
    document.body.appendChild(a);
    try { a.click(); } catch (_) { try { window.open(url, "_blank"); } catch (_) {} }
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  function cuerpoEmail(nombreArchivo, humano) {
    return `friendly-123 backup generated on ${humano}.\n\n`
         + `1) Attach the file "${nombreArchivo}" that just downloaded on this device (Android/PC: Downloads folder; iPhone/iPad: it opens in a tab — tap Share and "Save to Files").\n`
         + `2) Send it to this address (to yourself).\n\n`
         + `— Your backup goes to YOU, not to a server. You never lose control of your data.`;
  }

  function cuerpoWa(nombreArchivo, humano) {
    return `friendly-123 backup ${humano}. Attach the file ${nombreArchivo} just downloaded and send it to yourself. The backup lives with you, not in the cloud.`;
  }

  function abrirMailto(email, nombreArchivo, humano) {
    const asunto = `friendly-123 backup — ${humano}`;
    const body = cuerpoEmail(nombreArchivo, humano);
    window.location.href = `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(asunto)}&body=${encodeURIComponent(body)}`;
  }

  // PREVENTIVE MOBILE FIX (JFC 2026-07-22) — DO NOT REMOVE. window.open runs
  // AFTER an await (the backup download), i.e. outside the user gesture.
  // Safari/Chrome on phones/tablets block that popup and return null: the
  // WhatsApp backup was failing SILENTLY. Here, if the open is blocked, we
  // show a tappable link — a tap IS a fresh gesture, so the link always opens.
  function mostrarLinkFallback(url, etiqueta) {
    try {
      const prev = document.getElementById("f123-backup-linkfallback");
      if (prev) prev.remove();
      const wrap = document.createElement("div");
      wrap.id = "f123-backup-linkfallback";
      wrap.style.cssText = "position:fixed;bottom:150px;left:50%;transform:translateX(-50%);z-index:9492;"
        + "background:#0F1923;color:#fff;border:2px solid #E8A020;border-radius:12px;padding:12px 16px;"
        + "max-width:420px;width:calc(100% - 28px);box-shadow:0 12px 28px rgba(15,25,35,.35);"
        + "font-family:Georgia,serif;font-size:14px;line-height:1.45;text-align:center;";
      const intro = document.createElement("div");
      intro.style.cssText = "margin-bottom:8px;color:#fff;";
      intro.textContent = "Your browser blocked the window. Tap here to open it:";
      const a = document.createElement("a");
      a.href = url; a.target = "_blank"; a.rel = "noopener";
      a.textContent = etiqueta;
      a.style.cssText = "display:inline-block;min-height:44px;line-height:44px;padding:0 18px;"
        + "background:#25D366;color:#0a3d20;border-radius:8px;font-weight:700;text-decoration:none;";
      a.addEventListener("click", () => { try { wrap.remove(); } catch (_) {} });
      wrap.appendChild(intro); wrap.appendChild(a);
      document.body.appendChild(wrap);
      setTimeout(() => { try { wrap.remove(); } catch (_) {} }, 25000);
    } catch (_) {}
  }

  function abrirWa(num, nombreArchivo, humano) {
    const texto = cuerpoWa(nombreArchivo, humano);
    const url = `https://wa.me/${normalizeWa(num)}?text=${encodeURIComponent(texto)}`;
    let w = null;
    try { w = window.open(url, "_blank", "noopener"); } catch (_) { w = null; }
    if (!w) mostrarLinkFallback(url, "Open WhatsApp");
  }

  // Runs the full routine: download + open chosen channels + mark timestamp.
  async function correrRespaldo(silencioso) {
    const prefs = getPrefs();
    if (!prefs.canalEmail && !prefs.canalWhatsapp) {
      alert("Choose at least one channel (email and/or WhatsApp) in Advanced before backing up.");
      return;
    }
    if (prefs.canalEmail && !prefs.email) {
      alert("Enter your preferred email in Advanced before backing up.");
      return;
    }
    if (prefs.canalWhatsapp && !waEsValido(prefs.whatsapp)) {
      alert("Your WhatsApp number in Advanced looks incomplete (include country code). Fix it before backing up.");
      return;
    }
    // No navigator.onLine check — mock-backend intercepts fetch locally, no internet needed.
    let info;
    try {
      info = await construirArchivoRespaldo();
    } catch (e) {
      alert("Could not generate backup: " + e.message);
      return;
    }

    // ========================================================================
    // IDEAL METHOD (JFC FINAL DECISION 2026-07-22) — see memory note
    // feedback_metodo_autoenvio_html5. The backup is SELF-SENT with pure HTML5,
    // NO backend, NO cloud: the app forces the owner to send their own data to
    // themselves with the client they ALREADY have set up.
    //   1) Web Share API (navigator.share) with the file ALREADY ATTACHED: on
    //      phone/tablet it opens the system share sheet with the .json attached;
    //      the owner picks THEIR WhatsApp/Gmail and sends it to themselves.
    //   2) Fallback (laptop / no Web Share): download the file + open premade
    //      email/WhatsApp (owner attaches the just-downloaded file).
    // NEVER put a server in the middle of this data. That rule is JFC's.
    // ========================================================================
    let resultado = "fallback"; // "compartido" | "fallback" | "cancelado"
    try {
      const file = new File([info.texto], info.nombre, { type: "application/json" });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        const canalTxt = prefs.canalWhatsapp && !prefs.canalEmail ? "WhatsApp" : "email or WhatsApp";
        await navigator.share({
          files: [file],
          title: "friendly-123 backup",
          text: `Backup of your business (friendly-123) ${info.humano}. Send it to YOURSELF via ${canalTxt} — it's yours, it never goes through any server.`,
        });
        resultado = "compartido";
      }
    } catch (e) {
      resultado = (e && e.name === "AbortError") ? "cancelado" : "fallback";
    }

    if (resultado === "cancelado") return; // owner closed the share sheet — don't mark a backup that didn't happen

    if (resultado === "fallback") {
      descargarArchivo(info.texto, info.nombre);
      if (prefs.canalWhatsapp) abrirWa(prefs.whatsapp, info.nombre, info.humano);
      if (prefs.canalEmail)    setTimeout(() => abrirMailto(prefs.email, info.nombre, info.humano), 300);
    }

    const canal = prefs.canalEmail && prefs.canalWhatsapp ? "both" : (prefs.canalEmail ? "email" : "whatsapp");
    setLast(canal);

    if (!silencioso) programarAssurance();
  }

  // "Assurance" toast: weekly, friendly, no anxiety. Asks if the backup arrived.
  function programarAssurance() {
    try { localStorage.setItem(LS_ASSURED, String(Date.now())); } catch (_) {}
  }

  function tocaAssurance() {
    const last = getLast();
    if (!last) return false;
    let assured = 0;
    try { assured = parseInt(localStorage.getItem(LS_ASSURED) || "0", 10) || 0; } catch (_) {}
    const semana = 7 * 24 * 60 * 60 * 1000;
    return (Date.now() - Math.max(last.ts, assured)) >= semana;
  }

  function esDueno() {
    const rol = window.OCAuth && window.OCAuth.rolActual ? window.OCAuth.rolActual() : null;
    return rol === "dueno" || rol === "dueño" || rol === "owner";
  }

  // In demo mode, auth-ui.js assigns rol="owner" too — esDueno() alone doesn't
  // exclude demo sessions. No one just testing the app should see backup nags.
  function esDuenoReal() {
    return esDueno() && !(window.OCAuth && window.OCAuth.esDemo && window.OCAuth.esDemo());
  }

  function mostrarAssurance() {
    if (document.getElementById("f123-backup-assurance")) return;
    if (!esDuenoReal()) return;
    const wrap = document.createElement("div");
    wrap.id = "f123-backup-assurance";
    wrap.style.cssText = "position:fixed;bottom:90px;left:50%;transform:translateX(-50%);z-index:9490;"
      + "background:#F8F9FB;color:#0F1923;border:2px solid #E8A020;border-radius:12px;padding:14px 16px;"
      + "max-width:420px;width:calc(100% - 28px);box-shadow:0 12px 28px rgba(15,25,35,.28);"
      + "font-family:Georgia,serif;font-size:15px;line-height:1.45;";
    // Dynamic text based on backup channel — don't say "inbox" to someone who backed up via WhatsApp only.
    const _last = getLast();
    const _canalAssu = _last ? _last.canal : (getPrefs().canalEmail ? "email" : "whatsapp");
    const _textoAssu = _canalAssu === "whatsapp"
      ? "Did your backup reach your WhatsApp?"
      : (_canalAssu === "both" ? "Did your backup arrive — email or WhatsApp?" : "Did your backup reach your inbox?");
    const _cuerpoAssu = _canalAssu === "whatsapp"
      ? "Check your WhatsApp and confirm you have the file. It's yours — it never passes through us. Have a great week!"
      : "Open it in your inbox and confirm it's there. It's yours — it never passes through us. Have a great week!";
    wrap.innerHTML = `
      <div style="font-weight:700;color:#E8A020;margin-bottom:4px;">${_textoAssu}</div>
      <div style="margin-bottom:10px;">${_cuerpoAssu}</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <button id="f123-backup-assured-ok" style="flex:1;min-height:44px;padding:8px 12px;border:2px solid #00C87A;background:#00C87A;color:#fff;border-radius:8px;font-weight:700;cursor:pointer;">Yes, it arrived — thanks!</button>
        <button id="f123-backup-assured-resend" style="flex:1;min-height:44px;padding:8px 12px;border:2px solid #2E6278;background:#fff;color:#2E6278;border-radius:8px;font-weight:700;cursor:pointer;">Send again now</button>
      </div>`;
    document.body.appendChild(wrap);
    document.getElementById("f123-backup-assured-ok").addEventListener("click", () => {
      try { localStorage.setItem(LS_ASSURED, String(Date.now())); } catch (_) {}
      wrap.remove();
    });
    document.getElementById("f123-backup-assured-resend").addEventListener("click", () => {
      wrap.remove();
      correrRespaldo(false);
    });
  }

  // Tracks the active startup timeout — prevents rapid login/logout/login cycles
  // (within 4s) from stacking multiple timers and showing duplicate toasts.
  let _chequeoTimeout = null;

  // On startup (with delay to not block the splash), check if backup or assurance is due.
  //
  // AUTO-CONFIG (JFC 2026-07-21): if the owner never opened Advanced but has
  // an email saved in oc_secure, activate the monthly minimum automatically.
  // The "monthly minimum" promise cannot depend on the owner remembering to
  // open Advanced first.
  function chequearAlArrancar() {
    if (_chequeoTimeout) clearTimeout(_chequeoTimeout);
    _chequeoTimeout = setTimeout(() => {
      _chequeoTimeout = null;
      try {
        if (!esDuenoReal()) return;
        let prefs = getPrefs();
        if (!prefs.configurado) {
          const emailGuardado = (window.OCSecure && window.OCSecure.leerCorreo) ? window.OCSecure.leerCorreo() : "";
          if (emailGuardado) {
            prefs = Object.assign({}, prefs, {
              email: emailGuardado,
              canalEmail: true,
              frecKey: "monthly",
              configurado: true,
            });
            setPrefs(prefs);
            // Just auto-configured: give one grace cycle (the chosen
            // frequency) before the first reminder, so we don't nag 4s after
            // the owner activated the device and has no data yet. We do NOT
            // seed a fake backup (that would trigger the weekly assurance).
            setSnooze(frecDe(prefs.frecKey).dias * 24 * 60 * 60 * 1000);
          } else {
            return; // no email and no config — don't nag
          }
        }
        // Snooze silences ONLY the reminder ("Later"/initial grace), never the
        // "did your backup arrive?" assurance.
        const snoozed = getSnooze() > Date.now();
        if (toca(prefs) && !snoozed) {
          mostrarRecordatorioRespaldo();
        } else if (tocaAssurance()) {
          mostrarAssurance();
        }
      } catch (e) { console.warn("[backup-scheduler] startup check aborted:", e); }
    }, 4000);
  }

  function mostrarRecordatorioRespaldo() {
    if (document.getElementById("f123-backup-remind")) return;
    if (!esDuenoReal()) return;
    const wrap = document.createElement("div");
    wrap.id = "f123-backup-remind";
    wrap.style.cssText = "position:fixed;bottom:90px;left:50%;transform:translateX(-50%);z-index:9491;"
      + "background:#F8F9FB;color:#0F1923;border:2px solid #E8A020;border-radius:12px;padding:14px 16px;"
      + "max-width:440px;width:calc(100% - 28px);box-shadow:0 12px 28px rgba(15,25,35,.32);"
      + "font-family:Georgia,serif;font-size:15px;line-height:1.45;";
    const prefs = getPrefs();
    const f = frecDe(prefs.frecKey);
    const canales = [prefs.canalEmail && "email", prefs.canalWhatsapp && "WhatsApp"].filter(Boolean).join(" + ");
    // Dynamic message — show the actual channel, not a generic placeholder.
    const _canalMsg = canales === "WhatsApp" ? "a WhatsApp message"
      : (canales === "email + WhatsApp" ? "an email and a WhatsApp message"
      : "an email");
    const msg = `Tap "Back up now" and we'll prepare the file + ${_canalMsg} with everything ready. You just attach and send — <b>to yourself</b>. Chosen frequency: <b>${f.label.toLowerCase()}</b> via ${canales || "email"}.`;
    wrap.innerHTML = `
      <div style="font-weight:700;color:#E8A020;margin-bottom:4px;">Time for your backup</div>
      <div style="margin-bottom:10px;">${msg}</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <button id="f123-backup-remind-ok" style="flex:1;min-height:44px;padding:8px 12px;border:2px solid #E8A020;background:#E8A020;color:#fff;border-radius:8px;font-weight:700;cursor:pointer;">Back up now</button>
        <button id="f123-backup-remind-later" style="flex:1;min-height:44px;padding:8px 12px;border:2px solid #2E6278;background:#fff;color:#2E6278;border-radius:8px;font-weight:700;cursor:pointer;">Later</button>
      </div>`;
    document.body.appendChild(wrap);
    document.getElementById("f123-backup-remind-ok").addEventListener("click", () => {
      wrap.remove();
      correrRespaldo(false);
    });
    document.getElementById("f123-backup-remind-later").addEventListener("click", () => {
      wrap.remove();
      // Postpone 24h for real. This used to set LS_ASSURED, which toca()
      // ignores — the reminder came back on the next login. Snooze is the one
      // chequearAlArrancar() actually respects.
      setSnooze(24 * 60 * 60 * 1000);
    });
  }

  // ==========================================================================
  // Config UI rendered in Advanced. Called by avanzado-extra.js passing the
  // target <div>. Kept small and attached to the Backup card — doesn't
  // interrupt the owner's flow.
  // ==========================================================================
  function renderPanel(mount) {
    if (!mount) return;
    if (window.OCAuth && window.OCAuth.esDemo && window.OCAuth.esDemo()) { mount.innerHTML = ""; return; }

    // Gate: if the device is not activated, export gives 403. Better to show
    // this here than let the user configure everything and fail on first attempt.
    try {
      const owned = JSON.parse(localStorage.getItem("f123_owned") || "null") || {};
      if (!owned.instanceId) {
        mount.innerHTML = `<div style="border:2px solid #E86040;border-radius:12px;padding:14px 16px;background:#FFF3EE;margin-top:16px;">
          <p style="margin:0;font-size:15px;font-weight:700;color:#C05000;">To activate automatic backup, first activate this device.</p>
          <p style="margin:8px 0 0;font-size:14px;color:#2C3E50;">At the login screen enter PIN <strong>789</strong>. Once activated, come back here to set your email and frequency.</p>
        </div>`;
        return;
      }
    } catch (_) {}

    const prefs = getPrefs();
    const frecIdx = FREQS.findIndex((f) => f.key === prefs.frecKey);
    const frecIdxSafe = frecIdx >= 0 ? frecIdx : 3; // default monthly
    mount.innerHTML = `
      <div style="border:2px solid #E8A020;border-radius:12px;padding:14px 16px;background:#FFF8EC;margin-top:16px;">
        <h3 style="margin:0 0 4px;color:#C05000;font-family:Georgia,serif;font-size:19px;">
          Automatic backup — email and/or WhatsApp
        </h3>
        <p style="margin:0 0 12px;font-size:15px;color:#0F1923;font-weight:700;">
          Your backup goes to YOU, not to us. You never lose control of your data.
        </p>
        <p style="margin:0 0 12px;font-size:14px;color:#2C3E50;line-height:1.5;">
          The app downloads the file and opens your email/WhatsApp with everything pre-written. You attach and send — to yourself. The monthly minimum is enforced: if something goes wrong through neglect, you never lose more than 30 days.
        </p>

        <div style="display:grid;grid-template-columns:1fr;gap:10px;">
          <div>
            <div style="font-size:14px;font-weight:700;margin-bottom:6px;">Backup frequency</div>
            <input type="range" id="f123-bk-frec" min="0" max="3" step="1" value="${frecIdxSafe}"
              style="width:100%;max-width:320px;accent-color:#E86040;height:6px;cursor:pointer;">
            <div style="display:flex;justify-content:space-between;max-width:320px;margin-top:5px;">
              ${FREQS.map((f) => `<span style="font-size:13px;color:#2C3E50;text-align:center;width:25%;">${f.label.replace(" (minimum)","")}</span>`).join("")}
            </div>
            <p id="f123-bk-frec-label" style="margin:6px 0 0;font-size:13px;color:#E86040;font-weight:700;">
              Selected: ${FREQS[frecIdxSafe].label}
            </p>
          </div>

          <label style="font-size:14px;font-weight:700;">
            <input type="checkbox" id="f123-bk-canalEmail" ${prefs.canalEmail ? "checked" : ""} style="min-width:20px;min-height:20px;vertical-align:middle;margin-right:6px;">
            Send to my email
          </label>
          <input type="email" id="f123-bk-email" value="${(prefs.email || "").replace(/"/g, "&quot;")}" placeholder="you@email.com"
            style="padding:10px;border:2px solid #E86040;border-radius:6px;min-height:44px;max-width:340px;font-size:15px;">

          <label style="font-size:14px;font-weight:700;">
            <input type="checkbox" id="f123-bk-canalWa" ${prefs.canalWhatsapp ? "checked" : ""} style="min-width:20px;min-height:20px;vertical-align:middle;margin-right:6px;">
            Send to my WhatsApp
          </label>
          <input type="tel" id="f123-bk-wa" value="${(prefs.whatsapp || "").replace(/"/g, "&quot;")}" placeholder="+1 555 123 4567"
            style="padding:10px;border:2px solid #E86040;border-radius:6px;min-height:44px;max-width:340px;font-size:15px;">
        </div>

        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:14px;">
          <button id="f123-bk-guardar" style="min-height:44px;padding:10px 16px;border:2px solid #2E6278;background:#2E6278;color:#fff;border-radius:8px;font-weight:700;font-size:15px;cursor:pointer;">
            Save preference
          </button>
          <button id="f123-bk-correr" style="min-height:44px;padding:10px 16px;border:2px solid #E8A020;background:#E8A020;color:#fff;border-radius:8px;font-weight:700;font-size:15px;cursor:pointer;">
            Back up now
          </button>
        </div>
        <p id="f123-bk-msg" style="margin:10px 0 0;font-size:14px;font-weight:700;color:#2E6278;"></p>
        <p style="margin:8px 0 0;font-size:13px;color:#2C3E50;">
          <b>Honest note:</b>
          mailto: and wa.me links can't attach files automatically (web standard limitation). So we download the file first and open the message with the recipient and body already filled — you just attach and send. Most automatic possible without your data passing through us.
        </p>
        <p style="margin:8px 0 0;font-size:13px;color:#5A6270;">
          <b>Scope of this backup:</b> includes products, sales, clients, commissions, and business settings.
          The file is not encrypted — store it somewhere you trust.
          For a full backup (including security keys and rack photos) use <b>Advanced → Export backup</b>.
        </p>
      </div>
    `;

    function msg(txt, color) {
      const m = document.getElementById("f123-bk-msg");
      if (m) { m.textContent = txt; m.style.color = color || "#2E6278"; }
    }

    // Slider: update frequency label in real time
    document.getElementById("f123-bk-frec").addEventListener("input", function () {
      const idx = parseInt(this.value, 10);
      const lbl = document.getElementById("f123-bk-frec-label");
      if (lbl && FREQS[idx]) lbl.textContent = "Selected: " + FREQS[idx].label;
    });

    document.getElementById("f123-bk-guardar").addEventListener("click", () => {
      const frecSliderIdx = parseInt(document.getElementById("f123-bk-frec").value, 10);
      const nueva = {
        frecKey:       (FREQS[frecSliderIdx] || FREQS[3]).key,
        email:         document.getElementById("f123-bk-email").value.trim(),
        whatsapp:      document.getElementById("f123-bk-wa").value.trim(),
        canalEmail:    document.getElementById("f123-bk-canalEmail").checked,
        canalWhatsapp: document.getElementById("f123-bk-canalWa").checked,
        configurado:   true,
      };
      if (nueva.canalEmail && !nueva.email) { msg("Email address missing.", "#E8365D"); return; }
      if (nueva.canalWhatsapp && !waEsValido(nueva.whatsapp)) { msg("WhatsApp number looks incomplete — include country code.", "#E8365D"); return; }
      if (!nueva.canalEmail && !nueva.canalWhatsapp) { msg("Choose at least one channel.", "#E8365D"); return; }
      setPrefs(nueva);
      msg("Saved. Ready to back up whenever you want.", "#00C87A");
    });

    document.getElementById("f123-bk-correr").addEventListener("click", () => {
      correrRespaldo(false);
    });
  }

  // Public API. avanzado-extra.js calls OCBackupScheduler.montar(...)
  // from the Backup card, and index.html starts the periodic check on owner login.
  window.OCBackupScheduler = {
    montar: renderPanel,
    correr: correrRespaldo,
    chequearAlArrancar,
    getPrefs,
    // Exposed for manual testing from DevTools:
    _toca: () => toca(getPrefs()),
    _mostrarRecordatorio: mostrarRecordatorioRespaldo,
    _mostrarAssurance: mostrarAssurance,
  };

  // Auto-boot: when owner logs in, start the startup check.
  window.addEventListener("oc-login", () => {
    chequearAlArrancar();
  });
})();
