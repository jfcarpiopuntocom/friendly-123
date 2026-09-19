// friendly123-sync-relay — relay zero-trust del Hybrid Proxy Tunnel Sync Engine.
//
// JFC 2026-08-25. Este Worker SOLO une conexiones. No guarda el negocio y no
// puede leerlo: cada frame llega ya cifrado en el cliente (clave derivada del
// codigo de sala; ver docs/sync-realtime.js) y el relay lo reenvia tal cual a
// los demas de la MISMA sala. Es una tuberia, no una bodega.
//
// Reglas duras (ver _private/SPEC-SYNC-ZERO-TRUST.md):
//   - Sala en memoria (Durable Object), sin disco, sin KV de negocio.
//   - No se leen ni se registran los cuerpos de los mensajes (bytes cifrados).
//   - Tope de clientes por sala y tope de tamano de frame.
//   - Es OTRO Worker, otro nombre: NUNCA reusar el de licencias.
//
// La senalizacion de WebRTC (SDP/ICE) viaja como cualquier otro frame: el relay
// no la entiende ni la necesita entender, solo la reparte. Por eso el atajo P2P
// se negocia sin logica especial aqui.

const MAX_CLIENTES_SALA = 12;      // tope por sala (coincide con el cliente)
const MAX_FRAME_BYTES = 256 * 1024; // 256 KB por frame; el catalogo va a trozos

const MAX_OPS_SALA = 8000; // tope duro de operaciones guardadas por sala

// Base64 -> ArrayBuffer (para reenviar lo guardado como frame binario, tal
// cual lo espera el cliente). El relay NO descifra: solo mueve bytes.
function b64aBuf(b64) {
  const bin = atob(b64);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u.buffer;
}

