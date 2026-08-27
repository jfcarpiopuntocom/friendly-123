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
    this.sockets = new Set();
    /* BITACORA CIFRADA (JFC 2026-08-25). El relay guarda sobres CERRADOS para
       que un dispositivo nuevo se ponga al dia aunque no haya nadie en linea.
       No puede leer nada: `c` es ciphertext; `id` es aleatorio; `lam` un
       contador. Zero-knowledge del contenido. Durable Object + SQLite. */
    this.sql = state.storage && state.storage.sql ? state.storage.sql : null;
    if (this.sql) {
      try {
        this.sql.exec("CREATE TABLE IF NOT EXISTS ops(id TEXT PRIMARY KEY, lam INTEGER, c TEXT)");
        this.sql.exec("CREATE TABLE IF NOT EXISTS ckpt(k TEXT PRIMARY KEY, lam INTEGER, c TEXT)");
      } catch (_) { this.sql = null; }
    }
  }

  _guardarOp(id, lam, c) {
    if (!this.sql || !id || typeof c !== "string") return;
    try {
      this.sql.exec("INSERT OR IGNORE INTO ops(id, lam, c) VALUES (?, ?, ?)", String(id), Number(lam) || 0, c);
      // Tope duro: si crece de mas, se borran las mas viejas (el checkpoint ya
      // las resume). Barato y evita que una sala infle sin fin.
      const n = this.sql.exec("SELECT COUNT(*) AS n FROM ops").one().n;
      if (n > MAX_OPS_SALA) {
        this.sql.exec("DELETE FROM ops WHERE id IN (SELECT id FROM ops ORDER BY lam ASC LIMIT ?)", n - MAX_OPS_SALA);
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
      const filas = this.sql.exec("SELECT c FROM ops WHERE lam > ? ORDER BY lam ASC", cursor).toArray();
      for (const f of filas) {
        try { if (sock.readyState === 1) sock.send(b64aBuf(f.c)); } catch (_) {}
      }
    } catch (_) {}
  }

  async fetch(request) {
    if ((request.headers.get("Upgrade") || "").toLowerCase() !== "websocket") {
      return new Response("expected websocket", { status: 426 });
    }
    if (this.sockets.size >= MAX_CLIENTES_SALA) {
      // Sala llena: no se acepta un cliente mas (evita que una sala crezca sin
      // fin y sirva de amplificador). El cliente reintenta con backoff.
      return new Response("room full", { status: 429 });
    }

    const par = new WebSocketPair();
    const cliente = par[0];
    const servidor = par[1];
    servidor.accept();
    this.sockets.add(servidor);

    servidor.addEventListener("message", (evt) => {
      const data = evt.data;
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
      for (const s of this.sockets) {
        if (s === servidor) continue;
        try { if (s.readyState === 1 /* OPEN */) s.send(data); } catch (_) {}
      }
    });

    const quitar = () => { this.sockets.delete(servidor); };
    servidor.addEventListener("close", quitar);
    servidor.addEventListener("error", quitar);

    return new Response(null, { status: 101, webSocket: cliente });
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    // Salud sin tocar salas (para monitoreo): responde sin revelar nada.
    if (url.pathname === "/" || url.pathname === "/health") {
      return new Response("friendly123-sync-relay ok", {
        status: 200,
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }
    // /sala/<id>  — el id es el hash de sala que deriva el cliente (opaco aqui).
    const m = url.pathname.match(/^\/sala\/([A-Za-z0-9_-]{1,128})$/);
    if (!m) return new Response("not found", { status: 404 });
    const idSala = env.SALAS.idFromName(m[1]);
    const stub = env.SALAS.get(idSala);
    return stub.fetch(request);
  },
};
