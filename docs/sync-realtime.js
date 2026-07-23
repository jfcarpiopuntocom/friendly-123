// AMIGABLE — Cliente de sincronizacion en tiempo real (2026-07-23)
// ============================================================================
// QUE HACE: en cuanto el dueño se licencia (automatico) o un empleado escribe
// UNA vez el codigo del negocio ("Unirme a mi equipo"), este dispositivo
// queda sincronizado 24/7 PARA SIEMPRE — no es un modo evento que se prende
// y apaga. Las VENTAS, AJUSTES, ANULACIONES y TRANSFERENCIAS de stock hechas
// en cualquier dispositivo del equipo llegan a los demas en segundos, todos
// los dias, haya o no haya feria — para que nadie sobrevenda ni se atropelle.
//
// COMO SE PROTEGE LA APP (lazy approach, cero dependencia obligatoria):
//   - Si esto nunca se activa, o el relay esta caido, o se borra este
//     archivo entero: la app funciona EXACTAMENTE igual que siempre
//     (solo local, como fue desde el dia 1).
//   - mock-backend.js JAMAS toca la red — este archivo es el UNICO que abre
//     un WebSocket, y solo si el dueño lo pidio explicitamente.
//   - El relay (Cloudflare Worker) es "sordo y desmemoriado a proposito":
//     solo rebota blobs cifrados, nunca los guarda ni los lee en claro.
//   - Cifrado E2E: la clave sale del codigo de sala via PBKDF2+AES-GCM,
//     nunca viaja al relay. Sin el codigo, un mensaje interceptado es ruido.
//   - Alcance v1: SOLO se sincronizan cambios de STOCK (venta, ajuste,
//     anulacion, transferencia) sobre productos que YA EXISTEN en ambos
//     dispositivos (mismo id) — el catalogo (altas, precios, fotos, perchas)
//     se configura antes del evento, en un solo dispositivo, y se reparte
//     por backup/restauracion como siempre. Sincronizar el catalogo completo
//     es una fase futura, documentada aparte.
// ============================================================================
(function () {
  const RELAY_URL = "wss://amigable-sync-relay.jfcarpio.workers.dev/sala/";
  const ROOM_KEY = "amigable_sync_room"; // {codigo} — si no existe, sync apagado
  const DEVICE_ID_KEY = "amigable_device_id";
  const LAMPORT_KEY = "amigable_sync_lamport";
  const COLA_KEY = "amigable_sync_cola"; // ops pendientes de enviar (offline)
  const SALT_FIJO = "amigable-sync-v1"; // salt fijo: codigo de sala = "clave de cuarto", no defensa contra MITM

  function uuidCorto() {
    const c = globalThis.crypto;
    if (c && c.randomUUID) return c.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (ch) => {
      const r = (Math.random() * 16) | 0, v = ch === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  function deviceId() {
    let id = localStorage.getItem(DEVICE_ID_KEY);
    if (!id) { id = uuidCorto(); try { localStorage.setItem(DEVICE_ID_KEY, id); } catch (_) {} }
    return id;
  }

  function siguienteLamport() {
    let n = Number(localStorage.getItem(LAMPORT_KEY) || 0) + 1;
    try { localStorage.setItem(LAMPORT_KEY, String(n)); } catch (_) {}
    return n;
  }

  function leerCola() {
    try { const a = JSON.parse(localStorage.getItem(COLA_KEY) || "[]"); return Array.isArray(a) ? a : []; }
    catch (_) { return []; }
  }
  function guardarCola(cola) {
    try { localStorage.setItem(COLA_KEY, JSON.stringify(cola.slice(-200))); } catch (_) {}
  }

  function leerSala() {
    try { return JSON.parse(localStorage.getItem(ROOM_KEY) || "null"); } catch (_) { return null; }
  }

  // --- Cripto: PBKDF2(codigo) -> AES-GCM. El codigo nunca sale de este dispositivo. ---
  async function derivarClave(codigo) {
    const enc = new TextEncoder();
    const base = await crypto.subtle.importKey("raw", enc.encode(codigo), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey(
      { name: "PBKDF2", salt: enc.encode(SALT_FIJO), iterations: 100000, hash: "SHA-256" },
      base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]
    );
  }
  async function idDeSala(codigo) {
    const enc = new TextEncoder();
    const hash = await crypto.subtle.digest("SHA-256", enc.encode("amigable-sala:" + codigo));
    return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 40);
  }
  async function cifrar(clave, objeto) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const datos = new TextEncoder().encode(JSON.stringify(objeto));
    const cif = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, clave, datos);
    const paquete = new Uint8Array(iv.length + cif.byteLength);
    paquete.set(iv, 0); paquete.set(new Uint8Array(cif), iv.length);
    return paquete.buffer;
  }
  async function descifrar(clave, buffer) {
    const bytes = new Uint8Array(buffer);
    const iv = bytes.slice(0, 12), cif = bytes.slice(12);
    const claro = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, clave, cif);
    return JSON.parse(new TextDecoder().decode(claro));
  }

  // --- Estado de conexion ---
  let ws = null, claveActual = null, salaIdActual = null, reintentoMs = 1000;
  let estadoActual = "apagado"; // apagado | conectando | conectado | reconectando
  let presenciaN = null; // cuantos dispositivos conectados ahora (null = desconocido)
  let intentosSeguidos = 0; // reintentos consecutivos sin exito (refuerzo 2026-07-23)
  let timeoutConexion = null;
  const listenersEstado = [];
  function notificarEstado(nuevo) {
    estadoActual = nuevo;
    listenersEstado.forEach((fn) => { try { fn(nuevo, presenciaN); } catch (_) {} });
  }

  // Refuerzo (2026-07-23, auditoria delegada + verificacion manual): antes
  // conectar() podia llamarse dos veces seguidas (Activar + reconexion
  // automatica por visibilitychange casi al mismo tiempo, o un doble-click)
  // sin cerrar el socket anterior — quedaba una conexion fantasma abierta
  // consumiendo un cupo de la sala (max 12) y duplicando mensajes. Ahora
  // conectar() SIEMPRE cierra lo que hubiera antes de abrir uno nuevo.
  function cerrarWsExistente() {
    if (timeoutConexion) { clearTimeout(timeoutConexion); timeoutConexion = null; }
    if (ws) {
      try { ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null; ws.close(); } catch (_) {}
      ws = null;
    }
  }

  async function conectar() {
    const sala = leerSala();
    if (!sala || !sala.codigo) { notificarEstado("apagado"); return; }
    cerrarWsExistente();
    notificarEstado(estadoActual === "apagado" ? "conectando" : "reconectando");
    // Refuerzo: el codigo se normaliza (mayusculas + sin espacios) SIEMPRE
    // antes de derivar la clave/sala — sin esto, "amg-xxxx" y "AMG-XXXX"
    // caen en salas distintas y el equipo nunca entiende por que no sincroniza.
    const codigoNorm = normalizarCodigo(sala.codigo);
    claveActual = await derivarClave(codigoNorm);
    salaIdActual = await idDeSala(codigoNorm);
    try { ws = new WebSocket(RELAY_URL + salaIdActual); }
    catch (_) { return programarReintento(); }

    ws.binaryType = "arraybuffer";
    // Refuerzo: si el handshake se cuelga (servidor acepta TCP pero nunca
    // responde el upgrade), algunos navegadores nunca disparan onerror ni
    // onclose — sin este timeout, el estado quedaba en "conectando" para
    // siempre. A los 10s, si sigue CONNECTING, se fuerza el cierre y se
    // deja que el backoff normal reintente.
    timeoutConexion = setTimeout(() => {
      if (ws && ws.readyState === WebSocket.CONNECTING) { try { ws.close(); } catch (_) {} }
    }, 10000);
    ws.onopen = () => {
      if (timeoutConexion) { clearTimeout(timeoutConexion); timeoutConexion = null; }
      reintentoMs = 1000;
      intentosSeguidos = 0;
      notificarEstado("conectado");
      vaciarCola();
    };
    ws.onmessage = async (ev) => {
      // Frame de presencia (2026-07-23): el relay los manda en TEXTO plano,
      // sin cifrar (solo es un numero de conexiones, no dato del negocio).
      // Las Ops reales siempre son binarias (ArrayBuffer, cifradas). Este
      // chequeo de tipo es la unica forma de distinguirlos.
      if (typeof ev.data === "string") {
        try {
          const msg = JSON.parse(ev.data);
          if (msg && msg.__presencia__) { presenciaN = msg.n; notificarEstado(estadoActual); }
        } catch (_) {}
        return;
      }
      try {
        const op = await descifrar(claveActual, ev.data);
        if (window.OCSync && window.OCSync.aplicarOpRemota) window.OCSync.aplicarOpRemota(op);
        window.dispatchEvent(new CustomEvent("oc-sync-op-remota", { detail: op }));
      } catch (_) { /* mensaje ilegible (codigo distinto, ruido) — se ignora, sordo a proposito */ }
    };
    ws.onclose = () => { notificarEstado("reconectando"); programarReintento(); };
    ws.onerror = () => { try { ws.close(); } catch (_) {} };
  }

  function normalizarCodigo(codigo) {
    return String(codigo || "").trim().toUpperCase().replace(/\s+/g, "");
  }

  function programarReintento() {
    if (!leerSala()) return; // el dueño apago sync mientras tanto: no insistir
    intentosSeguidos++;
    // Refuerzo: no podemos distinguir "codigo invalido / sala inalcanzable"
    // de "wifi que parpadeo" desde el WebSocket (el navegador no expone el
    // motivo del cierre) — pero tras varios intentos seguidos fallidos SI
    // podemos avisar, en vez de reintentar en silencio para siempre sin que
    // nadie sepa que algo no cuadra.
    if (intentosSeguidos >= 6) notificarEstado("reconectando");
    // Jitter chico (+-20%) para que, si varios dispositivos del equipo se
    // desconectan juntos (ej. wifi del local que parpadea), no reconecten
    // todos en el mismo instante exacto.
    const jitter = 1 + (Math.random() * 0.4 - 0.2);
    setTimeout(conectar, Math.round(reintentoMs * jitter));
    reintentoMs = Math.min(reintentoMs * 2, 30000);
  }

  async function vaciarCola() {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const cola = leerCola();
    if (!cola.length) return;
    for (const op of cola) {
      try { ws.send(await cifrar(claveActual, op)); } catch (_) { return; } // corta si algo falla, reintenta despues
    }
    guardarCola([]);
  }

  // --- Puente con mock-backend.js: emitirOpStock(tipo, payload) llama aqui ---
  window.OCSyncEmit = function (tipo, payload) {
    const sala = leerSala();
    if (!sala) return; // sync apagado: no-op total, cero overhead
    const op = {
      opId: uuidCorto(), deviceId: deviceId(), deviceNombre: (window.OCCurrentUser && window.OCCurrentUser.nombre) || null,
      lamport: siguienteLamport(), tipo, payload, fecha: (new Date()).toISOString(),
    };
    if (ws && ws.readyState === WebSocket.OPEN) {
      cifrar(claveActual, op).then((buf) => { try { ws.send(buf); } catch (_) { encolar(op); } });
    } else {
      encolar(op);
    }
  };
  function encolar(op) { const cola = leerCola(); cola.push(op); guardarCola(cola); }

  // --- API publica para la UI (Avanzado) ---
  window.OCSyncControl = {
    // activar(): usado por el dueño al licenciarse (auto, sin pantalla) y por
    // el panel de Avanzado. unirse() es el mismo mecanismo con nombre claro
    // para el flujo de equipo ("Unirme con el codigo de mi negocio").
    // 2026-07-23 (ajuste del plan sincro-equipos): una vez guardado el
    // codigo, sync queda encendido PARA SIEMPRE en este dispositivo — no es
    // un "modo evento" que se prende y apaga, es un estado permanente.
    activar(codigo) {
      // Refuerzo (2026-07-23): normalizar SIEMPRE antes de guardar — "amg-x"
      // y "AMG-X" deben caer en la MISMA sala. Antes se guardaba tal cual lo
      // tecleara el usuario, silencioso y confuso si alguien no usaba mayus.
      const codigoNorm = normalizarCodigo(codigo);
      if (codigoNorm.length < 6) return { ok: false, error: "El código debe tener al menos 6 caracteres." };
      try { localStorage.setItem(ROOM_KEY, JSON.stringify({ codigo: codigoNorm })); } catch (_) {}
      reintentoMs = 1000;
      intentosSeguidos = 0;
      conectar();
      return { ok: true };
    },
    unirse(codigo) { return this.activar(codigo); },
    desactivar() {
      try { localStorage.removeItem(ROOM_KEY); } catch (_) {}
      cerrarWsExistente();
      presenciaN = null;
      intentosSeguidos = 0;
      notificarEstado("apagado");
    },
    // "Resincronizar" (nunca "forzar" — asusta al usuario normal): salvavidas
    // raro para cuando alguien duda si esta sincronizado de verdad en plena
    // feria. Reconecta ya mismo, sin esperar el backoff normal.
    resincronizar() {
      if (!leerSala()) return { ok: false, error: "Sync no está activo en este dispositivo." };
      reintentoMs = 1000;
      intentosSeguidos = 0;
      conectar();
      return { ok: true };
    },
    estado() { return estadoActual; },
    presencia() { return presenciaN; },
    // Refuerzo: expone si llevamos varios intentos seguidos sin exito, para
    // que la UI pueda avisar ("revisa el código") en vez de reintentar mudo.
    problemaPersistente() { return intentosSeguidos >= 6; },
    salaActiva() { const s = leerSala(); return s ? s.codigo : null; },
    onEstado(fn) { listenersEstado.push(fn); },
  };

  // Reconexion automatica al volver a tener foco/red (celular que se bloqueo, wifi que parpadeo)
  window.addEventListener("online", () => { if (leerSala() && estadoActual !== "conectado") { reintentoMs = 1000; conectar(); } });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && leerSala() && (!ws || ws.readyState !== WebSocket.OPEN)) { reintentoMs = 1000; conectar(); }
  });

  // Arranque: si ya habia una sala configurada de antes, reconectar solo.
  if (leerSala()) conectar();
})();
