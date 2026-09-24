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
const PULL_PAGE_DEFAULT = 64;
const PULL_PAGE_MAX = 128;

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
    if (!this.sql || !id || typeof c !== "string") return;
    try {
      this.sql.exec("INSERT OR IGNORE INTO ops(id, lam, c) VALUES (?, ?, ?)", String(id), Number(lam) || 0, c);
      /* COUNT(*) por CADA op era el quemador. Se muestrea por hash del id en
         vez de contar en memoria: la hibernacion ya no desactiva la poda y no
         agregamos una lectura/escritura de metadata por cada operacion. */
      if (debePodar(id)) {
        this.sql.exec("DELETE FROM ops WHERE id IN (SELECT id FROM ops ORDER BY lam DESC LIMIT -1 OFFSET ?)", MAX_OPS_SALA);
      }
    } catch (_) {}
  }

  _guardarCkpt(lam, c, protocolo, cursorRev, cursorSeq) {
    if (!this.sql || typeof c !== "string") return;
    try {
      const lamN = Number(lam) || 0;
      const existente = this.sql.exec("SELECT lam, rev, v FROM ckpt WHERE k = 'latest'").toArray();

      if (Number(protocolo) === 2) {
        const revActual = existente.length ? (Number(existente[0].rev) || 0) : 0;
        const revCliente = Number(cursorRev);
        const seqCliente = Math.max(0, Math.trunc(Number(cursorSeq) || 0));
        /* CAS: el estado solo puede compactar la generacion que el cliente ya
           termino de aplicar. Una op concurrente tiene rowid mayor y sobrevive. */
        if (!Number.isFinite(revCliente) || revCliente !== revActual) return;
        this.sql.exec(
          "INSERT INTO ckpt(k, lam, c, rev, v) VALUES ('latest', ?, ?, ?, 2) " +
          "ON CONFLICT(k) DO UPDATE SET lam = excluded.lam, c = excluded.c, rev = excluded.rev, v = 2",
          lamN, c, revActual + 1
        );
        this.sql.exec("DELETE FROM ops WHERE rowid <= ?", seqCliente);
        return;
      }

      // Un shell viejo no puede degradar un checkpoint ya confirmado por v2.
      if (existente.length && Number(existente[0].v) >= 2) return;
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
      const ck = this.sql.exec("SELECT lam, c, v FROM ckpt WHERE k = 'latest'").toArray();
      if (ck.length && (Number(ck[0].lam) || 0) > cursor) {
        try { if (sock.readyState === 1) sock.send(b64aBuf(ck[0].c)); } catch (_) {}
        cursor = Number(ck[0].lam) || 0;
      }
      // 2) Las operaciones posteriores al cursor, en orden.
      /* Tras un checkpoint v2, ops solo contiene filas concurrentes/posteriores
         a ese estado. Un shell viejo debe recibirlas TODAS: su reloj no es un
         cursor confiable y puede estar adelantado o atrasado. */
      const filas = ck.length && Number(ck[0].v) >= 2
        ? this.sql.exec("SELECT c FROM ops ORDER BY rowid ASC LIMIT ?", MAX_OPS_SALA).toArray()
        : this.sql.exec("SELECT c FROM ops WHERE lam > ? ORDER BY lam ASC LIMIT ?", cursor, MAX_OPS_SALA).toArray();
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
        if (msg.k === "ckpt") { this._guardarCkpt(msg.lam, msg.c, msg.v, msg.rev, msg.seq); return; }
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
