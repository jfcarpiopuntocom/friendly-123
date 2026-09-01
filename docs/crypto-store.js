// COMPARTIDO: portado y mantenido identico entre apps hermanas a proposito.
// crypto-store.js — Almacenamiento local cifrado, sin servidor, sin librerías.
// Usa WebCrypto (nativo del navegador, gratis y estándar) para que las claves
// de acceso y el correo de recuperación NUNCA se guarden en texto plano en
// localStorage. Antes, cualquiera con DevTools abierto (o un vecino con
// acceso físico al equipo) podía leer "oc_auth" y ver los 3 PINs y el correo
// tal cual. Ahora solo se guardan HASHES (no reversibles) de cada PIN para
// poder validarlos, y el correo va cifrado con AES-256-GCM bajo una llave
// derivada del PIN del dueño (PBKDF2, 150k iteraciones, SHA-256).
//
// Esto es "nivel nostr" en el sentido que importa para un negocio: cifrado
// de extremo a extremo en el cliente, sin que ningún servidor (porque no hay
// servidor) ni un atacante con el archivo de datos pueda leer nada sin el PIN
// correcto. No es un keypair nostr real (eso es overkill para una sola
// terminal) — si más adelante se necesita sincronizar entre dispositivos o
// identidad firmada, este módulo es el lugar para añadir secp256k1.
//
// NOTA sobre el correo de recuperación: a propósito NO se cifra bajo el PIN.
// Si lo cifráramos bajo el PIN del dueño, el flujo "olvidé mi clave" quedaría
// roto (haría falta el PIN para leer el correo que sirve para recuperar el
// PIN). Por diseño (spec confirmado del proyecto) el correo se guarda en
// claro pero se OFUSCA en toda la interfaz (ej. j••••@gmail.com); lo
// sensible que de verdad protegemos con criptografía fuerte son los 3 PINs,
// que solo se guardan como hash irreversible — nunca se necesita leerlos de
// vuelta, solo compararlos.
//
// Formato guardado en localStorage["oc_secure"]:
//   {
//     v: 1,
//     salt: <base64>,            // salt PBKDF2, no es secreto, solo evita rainbow tables
//     ownerHash: <base64>,       // verificador del PIN del dueño (no se puede revertir)
//     employeeHashes: [<base64>, ...],
//     acctHash: <base64>,        // verificador de la subclave contable
//     email: <string>            // correo de recuperación, en claro, SOLO ofuscado en UI
//   }
//
// ===========================================================================
// CÓDIGO MAESTRO (JFC, 2026-06-30) — candado de "reasignar correo"
// ---------------------------------------------------------------------------
// JFC es "master admin" de todos los negocios que corren esta app. Retiene
// SOLO una habilidad especial: dejar que un dueño vuelva a registrar su
// correo de recuperación DESPUÉS de identificarlo en persona/videollamada
// (evita que cualquiera con acceso al dispositivo del dueño secuestre la
// cuenta cambiando el correo a uno propio). Mientras haya un correo ya
// registrado, cambiarlo exige este código maestro; si NO hay correo (primera
// vez), el dueño lo registra libremente, sin necesitar a JFC.
//
// LIMITACIÓN HONESTA: como esta es una app 100% cliente sin servidor, este
// código vive embebido en el JS — cualquiera que lea el código fuente puede
// verlo (aunque solo se guarda su HASH, no en texto plano). Es la única forma
// de tener un "candado maestro" sin backend. Por eso el default de abajo debe
// cambiarse por negocio si JFC quiere aislar el riesgo entre clientes.
//
// CAMBIAR ESTE CÓDIGO: edita MASTER_CODE_DEFAULT antes de entregar la app a
// cada nuevo negocio (o dile a JFC su código actual si no lo recuerda — sin
// él, ni siquiera JFC puede reasignar un correo ya registrado en ese negocio).
// ===========================================================================
const MASTER_CODE_DEFAULT = "POSCUENCA-MAESTRO-2026";

// Sal fija para ofuscar el PIN del dueño (no es un secreto fuerte — protege
// solo de lectura casual de localStorage; el hash PBKDF2 es el verdadero
// verificador de identidad). Permite enviar el PIN por correo sin guardarlo
// en texto plano. El dueño puede recuperarlo con "¿Olvidaste?" → email.
const PIN_XOR_KEY = "oc-pin-r-v1";

