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

export class SalaSync {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.sockets = new Set();
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
      // Tope de tamano SIN mirar el contenido: solo el largo en bytes/caracteres.
      const tam = typeof data === "string" ? data.length : (data && data.byteLength) || 0;
      if (tam > MAX_FRAME_BYTES) {
        try { servidor.close(1009, "frame too big"); } catch (_) {}
        return;
      }
      // Reenvio a los DEMAS de la sala. El relay no descifra ni inspecciona.
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
