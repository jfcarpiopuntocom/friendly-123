// friendly123-sync-relay — relay zero-trust del Hybrid Proxy Tunnel Sync Engine.
//
// El relay reenvia frames cifrados y conserva sobres cifrados en SQLite para
// recuperar aparatos desconectados. No ejecuta logica de dinero ni abre estos
// sobres. La custodia/separacion de claves requiere evaluacion aparte.
//
// Reglas duras (ver _private/SPEC-SYNC-ZERO-TRUST.md):
//   - WebSocket Hibernation y persistencia cifrada en Durable Object SQLite.
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
const PULL_PAGE_DEFAULT = 64;
const PULL_PAGE_MAX = 128;
const LEGACY_PULL_MAX = 128; // fusible: un shell viejo no puede releer 8.000 por reconexion
const MIGRATION_BODY = Symbol("verified migration request body");

// Read-only migration access. The signing private key never enters this Worker.
// Empty/missing public key leaves the endpoint disabled. Requests are signed in
// full, expire after one minute and bind the destination Durable Object ID.
async function migrationRequest(request, env) {
  if (request.method !== "POST" || !env.RELAY_MIGRATION_PUBLIC_KEY) return null;
  const signature = request.headers.get("X-Relay-Migration-Signature") || "";
  if (!/^[A-Za-z0-9_-]{86}$/.test(signature)) return null;
  try {
    const reader = request.body?.getReader();
    if (!reader) return null;
    const pieces = []; let total = 0;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > 4096) { await reader.cancel(); return null; }
      pieces.push(value);
    }
    const bytes = new Uint8Array(total); let offset = 0;
    for (const piece of pieces) { bytes.set(piece, offset); offset += piece.length; }
    const data = JSON.parse(new TextDecoder().decode(bytes));
    const target = typeof data.objectId === "string" && /^[a-f0-9]{64}$/.test(data.objectId) && data.room === undefined ||
      typeof data.room === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(data.room) && data.objectId === undefined;
    if (data.v !== 1 || data.action !== "export" || !target ||
        !Number.isSafeInteger(data.issuedAt) || Math.abs(Date.now() - data.issuedAt) > 60000) return null;
    const decode = s => b64aBuf(s.replace(/-/g, "+").replace(/_/g, "/"));
    const key = await crypto.subtle.importKey("raw", decode(env.RELAY_MIGRATION_PUBLIC_KEY), "Ed25519", false, ["verify"]);
    if (!await crypto.subtle.verify("Ed25519", key, decode(signature), bytes)) return null;
    Object.defineProperty(data, MIGRATION_BODY, { value: bytes });
    return data;
  } catch (_) { return null; }
}

function migrationJson(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: {
    "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff"
  } });
}

