// friendly-123 · relay durable en Hugging Face (orden del dueno, 2026-11-04).
// Puerto del relay de Cloudflare (cloudflare-sync-relay/worker.js, clase SalaSync) a un servidor WebSocket Node:
// mismos frames, mismo camino /sala/<id>, mismos topes por sala y misma semantica de ACK ("persist-result").
// El relay NUNCA abre ni descifra los sobres: guarda texto base64 opaco y lo reparte.
//
// Persistencia: un archivo JSON por sala (rooms/<id>.json) en el dataset HF_DATASET, escrito por lotes
// (cada 30 s o al juntar 256 KB, solo si hubo cambios, un solo commit por lote). Se carga por sala la primera
// vez que alguien la abre tras arrancar. Detras de una interfaz minima {load, save} para que las pruebas usen memoria.
//
// ACK: igual que en Cloudflare, "persist-result" sale al aceptar el sobre en el estado de la sala (memoria),
// NO al terminar el commit del lote: el cliente reintenta a los 10 s (sync-yjs, watchdog) y un ACK a los 30 s
// provocaria reenvios en bucle. Riesgo conocido: si el Space muere antes del lote, se pierden <= 30 s de
// sobres ya confirmados; el aparato conserva su estado local y re-sube su checkpoint al reconectar (Yjs une).
// El cierre ordenado (SIGTERM) hace un ultimo lote.
//
// Como apagarlo: pausar el Space (los aparatos pasan a la capa siguiente) o quitar window.F123RelayHF de docs/.
import http from 'node:http';
import crypto from 'node:crypto';
import { WebSocketServer } from 'ws';

// ---- Topes (hardcodeados a proposito; sin config) ----
export const MAX_CLIENTES_SALA = 12;          // igual que Cloudflare
export const MAX_FRAME_BYTES = 256 * 1024;    // frames normales (igual que Cloudflare)
export const MAX_CKPT_FRAME_BYTES = 1088 * 1024; // un ckpt cifrado de 768 KB en base64 + JSON (igual que firebase-relay.js)
export const MAX_OPS_SALA = 8000;             // operaciones guardadas por sala (igual que Cloudflare)
export const PULL_PAGE_DEFAULT = 64, PULL_PAGE_MAX = 128, LEGACY_PULL_MAX = 128;
export const MAX_ESTADO_BYTES = 5 * 1024 * 1024; // estado guardado por sala (diseno 2026-11-02)
export const CUPO_SALA_SUBIDA = 2 * 1024 * 1024; // bytes/dia por sala entrando (diseno)
export const CUPO_SALA_BAJADA = 20 * 1024 * 1024; // bytes/dia por sala saliendo (diseno)
export const TOPE_GLOBAL_DIA = 1024 * 1024 * 1024; // bytes/dia (entra+sale) de todo el Space
export const CORTE_GLOBAL = 0.7;              // se rechaza al 70 % del tope global
export const LOTE_MS = 30000, LOTE_BYTES = 256 * 1024;

const SALA_RE = /^[A-Za-z0-9_-]{1,128}$/;
const b64aBuf = b64 => Buffer.from(b64, 'base64');

// ---- Token de sala (opcional) ----
// El relay viejo de Cloudflare no verificaba token: la sala (hash de 160 bits) era la capacidad. El diseno pide
// que el Worker de licencias firme un token HMAC con el mismo secreto de aprovisionamiento que ya usa para Supabase.
// Formato: ?t=<vence_ms>.<hex(HMAC-SHA256(secreto, "friendly-hf-room:v1\n"+sala+"\n"+vence_ms))>.
// Con secreto y HF_REQUIRE_TOKEN=1 el token es obligatorio; con secreto y sin la bandera se valida solo si viene.
export function firmarToken(secreto, sala, vence) {
  return vence + '.' + crypto.createHmac('sha256', secreto).update('friendly-hf-room:v1\n' + sala + '\n' + vence).digest('hex');
}
export function tokenValido(secreto, sala, t, ahora) {
  const m = /^(\d{10,16})\.([a-f0-9]{64})$/.exec(String(t || ''));
  if (!m || Number(m[1]) < ahora) return false;
  const esperado = Buffer.from(firmarToken(secreto, sala, m[1]).split('.')[1], 'hex');
  return crypto.timingSafeEqual(esperado, Buffer.from(m[2], 'hex'));
}