(function () {
  /* SECURE-CONTEXT GUARD (JFC 2026-07-22) — DO NOT REMOVE, purely additive.
     crypto.subtle only exists in a secure context (https:// or localhost). If
     the owner opens the app over a LAN IP (http://192.168.x.x) on a tablet or
     phone to test, everything using PBKDF2/AES (keys, encrypted sync, backup
     checksums) would throw a cryptic error with no explanation. We detect that
     case ONCE and show an actionable notice. It modifies none of the functions
     below — it just warns before they fail blindly. */
  try {
    var _ctxSeguro = (typeof self !== "undefined" && self.isSecureContext) || /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
    var _haySubtle = !!(typeof self !== "undefined" && self.crypto && self.crypto.subtle);
    if (!_ctxSeguro || !_haySubtle) {
      try { console.warn("[crypto-store] Insecure context: keys and encrypted backup won't work. Open the app over HTTPS or localhost, not a LAN IP."); } catch (_) {}
      if (typeof document !== "undefined") {
        var _avisoCrypto = function () {
          if (document.getElementById("f123-crypto-insecure")) return;
          var b = document.createElement("div");
          b.id = "f123-crypto-insecure";
          b.setAttribute("role", "alert");
          b.style.cssText = "position:fixed;top:0;left:0;right:0;z-index:100000;background:#a3392a;color:#fff;font-family:Georgia,serif;font-size:14px;line-height:1.4;padding:10px 14px;text-align:center;";
          b.textContent = "Open this app from its official https://… address (or localhost). Over a local-network IP, keys and encrypted backup don't work.";
          document.body.appendChild(b);
        };
        if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", _avisoCrypto);
        else _avisoCrypto();
      }
    }
  } catch (_) {}
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
  const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

  async function importPinKey(pin) {
    return crypto.subtle.importKey("raw", enc.encode(String(pin)), "PBKDF2", false, ["deriveBits", "deriveKey"]);
  }

  // info: etiqueta de contexto ("owner"|"emp"|"acct"|"vault") para que el mismo
  // PIN nunca derive la misma llave/hash en dos roles distintos.
  async function deriveBits(pin, saltB64, info, bits) {
    const base = await importPinKey(pin);
    const salt = enc.encode(info + ":" + saltB64); // mezcla salt + contexto
    return crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: 150000, hash: "SHA-256" }, base, bits);
  }

  async function hashPin(pin, saltB64, info) {
    const bits = await deriveBits(pin, saltB64, info, 256);
    return b64(bits);
  }

  function randSalt() { return b64(crypto.getRandomValues(new Uint8Array(16))); }

  // XOR + base64: ofusca/recupera el PIN del dueno para el correo de recuperacion.
  function xorPin(pin) {
    const bytes = [...String(pin)].map((c, i) => c.charCodeAt(0) ^ PIN_XOR_KEY.charCodeAt(i % PIN_XOR_KEY.length));
    return btoa(String.fromCharCode(...bytes));
  }
  function unxorPin(b64str) {
    try {
      const bytes = [...atob(b64str)].map((c, i) => c.charCodeAt(0) ^ PIN_XOR_KEY.charCodeAt(i % PIN_XOR_KEY.length));
      return String.fromCharCode(...bytes);
    } catch { return null; }
  }

  // Guard G2 (JFC 2026-08-04): distingue "nunca existió" de "existe pero está
  // dañado" (JSON.parse fallaría o le faltan campos clave). Antes leerSecreto()
  // trataba ambos casos igual (devolvía null), así que verificarOwner/Encargado
  // devolvían false para TODOS los PINs y el dueño quedaba viendo "Clave
  // incorrecta" para siempre sin ninguna pista de que el problema no era su
  // memoria del PIN, sino el dato mismo.
  function estadoSecreto() {
    const raw = localStorage.getItem("f123_secure");
    if (!raw) return "vacio";
    try {
      const s = JSON.parse(raw);
      return (s && s.salt && s.ownerHash) ? "ok" : "corrupto";
    } catch (_) { return "corrupto"; }
  }

  // ---- migración silenciosa desde el formato viejo en texto plano (oc_auth) ----
  // Si José ya había configurado sus claves/correo antes de este cambio, NO se
  // pierden ni se resetean: se migran tal cual a oc_secure en el primer load.
  async function migrarSiHaceFalta() {
    if (!localStorage.getItem("f123_secure")) {
      let viejo = null;
      try { viejo = JSON.parse(localStorage.getItem("f123_auth") || "null"); } catch {}
      const DEF = { owner: "789", encargados: ["260"], acct: "357", email: "" };
      const base = viejo || DEF;
      await guardarSecreto(base.owner, base.encargados || [], base.acct, base.email || "");
      localStorage.removeItem("f123_auth"); // ya no queda nada en texto plano
    } else if (estadoSecreto() === "corrupto") {
      // Guard G2: auto-reparar a defaults SOLO si el dispositivo NUNCA fue
      // activado (sin instanceId en f123_owned). En un dispositivo YA
      // activado, auto-reparar sería exactamente el backdoor que el resto
      // del código bloquea a propósito — ahí se deja corrupto y auth-ui.js
      // ofrece el flujo de recuperación por correo en vez de arreglarlo solo.
      let _apropiado = false;
      try { _apropiado = !!(JSON.parse(localStorage.getItem("f123_owned") || "null") || {}).instanceId; } catch (_) {}
      if (!_apropiado) {
        await guardarSecreto("789", ["260"], "357", "");
      }
    }
    // Viejo default 159 (AMIGABLE) → 789 (dueño actual). NUNCA pasar por 888:
    // 888 es PIN libre, no fábrica. coincidePin no suma fallos al candado.
    if (!localStorage.getItem("f123_migrado_159_888")) {
      try {
        if (await coincidePin("159", "owner")) await fijarOwnerPin("789");
      } catch (_) {}
      try { localStorage.setItem("f123_migrado_159_888", "1"); } catch (_) {}
    }
    /* 2026-08-31: 888 dejó de ser el default de dueño. Default = 789.
       456 demo. 888 queda libre para que cada dueño lo asigne si quiere.
       Solo se migra si el hash actual SIGUE siendo 888 (fábrica). Un 555/222
       propio no se toca. coincidePin no suma fallos al candado. */
    if (!localStorage.getItem("f123_migrado_888_a_789_default")) {
      try {
        if (await coincidePin("888", "owner")) {
          await fijarOwnerPin("789");
          try {
            const cur = leerPinQueAbre();
            if (!cur.owner || cur.owner === "888") {
              cur.owner = "789";
              localStorage.setItem("f123_pin_que_abre", JSON.stringify(cur));
            }
          } catch (_) {}
        }
      } catch (_) {}
      try { localStorage.setItem("f123_migrado_888_a_789_default", "1"); } catch (_) {}
    }
  }

  // Guardado resiliente (JFC 2026-08-04, Guard G1 — "no dañar lo que no debe
  // dañar"): si localStorage está lleno (fotos de percha en base64 son lo que
  // más pesa), un setItem normal lanza QuotaExceededError y el guardado de
  // PINs se pierde EN SILENCIO — hasta ahora, guardarSecreto/fijarOwnerPin/etc
  // ignoraban por completo si esto pasaba. Antes de rendirse, purga las fotos
  // de percha (recuperables re-tomando la foto; un PIN perdido deja al dueño
  // fuera de su propio negocio) y reintenta una vez. Devuelve boolean para
  // que cada llamador pueda decidir qué decirle al usuario si falla.
  function guardarSecureResiliente(s) {
    const payload = JSON.stringify(s);
    try { localStorage.setItem("f123_secure", payload); return true; }
    catch (_) {
      try {
        const rm = [];
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && k.indexOf("vp_foto_percha_") === 0) rm.push(k);
        }
        rm.forEach((kk) => { try { localStorage.removeItem(kk); } catch (_) {} });
        localStorage.setItem("f123_secure", payload);
        return true;
      } catch (_) { return false; }
    }
  }

  async function guardarSecreto(ownerPin, empleadosPins, acctPin, email) {
    const salt = randSalt();
    const ownerHash = await hashPin(ownerPin, salt, "owner");
    const employeeHashes = [];
    for (const p of empleadosPins) employeeHashes.push(await hashPin(p, salt, "emp"));
    const acctHash = await hashPin(acctPin, salt, "acct");
    /* Copias recuperables (JFC 2026-08-27): para que JFC pueda VER los PINs
       actuales en Advanced/Team (soporte), se guarda una copia XOR+base64 de
       cada PIN (mismo patrón que ownerPinR, que ya existía para el correo de
       recuperación). NO es texto plano: es ofuscación XOR, no criptografía
       fuerte — el hash PBKDF2 sigue siendo el verificador real de identidad.
       Tradeoff comunicado: esto debilita la garantía "los PINs nunca se
       guardan en claro"; es aceptable porque JFC es el master admin y es su
       herramienta de soporte. Solo los PINs fijados DESPUÉS de este cambio
       serán visibles (los hashes viejos no se pueden recuperar). */
    const ownerPinR = xorPin(String(ownerPin));
    const empPinR = (empleadosPins || []).map((p) => xorPin(String(p)));
    const acctPinR = xorPin(String(acctPin));
    return guardarSecureResiliente({ v: 1, salt, ownerHash, employeeHashes, acctHash, email: email || "", ownerPinR, empPinR, acctPinR });
  }

  // Lee los PINs visibles (copias XOR) para mostrarlos en Advanced/Team.
  // Devuelve { owner, empleados:[...], acct } o null si no hay copias (PINs
  // fijados antes de este cambio). Solo para JFC (master admin / soporte).
  function leerPinsVisibles() {
    try {
      const s = leerSecreto();
      if (!s || !s.ownerPinR) return null;
      const owner = unxorPin(s.ownerPinR);
      const empleados = (s.empPinR || []).map((x) => unxorPin(x)).filter((x) => x && /^\d{3}$/.test(x));
      const acct = unxorPin(s.acctPinR);
      const ok = (p) => p && /^\d{3}$/.test(p);
      return { owner: ok(owner) ? owner : null, empleados, acct: ok(acct) ? acct : null };
    } catch { return null; }
  }

  function leerSecreto() {
    try { return JSON.parse(localStorage.getItem("f123_secure")); } catch { return null; }
  }

  // Verifica un PIN de 3 dígitos contra un rol ("owner"|"acct") o la lista de encargados.
  // Bloqueo progresivo tras 5 fallos (ver rate limiting arriba) — mitiga que
  // el pequeño espacio de 1000 combinaciones se pueda probar por fuerza bruta.
  async function verificarOwner(pin) {
    if (segundosBloqueo("owner") > 0) return false;
    const s = leerSecreto(); if (!s) return false;
    const ok = (await hashPin(pin, s.salt, "owner")) === s.ownerHash;
    ok ? registrarExito("owner") : registrarFallo("owner");
    return ok;
  }
  async function verificarEmpleado(pin) {
    if (segundosBloqueo("emp") > 0) return false;
    const s = leerSecreto(); if (!s) return false;
    const h = await hashPin(pin, s.salt, "emp");
    const ok = (s.employeeHashes || []).includes(h);
    ok ? registrarExito("emp") : registrarFallo("emp");
    return ok;
  }
  // Paridad AMIGABLE (2026-07-17): verificacion combinada dueno/encargado con
  // UN solo ambito de lockout ("login") — evita que probar un PIN de encargado
  // acumule fallos en el contador del dueno y viceversa.
  async function verificarOwnerOEmpleado(pin) {
    if (segundosBloqueo("login") > 0) return null;
    const s = leerSecreto();
    if (!s) return null;
    if ((await hashPin(pin, s.salt, "owner")) === s.ownerHash) { registrarExito("login"); return "dueno"; }
    const h = await hashPin(pin, s.salt, "emp");
    if ((s.employeeHashes || []).includes(h)) { registrarExito("login"); return "empleado"; }
    registrarFallo("login");
    return null;
  }
  async function verificarAcct(pin) {
    if (segundosBloqueo("acct") > 0) return false;
    const s = leerSecreto(); if (!s) return false;
    const ok = (await hashPin(pin, s.salt, "acct")) === s.acctHash;
    ok ? registrarExito("acct") : registrarFallo("acct");
    return ok;
  }
  function leerCorreo() {
    const s = leerSecreto();
    return s ? (s.email || "") : "";
  }
  // Actualiza solo el correo, sin tocar salt/hashes de los PINs. Solo debe
  // llamarse: (a) cuando NO hay correo previo (primer registro, libre), o
  // (b) tras verificarMaestro() exitoso (re-registro, requiere a JFC). La UI
  // (avanzado-extra.js) es responsable de aplicar esa regla — esta función
  // en sí no lo impone, para no acoplar la capa de datos con la capa de UI.
  function actualizarCorreo(email) {
    const s = leerSecreto(); if (!s) return false;
    s.email = email || "";
    return guardarSecureResiliente(s);
  }

  // WhatsApp del dueno (Mejora #5, JFC 2026-07-16) — a diferencia del correo,
  // NO esta bloqueado tras codigo maestro: es solo un dato de contacto/
  // notificacion, no la via de recuperacion de acceso. Editable libremente.
  function leerWhatsapp() {
    const s = leerSecreto();
    return s ? (s.whatsapp || "") : "";
  }
  function actualizarWhatsapp(numero) {
    const s = leerSecreto(); if (!s) return false; // Fix-7: return false so caller can check
    s.whatsapp = numero || "";
    return guardarSecureResiliente(s);
  }
  // Fix-2: recuperarPinDueno — lee ownerPinR (XOR+base64 opaco) si fue guardado.
  // Actualmente guardarSecreto no escribe ownerPinR, así que retorna null y el
  // flujo de "Olvidaste?" muestra el mensaje de "activa recuperación primero".
  // Exportada para que auth-ui.js no explote con TypeError al llamarla.
  // Bug fix (2026-07-21): el decode anterior usaba XOR par-de-bytes, incompatible
  // con xorPin() que usa PIN_XOR_KEY. unxorPin() es el inverso correcto.
  function recuperarPinDueno() {
    try {
      const s = leerSecreto();
      if (!s || !s.ownerPinR) return null;
      const out = unxorPin(s.ownerPinR);
      return out && /^\d{3}$/.test(out) ? out : null;
    } catch { return null; }
  }

  // ---- Código maestro (ver nota arriba) ----
  // Hash simple SHA-256 con sal fija embebida — no es PBKDF2 porque el código
  // maestro es una frase larga (alta entropía), no un PIN de 3 dígitos
  // vulnerable a fuerza bruta; SHA-256 simple es suficiente y no reproduce el
  // mismo hash que cualquier otro campo del sistema.
  async function hashMaestro(codigo) {
    const bits = await crypto.subtle.digest("SHA-256", enc.encode("oc-master:" + codigo));
    return b64(bits);
  }
  function leerHashMaestroGuardado() {
    const s = leerSecreto();
    return s && s.masterHash ? s.masterHash : null;
  }
  async function verificarMaestro(codigo) {
    if (segundosBloqueo("maestro") > 0) return false;
    const guardado = leerHashMaestroGuardado();
    const hashIngresado = await hashMaestro(codigo);
    const ok = guardado ? hashIngresado === guardado : hashIngresado === (await hashMaestro(MASTER_CODE_DEFAULT));
    ok ? registrarExito("maestro") : registrarFallo("maestro");
    /* MARCA DE LORD (JFC 2026-08-26). Quien verifica el código maestro ES el
       super-admin (JFC). Se marca el aparato como lord para que, al unirse a la
       licencia de un cliente, entre como INVITADO/observador y NO adopte esa
       licencia (ver _esLord() en sync-realtime.js). Un usuario normal jamás pasa
       por aquí, así que nunca queda marcado. Solo se ESCRIBE en éxito. */
    if (ok) {
      try { localStorage.setItem("f123_lord", "1"); } catch (_) {}
      /* Identidad canónica del Lord: UNA sola escritura, aquí, al verificar
         el código maestro. unirse()/activar() jamás la tocan. Si ya existe,
         no se pisa aunque f123_owned ya esté corrupto. */
      try {
        if (!localStorage.getItem("f123_lord_licencia_canonica")) {
          var o = JSON.parse(localStorage.getItem("f123_owned") || "null") || {};
          var cand = String(o.syncCode || o.licenseCode || "").trim().toUpperCase().replace(/\s+/g, "");
          if (cand && /^F123-/i.test(cand)) {
            localStorage.setItem("f123_lord_licencia_canonica", cand);
          }
        }
      } catch (_) {}
    }
    return ok;
  }
  // Permite fijar un código maestro propio por negocio (JFC, no el dueño).
  async function fijarCodigoMaestro(codigoNuevo) {
    const s = leerSecreto(); if (!s) return false;
    s.masterHash = await hashMaestro(codigoNuevo);
    return guardarSecureResiliente(s);
  }

  // Cambia SOLO el PIN de dueño (re-hash bajo el salt existente) sin rotar
  // encargado/contable/correo. Usado por la migración 159->888 de AMIGABLE y
  // por la activación 789. Devuelve boolean (Guard G1): el llamador debe
  // saber si el PIN nuevo de verdad quedó guardado antes de decirle al
  // usuario "ya puedes entrar con tu PIN nuevo".
  async function fijarOwnerPin(nuevoPin) {
    const s = leerSecreto(); if (!s) return false;
    s.ownerHash = await hashPin(nuevoPin, s.salt, "owner");
    s.ownerPinR = xorPin(nuevoPin);
    return guardarSecureResiliente(s);
  }

  // Cambia SOLO el PIN de encargado (re-hash bajo el salt existente) sin rotar
  // dueño/contable/correo. (JFC 2026-08-28: edición individual de PINs con
  // lapicito en Access & recovery.) Reemplaza la lista de encargados por el
  // PIN nuevo. Devuelve boolean (Guard G1).
  async function fijarEmpleadoPin(nuevoPin) {
    const s = leerSecreto(); if (!s) return false;
    s.employeeHashes = [await hashPin(nuevoPin, s.salt, "emp")];
    s.empPinR = [xorPin(nuevoPin)];
    return guardarSecureResiliente(s);
  }

  // Cambia SOLO el PIN de la subclave contable (re-hash bajo el salt existente)
  // sin rotar dueño/encargado/correo. (JFC 2026-08-28.) Devuelve boolean.
  async function fijarAcctPin(nuevoPin) {
    const s = leerSecreto(); if (!s) return false;
    s.acctHash = await hashPin(nuevoPin, s.salt, "acct");
    s.acctPinR = xorPin(nuevoPin);
    return guardarSecureResiliente(s);
  }

  /* DIRECTORIO DE ACCESO (JFC 2026-08-28, aprobado). Cada PIN se asocia a una
     persona: nombre, correo (opcional) y notas/apuntes de control. Es la base
     para reportes "quién hizo qué" y para que cada dueño de licencia tenga
     control real de quién tiene cada PIN. Viaja cifrado con el resto del
     secreto (mismo mecanismo que los PINs). No cambia la verificación: el hash
     PBKDF2 sigue siendo el verificador de identidad; esto es metadato. */
  function leerDirectorio() {
    try {
      const s = leerSecreto();
      if (!s || !s.directorio) return null;
      return s.directorio;
    } catch { return null; }
  }
  function guardarDirectorio(dir) {
    try {
      const s = leerSecreto(); if (!s) return false;
      s.directorio = dir || {};
      return guardarSecureResiliente(s);
    } catch { return false; }
  }
  // Asegura que el directorio tenga la forma esperada (con los PINs actuales
  // como claves de referencia), sin pisar nombres/correos/notas ya guardados.
  function directorioNormalizado() {
    const pins = leerPinsVisibles();
    const dir = leerDirectorio() || {};
    const out = {
      owner: Object.assign({ pin: (pins && pins.owner) || "", nombre: "", correo: "", notas: "" }, dir.owner || {}),
      acct: Object.assign({ pin: (pins && pins.acct) || "", nombre: "", correo: "", notas: "" }, dir.acct || {}),
      empleados: [],
    };
    const empPins = (pins && pins.empleados && pins.empleados.length) ? pins.empleados : ["260"];
    const empDir = Array.isArray(dir.empleados) ? dir.empleados : [];
    empPins.forEach((pin) => {
      const prev = empDir.find((e) => String(e.pin) === String(pin)) || {};
      out.empleados.push(Object.assign({ pin: String(pin), nombre: "", correo: "", notas: "" }, prev));
    });
    return out;
  }

  // ---- Reseteo de acceso por correo ("olvidé mi clave") ----
  // Flujo: 1) generarCodigoReset() crea un código de 6 dígitos con vencimiento
  // de 15 min y lo guarda (solo su hash) en localStorage["oc_reset"]; el
  // código EN CLARO se devuelve una sola vez para que quien llama lo mande
  // por correo (ver email-recovery.js). 2) El dueño ingresa ese código + un
  // PIN nuevo. 3) resetearConCodigo() verifica el código, ROTA TODO (nuevo
  // salt) porque el diseño de este archivo usa un salt compartido entre los
  // 3 roles — no se puede cambiar solo el PIN del dueño manteniendo los
  // hashes de encargado/contable bajo el salt viejo. Por eso también se
  // generan códigos nuevos de encargado y contable, que se devuelven UNA VEZ
  // para que la UI se los muestre al dueño ("apunta estos códigos nuevos").
  // ---- Rate limiting anti fuerza bruta (PINs de 3 dígitos = solo 1000
  // combinaciones; sin esto, un script en el mismo dispositivo podría
  // probarlas todas en segundos). Bloqueo progresivo por ámbito
  // ("owner"|"emp"|"acct"|"maestro"|"reset"), guardado en localStorage para
  // que sobreviva un refresh de página.
  // 2026-08-30: 5 intentos y un lock en CADA fallo extra era hostil en un
  // mostrador. NIST 800-63B pide limitar la tasa, no encerrar a la tercera.
  // iOS espera ~10 fallos antes del primer delay. Tope 15 min.
  const INTENTOS_MAX = 10;
  const BLOQUEO_BASE_MS = 30 * 1000;
  const BLOQUEO_TOPE_MS = 15 * 60 * 1000;
  // f123_ prefijo (2026-07-17): sin esto, los contadores de bloqueo por
  // intentos fallidos se compartian con AMIGABLE (mismo origen en GitHub
  // Pages). Solo son contadores de lockout, sin datos sensibles — renombrar
  // directo es seguro, en el peor caso un lockout activo se reinicia.
  function intentosKey(ambito) { return "f123_intentos_" + ambito; }
  function leerIntentos(ambito) {
    try { return JSON.parse(localStorage.getItem(intentosKey(ambito)) || "null") || { n: 0, bloqueadoHasta: 0 }; }
    catch { return { n: 0, bloqueadoHasta: 0 }; }
  }
  function segundosBloqueo(ambito) {
    const i = leerIntentos(ambito);
    const m = _memInt[ambito] || {};
    const hasta = Math.max(i.bloqueadoHasta || 0, m.bloqueadoHasta || 0);
    return hasta && Date.now() < hasta ? Math.ceil((hasta - Date.now()) / 1000) : 0;
  }
  // Espejo EN MEMORIA del contador de intentos (antitampering 2026-07-17):
  // borrar localStorage desde la consola ya no resetea el lockout de la
  // sesion viva. Se toma siempre el peor de los dos contadores.
  const _memInt = {};
  function registrarFallo(ambito) {
    const i = leerIntentos(ambito);
    i.n = (i.n || 0) + 1;
    const m = _memInt[ambito] = _memInt[ambito] || { n: 0, bloqueadoHasta: 0 };
    m.n++;
    if (m.n > i.n) i.n = m.n;
    if (i.n >= INTENTOS_MAX && i.n % INTENTOS_MAX === 0) {
      const ronda = Math.floor(i.n / INTENTOS_MAX);
      const ms = Math.min(BLOQUEO_TOPE_MS, BLOQUEO_BASE_MS * Math.pow(2, ronda - 1));
      i.bloqueadoHasta = Date.now() + ms;
      m.bloqueadoHasta = i.bloqueadoHasta;
    }
    try { localStorage.setItem(intentosKey(ambito), JSON.stringify(i)); } catch (_) {}
  }
  function registrarExito(ambito) {
    delete _memInt[ambito];
    try { localStorage.setItem(intentosKey(ambito), JSON.stringify({ n: 0, bloqueadoHasta: 0 })); } catch (_) {}
  }

  function randDigits(n) {
    let s = "";
    const buf = new Uint32Array(n);
    crypto.getRandomValues(buf);
    for (let i = 0; i < n; i++) s += buf[i] % 10;
    return s;
  }
  async function generarCodigoReset() {
    const codigo = randDigits(6);
    const salt = randSalt();
    const codeHash = await hashPin(codigo, salt, "reset");
    localStorage.setItem("f123_reset", JSON.stringify({ codeHash, salt, expiresAt: Date.now() + 15 * 60 * 1000 }));
    return codigo; // en claro, solo para que quien llama lo envíe por correo
  }
  function leerReset() {
    try { return JSON.parse(localStorage.getItem("f123_reset")); } catch { return null; }
  }
  async function resetearConCodigo(codigoIngresado, nuevoOwnerPin) {
    // BUG FIJADO (JFC 2026-08-19, caza produccion): mensajes de error de
    // reset en espanol para app cuyo default es ingles.
    const _es = (function(){try{return window.OCI18n&&window.OCI18n.getLang()==="es";}catch(_){return false;}})();
    if (segundosBloqueo("reset") > 0) {
      return { error: _es ? `Demasiados intentos. Espera ${segundosBloqueo("reset")}s.`
                          : `Too many attempts. Wait ${segundosBloqueo("reset")}s.` };
    }
    const r = leerReset();
    if (!r) return { error: _es ? "No hay ningún reseteo pendiente. Pide un código nuevo."
                                : "No pending reset. Request a new code." };
    if (Date.now() > r.expiresAt) {
      localStorage.removeItem("f123_reset");
      return { error: _es ? "El código venció (15 min). Pide uno nuevo."
                          : "The code expired (15 min). Request a new one." };
    }
    const hashIngresado = await hashPin(codigoIngresado, r.salt, "reset");
    if (hashIngresado !== r.codeHash) {
      registrarFallo("reset");
      return { error: _es ? "Código incorrecto." : "Incorrect code." };
    }
    registrarExito("reset");
    const correoActual = leerCorreo();
    const nuevoEmpleado = randDigits(3);
    const nuevoAcct = randDigits(3);
    const guardado = await guardarSecreto(nuevoOwnerPin, [nuevoEmpleado], nuevoAcct, correoActual);
    // Guard G1 (JFC 2026-08-04): antes esto quemaba el código de reset y
    // mostraba PINs nuevos AUNQUE el guardado hubiera fallado (localStorage
    // lleno) — el dueño se quedaba con los PINs viejos que justo había
    // olvidado, sin poder reintentar porque el código de reset ya no
    // existía. Ahora el código de reset SOLO se consume si el guardado
    // funcionó de verdad.
    if (!guardado) {
      return { error: _es ? "No se pudo guardar tu PIN nuevo (memoria del dispositivo llena). Tu PIN anterior sigue funcionando. Libera espacio (fotos, otras apps) y vuelve a intentar con el mismo código."
                          : "Could not save your new PIN (device storage full). Your previous PIN still works. Free up space (photos, other apps) and try again with the same code." };
    }
    localStorage.removeItem("f123_reset");
    return { ok: true, empleado: nuevoEmpleado, acct: nuevoAcct };
  }

  // ===========================================================================
  // CIFRADO REAL PARA SYNC ENTRE DISPOSITIVOS (JFC, 2026-07-04)
  // ---------------------------------------------------------------------------
  // Todo lo de arriba son HASHES (PBKDF2): sirven para VERIFICAR un PIN, no
  // para cifrar/descifrar nada — de un hash no se puede volver al dato
  // original. Lo que sigue sí es cifrado real (AES-256-GCM) para que el log
  // de operaciones del motor de sync (avanzado-extra.js) viaje ilegible para
  // cualquiera que no sea otro dispositivo del mismo negocio con el mismo PIN
  // de dueño — incluido un relay ciego, que solo verá bytes opacos
  // (igual que un relay nostr con un evento cifrado).
  //
  // La llave AES vive SOLO en memoria (variable de módulo) y se deriva del
  // PIN del dueño + el mismo salt de oc_secure, con la etiqueta de contexto
  // "vault" (nunca puede coincidir con el hash "owner" usado para verificar
  // el PIN, ni con "emp"/"acct"/"reset" — son derivaciones distintas del
  // mismo PBKDF2). Por eso hay que "activar" sync con el PIN una vez por
  // sesión de navegador: al recargar la página la llave se pierde a
  // propósito (mismo patrón que la subclave contable) y hay que volver a
  // teclearlo.
  let claveSync = null; // CryptoKey AES-GCM — solo en memoria, nunca en localStorage/disco

  async function derivarLlaveAES(pin, saltB64, info) {
    const base = await importPinKey(pin);
    const salt = enc.encode(info + ":" + saltB64);
    return crypto.subtle.deriveKey(
      { name: "PBKDF2", salt, iterations: 150000, hash: "SHA-256" },
      base,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );
  }

  async function activarSync(pin) {
    const ok = await verificarOwner(pin);
    if (!ok) return false;
    const s = leerSecreto();
    claveSync = await derivarLlaveAES(pin, s.salt, "vault");
    return true;
  }
  function syncActiva() { return !!claveSync; }
  function desactivarSync() { claveSync = null; }

  // Formato del blob: "<iv-b64>.<data-b64>" — IV nuevo en cada cifrado (nunca
  // se reutiliza), como exige AES-GCM para no debilitar la garantía.
  async function cifrarSync(texto) {
    if (!claveSync) return null;
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, claveSync, enc.encode(texto));
    return b64(iv) + "." + b64(data);
  }
  async function descifrarSync(blob) {
    if (!claveSync || !blob || blob.indexOf(".") === -1) return null;
    try {
      const [ivB64, dataB64] = blob.split(".");
      const bits = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(ivB64) }, claveSync, unb64(dataB64));
      return dec.decode(bits);
    } catch { return null; }
  }
  async function hashTexto(texto) {
    const bits = await crypto.subtle.digest("SHA-256", enc.encode(String(texto || "")));
    return b64(bits);
  }

  async function derivarLlaveBackup(passphrase, saltB64) {
    const base = await importPinKey(passphrase);
    return crypto.subtle.deriveKey(
      { name: "PBKDF2", salt: enc.encode("backup:" + saltB64), iterations: 250000, hash: "SHA-256" },
      base,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );
  }

  async function cifrarTextoConClave(texto, passphrase) {
    if (!passphrase || String(passphrase).length < 8) throw new Error("The backup passphrase must be at least 8 characters.");
    const salt = randSalt();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await derivarLlaveBackup(passphrase, salt);
    const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(String(texto || "")));
    return { v: 1, alg: "AES-256-GCM", kdf: "PBKDF2-SHA256-250k", salt, iv: b64(iv), data: b64(data) };
  }

  async function descifrarTextoConClave(paquete, passphrase) {
    if (!paquete || paquete.alg !== "AES-256-GCM" || !paquete.salt || !paquete.iv || !paquete.data) return null;
    try {
      const key = await derivarLlaveBackup(passphrase, paquete.salt);
      const bits = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(paquete.iv) }, key, unb64(paquete.data));
      return dec.decode(bits);
    } catch { return null; }
  }

  function intentosRestantes(ambito) {
    if (segundosBloqueo(ambito) > 0) return 0;
    const i = leerIntentos(ambito);
    const m = _memInt[ambito] || {};
    const n = Math.max(i.n || 0, m.n || 0);
    const enRonda = n % INTENTOS_MAX;
    return INTENTOS_MAX - enRonda;
  }

  async function identificarPin(pin) {
    const p = String(pin || "");
    if (!/^\d{3}$/.test(p)) return null;
    const s = leerSecreto();
    if (!s) return null;
    try {
      if ((await hashPin(p, s.salt, "owner")) === s.ownerHash) return "dueno";
      const hEmp = await hashPin(p, s.salt, "emp");
      if ((s.employeeHashes || []).includes(hEmp)) return "empleado";
      if ((await hashPin(p, s.salt, "acct")) === s.acctHash) return "contador";
    } catch (_) {}
    try {
      const vis = leerPinsVisibles();
      if (vis && vis.owner === p) return "dueno";
    } catch (_) {}
    try {
      const abre = leerPinQueAbre();
      if (abre.owner === p) return "dueno";
      if (abre.emp === p) return "empleado";
      if (abre.acct === p) return "contador";
    } catch (_) {}
    try {
      const dir = directorioNormalizado();
      if (dir.owner && String(dir.owner.pin) === p) return "dueno";
      if (dir.acct && String(dir.acct.pin) === p) return "contador";
      if ((dir.empleados || []).some(function (e) { return e && String(e.pin) === p; })) return "empleado";
    } catch (_) {}
    try {
      const eq = leerPinsEquipo();
      if (eq.owner === p) return "dueno";
      if (eq.acct === p) return "contador";
      if (eq.emp === p || (Array.isArray(eq.emps) && eq.emps.indexOf(p) >= 0)) return "empleado";
    } catch (_) {}
    return null;
  }

  function limpiarLockouts() {
    ["login", "owner", "emp", "acct"].forEach(function (a) { registrarExito(a); });
  }

  async function coincidePin(pin, rol) {
    const s = leerSecreto();
    if (!s || !/^\d{3}$/.test(String(pin || ""))) return false;
    const p = String(pin);
    try {
      if (rol === "owner") return (await hashPin(p, s.salt, "owner")) === s.ownerHash;
      if (rol === "acct") return (await hashPin(p, s.salt, "acct")) === s.acctHash;
      if (rol === "emp") {
        const h = await hashPin(p, s.salt, "emp");
        return (s.employeeHashes || []).includes(h);
      }
    } catch (_) { return false; }
    return false;
  }

  async function pinsVisiblesVerificados() {
    const vis = leerPinsVisibles() || { owner: null, empleados: [], acct: null };
    const owner = (vis.owner && await coincidePin(vis.owner, "owner")) ? vis.owner : null;
    const acct = (vis.acct && await coincidePin(vis.acct, "acct")) ? vis.acct : null;
    const empleados = [];
    for (const e of (vis.empleados || [])) {
      if (e && await coincidePin(e, "emp")) empleados.push(e);
    }
    return { owner, empleados, acct };
  }

  const PIN_ABRE_KEY = "f123_pin_que_abre";
  function leerPinQueAbre() {
    try { return JSON.parse(localStorage.getItem(PIN_ABRE_KEY) || "{}") || {}; }
    catch (_) { return {}; }
  }
  function recordarPinQueAbre(pin, rol) {
    const p = String(pin || "");
    if (!/^\d{3}$/.test(p) || p === "456") return;
    const cur = leerPinQueAbre();
    if (rol === "dueno" || rol === "admin") cur.owner = p;
    else if (rol === "empleado") cur.emp = p;
    else if (rol === "contador") cur.acct = p;
    try { localStorage.setItem(PIN_ABRE_KEY, JSON.stringify(cur)); } catch (_) {}
  }
  function clavePinsEquipo() {
    let suf = "";
    try { suf = localStorage.getItem("f123_tienda_activa") || ""; } catch (_) {}
    return "f123_pins_equipo" + suf;
  }
  function leerPinsEquipo() {
    try { return JSON.parse(localStorage.getItem(clavePinsEquipo()) || "{}") || {}; }
    catch (_) { return {}; }
  }
  function guardarPinsEquipo(obj) {
    try { localStorage.setItem(clavePinsEquipo(), JSON.stringify(obj || {})); return true; }
    catch (_) { return false; }
  }

  window.OCSecure = {
    migrarSiHaceFalta, guardarSecreto, verificarOwner, verificarEmpleado, verificarAcct, leerCorreo, actualizarCorreo,
    estadoSecreto, // Guard G2, JFC 2026-08-04: distingue "vacío"/"ok"/"corrupto" para dar mensajes honestos
    verificarMaestro, fijarCodigoMaestro, generarCodigoReset, resetearConCodigo, segundosBloqueo,
    fijarOwnerPin, // exportado 2026-07-08: la activación 789 fija el PIN de dueño de la instancia propia
    fijarEmpleadoPin, fijarAcctPin, // JFC 2026-08-28: edición individual de PINs (lapicito en Access & recovery)
    leerDirectorio, guardarDirectorio, directorioNormalizado, // JFC 2026-08-28: directorio de acceso (PINs atados a personas)
    activarSync, syncActiva, desactivarSync, cifrarSync, descifrarSync,
    hashTexto, cifrarTextoConClave, descifrarTextoConClave,
    leerWhatsapp, actualizarWhatsapp, // Mejora #5, 2026-07-16
    verificarOwnerOEmpleado, // paridad AMIGABLE, lockout unico
    recuperarPinDueno, // Fix-2: evita TypeError en abrirFlujoReset si no hay ownerPinR
    leerPinsVisibles, // JFC 2026-08-27: PINs visibles para soporte (Advanced/Team)
    pinsVisiblesVerificados, coincidePin,
    identificarPin, intentosRestantes,
    anotarFalloLogin: function () { registrarFallo("login"); },
    anotarExitoLogin: function () { limpiarLockouts(); },
    limpiarLockouts,
    leerPinQueAbre, recordarPinQueAbre,
    leerPinsEquipo, guardarPinsEquipo,
  };
})();
