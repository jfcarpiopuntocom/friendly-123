// backup-scheduler.js — Backup soberano por correo y/o WhatsApp del propio
// dueño. NUNCA a un servidor central. Filosofía: "el backup va a ti, no a
// nosotros. Nunca sueltas control de tus datos."
//
// ¿Por qué existe?  JFC (2026-07-21): la única forma honesta de garantizar
// que el dueño no pierda sus datos por olvido es que la app misma le esté
// generando correos/mensajes automáticos con el respaldo adjuntable, a SU
// correo/WhatsApp preferido, con la frecuencia que él elija. El mínimo
// mensual es INAMOVIBLE: si un cliente pierde 30 días de datos por descuido,
// mala experiencia; pero >30 días sería inaceptable.
//
// LIMITACIÓN HONESTA (importante — no la escondemos al usuario):
//   Los enlaces mailto: y wa.me NO pueden adjuntar archivos por sí solos
//   (limitación de los estándares). Lo que hacemos:
//     1) Descargamos automáticamente el archivo .json cifrado del respaldo.
//     2) Abrimos mailto: (o wa.me:) con el destinatario, asunto y cuerpo YA
//        escritos. El usuario da 1 toque más (adjuntar el archivo recién
//        descargado) y otro toque a Enviar. Es lo más automático posible
//        desde una PWA sin backend intermediario. Vale la promesa: el
//        backup viaja a TU cuenta, no a la nuestra.
//
// Depende de: window.OCAuth (rol), /api/respaldo/exportar (payload),
// window.OCCryptoStore (si el dueño puso passphrase; para cifrar), y
// window.t() (i18n). No depende de EmailJS ni de ningún servicio pago.
(function () {
  const LS_PREFS = "oc_backup_prefs_v1";
  const LS_LAST  = "oc_backup_last_v1"; // { ts: number, canal: "email"|"whatsapp"|"both" }
  const LS_ASSURED = "oc_backup_assurance_last_v1";

  // Frecuencias en días. Mensual (30) es el mínimo obligatorio: no se puede
  // elegir MÁS de 30 días. Se puede elegir menos (diario, semanal, quincenal).
  const FREQS = [
    { key: "diario",    dias: 1,  labelES: "Diario",    labelEN: "Daily"    },
    { key: "semanal",   dias: 7,  labelES: "Semanal",   labelEN: "Weekly"   },
    { key: "quincenal", dias: 15, labelES: "Quincenal", labelEN: "Biweekly" },
    { key: "mensual",   dias: 30, labelES: "Mensual",   labelEN: "Monthly (minimum)" },
  ];

  function getLang() {
    return (window.OCI18n && window.OCI18n.getLang && window.OCI18n.getLang() === "es") ? "es" : "en";
  }

  function defaults() {
    return {
      frecKey: "mensual",   // mínimo obligatorio como default
      email: "",            // correo preferido del dueño
      whatsapp: "",         // wa.me acepta con o sin +, ver normalizeWa()
      canalEmail: true,     // email marcado por default (es el vehículo mínimo)
      canalWhatsapp: false, // whatsapp opt-in
      configurado: false,   // false = nunca abrió la config; usamos para mostrar aviso
    };
  }

  function getPrefs() {
    try {
      const raw = localStorage.getItem(LS_PREFS);
      if (!raw) return defaults();
      const p = JSON.parse(raw);
      return Object.assign(defaults(), p);
    } catch (_) { return defaults(); }
  }

  function setPrefs(p) {
    try { localStorage.setItem(LS_PREFS, JSON.stringify(p)); } catch (_) {}
  }

  function getLast() {
    try {
      const raw = localStorage.getItem(LS_LAST);
      return raw ? JSON.parse(raw) : null;
    } catch (_) { return null; }
  }

  function setLast(canal) {
    try { localStorage.setItem(LS_LAST, JSON.stringify({ ts: Date.now(), canal })); } catch (_) {}
  }

  function frecDe(key) {
    return FREQS.find((f) => f.key === key) || FREQS[3];
  }

  // ¿Es hora de recordar respaldo? true si nunca se hizo o si pasó la frecuencia elegida.
  function toca(prefs) {
    const last = getLast();
    if (!last) return true;
    const f = frecDe(prefs.frecKey);
    const msLimite = f.dias * 24 * 60 * 60 * 1000;
    return (Date.now() - last.ts) >= msLimite;
  }

  // Fecha/hora local formateada, timestamped para el nombre del archivo y el asunto.
  function stampArchivo(d) {
    const iso = d.toISOString().replace(/[:T]/g, "-").slice(0, 16); // 2026-07-21-02-15
    return iso;
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
    // wa.me acepta solo dígitos, sin +. Aceptamos que el dueño escriba +593 99 990 5080
    return (num || "").replace(/[^\d]/g, "");
  }

  // FIX PREVENTIVO (JFC 2026-07-21): normalizeWa() solo limpia el texto, no
  // valida que sea un número real — un número truncado ("593") generaba un
  // link wa.me roto sin ningún aviso al dueño. 8 dígitos es un mínimo laxo
  // (cubre números locales de 7-8 dígitos + variantes cortas), suficiente
  // para atrapar el caso de "se me fue el dedo" sin bloquear números válidos.
  function waEsValido(num) {
    return normalizeWa(num).length >= 8;
  }

  // Descarga real del respaldo. Reusa el flujo canónico: /api/respaldo/exportar.
  // Si hay passphrase configurada en OCCryptoStore, se cifra igual que la
  // exportación manual (mismo camino, misma cripto — no reinventamos nada).
  async function descargarRespaldo() {
    const res = await fetch("/api/respaldo/exportar");
    if (!res.ok) throw new Error("No se pudo leer los datos del negocio (backend caído?).");
    const datos = await res.json();
    const paquete = {
      app: "friendly-123",
      exportadoEn: new Date().toISOString(),
      schemaVersion: 2,
      datos,
    };
    const texto = JSON.stringify(paquete, null, 2);
    const blob = new Blob([texto], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const now = new Date();
    const nombre = `respaldo-friendly-123-${stampArchivo(now)}.json`;
    const a = document.createElement("a");
    a.href = url;
    a.download = nombre;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return { nombre, humano: stampHumano(now) };
  }

  function cuerpoEmail(nombreArchivo, humano) {
    const lang = getLang();
    if (lang === "es") {
      return `Respaldo de friendly-123 generado el ${humano}.\n\n`
           + `1) Adjunta el archivo "${nombreArchivo}" que se acaba de descargar en este dispositivo (carpeta Descargas).\n`
           + `2) Envíalo a este correo (a ti mismo/a).\n\n`
           + `— El backup va a TI, no a un servidor. Nunca sueltas control de tus datos.`;
    }
    return `friendly-123 backup — ${humano}.\n\n`
         + `1) Attach the file "${nombreArchivo}" that was just downloaded on this device (Downloads folder).\n`
         + `2) Send it to your own email address.\n\n`
         + `— The backup goes to YOU, not to a server. You never give up control of your data.`;
  }

  function cuerpoWa(nombreArchivo, humano) {
    const lang = getLang();
    if (lang === "es") {
      return `Respaldo friendly-123 ${humano}. Adjunta el archivo ${nombreArchivo} recién descargado y envíatelo a ti mismo. El backup vive contigo, no en la nube.`;
    }
    return `friendly-123 backup ${humano}. Attach the file ${nombreArchivo} just downloaded and send it to yourself. The backup lives with you, never in the cloud.`;
  }

  function abrirMailto(email, nombreArchivo, humano) {
    const asunto = getLang() === "es"
      ? `Respaldo friendly-123 — ${humano}`
      : `friendly-123 backup — ${humano}`;
    const body = cuerpoEmail(nombreArchivo, humano);
    const href = `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(asunto)}&body=${encodeURIComponent(body)}`;
    // window.location.href respeta el cliente de correo por default del sistema.
    window.location.href = href;
  }

  function abrirWa(num, nombreArchivo, humano) {
    const texto = cuerpoWa(nombreArchivo, humano);
    const url = `https://wa.me/${normalizeWa(num)}?text=${encodeURIComponent(texto)}`;
    window.open(url, "_blank", "noopener");
  }

  // Corre la rutina completa: descarga + abre canales elegidos + marca timestamp.
  async function correrRespaldo(silencioso) {
    const prefs = getPrefs();
    if (!prefs.canalEmail && !prefs.canalWhatsapp) {
      alert(getLang() === "es"
        ? "Elige al menos un canal (correo y/o WhatsApp) en Avanzado antes de respaldar."
        : "Pick at least one channel (email and/or WhatsApp) in Advanced before backing up.");
      return;
    }
    if (prefs.canalEmail && !prefs.email) {
      alert(getLang() === "es"
        ? "Escribe tu correo preferido en Avanzado antes de respaldar."
        : "Enter your preferred email in Advanced before backing up.");
      return;
    }
    if (prefs.canalWhatsapp && !waEsValido(prefs.whatsapp)) {
      alert(getLang() === "es"
        ? "Tu WhatsApp en Avanzado parece incompleto (con código de país). Corrígelo antes de respaldar."
        : "Your WhatsApp number in Advanced looks incomplete (with country code). Fix it before backing up.");
      return;
    }
    // FIX PREVENTIVO (JFC 2026-07-21): negocios de feria/mercado suelen
    // quedarse sin señal — distinguir "estás offline" de un error real evita
    // que el dueño interprete un fallo de red como que la app está rota.
    // No marcamos setLast() en ningún caso de fallo: el recordatorio vuelve
    // a aparecer la próxima vez que abra Avanzado, que es lo correcto.
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      alert(getLang() === "es"
        ? "Estás sin conexión ahora mismo. El respaldo necesita internet un momento para leer tus datos — inténtalo de nuevo cuando tengas señal."
        : "You're offline right now. The backup needs internet for a moment to read your data — try again once you have signal.");
      return;
    }
    let info;
    try {
      info = await descargarRespaldo();
    } catch (e) {
      alert((getLang() === "es" ? "No se pudo generar el respaldo: " : "Backup failed: ") + e.message);
      return;
    }
    // Abrimos primero email (misma pestaña, es un mailto:), luego wa.me en nueva pestaña.
    // Si el usuario eligió ambos, primero wa.me (nueva pestaña) y después mailto,
    // para no perder el mailto por el open() de wa.me.
    if (prefs.canalWhatsapp) abrirWa(prefs.whatsapp, info.nombre, info.humano);
    if (prefs.canalEmail)    setTimeout(() => abrirMailto(prefs.email, info.nombre, info.humano), 300);

    const canal = prefs.canalEmail && prefs.canalWhatsapp ? "both" : (prefs.canalEmail ? "email" : "whatsapp");
    setLast(canal);

    if (!silencioso) {
      programarAssurance();
    }
  }

  // Popup de "assurance": SEMANAL, amigable, sin ansiedad. Verifica que
  // llegó y desea buena semana. NO es un modal bloqueante — es un toast.
  function programarAssurance() {
    try { localStorage.setItem(LS_ASSURED, String(Date.now())); } catch (_) {}
  }

  function tocaAssurance() {
    const last = getLast();
    if (!last) return false; // aún no hay respaldos
    let assured = 0;
    try { assured = parseInt(localStorage.getItem(LS_ASSURED) || "0", 10) || 0; } catch (_) {}
    const semana = 7 * 24 * 60 * 60 * 1000;
    return (Date.now() - Math.max(last.ts, assured)) >= semana;
  }

  function mostrarAssurance() {
    if (document.getElementById("oc-backup-assurance")) return;
    if (!esDuenoReal()) return; // revalidado: pudo cambiar de rol (o ser demo) durante el delay de arranque
    const wrap = document.createElement("div");
    wrap.id = "oc-backup-assurance";
    // bottom:90px (no 16px/0) para no chocar con el toast de deshacer venta
    // (bottom:16px, z-index:9500, index.html:3640) ni con la barra inferior
    // full-width (bottom:0, z-index:10004, index.html:4031) — ambas ya
    // existían antes de este módulo.
    wrap.style.cssText = "position:fixed;bottom:90px;left:50%;transform:translateX(-50%);z-index:9490;"
      + "background:#F8F9FB;color:#0F1923;border:2px solid #E8A020;border-radius:12px;padding:14px 16px;"
      + "max-width:420px;width:calc(100% - 28px);box-shadow:0 12px 28px rgba(15,25,35,.28);"
      + "font-family:Georgia,serif;font-size:15px;line-height:1.45;";
    const lang = getLang();
    const titulo = lang === "es" ? "¿Llegó tu respaldo a tu correo?" : "Did your backup reach your email?";
    const msg = lang === "es"
      ? "Ábrelo en tu bandeja y verifica que sí lo tienes. Es tuyo — nunca pasa por nosotros. ¡Buena semana!"
      : "Open your inbox and check that it's there. It's yours — it never goes through us. Have a great week!";
    const ok = lang === "es" ? "Sí, llegó — buena semana" : "Yes, it arrived — have a great week";
    const no = lang === "es" ? "Reenviar ahora" : "Send it again now";
    wrap.innerHTML = `
      <div style="font-weight:700;color:#E8A020;margin-bottom:4px;">${titulo}</div>
      <div style="margin-bottom:10px;">${msg}</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <button id="oc-backup-assured-ok" style="flex:1;min-height:40px;padding:8px 12px;border:2px solid #00C87A;background:#00C87A;color:#fff;border-radius:8px;font-weight:700;cursor:pointer;">${ok}</button>
        <button id="oc-backup-assured-resend" style="flex:1;min-height:40px;padding:8px 12px;border:2px solid #2E6278;background:#fff;color:#2E6278;border-radius:8px;font-weight:700;cursor:pointer;">${no}</button>
      </div>`;
    document.body.appendChild(wrap);
    document.getElementById("oc-backup-assured-ok").addEventListener("click", () => {
      try { localStorage.setItem(LS_ASSURED, String(Date.now())); } catch (_) {}
      wrap.remove();
    });
    document.getElementById("oc-backup-assured-resend").addEventListener("click", () => {
      wrap.remove();
      correrRespaldo(false);
    });
  }

  function esDueno() {
    const rol = window.OCAuth && window.OCAuth.rolActual ? window.OCAuth.rolActual() : null;
    return rol === "dueno" || rol === "dueño" || rol === "owner";
  }

  // FIX PREVENTIVO (JFC 2026-07-21): en demo, auth-ui.js asigna rol="dueno"
  // igual (ver auth-ui.js:511), así que esDueno() por sí solo NO excluye la
  // sesión de prueba. Nadie que solo está probando la app debería ver el
  // panel de backup ni recibir el nag de "es hora de respaldar" — mismo
  // patrón ya usado en avanzado-extra.js (líneas 777, 1115, 1146) y en el
  // gate del reporte trimestral que agregamos antes.
  function esDuenoReal() {
    return esDueno() && !(window.OCAuth && window.OCAuth.esDemo && window.OCAuth.esDemo());
  }

  // Chequea al arrancar (con delay para no molestar en el splash) si toca
  // respaldo o assurance. Nunca es bloqueante.
  //
  // FIX PREVENTIVO (JFC 2026-07-21): el dueño puede loguearse y ceder el
  // dispositivo a un empleado DENTRO de los 4s de este delay (pasa seguido
  // en mostrador). Por eso el rol se revalida DOS VECES: aquí al programar
  // el timeout, y otra vez justo antes de pintar cada popup (ver
  // mostrarRecordatorioRespaldo/mostrarAssurance) — nunca confiar en una
  // sola lectura de rol tomada segundos antes de usarla.
  function chequearAlArrancar() {
    setTimeout(() => {
      try {
        if (!esDuenoReal()) return; // solo el dueño real, nunca demo
        const prefs = getPrefs();
        if (!prefs.configurado) return; // no molestar hasta que el dueño abra Avanzado y configure
        if (toca(prefs)) {
          mostrarRecordatorioRespaldo();
        } else if (tocaAssurance()) {
          mostrarAssurance();
        }
      } catch (e) { console.warn("[backup-scheduler] chequeo abortado:", e); }
    }, 4000);
  }

  function mostrarRecordatorioRespaldo() {
    if (document.getElementById("oc-backup-remind")) return;
    if (!esDuenoReal()) return; // revalidado: pudo cambiar de rol (o ser demo) durante el delay de arranque
    const wrap = document.createElement("div");
    wrap.id = "oc-backup-remind";
    // bottom:90px, ver nota en mostrarAssurance() sobre el toast/barra existentes.
    wrap.style.cssText = "position:fixed;bottom:90px;left:50%;transform:translateX(-50%);z-index:9491;"
      + "background:#F8F9FB;color:#0F1923;border:2px solid #E8A020;border-radius:12px;padding:14px 16px;"
      + "max-width:440px;width:calc(100% - 28px);box-shadow:0 12px 28px rgba(15,25,35,.32);"
      + "font-family:Georgia,serif;font-size:15px;line-height:1.45;";
    const lang = getLang();
    const prefs = getPrefs();
    const f = frecDe(prefs.frecKey);
    const canales = [prefs.canalEmail && (lang === "es" ? "correo" : "email"),
                     prefs.canalWhatsapp && "WhatsApp"].filter(Boolean).join(" + ");
    const titulo = lang === "es" ? "Es hora de tu respaldo" : "Time for your backup";
    const msg = lang === "es"
      ? `Toca "Respaldar ahora" y te preparamos el archivo + un correo/WhatsApp con todo listo. Solo te queda adjuntar y enviar — <b>a ti mismo/a</b>. Frecuencia elegida: <b>${f.labelES.toLowerCase()}</b> por ${canales || "correo"}.`
      : `Tap "Back up now" and we'll prepare the file + an email/WhatsApp with everything ready. You just attach and hit send — <b>to yourself</b>. Chosen frequency: <b>${f.labelEN.toLowerCase()}</b> via ${canales || "email"}.`;
    const ok = lang === "es" ? "Respaldar ahora" : "Back up now";
    const luego = lang === "es" ? "Más tarde" : "Later";
    wrap.innerHTML = `
      <div style="font-weight:700;color:#E8A020;margin-bottom:4px;">${titulo}</div>
      <div style="margin-bottom:10px;">${msg}</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <button id="oc-backup-remind-ok" style="flex:1;min-height:40px;padding:8px 12px;border:2px solid #E8A020;background:#E8A020;color:#fff;border-radius:8px;font-weight:700;cursor:pointer;">${ok}</button>
        <button id="oc-backup-remind-later" style="flex:1;min-height:40px;padding:8px 12px;border:2px solid #2E6278;background:#fff;color:#2E6278;border-radius:8px;font-weight:700;cursor:pointer;">${luego}</button>
      </div>`;
    document.body.appendChild(wrap);
    document.getElementById("oc-backup-remind-ok").addEventListener("click", () => {
      wrap.remove();
      correrRespaldo(false);
    });
    document.getElementById("oc-backup-remind-later").addEventListener("click", () => {
      wrap.remove();
      // Postponer 24h: marca assured para que no vuelva a molestar hoy.
      try { localStorage.setItem(LS_ASSURED, String(Date.now() - (6 * 24 * 60 * 60 * 1000))); } catch (_) {}
    });
  }

  // ==========================================================================
  // Render de la UI de configuración en Avanzado. Lo llama avanzado-extra.js
  // pasando el <div> destino. Mantengo la UI pequeña y adosada al card de
  // Gestión — no interrumpe el flujo del dueño.
  // ==========================================================================
  function renderPanel(mount) {
    if (!mount) return;
    // FIX PREVENTIVO: no mostrar la config de backup a quien solo prueba la
    // demo — ver nota en esDuenoReal() más arriba.
    if (window.OCAuth && window.OCAuth.esDemo && window.OCAuth.esDemo()) { mount.innerHTML = ""; return; }
    const prefs = getPrefs();
    const lang = getLang();
    const T = (es, en) => lang === "es" ? es : en;
    const opts = FREQS.map((f) => {
      const label = lang === "es" ? f.labelES : f.labelEN;
      const sel = f.key === prefs.frecKey ? "selected" : "";
      return `<option value="${f.key}" ${sel}>${label}</option>`;
    }).join("");
    mount.innerHTML = `
      <div style="border:2px solid #E8A020;border-radius:12px;padding:14px 16px;background:#FFF8EC;margin-top:16px;">
        <h3 style="margin:0 0 4px;color:#C05000;font-family:Georgia,serif;font-size:19px;">
          ${T("Respaldo a tu correo y/o WhatsApp", "Backup to your own email and/or WhatsApp")}
        </h3>
        <p style="margin:0 0 12px;font-size:15px;color:#0F1923;font-weight:700;">
          ${T("El backup va a TI, no a nosotros. Nunca sueltas control de tus datos.", "The backup goes to YOU, not us. You never give up control of your data.")}
        </p>
        <p style="margin:0 0 12px;font-size:14px;color:#2C3E50;line-height:1.5;">
          ${T("La app te descarga el archivo y te abre el correo/WhatsApp con todo escrito. Tú adjuntas y envías — a ti mismo/a. El mínimo mensual es obligatorio: así, si algo se pierde por descuido, nunca son más de 30 días.",
              "The app downloads the file and opens your email/WhatsApp with everything pre-written. You attach and hit send — to yourself. Monthly is the mandatory minimum: even in the worst-case slip, you never lose more than 30 days.")}
        </p>

        <div style="display:grid;grid-template-columns:1fr;gap:10px;">
          <label style="font-size:14px;font-weight:700;">
            ${T("Frecuencia", "Frequency")}
            <select id="oc-bk-frec" style="display:block;margin-top:4px;padding:8px;border:2px solid #E86040;border-radius:6px;min-height:40px;width:100%;max-width:280px;">
              ${opts}
            </select>
          </label>

          <label style="font-size:14px;font-weight:700;">
            <input type="checkbox" id="oc-bk-canalEmail" ${prefs.canalEmail ? "checked" : ""} style="min-width:20px;min-height:20px;vertical-align:middle;margin-right:6px;">
            ${T("Enviarme por correo", "Send me by email")}
          </label>
          <input type="email" id="oc-bk-email" value="${(prefs.email || "").replace(/"/g, "&quot;")}" placeholder="${T("tu@correo.com", "you@email.com")}"
            style="padding:10px;border:2px solid #E86040;border-radius:6px;min-height:44px;max-width:340px;font-size:15px;">

          <label style="font-size:14px;font-weight:700;">
            <input type="checkbox" id="oc-bk-canalWa" ${prefs.canalWhatsapp ? "checked" : ""} style="min-width:20px;min-height:20px;vertical-align:middle;margin-right:6px;">
            ${T("Enviarme por WhatsApp", "Send me on WhatsApp")}
          </label>
          <input type="tel" id="oc-bk-wa" value="${(prefs.whatsapp || "").replace(/"/g, "&quot;")}" placeholder="${T("+593 99 990 5080", "+1 555 123 4567")}"
            style="padding:10px;border:2px solid #E86040;border-radius:6px;min-height:44px;max-width:340px;font-size:15px;">
        </div>

        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:14px;">
          <button id="oc-bk-guardar" style="min-height:44px;padding:10px 16px;border:2px solid #2E6278;background:#2E6278;color:#fff;border-radius:8px;font-weight:700;font-size:15px;cursor:pointer;">
            ${T("Guardar preferencia", "Save preference")}
          </button>
          <button id="oc-bk-correr" style="min-height:44px;padding:10px 16px;border:2px solid #E8A020;background:#E8A020;color:#fff;border-radius:8px;font-weight:700;font-size:15px;cursor:pointer;">
            ${T("Respaldar ahora", "Back up now")}
          </button>
        </div>
        <p id="oc-bk-msg" style="margin:10px 0 0;font-size:14px;font-weight:700;color:#2E6278;"></p>
        <p style="margin:8px 0 0;font-size:13px;color:#2C3E50;">
          <b>${T("Nota honesta:", "Honest note:")}</b>
          ${T("los enlaces mailto: y wa.me no pueden adjuntar archivos automáticamente (limitación de los estándares web). Por eso descargamos el archivo primero y te abrimos el mensaje con el destinatario y el texto ya listos — tú solo adjuntas y envías. Es lo más automático posible sin que nada pase por nosotros.",
              "mailto: and wa.me links can't attach files by themselves (web standards limitation). That's why we download the file first and open the message with recipient and body pre-written — you just attach and send. Most automatic possible without anything passing through us.")}
        </p>
      </div>
    `;

    function msg(txt, color) {
      const m = document.getElementById("oc-bk-msg");
      if (m) { m.textContent = txt; m.style.color = color || "#2E6278"; }
    }

    document.getElementById("oc-bk-guardar").addEventListener("click", () => {
      const nueva = {
        frecKey: document.getElementById("oc-bk-frec").value,
        email: document.getElementById("oc-bk-email").value.trim(),
        whatsapp: document.getElementById("oc-bk-wa").value.trim(),
        canalEmail: document.getElementById("oc-bk-canalEmail").checked,
        canalWhatsapp: document.getElementById("oc-bk-canalWa").checked,
        configurado: true,
      };
      // Validación mínima: si eligió email, tiene que tener correo. Igual WhatsApp.
      if (nueva.canalEmail && !nueva.email) { msg(T("Falta tu correo.", "Missing your email."), "#E8365D"); return; }
      if (nueva.canalWhatsapp && !waEsValido(nueva.whatsapp)) { msg(T("Tu WhatsApp parece incompleto — inclúyelo con código de país.", "Your WhatsApp looks incomplete — include the country code."), "#E8365D"); return; }
      if (!nueva.canalEmail && !nueva.canalWhatsapp) { msg(T("Elige al menos un canal.", "Pick at least one channel."), "#E8365D"); return; }
      setPrefs(nueva);
      msg(T("Listo. Guardado. Podemos respaldar cuando quieras.", "Saved. We can back up whenever you like."), "#00C87A");
    });

    document.getElementById("oc-bk-correr").addEventListener("click", () => {
      correrRespaldo(false);
    });
  }

  // API pública mínima. avanzado-extra.js llama a OCBackupScheduler.montar(...)
  // desde el card de Gestión, e index.html arranca el chequeo periódico al
  // login del dueño.
  window.OCBackupScheduler = {
    montar: renderPanel,
    correr: correrRespaldo,
    chequearAlArrancar,
    getPrefs,
    // Utilidades expuestas para pruebas manuales desde DevTools:
    _toca: () => toca(getPrefs()),
    _mostrarRecordatorio: mostrarRecordatorioRespaldo,
    _mostrarAssurance: mostrarAssurance,
  };

  // Auto-boot: cuando el dueño hace login, arrancamos el chequeo.
  window.addEventListener("oc-login", () => {
    chequearAlArrancar();
  });

  // FIX PREVENTIVO (JFC 2026-07-21): a diferencia de help-ui.js (que escucha
  // "oc-lang-change" y repinta sus textos fijos, ver help-ui.js:262), este
  // módulo se quedaba congelado en el idioma con el que se renderizó. Si el
  // panel de Avanzado está montado, se re-renderiza con renderPanel() (ya es
  // idempotente: reconstruye su innerHTML leyendo getLang() de nuevo). Los
  // popups de recordatorio/assurance, si están abiertos, simplemente se
  // cierran — el próximo chequeo automático los vuelve a mostrar ya en el
  // idioma correcto; repintar un popup abierto en caliente no vale la
  // complejidad extra para un caso tan raro.
  window.addEventListener("oc-lang-change", () => {
    const mount = document.getElementById("oc-backup-scheduler-mount");
    if (mount && mount.childNodes.length) renderPanel(mount);
    const remind = document.getElementById("oc-backup-remind");
    if (remind) remind.remove();
    const assurance = document.getElementById("oc-backup-assurance");
    if (assurance) assurance.remove();
  });
})();
