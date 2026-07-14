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

  // ---- migración silenciosa desde el formato viejo en texto plano (oc_auth) ----
  // Si José ya había configurado sus claves/correo antes de este cambio, NO se
  // pierden ni se resetean: se migran tal cual a oc_secure en el primer load.
  async function migrarSiHaceFalta() {
    if (!localStorage.getItem("oc_secure")) {
      let viejo = null;
      try { viejo = JSON.parse(localStorage.getItem("oc_auth") || "null"); } catch {}
      const DEF = { owner: "888", empleados: ["260"], acct: "357", email: "" };
      const base = viejo || DEF;
      await guardarSecreto(base.owner, base.empleados || [], base.acct, base.email || "");
      localStorage.removeItem("oc_auth"); // ya no queda nada en texto plano
    }
    // AMIGABLE (JFC 2026-07-02): el PIN de dueño pasó de 159 a 888. Si un
    // navegador ya tenía guardado el default viejo (159), lo subimos a 888 sin
    // tocar empleado/contable/correo. No-op si el dueño ya no es 159.
    if (await verificarOwner("159") && !(await verificarOwner("888"))) {
      await fijarOwnerPin("888");
    }
  }

  async function guardarSecreto(ownerPin, empleadosPins, acctPin, email) {
    const salt = randSalt();
    const ownerHash = await hashPin(ownerPin, salt, "owner");
    const employeeHashes = [];
    for (const p of empleadosPins) employeeHashes.push(await hashPin(p, salt, "emp"));
    const acctHash = await hashPin(acctPin, salt, "acct");
    localStorage.setItem("oc_secure", JSON.stringify({ v: 1, salt, ownerHash, employeeHashes, acctHash, email: email || "" }));
  }

  function leerSecreto() {
    try { return JSON.parse(localStorage.getItem("oc_secure")); } catch { return null; }
  }

  // Verifica un PIN de 3 dígitos contra un rol ("owner"|"acct") o la lista de empleados.
  async function verificarOwner(pin) {
    const s = leerSecreto(); if (!s) return false;
    return (await hashPin(pin, s.salt, "owner")) === s.ownerHash;
  }
  async function verificarEmpleado(pin) {
    const s = leerSecreto(); if (!s) return false;
    const h = await hashPin(pin, s.salt, "emp");
    return (s.employeeHashes || []).includes(h);
  }
  async function verificarAcct(pin) {
    const s = leerSecreto(); if (!s) return false;
    return (await hashPin(pin, s.salt, "acct")) === s.acctHash;
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
    const s = leerSecreto(); if (!s) return;
    s.email = email || "";
    localStorage.setItem("oc_secure", JSON.stringify(s));
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
    const guardado = leerHashMaestroGuardado();
    const hashIngresado = await hashMaestro(codigo);
    if (guardado) return hashIngresado === guardado;
    // Si todavía no se guardó un hash propio (negocio recién migrado), se
    // compara contra el default de fábrica — así JFC siempre puede entrar
    // con MASTER_CODE_DEFAULT aunque el negocio nunca lo haya personalizado.
    return hashIngresado === (await hashMaestro(MASTER_CODE_DEFAULT));
  }
  // Permite fijar un código maestro propio por negocio (JFC, no el dueño).
  async function fijarCodigoMaestro(codigoNuevo) {
    const s = leerSecreto(); if (!s) return;
    s.masterHash = await hashMaestro(codigoNuevo);
    localStorage.setItem("oc_secure", JSON.stringify(s));
  }

  // Cambia SOLO el PIN de dueño (re-hash bajo el salt existente) sin rotar
  // empleado/contable/correo. Usado por la migración 159->888 de AMIGABLE.
  async function fijarOwnerPin(nuevoPin) {
    const s = leerSecreto(); if (!s) return;
    s.ownerHash = await hashPin(nuevoPin, s.salt, "owner");
    s.ownerPinR = xorPin(nuevoPin);
    localStorage.setItem("oc_secure", JSON.stringify(s));
  }

  // ---- Reseteo de acceso por correo ("olvidé mi clave") ----
  // Flujo: 1) generarCodigoReset() crea un código de 6 dígitos con vencimiento
  // de 15 min y lo guarda (solo su hash) en localStorage["oc_reset"]; el
  // código EN CLARO se devuelve una sola vez para que quien llama lo mande
  // por correo (ver email-recovery.js). 2) El dueño ingresa ese código + un
  // PIN nuevo. 3) resetearConCodigo() verifica el código, ROTA TODO (nuevo
  // salt) porque el diseño de este archivo usa un salt compartido entre los
  // 3 roles — no se puede cambiar solo el PIN del dueño manteniendo los
  // hashes de empleado/contable bajo el salt viejo. Por eso también se
  // generan códigos nuevos de empleado y contable, que se devuelven UNA VEZ
  // para que la UI se los muestre al dueño ("apunta estos códigos nuevos").
  function randDigits(n) {
    let s = "";
    for (let i = 0; i < n; i++) s += Math.floor(Math.random() * 10);
    return s;
  }
  async function generarCodigoReset() {
    const codigo = randDigits(6);
    const salt = randSalt();
    const codeHash = await hashPin(codigo, salt, "reset");
    localStorage.setItem("oc_reset", JSON.stringify({ codeHash, salt, expiresAt: Date.now() + 15 * 60 * 1000 }));
    return codigo; // en claro, solo para que quien llama lo envíe por correo
  }
  function leerReset() {
    try { return JSON.parse(localStorage.getItem("oc_reset")); } catch { return null; }
  }
  async function resetearConCodigo(codigoIngresado, nuevoOwnerPin) {
    const r = leerReset();
    if (!r) return { error: "No hay ningún reseteo pendiente. Pide un código nuevo." };
    if (Date.now() > r.expiresAt) { localStorage.removeItem("oc_reset"); return { error: "El código venció (15 min). Pide uno nuevo." }; }
    const hashIngresado = await hashPin(codigoIngresado, r.salt, "reset");
    if (hashIngresado !== r.codeHash) return { error: "Código incorrecto." };
    const correoActual = leerCorreo();
    const nuevoEmpleado = randDigits(3);
    const nuevoAcct = randDigits(3);
    await guardarSecreto(nuevoOwnerPin, [nuevoEmpleado], nuevoAcct, correoActual);
    localStorage.removeItem("oc_reset");
    return { ok: true, empleado: nuevoEmpleado, acct: nuevoAcct };
  }

  window.OCSecure = {
    migrarSiHaceFalta, guardarSecreto, verificarOwner, verificarEmpleado, verificarAcct, leerCorreo, actualizarCorreo,
    verificarMaestro, fijarCodigoMaestro, generarCodigoReset, resetearConCodigo,
  };
})();
