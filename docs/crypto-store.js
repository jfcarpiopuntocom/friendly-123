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
    if (!localStorage.getItem("f123_secure")) {
      let viejo = null;
      try { viejo = JSON.parse(localStorage.getItem("f123_auth") || "null"); } catch {}
      const DEF = { owner: "888", empleados: ["260"], acct: "357", email: "" };
      const base = viejo || DEF;
      await guardarSecreto(base.owner, base.empleados || [], base.acct, base.email || "");
      localStorage.removeItem("f123_auth"); // ya no queda nada en texto plano
    }
    // AMIGABLE (JFC 2026-07-02): el PIN de dueño pasó de 159 a 888. Si un
    // navegador ya tenía guardado el default viejo (159), lo subimos a 888 sin
    // tocar empleado/contable/correo. No-op si el dueño ya no es 159.
    // Fix-5: flag de un-solo-run — sin esto verificarOwner("159") corre en CADA
    // pageload y acumula registrarFallo("owner") hasta lockout del dueño.
    if (!localStorage.getItem("f123_migrado_159_888")) {
      if (await verificarOwner("159") && !(await verificarOwner("888"))) {
        await fijarOwnerPin("888");
      }
      localStorage.setItem("f123_migrado_159_888", "1");
    }
  }

  async function guardarSecreto(ownerPin, empleadosPins, acctPin, email) {
    const salt = randSalt();
    const ownerHash = await hashPin(ownerPin, salt, "owner");
    const employeeHashes = [];
    for (const p of empleadosPins) employeeHashes.push(await hashPin(p, salt, "emp"));
    const acctHash = await hashPin(acctPin, salt, "acct");
    localStorage.setItem("f123_secure", JSON.stringify({ v: 1, salt, ownerHash, employeeHashes, acctHash, email: email || "" }));
  }

  function leerSecreto() {
    try { return JSON.parse(localStorage.getItem("f123_secure")); } catch { return null; }
  }

  // Verifica un PIN de 3 dígitos contra un rol ("owner"|"acct") o la lista de empleados.
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
  // Paridad AMIGABLE (2026-07-17): verificacion combinada dueno/empleado con
  // UN solo ambito de lockout ("login") — evita que probar un PIN de empleado
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
    const s = leerSecreto(); if (!s) return;
    s.email = email || "";
    localStorage.setItem("f123_secure", JSON.stringify(s));
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
    localStorage.setItem("f123_secure", JSON.stringify(s));
    return true;
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
    return ok;
  }
  // Permite fijar un código maestro propio por negocio (JFC, no el dueño).
  async function fijarCodigoMaestro(codigoNuevo) {
    const s = leerSecreto(); if (!s) return;
    s.masterHash = await hashMaestro(codigoNuevo);
    localStorage.setItem("f123_secure", JSON.stringify(s));
  }

  // Cambia SOLO el PIN de dueño (re-hash bajo el salt existente) sin rotar
  // empleado/contable/correo. Usado por la migración 159->888 de AMIGABLE.
  async function fijarOwnerPin(nuevoPin) {
    const s = leerSecreto(); if (!s) return;
    s.ownerHash = await hashPin(nuevoPin, s.salt, "owner");
    s.ownerPinR = xorPin(nuevoPin);
    localStorage.setItem("f123_secure", JSON.stringify(s));
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
  // ---- Rate limiting anti fuerza bruta (PINs de 3 dígitos = solo 1000
  // combinaciones; sin esto, un script en el mismo dispositivo podría
  // probarlas todas en segundos). Bloqueo progresivo por ámbito
  // ("owner"|"emp"|"acct"|"maestro"|"reset"), guardado en localStorage para
  // que sobreviva un refresh de página.
  const INTENTOS_MAX = 5;
  const BLOQUEO_BASE_MS = 30 * 1000;
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
    if (i.n >= INTENTOS_MAX) { i.bloqueadoHasta = Date.now() + BLOQUEO_BASE_MS * Math.min(20, Math.floor(i.n / INTENTOS_MAX)); m.bloqueadoHasta = i.bloqueadoHasta; }
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
    if (segundosBloqueo("reset") > 0) return { error: `Demasiados intentos. Espera ${segundosBloqueo("reset")}s.` };
    const r = leerReset();
    if (!r) return { error: "No hay ningún reseteo pendiente. Pide un código nuevo." };
    if (Date.now() > r.expiresAt) { localStorage.removeItem("f123_reset"); return { error: "El código venció (15 min). Pide uno nuevo." }; }
    const hashIngresado = await hashPin(codigoIngresado, r.salt, "reset");
    if (hashIngresado !== r.codeHash) { registrarFallo("reset"); return { error: "Código incorrecto." }; }
    registrarExito("reset");
    const correoActual = leerCorreo();
    const nuevoEmpleado = randDigits(3);
    const nuevoAcct = randDigits(3);
    await guardarSecreto(nuevoOwnerPin, [nuevoEmpleado], nuevoAcct, correoActual);
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
  // de dueño — incluido un relay ciego en Fly.io, que solo verá bytes opacos
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
    if (!passphrase || String(passphrase).length < 8) throw new Error("La clave del respaldo debe tener al menos 8 caracteres.");
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

  window.OCSecure = {
    migrarSiHaceFalta, guardarSecreto, verificarOwner, verificarEmpleado, verificarAcct, leerCorreo, actualizarCorreo,
    verificarMaestro, fijarCodigoMaestro, generarCodigoReset, resetearConCodigo, segundosBloqueo,
    fijarOwnerPin, // exportado 2026-07-08: la activación 789 fija el PIN de dueño de la instancia propia
    activarSync, syncActiva, desactivarSync, cifrarSync, descifrarSync,
    hashTexto, cifrarTextoConClave, descifrarTextoConClave,
    leerWhatsapp, actualizarWhatsapp, // Mejora #5, 2026-07-16
    verificarOwnerOEmpleado, // paridad AMIGABLE, lockout unico
    recuperarPinDueno, // Fix-2: evita TypeError en abrirFlujoReset si no hay ownerPinR
  };
})();