export class SalaSync {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    /* HIBERNATION (JFC 2026-09-16, world-class + fix "quema los Workers"). Antes
       se usaba server.accept() y this.sockets: eso mantiene el Durable Object
       ACTIVO todo el tiempo que haya UNA conexion WebSocket abierta, facturando
       "duration" sin parar aunque nadie mande nada. Con 3 canales por aparato,
       24/7, eso consumio el 90% del limite diario gratis de Durable Objects.
       Ahora se usa la WebSocket Hibernation API (state.acceptWebSocket): las
       conexiones siguen abiertas pero el DO se DUERME cuando no hay trafico y
       DEJA DE facturar duration mientras esta idle. La lista de sockets ya no se
       guarda en memoria (se pierde al hibernar): se lee con state.getWebSockets(). */
    /* BITACORA CIFRADA (JFC 2026-08-25). El relay guarda sobres CERRADOS para
       que un dispositivo nuevo se ponga al dia aunque no haya nadie en linea.
       No puede leer nada: `c` es ciphertext; `id` es aleatorio; `lam` un
       contador. Zero-knowledge del contenido. Durable Object + SQLite. */
    this.sql = state.storage && state.storage.sql ? state.storage.sql : null;
    this._opsDesdePoda = 0;
    if (this.sql) {
      try {
        this.sql.exec("CREATE TABLE IF NOT EXISTS ops(id TEXT PRIMARY KEY, lam INTEGER, c TEXT)");
        this.sql.exec("CREATE TABLE IF NOT EXISTS ckpt(k TEXT PRIMARY KEY, lam INTEGER, c TEXT)");
        /* Todas las lecturas de catch-up filtran y ordenan por lam. Sin este
           índice SQLite recorría la tabla completa en cada pull; rows_read se
           disparaba aunque hubiera muy pocos aparatos. */
        this.sql.exec("CREATE INDEX IF NOT EXISTS ops_lam ON ops(lam)");
      } catch (_) { this.sql = null; }
    }
  }

  _guardarOp(id, lam, c) {
    if (!this.sql || !id || typeof c !== "string") return;
    try {
      this.sql.exec("INSERT OR IGNORE INTO ops(id, lam, c) VALUES (?, ?, ?)", String(id), Number(lam) || 0, c);
      /* COUNT(*) por CADA op era el quemador: cada inserción leía todas las
         filas de la sala y Cloudflare factura esas filas. Los checkpoints ya
         podan normalmente; esta red de seguridad corre una vez cada 256 ops
         de una instancia activa, con el índice, y conserva las 8.000 nuevas. */
      this._opsDesdePoda++;
      if (this._opsDesdePoda >= 256) {
        this._opsDesdePoda = 0;
        this.sql.exec("DELETE FROM ops WHERE id IN (SELECT id FROM ops ORDER BY lam DESC LIMIT -1 OFFSET ?)", MAX_OPS_SALA);
      }
    } catch (_) {}
  }

  _guardarCkpt(lam, c) {
    if (!this.sql || typeof c !== "string") return;
    try {
      const lamN = Number(lam) || 0;
      /* C1 (2026-08-27, auditoría de integridad): NUNCA sobreescribir un
         checkpoint con uno MÁS VIEJO. Antes, un dispositivo atrasado que
         reconectaba subía su estado rancio y pisaba el checkpoint bueno del
         relay; como el checkpoint bueno ya había podado las ops (DELETE abajo),
         un dispositivo nuevo que hacía pull recibía el estado rancio y perdía
         las ops intermedias → stock/ventas incompletas sin forma de recuperarlas.
         El lamport refleja lo aplicado (mayor lam = estado más completo), así
         que solo se acepta si el entrante es >= al guardado. Igual se deja
         pasar (último en subir gana) para no congelar el checkpoint en el
         primer aparato que conecte. */
      const existente = this.sql.exec("SELECT lam FROM ckpt WHERE k = 'latest'").toArray();
      if (existente.length && (Number(existente[0].lam) || 0) > lamN) return;
      this.sql.exec(
        "INSERT INTO ckpt(k, lam, c) VALUES ('latest', ?, ?) ON CONFLICT(k) DO UPDATE SET lam = excluded.lam, c = excluded.c",
        lamN, c
      );
      // El checkpoint resume todo lo <= su lam: esas ops ya no hacen falta.
      this.sql.exec("DELETE FROM ops WHERE lam <= ?", lamN);
    } catch (_) {}
  }

  _responderPull(sock, desdeLam) {
    if (!this.sql) return;
    try {
      let cursor = Number(desdeLam) || 0;
      // 1) Si hay checkpoint mas nuevo que lo que el cliente tiene, se lo mando
      //    primero (como frame binario, lo descifra y lo aplica como catalogo).
      const ck = this.sql.exec("SELECT lam, c FROM ckpt WHERE k = 'latest'").toArray();
      if (ck.length && (Number(ck[0].lam) || 0) > cursor) {
        try { if (sock.readyState === 1) sock.send(b64aBuf(ck[0].c)); } catch (_) {}
        cursor = Number(ck[0].lam) || 0;
      }
      // 2) Las operaciones posteriores al cursor, en orden.
      const filas = this.sql.exec("SELECT c FROM ops WHERE lam > ? ORDER BY lam ASC LIMIT ?", cursor, MAX_OPS_SALA).toArray();
      for (const f of filas) {
        try { if (sock.readyState === 1) sock.send(b64aBuf(f.c)); } catch (_) {}
      }
    } catch (_) {}
  }

  async fetch(request) {
    if ((request.headers.get("Upgrade") || "").toLowerCase() !== "websocket") {
      return new Response("expected websocket", { status: 426 });
    }
    // Con hibernacion la lista viva se lee del runtime, no de memoria del DO.
    if (this.state.getWebSockets().length >= MAX_CLIENTES_SALA) {
      // Sala llena: no se acepta un cliente mas (evita que una sala crezca sin
      // fin y sirva de amplificador). El cliente reintenta con backoff.
      return new Response("room full", { status: 429 });
    }

    const par = new WebSocketPair();
    const cliente = par[0];
    const servidor = par[1];
    // HIBERNACION: acceptWebSocket (no servidor.accept()). El DO puede evacuarse
    // de memoria entre mensajes sin cerrar la conexion, y NO factura duration
    // mientras esta dormido. Los mensajes despiertan al DO y llegan por
    // webSocketMessage(); el cierre por webSocketClose().
    this.state.acceptWebSocket(servidor);

    return new Response(null, { status: 101, webSocket: cliente });
  }

  // === Handlers de la WebSocket Hibernation API ===
  // El runtime los invoca al despertar el DO; NO hay estado en memoria entre
  // mensajes (this.sockets ya no existe): la lista viva se obtiene siempre con
  // this.state.getWebSockets().
  async webSocketMessage(servidor, data) {
    // Tope de tamano SIN mirar el contenido: bytes reales. En un string,
    // .length son CARACTERES, no bytes — un texto multibyte podia colarse por
    // encima del tope; se mide en UTF-8. (Importa para los frames base64 de la
    // bitacora cifrada.) El relay sigue sin leer el contenido.
    const tam = typeof data === "string"
      ? new TextEncoder().encode(data).length
      : (data && data.byteLength) || 0;
    if (tam > MAX_FRAME_BYTES) {
      try { servidor.close(1009, "frame too big"); } catch (_) {}
      return;
    }

    /* Frames de CONTROL de la bitacora: viajan como texto JSON con una clave
       `k`. El relay los CONSUME (no los retransmite): el envio en vivo va por
       separado como frame binario. Cualquier otra cosa (binario en vivo, o un
       texto que no reconozco) se retransmite tal cual a los demas, como antes
       — asi un relay/cliente viejo sigue funcionando. */
    if (typeof data === "string") {
      let msg = null;
      try { msg = JSON.parse(data); } catch (_) { msg = null; }
      if (msg && typeof msg === "object" && msg.k) {
        if (msg.k === "op") { this._guardarOp(msg.id, msg.lam, msg.c); return; }
        if (msg.k === "ckpt") { this._guardarCkpt(msg.lam, msg.c); return; }
        if (msg.k === "pull") { this._responderPull(servidor, msg.lam); return; }
        // k desconocida: no se retransmite ni se guarda (evita amplificar).
        return;
      }
    }

    // Reenvio EN VIVO a los DEMAS de la sala. El relay no descifra ni inspecciona.
    for (const s of this.state.getWebSockets()) {
      if (s === servidor) continue;
      try { if (s.readyState === 1 /* OPEN */) s.send(data); } catch (_) {}
    }
  }

  async webSocketClose(servidor, code, reason, wasClean) {
    // Con hibernacion el runtime gestiona la lista; solo cerramos limpio.
    // NO reenviar el `code` entrante: codigos reservados (1005/1006) LANZAN al
    // pasarse a close() y el cierre limpio no ocurre. Se usa 1000 (normal) o
    // ninguno. (v-relay 2026-09-16, auditoria #9.)
    try { servidor.close(1000); } catch (_) {}
  }

  async webSocketError(servidor, err) {
    try { servidor.close(1011, "error"); } catch (_) {}
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    // Salud sin tocar salas (para monitoreo): responde sin revelar nada.
    if (url.pathname === "/" || url.pathname === "/health") {
      return new Response("friendly123-sync-relay ok", {
        status: 200,
        headers: {
          "content-type": "text/plain; charset=utf-8",
          /* CORS (JFC 2026-08-28): sin esto, un fetch("/health") desde el
             navegador (github.io) se bloqueaba por CORS y el autodiagnóstico
             reportaba "RELAY UNREACHABLE" en falso. El check del cliente ya
             usa WebSocket (no sujeto a CORS), pero /health debe responder
             también para monitoreo externo. */
          "access-control-allow-origin": "*",
        },
      });
    }
    // /sala/<id>  — el id es el hash de sala que deriva el cliente (opaco aqui).
    const m = url.pathname.match(/^\/sala\/([A-Za-z0-9_-]{1,128})$/);
    if (!m) return new Response("not found", { status: 404, headers: { "access-control-allow-origin": "*" } });
    const idSala = env.SALAS.idFromName(m[1]);
    const stub = env.SALAS.get(idSala);
    return stub.fetch(request);
  },
};