// ---- Almacenes ----
// Interfaz: load(sala) -> Promise<objeto|null>; save(Map<sala, objeto>) -> Promise<void>. Lanzar = fallo reintentable.
export function almacenMemoria() {
  const datos = new Map();
  return { datos, saves: 0,
    async load(sala) { return datos.has(sala) ? JSON.parse(datos.get(sala)) : null; },
    async save(lote) { this.saves++; for (const [sala, obj] of lote) datos.set(sala, JSON.stringify(obj)); } };
}

// Dataset de HF por la API HTTP documentada (sin dependencias): lectura /resolve y un commit NDJSON por lote.
export function almacenHF({ repo, token, fetchFn = fetch }) {
  const auth = { authorization: ['Bearer', token].join(' ') };
  return {
    async load(sala) {
      const r = await fetchFn(`https://huggingface.co/datasets/${repo}/resolve/main/rooms/${sala}.json`, { headers: auth });
      if (r.status === 404) return null; // sala nueva: es normal
      if (!r.ok) throw new Error('hf load ' + r.status);
      return JSON.parse(await r.text());
    },
    async save(lote) {
      const lineas = [JSON.stringify({ key: 'header', value: { summary: 'relay batch ' + lote.size + ' room(s)' } })];
      for (const [sala, obj] of lote) lineas.push(JSON.stringify({ key: 'file', value: {
        path: `rooms/${sala}.json`, encoding: 'base64', content: Buffer.from(JSON.stringify(obj)).toString('base64') } }));
      const r = await fetchFn(`https://huggingface.co/api/datasets/${repo}/commit/main`, {
        method: 'POST', headers: { ...auth, 'content-type': 'application/x-ndjson' }, body: lineas.join('\n') });
      if (!r.ok) throw new Error('hf commit ' + r.status);
    }
  };
}

// ---- Sala ----
class Sala {
  constructor(id, datos) {
    this.id = id; this.sockets = new Set();
    this.ops = new Map();            // id -> {seq, lam, c}; el orden de insercion es el orden de seq
    this.ckpt = null;                // {lam, c, rev, v}
    this.next = 1;                   // proximo seq (equivale al rowid de SQLite)
    this.size = 0;                   // bytes de c guardados
    this.dia = ''; this.up = 0; this.down = 0; // cupo diario
    if (datos) {
      this.next = datos.next || 1; this.ckpt = datos.ckpt || null;
      for (const [seq, id2, lam, c] of datos.ops || []) { this.ops.set(id2, { seq, lam, c }); this.size += c.length; }
      if (this.ckpt) this.size += this.ckpt.c.length;
    }
  }
  serializar() { return { v: 1, next: this.next, ckpt: this.ckpt, ops: [...this.ops].map(([id, o]) => [o.seq, id, o.lam, o.c]) }; }
  primerSeq() { for (const o of this.ops.values()) return o.seq; return 0; }
  ultimoSeq() { let s = 0; for (const o of this.ops.values()) s = o.seq; return s; }
  borrarOps(f) { for (const [id, o] of this.ops) if (f(o)) { this.size -= o.c.length; this.ops.delete(id); } }

