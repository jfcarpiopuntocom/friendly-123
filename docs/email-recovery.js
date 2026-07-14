// email-recovery.js — Envío real del código de reseteo por correo, usando
// EmailJS (servicio gratuito hasta 200 correos/mes, diseñado para apps sin
// backend: todo corre en el navegador con una "public key", no hace falta
// servidor ni SMTP propio). Sin esto, "olvidé mi clave" solo podría MOSTRAR
// el código en pantalla — con esto llega de verdad al correo del dueño.
//
// ===========================================================================
// CONFIGURACIÓN PENDIENTE (JFC) — sin esto el correo NO se envía
// ---------------------------------------------------------------------------
// 1. Crea una cuenta gratis en https://www.emailjs.com
// 2. Conecta un servicio de correo (Gmail, Outlook, etc.) → te da un
//    "Service ID" (ej. "service_abc123")
// 3. Crea un template de email con estas variables: {{to_email}} y
//    {{codigo}} — ej: "Tu código de recuperación de Olimpo Control es:
//    {{codigo}}. Vence en 15 minutos." → te da un "Template ID"
// 4. En "Account" → "General" copia tu "Public Key"
// 5. Pega los 3 valores abajo, en EMAILJS_CONFIG. Repite esto (con su propio
//    template si quieres) en cada negocio/repo — este archivo es idéntico en
//    todos, solo cambia esta configuración.
// Mientras EMAILJS_CONFIG tenga los placeholders de abajo, el sistema cae en
// modo "mostrar el código en pantalla" automáticamente (ver enviarCodigo) —
// nunca falla en seco ni miente diciendo que se envió un correo que no salió.
// ===========================================================================
const EMAILJS_CONFIG = {
  serviceId: "TU_SERVICE_ID",
  templateId: "TU_TEMPLATE_ID",
  publicKey: "TU_PUBLIC_KEY",
};

(function () {
  function configurado() {
    return !Object.values(EMAILJS_CONFIG).some((v) => v.startsWith("TU_"));
  }

  let emailjsListo = null;
  function cargarEmailJS() {
    if (emailjsListo) return emailjsListo;
    emailjsListo = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/@emailjs/browser@4/dist/email.min.js";
      s.onload = () => { window.emailjs.init({ publicKey: EMAILJS_CONFIG.publicKey }); resolve(); };
      s.onerror = () => reject(new Error("No se pudo cargar EmailJS (¿sin internet?)."));
      document.head.appendChild(s);
    });
    return emailjsListo;
  }

  // Devuelve { enviado: true } si el correo salió de verdad, o
  // { enviado: false, codigo } si no hay configuración de EmailJS todavía
  // (modo de respaldo: se muestra el código en pantalla, nunca se pierde el
  // flujo de recuperación por falta de configuración).
  async function enviarCodigo(email, codigo) {
    if (!configurado()) return { enviado: false, codigo };
    try {
      await cargarEmailJS();
      await window.emailjs.send(EMAILJS_CONFIG.serviceId, EMAILJS_CONFIG.templateId, { to_email: email, codigo });
      return { enviado: true };
    } catch (err) {
      console.error("EmailJS falló, se muestra el código en pantalla como respaldo:", err);
      return { enviado: false, codigo };
    }
  }

  window.OCEmailRecovery = { enviarCodigo, configurado };
})();