// Muestreo determinista para la poda. El contador anterior vivia en memoria y
// volvia a cero cada vez que el DO hibernaba; una sala con trafico intermitente
// podia crecer para siempre sin alcanzar 256 en una misma encarnacion.
function debePodar(id) {
  let h = 2166136261;
  const s = String(id || "");
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) % 256 === 0;
}

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
    if (this.sql) {
      try {
        this.sql.exec("CREATE TABLE IF NOT EXISTS ops(id TEXT PRIMARY KEY, lam INTEGER, c TEXT)");
        this.sql.exec("CREATE TABLE IF NOT EXISTS ckpt(k TEXT PRIMARY KEY, lam INTEGER, c TEXT)");
        /* Migracion aditiva. rev cambia cada vez que un checkpoint v2 compacta
           la bitacora; el cliente reinicia entonces su cursor SQLite. v impide
           que un shell viejo vuelva a pisar un checkpoint confirmado por v2. */
        try { this.sql.exec("ALTER TABLE ckpt ADD COLUMN rev INTEGER NOT NULL DEFAULT 0"); } catch (_) {}
        try { this.sql.exec("ALTER TABLE ckpt ADD COLUMN v INTEGER NOT NULL DEFAULT 1"); } catch (_) {}
        /* Todas las lecturas de catch-up filtran y ordenan por lam. Sin este
           índice SQLite recorría la tabla completa en cada pull; rows_read se
           disparaba aunque hubiera muy pocos aparatos. */
        this.sql.exec("CREATE INDEX IF NOT EXISTS ops_lam ON ops(lam)");
        this.sql.exec("CREATE INDEX IF NOT EXISTS ops_lam_id ON ops(lam, id)");
      } catch (_) { this.sql = null; }
    }
  }

  _guardarOp(id, lam, c) {
    if (!this.sql || !id || typeof c !== "string") return false;
    try {
      // A durable retry needs no additional write, even when today's quota is full.
      const anterior = this.sql.exec("SELECT c FROM ops WHERE id = ?", String(id)).toArray();
      if (anterior.length) return true; // Stable operation id remains authoritative across fresh encryption IVs.
      this.sql.exec("INSERT OR IGNORE INTO ops(id, lam, c) VALUES (?, ?, ?)", String(id), Number(lam) || 0, c);
      /* COUNT(*) por CADA op era el quemador. Se muestrea por hash del id en
         vez de contar en memoria: la hibernacion ya no desactiva la poda y no
         agregamos una lectura/escritura de metadata por cada operacion. */
      if (debePodar(id)) {
        try { this.sql.exec("DELETE FROM ops WHERE id IN (SELECT id FROM ops ORDER BY lam DESC LIMIT -1 OFFSET ?)", MAX_OPS_SALA); } catch (_) {}
      }
      return true;
    } catch (_) { return false; }
  }

  _guardarCkpt(lam, c, protocolo, cursorRev, cursorSeq) {
    if (!this.sql || typeof c !== "string") return false;
    try {
      const guardar = () => {
      const lamN = Number(lam) || 0;
      const existente = this.sql.exec("SELECT lam, rev, v FROM ckpt WHERE k = 'latest'").toArray();
      const repetido = this.sql.exec("SELECT c FROM ckpt WHERE k = 'latest'").toArray();
      if (repetido.length && repetido[0].c === c) return true;

      if (Number(protocolo) === 2) {
        const revActual = existente.length ? (Number(existente[0].rev) || 0) : 0;
        const revCliente = Number(cursorRev);
        const seqCliente = Math.max(0, Math.trunc(Number(cursorSeq) || 0));
        /* CAS: el estado solo puede compactar la generacion que el cliente ya
           termino de aplicar. Una op concurrente tiene rowid mayor y sobrevive. */
        if (!Number.isFinite(revCliente) || revCliente !== revActual) return false;
        this.sql.exec(
          "INSERT INTO ckpt(k, lam, c, rev, v) VALUES ('latest', ?, ?, ?, 2) " +
          "ON CONFLICT(k) DO UPDATE SET lam = excluded.lam, c = excluded.c, rev = excluded.rev, v = 2",
          lamN, c, revActual + 1
        );
        this.sql.exec("DELETE FROM ops WHERE rowid <= ?", seqCliente);
        return true;
      }

      // Un shell viejo no puede degradar un checkpoint ya confirmado por v2.
      if (existente.length && Number(existente[0].v) >= 2) return false;
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
      if (existente.length && (Number(existente[0].lam) || 0) > lamN) return false;
      this.sql.exec(
        "INSERT INTO ckpt(k, lam, c) VALUES ('latest', ?, ?) ON CONFLICT(k) DO UPDATE SET lam = excluded.lam, c = excluded.c",
        lamN, c
      );
      // El checkpoint resume todo lo <= su lam: esas ops ya no hacen falta.
      this.sql.exec("DELETE FROM ops WHERE lam <= ?", lamN);
      return true;
      };
      // SQLite checkpoint and its pruning are one recoverable state transition.
      // The runtime always provides this API; simple historical test doubles may not.
      return typeof this.state.storage.transactionSync === "function"
        ? this.state.storage.transactionSync(guardar) : guardar();
    } catch (_) { return false; }
  }

  _responderPull(sock, desdeLam) {
    if (!this.sql) return;
    try {
      let cursor = Number(desdeLam) || 0;
      // 1) Si hay checkpoint mas nuevo que lo que el cliente tiene, se lo mando
      //    primero (como frame binario, lo descifra y lo aplica como catalogo).
      const ck = this.sql.exec("SELECT lam, c, v FROM ckpt WHERE k = 'latest'").toArray();
      if (ck.length && (Number(ck[0].lam) || 0) > cursor) {
        try { if (sock.readyState === 1) sock.send(b64aBuf(ck[0].c)); } catch (_) {}
        cursor = Number(ck[0].lam) || 0;
      }
      // 2) Las operaciones posteriores al cursor, en orden.
      /* Tras un checkpoint v2, ops solo contiene filas concurrentes/posteriores
         a ese estado. Un shell viejo debe recibirlas TODAS: su reloj no es un
         cursor confiable y puede estar adelantado o atrasado. */
      /* El protocolo viejo no sabe paginar. Se le da una ventana acotada para
         mantener compatibilidad sin permitir otra tormenta de 8.000 lecturas;
         el shell v364 reanuda todas las paginas con el protocolo v2. */
      const filas = ck.length && Number(ck[0].v) >= 2
        ? this.sql.exec("SELECT c FROM ops ORDER BY rowid ASC LIMIT ?", LEGACY_PULL_MAX).toArray()
        : this.sql.exec("SELECT c FROM ops WHERE lam > ? ORDER BY lam ASC LIMIT ?", cursor, LEGACY_PULL_MAX).toArray();
      for (const f of filas) {
        try { if (sock.readyState === 1) sock.send(b64aBuf(f.c)); } catch (_) {}
      }
    } catch (_) {}
  }

  /* Protocolo paginado v2. El incidente del 23-sep-2026 fue un bucle de
     reconexion del canal de fotos: cada apertura repetia un pull de miles de
     filas, la respuesta grande volvia a cortar el stream y 2.075 reaperturas
     terminaron leyendo 9,48 M filas en un dia. El cursor es el rowid de SQLite,
     no el reloj del telefono. rev lo invalida tras cada compactacion. */
  _responderPullV2(sock, msg) {
    if (!this.sql) return;
    try {
      let cursorRev = Number.isFinite(Number(msg.rev)) ? Math.trunc(Number(msg.rev)) : -1;
      let cursorSeq = Math.max(0, Math.trunc(Number(msg.seq) || 0));
      const pageSize = Math.max(1, Math.min(PULL_PAGE_MAX, Math.trunc(Number(msg.limit) || PULL_PAGE_DEFAULT)));

      const ck = this.sql.exec("SELECT lam, c, rev FROM ckpt WHERE k = 'latest'").toArray();
      const revActual = ck.length ? (Number(ck[0].rev) || 0) : 0;
      if (cursorRev !== revActual) {
        /* Una generacion distinta significa que hubo compactacion. El ckpt
           resume lo anterior y las ops que queden se leen desde rowid cero. */
        if (ck.length) {
        try { if (sock.readyState === 1) sock.send(b64aBuf(ck[0].c)); } catch (_) { return; }
        }
        cursorRev = revActual;
        cursorSeq = 0;
      }

      const filas = this.sql.exec(
        "SELECT rowid AS seq, c FROM ops WHERE rowid > ? ORDER BY rowid ASC LIMIT ?",
        cursorSeq, pageSize
      ).toArray();
      for (const f of filas) {
        try { if (sock.readyState === 1) sock.send(b64aBuf(f.c)); else return; } catch (_) { return; }
      }
      if (filas.length) {
        const ultima = filas[filas.length - 1];
        cursorSeq = Number(ultima.seq) || 0;
      }
      try {
        if (sock.readyState === 1) sock.send(JSON.stringify({
          k: "pull-page", v: 2, rev: cursorRev, seq: cursorSeq,
          more: filas.length === pageSize, n: filas.length,
        }));
      } catch (_) {}
    } catch (_) {}
  }

  async fetch(request) {
    if (new URL(request.url).pathname === "/__migration/export") {
      const query = await migrationRequest(request, this.env);
      const target = query && (query.objectId || this.env.SALAS.idFromName(query.room).toString());
      if (!query || target !== this.state.id.toString()) return migrationJson({ error: "forbidden" }, 403);
      return this._exportEncryptedPage(query);
    }
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
    this._avisarPares();

    return new Response(null, { status: 101, webSocket: cliente });
  }

  async _exportEncryptedPage(query) {
    if (!this.sql) return migrationJson({ error: "storage unavailable" }, 503);
    try {
      const after = Number(query.after || 0), limit = Math.min(32, Math.max(1, Number(query.limit) || 16));
      if (!Number.isSafeInteger(after) || after < 0) return migrationJson({ error: "invalid cursor" }, 400);
      const checkpoint = this.sql.exec("SELECT lam, c, rev, v FROM ckpt WHERE k='latest'").toArray()[0] || null;
      const top = this.sql.exec("SELECT rowid AS seq FROM ops ORDER BY rowid DESC LIMIT 1").toArray()[0];
      const maxSeq = query.cut ? Number(query.cut.maxSeq) : Number(top?.seq || 0);
      if (!Number.isSafeInteger(maxSeq) || maxSeq < 0 || after > maxSeq) return migrationJson({ error: "invalid cut" }, 400);
      const bottom = this.sql.exec("SELECT rowid AS seq FROM ops WHERE rowid <= ? ORDER BY rowid LIMIT 1", maxSeq).toArray()[0];
      const minSeq = Number(bottom?.seq || 0);
      const rows = this.sql.exec("SELECT rowid AS seq, id, lam, c FROM ops WHERE rowid > ? AND rowid <= ? ORDER BY rowid LIMIT ?", after, maxSeq, limit).toArray();
      // All SQLite reads above precede the first await: one coherent page.
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(checkpoint)));
      const fingerprint = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
      const cut = { maxSeq, minSeq, fingerprint };
      // Compaction changes either the checkpoint or the first surviving row.
      // Restart the read; never silently export a history with a missing page.
      if (query.cut && (query.cut.fingerprint !== fingerprint || Number(query.cut.minSeq) !== minSeq)) {
        return migrationJson({ error: "source changed; restart export" }, 409);
      }
      let size = 0; const ops = [];
      for (const row of rows) {
        const bytes = (row.c?.length || 0) + (row.id?.length || 0) + 128;
        if (size + bytes > 512 * 1024) break;
        size += bytes; ops.push(row);
      }
      if (!ops.length && rows.length) return migrationJson({ error: "stored frame exceeds export bound" }, 413);
      const cursor = ops.length ? Number(ops[ops.length - 1].seq) : after;
      return migrationJson({ v: 1, cut, checkpoint: after === 0 ? checkpoint : null, ops, after: cursor, more: cursor < maxSeq });
    } catch (_) { return migrationJson({ error: "export unavailable" }, 503); }
  }

  // === Handlers de la WebSocket Hibernation API ===
  _avisarPares(excluir) {
    const sockets = this.state.getWebSockets().filter(s => s !== excluir && s.readyState === 1);
    for (const s of sockets) {
      try { s.send(JSON.stringify({ k: "peer-count", n: sockets.length })); } catch (_) {}
    }
  }
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
        if (msg.k === "op" || msg.k === "ckpt") {
          const ok = msg.k === "op"
            ? this._guardarOp(msg.id, msg.lam, msg.c)
            : this._guardarCkpt(msg.lam, msg.c, msg.v, msg.rev, msg.seq);
          // Opt-in acknowledgement: clients already in use retain their wire format.
          if (msg.ack === 1 && typeof msg.id === "string") {
            let conflict = false;
            if (!ok && msg.k === "ckpt" && Number(msg.v) === 2 && this.sql) {
              try {
                const current = this.sql.exec("SELECT rev FROM ckpt WHERE k = 'latest'").toArray();
                conflict = Number(msg.rev) !== (current.length ? Number(current[0].rev) || 0 : 0);
              } catch (_) {}
            }
            try { servidor.send(JSON.stringify({ k: "persist-result", kind: msg.k, id: msg.id, ok: ok === true, conflict })); } catch (_) {}
          }
          return;
        }
        if (msg.k === "pull") {
          if (Number(msg.v) === 2) this._responderPullV2(servidor, msg);
          else this._responderPull(servidor, msg.lam); // compatibilidad con shells viejos
          return;
        }
        /* MEDICION DE LATENCIA (JFC 2026-09-22). Dos frames de control nuevos.
           NINGUNO toca el almacenamiento: son memoria y reenvio puros. Esto es
           deliberado — el incidente de costo de v328 fue por un SELECT COUNT(*)
           en el camino caliente, y una medicion jamas debe poder repetir eso.
           El relay SIGUE sin abrir ni interpretar contenido de negocio: aqui
           solo viajan numeros de reloj y una etiqueta corta. (Redaccion a
           proposito: sync-zero-trust.test.js veta el infinitivo de la palabra
           "descifr-ar" en el fuente como guard anti-cripto. Aqui seria un falso
           positivo, pero el guard protege algo real y NO se relaja por mi
           comodidad: se reescribe el comentario, no la prueba.)

           k:"ts"  -> devuelve la hora DEL RELAY. Es el reloj de referencia con
                      el que cada aparato calcula su desfase (estilo NTP). Se
                      consume, no se retransmite.
           k:"lat" -> marca de origen de un cambio, ya en hora del relay. SI se
                      retransmite a los demas (es para ellos) y se le agrega la
                      hora de reenvio, que permite separar la pata
                      emisor->relay de la pata relay->receptor. */
        if (msg.k === "ts") {
          try { servidor.send(JSON.stringify({ k: "tsr", t0: msg.t0, t1: Date.now() })); } catch (_) {}
          return;
        }
        if (msg.k === "lat") {
          const eco = JSON.stringify({
            k: "lat",
            oTs: msg.oTs,
            etq: typeof msg.etq === "string" ? msg.etq.slice(0, 24) : "",
            rTs: Date.now(),
          });
          for (const s of this.state.getWebSockets()) {
            if (s === servidor) continue;
            try { if (s.readyState === 1) s.send(eco); } catch (_) {}
          }
          return;
        }
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
    this._avisarPares(servidor);
  }

  async webSocketError(servidor, err) {
    try { servidor.close(1011, "error"); } catch (_) {}
    this._avisarPares(servidor);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/migration/export") {
      // Reconstruct only after signature verification; do not enter a room for
      // unsigned requests. No data or credentials are logged by this path.
      const query = await migrationRequest(request, env);
      if (!query) return migrationJson({ error: "forbidden" }, 403);
      try {
        const id = query.objectId ? env.SALAS.idFromString(query.objectId) : env.SALAS.idFromName(query.room);
        return await env.SALAS.get(id).fetch(new Request("https://relay.internal/__migration/export", {
          method: "POST", headers: request.headers, body: query[MIGRATION_BODY]
        }));
      } catch (_) { return migrationJson({ error: "export unavailable" }, 503); }
    }
    // Salud sin tocar salas (para monitoreo): responde sin revelar nada.
    if (url.pathname === "/" || url.pathname === "/health") {
      return new Response("friendly123-sync-relay ok", {
        status: 200,
        headers: {
          "content-type": "text/plain; charset=utf-8",
          "x-friendly-relay-release": "durable-ack-20261014",
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