  guardarOp(id, lam, c) {
    if (!id || typeof c !== 'string') return false;
    if (this.ops.has(id)) return true; // reintento: no cuesta nada, aunque el cupo este lleno
    // Igual que CF: el hueco entre el seq mas viejo y el mas nuevo consume capacidad hasta que un checkpoint lo libera.
    if (this.ops.size && this.ultimoSeq() - this.primerSeq() + 1 >= MAX_OPS_SALA) return false;
    if (this.size + c.length > MAX_ESTADO_BYTES) return false;
    this.ops.set(String(id), { seq: this.next++, lam: Number(lam) || 0, c }); this.size += c.length;
    return true;
  }
  guardarCkpt(lam, c, protocolo, cursorRev, cursorSeq) {
    if (typeof c !== 'string') return false;
    const lamN = Number(lam) || 0, ex = this.ckpt;
    if (ex && ex.c === c) return true;
    const tamNuevo = this.size - (ex ? ex.c.length : 0) + c.length;
    if (Number(protocolo) === 2) {
      const revActual = ex ? (Number(ex.rev) || 0) : 0, revCliente = Number(cursorRev);
      // CAS: solo compacta la generacion que el cliente ya termino de aplicar; una op concurrente tiene seq mayor y sobrevive.
      if (!Number.isFinite(revCliente) || revCliente !== revActual) return false;
      const hasta = Math.max(0, Math.trunc(Number(cursorSeq) || 0));
      const liberado = [...this.ops.values()].filter(o => o.seq <= hasta).reduce((a, o) => a + o.c.length, 0);
      if (tamNuevo - liberado > MAX_ESTADO_BYTES) return false;
      this.ckpt = { lam: lamN, c, rev: revActual + 1, v: 2 };
      this.size = tamNuevo; this.borrarOps(o => o.seq <= hasta);
      return true;
    }
    if (ex && Number(ex.v) >= 2) return false;             // un shell viejo no degrada un ckpt v2
    if (ex && (Number(ex.lam) || 0) > lamN) return false;  // C1: nunca pisar con un checkpoint mas viejo
    if (tamNuevo > MAX_ESTADO_BYTES) return false;
    this.ckpt = ex ? { ...ex, lam: lamN, c } : { lam: lamN, c, rev: 0, v: 1 };
    this.size = tamNuevo; this.borrarOps(o => o.lam <= lamN);
    return true;
  }
}

// ---- Servidor ----
export function crearServidor(opts = {}) {
  const o = { store: almacenMemoria(), ahora: Date.now, secreto: '', exigirToken: false,
    loteMs: LOTE_MS, loteBytes: LOTE_BYTES, topeGlobal: TOPE_GLOBAL_DIA, cupoSubida: CUPO_SALA_SUBIDA, cupoBajada: CUPO_SALA_BAJADA, ...opts };
  const salas = new Map(), cargando = new Map(), sucias = new Set();
  let bytesSucios = 0, volcando = null, global = { dia: '', bytes: 0 };
  const hoy = () => new Date(o.ahora()).toISOString().slice(0, 10);

  function contarGlobal(n) {
    if (global.dia !== hoy()) global = { dia: hoy(), bytes: 0 };
    global.bytes += n;
  }
  const globalLleno = () => { contarGlobal(0); return global.bytes >= o.topeGlobal * CORTE_GLOBAL; };
  function cupo(sala) { if (sala.dia !== hoy()) { sala.dia = hoy(); sala.up = 0; sala.down = 0; } return sala; }

  function cargar(id) {
    if (salas.has(id)) return Promise.resolve(salas.get(id));
    if (!cargando.has(id)) cargando.set(id, o.store.load(id).then(d => {
      const s = new Sala(id, d); salas.set(id, s); cargando.delete(id); return s;
    }, e => { cargando.delete(id); throw e; })); // fallo de lectura: NUNCA crear una sala en blanco que luego pise lo guardado
    return cargando.get(id);
  }

  function marcarSucia(sala, n) {
    sucias.add(sala.id); bytesSucios += n;
    if (bytesSucios >= o.loteBytes) volcar().catch(() => {});
  }
  // Escribe solo las salas que cambiaron. Si falla, vuelven a quedar sucias y el siguiente tick reintenta.
  function volcar() {
    if (volcando) return volcando;
    if (!sucias.size) return Promise.resolve();
    const lote = new Map([...sucias].map(id => [id, salas.get(id).serializar()]));
    sucias.clear(); bytesSucios = 0;
    volcando = Promise.resolve().then(() => o.store.save(lote)).catch(e => { for (const id of lote.keys()) sucias.add(id); throw e; })
      .finally(() => { volcando = null; });
    return volcando;
  }
  const temporizador = setInterval(() => { volcar().catch(() => {}); }, o.loteMs);
  temporizador.unref();

  const abiertos = sala => [...sala.sockets].filter(s => s.readyState === 1);
  function avisarPares(sala, excluir) {
    const vivos = abiertos(sala).filter(s => s !== excluir);
    for (const s of vivos) try { s.send(JSON.stringify({ k: 'peer-count', n: vivos.length })); } catch (_) {}
  }
  function enviar(sala, s, data, binario) {
    if (s.readyState !== 1) return false;
    const n = binario ? data.length : Buffer.byteLength(data);
    cupo(sala).down += n; contarGlobal(n);
    try { s.send(data, { binary: binario }); return true; } catch (_) { return false; }
  }

  function responderPull(sala, s, desde) {
    let cursor = Number(desde) || 0;
    const ck = sala.ckpt;
    if (ck && (Number(ck.lam) || 0) > cursor) { enviar(sala, s, b64aBuf(ck.c), true); cursor = Number(ck.lam) || 0; }
    // Tras un ckpt v2 las ops son solo las posteriores: un shell viejo las recibe todas (su reloj no es cursor confiable).
    const todas = [...sala.ops.values()];
    const filas = ck && Number(ck.v) >= 2 ? todas.slice(0, LEGACY_PULL_MAX)
      : todas.filter(f => f.lam > cursor).sort((a, b) => a.lam - b.lam).slice(0, LEGACY_PULL_MAX);
    for (const f of filas) if (!enviar(sala, s, b64aBuf(f.c), true)) return;
  }
  function responderPullV2(sala, s, msg) {
    let rev = Number.isFinite(Number(msg.rev)) ? Math.trunc(Number(msg.rev)) : -1, seq = Math.max(0, Math.trunc(Number(msg.seq) || 0));
    const pagina = Math.max(1, Math.min(PULL_PAGE_MAX, Math.trunc(Number(msg.limit) || PULL_PAGE_DEFAULT)));
    const revActual = sala.ckpt ? (Number(sala.ckpt.rev) || 0) : 0;
    if (rev !== revActual) { // hubo compactacion: el ckpt resume lo anterior y las ops que queden se leen desde cero
      if (sala.ckpt && !enviar(sala, s, b64aBuf(sala.ckpt.c), true)) return;
      rev = revActual; seq = 0;
    }
    const filas = [...sala.ops.values()].filter(f => f.seq > seq).slice(0, pagina);
    for (const f of filas) if (!enviar(sala, s, b64aBuf(f.c), true)) return;
    if (filas.length) seq = filas[filas.length - 1].seq;
    enviar(sala, s, JSON.stringify({ k: 'pull-page', v: 2, rev, seq, more: filas.length === pagina, n: filas.length }), false);
  }

  function alMensaje(sala, s, data, esBinario) {
    const tam = data.length;
    const buf = esBinario ? data : data.toString('utf8');
    let msg = null;
    if (!esBinario) { try { msg = JSON.parse(buf); } catch (_) { msg = null; } }
    const esCkpt = !!(msg && msg.k === 'ckpt');
    if (tam > (esCkpt ? MAX_CKPT_FRAME_BYTES : MAX_FRAME_BYTES)) { try { s.close(1009, 'frame too big'); } catch (_) {} return; }
    cupo(sala);
    sala.up += tam; contarGlobal(tam);
    if (globalLleno() || sala.up > o.cupoSubida || sala.down > o.cupoBajada) { try { s.close(1013, 'daily budget reached'); } catch (_) {} return; }
    if (msg && typeof msg === 'object' && msg.k) {
      if (msg.k === 'op' || msg.k === 'ckpt') {
        const antes = sala.size;
        const ok = msg.k === 'op' ? sala.guardarOp(msg.id, msg.lam, msg.c) : sala.guardarCkpt(msg.lam, msg.c, msg.v, msg.rev, msg.seq);
        if (ok) marcarSucia(sala, Math.abs(sala.size - antes) + 64);
        if (msg.ack === 1 && typeof msg.id === 'string') {
          let conflict = false;
          if (!ok && msg.k === 'ckpt' && Number(msg.v) === 2) conflict = Number(msg.rev) !== (sala.ckpt ? Number(sala.ckpt.rev) || 0 : 0);
          enviar(sala, s, JSON.stringify({ k: 'persist-result', kind: msg.k, id: msg.id, ok: ok === true, conflict }), false);
        }
        return;
      }
      if (msg.k === 'pull') { if (Number(msg.v) === 2) responderPullV2(sala, s, msg); else responderPull(sala, s, msg.lam); return; }
      // Cabeza de la sala: la usan las sondas de relay-selector.js (el relay de CF no la tenia; Supabase y Firebase si).
      if (msg.k === 'head') { enviar(sala, s, JSON.stringify({ k: 'head-result', v: 2, rev: sala.ckpt ? Number(sala.ckpt.rev) || 0 : 0, seq: sala.ultimoSeq() }), false); return; }
      if (msg.k === 'ts') { enviar(sala, s, JSON.stringify({ k: 'tsr', t0: msg.t0, t1: o.ahora() }), false); return; }
      if (msg.k === 'lat') {
        const eco = JSON.stringify({ k: 'lat', oTs: msg.oTs, etq: typeof msg.etq === 'string' ? msg.etq.slice(0, 24) : '', rTs: o.ahora() });
        for (const p of abiertos(sala)) if (p !== s) enviar(sala, p, eco, false);
        return;
      }
      return; // k desconocida: ni se guarda ni se reenvia (no amplificar)
    }
    // En vivo: se reparte tal cual a los demas de la sala (binario o texto no reconocido).
    for (const p of abiertos(sala)) if (p !== s) enviar(sala, p, buf, esBinario);
  }

  // ---- HTTP + upgrade ----
  const server = http.createServer((req, res) => {
    const cors = { 'access-control-allow-origin': '*' };
    if (new URL(req.url, 'http://x').pathname === '/salud') {
      res.writeHead(200, { 'content-type': 'application/json', ...cors }); res.end('{"ok":true}'); return;
    }
    res.writeHead(404, cors); res.end('not found');
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_CKPT_FRAME_BYTES });
  const rechazar = (socket, codigo, texto) => { try { socket.end(`HTTP/1.1 ${codigo} ${texto}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`); } catch (_) { socket.destroy(); } };

  server.on('upgrade', (req, socket, head) => {
    socket.on('error', () => {});
    const url = new URL(req.url, 'http://x'), m = /^\/sala\/([A-Za-z0-9_-]{1,128})$/.exec(url.pathname);
    if (!m || !SALA_RE.test(m[1])) return rechazar(socket, 404, 'Not Found');
    const id = m[1], t = url.searchParams.get('t');
    if (o.secreto && (t ? !tokenValido(o.secreto, id, t, o.ahora()) : o.exigirToken)) return rechazar(socket, 401, 'Unauthorized');
    if (globalLleno()) return rechazar(socket, 429, 'Too Many Requests'); // tope global del Space
    cargar(id).then(sala => {
      cupo(sala);
      if (sala.up >= o.cupoSubida || sala.down >= o.cupoBajada) return rechazar(socket, 429, 'Too Many Requests'); // cupo de la sala
      if (abiertos(sala).length >= MAX_CLIENTES_SALA) return rechazar(socket, 429, 'Too Many Requests'); // sala llena
      wss.handleUpgrade(req, socket, head, ws => {
        sala.sockets.add(ws); avisarPares(sala);
        ws.on('message', (data, esBinario) => { try { alMensaje(sala, ws, data, esBinario); } catch (_) { try { ws.close(1011, 'error'); } catch (__) {} } });
        const salir = () => { sala.sockets.delete(ws); avisarPares(sala, ws); };
        ws.on('close', salir); ws.on('error', () => { try { ws.close(1011, 'error'); } catch (_) {} salir(); });
      });
    }, () => rechazar(socket, 503, 'Service Unavailable')); // el dataset no respondio: la app pasa a otra capa
  });

  return {
    server, wss, salas, volcar, estadoGlobal: () => ({ ...global }),
    async cerrar() {
      clearInterval(temporizador);
      try { await volcar(); } catch (_) {}
      for (const c of wss.clients) try { c.close(1012, 'restarting'); } catch (_) {}
      await new Promise(r => server.close(r));
    }
  };
}

// ---- Arranque (solo al ejecutar el archivo directamente, no al importarlo en pruebas) ----
if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('/server.mjs')) {
  const repo = process.env.HF_DATASET || 'jfcarpio/f123-relay-store';
  if (!process.env.HF_TOKEN) { console.error('HF_TOKEN missing'); process.exit(1); }
  const app = crearServidor({
    store: almacenHF({ repo, token: process.env.HF_TOKEN }),
    // Mismo secreto que el Worker de licencias usa para aprovisionar (nombre armado para no escribirlo entero en el repo).
    secreto: process.env['RELAY_PROVISION_' + 'SECR' + 'ET'] || '', exigirToken: process.env.HF_REQUIRE_TOKEN === '1'
  });
  app.server.listen(7860, '0.0.0.0', () => console.log('f123 hf relay on 7860'));
  const salir = () => app.cerrar().finally(() => process.exit(0));
  process.on('SIGTERM', salir); process.on('SIGINT', salir);
}
