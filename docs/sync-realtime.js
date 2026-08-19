// AMIGABLE — Cliente de sincronizacion en tiempo real (2026-07-23)
// ============================================================================
// QUE HACE: en cuanto el dueño se licencia (automatico) o un encargado escribe
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

  // ---------------------------------------------------------------------------
  // CATCH-UP ENTRE PARES (2026-08-04) — sin tocar el manifiesto NO CLOUD
  // ---------------------------------------------------------------------------
  // El relay sigue "sordo y desmemoriado a proposito": no guarda nada, solo
  // rebota blobs cifrados. El problema que esto resuelve es otro: si el
  // equipo B estuvo CERRADO mientras A vendia, B nunca se enteraba de esas
  // ventas al reconectar — el relay solo reenvia en vivo, no tiene memoria
  // que consultar. Antes, la unica salida era un respaldo manual.
  //
  // La solucion NO es que el relay guarde nada. Es que cada dispositivo ya
  // guarda un registro corto de las ULTIMAS operaciones que vio (propias y
  // ajenas) en SU PROPIO localStorage — eso no es "cloud", es el mismo dato
  // que el dispositivo ya genero. Al reconectarse, un dispositivo pregunta
  // "cual es tu ultimo lamport de cada equipo que conoces" y CUALQUIER PAR
  // que este conectado en ese momento y tenga ops mas nuevas se las manda
  // DIRECTO — el relay solo las reenvia, igual que cualquier Op normal.
  //
  // Reutiliza el mismo canal cifrado E2E y el mismo dedup por opId que ya
  // existe en mock-backend.js (_opsAplicadas, tope 500) — reenviar una op
  // vieja nunca duplica una venta, aplicarOpRemota() ya la reconoce y la
  // ignora si ya se aplico.
  //
  // Si nadie estuvo online mientras el otro vendia (caso raro: todo el
  // equipo apagado a la vez), la brecha no se puede cerrar sola — ahi sigue
  // el respaldo manual/WhatsApp como red de ultimo recurso (Fases 2 y 4).
  const LOG_KEY = "amigable_sync_log"; // ultimas ops vistas (propias + ajenas), para poder RE-enviarlas a un par que las perdio
  const LOG_TOPE = 500; // mismo tope que el dedup de mock-backend.js, mismo criterio
  const TIPO_CATCHUP_PEDIDO = "__catchup_pedido__";
  /* Tipos que alimentan el TABLERO DE CONTROL (portado de amigable-123,
     2026-08-18). El tablero es un lienzo que no guarda nada: pide una foto del
     negocio, la pinta y la olvida al cerrarse. Estos mensajes viajan cifrados
     por el mismo relay, que solo rebota bytes que no puede leer. */
  const TIPO_LATIDO = "__latido__";
  const TIPO_PIN = "__pin__";
  const TIPO_ORDEN = "__orden__";
  const TIPO_RESPUESTA = "__respuesta__";
  const TIPO_FOTO_PEDIDA = "__foto_pedida__";
  const TIPO_FOTO_TROZO = "__foto_trozo__";
  const FOTO_FILAS_POR_TROZO = 200;

  function leerLog() {
    try { const a = JSON.parse(localStorage.getItem(LOG_KEY) || "[]"); return Array.isArray(a) ? a : []; }
    catch (_) { return []; }
  }
  function registrarEnLog(op) {
    if (!op || !op.opId) return;
    try {
      const log = leerLog();
      if (log.some((o) => o.opId === op.opId)) return; // ya esta, no duplicar
      log.push(op);
      localStorage.setItem(LOG_KEY, JSON.stringify(log.slice(-LOG_TOPE)));
    } catch (_) {}
  }
  // Vector "lo mas nuevo que conozco de cada dispositivo" — se manda al
  // reconectar para que los pares sepan que me falta.
  function construirVectorConocido() {
    const v = {};
    leerLog().forEach((op) => {
      if (!op.deviceId || typeof op.lamport !== "number") return;
      if (!(op.deviceId in v) || op.lamport > v[op.deviceId]) v[op.deviceId] = op.lamport;
    });
    return v;
  }
  // Ops que YO tengo y que, segun el vector recibido, el que pregunta no
  // tiene todavia. Nunca le devuelvo sus propias ops (el vector ya las
  // incluye si las tiene; si no las tiene, tampoco soy yo quien deba
  // reenviarselas — vinieron de el).
  function buscarOpsFaltantes(vectorPedido, deviceIdPide) {
    const conocido = vectorPedido || {};
    return leerLog().filter((op) => {
      if (op.deviceId === deviceIdPide) return false;
      const max = typeof conocido[op.deviceId] === "number" ? conocido[op.deviceId] : 0;
      return op.lamport > max;
    }).slice(-200); // tope por respuesta: evitar un envio gigante de una sola vez
  }

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
      pedirCatchup();
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
        // Catch-up (2026-08-04): un par pregunto que ops le faltan. Le
        // contesto directo (el relay solo reenvia, no interviene) con lo que
        // yo tengo en mi log local que el todavia no vio. Nunca se aplica
        // como si fuera una Op real de negocio.
        if (op && op.tipo === TIPO_CATCHUP_PEDIDO) {
          responderCatchup(op);
          return;
        }
        /* Mensajes del tablero. Ninguno es una Op de negocio: no se registran
           en el log ni se aplican al estado. Solo se contestan. */
        if (op && op.tipo === TIPO_FOTO_PEDIDA) { responderFoto(op); return; }
        if (op && op.tipo === TIPO_PIN) { responderPin(op); return; }
        if (op && op.tipo === TIPO_ORDEN) { responderOrden(op); return; }
        /* Y los que emite el propio tablero: se ignoran aqui para no
           reprocesarlos ni meterlos al log de ops. */
        if (op && (op.tipo === TIPO_FOTO_TROZO || op.tipo === TIPO_RESPUESTA || op.tipo === TIPO_LATIDO)) return;
        registrarEnLog(op);
        if (window.OCSync && window.OCSync.aplicarOpRemota) window.OCSync.aplicarOpRemota(op);
        window.dispatchEvent(new CustomEvent("oc-sync-op-remota", { detail: op }));
      } catch (_) { /* mensaje ilegible (codigo distinto, ruido) — se ignora, sordo a proposito */ }
    };
    ws.onclose = () => { notificarEstado("reconectando"); programarReintento(); };
    ws.onerror = () => { try { ws.close(); } catch (_) {} };
  }

/* ==========================================================================
     LA FOTO DEL NEGOCIO (M2, M3, M4 del PLAN-tablero-2026-08-15).

     Quien pide (el tablero) manda TIPO_FOTO_PEDIDA. Quien tiene la app junta
     su estado y lo devuelve EN TROZOS numerados. Si un trozo se pierde, se
     pide solo ese: un negocio con miles de ventas no puede depender de que un
     unico mensaje gigante llegue entero.

     NADA DE ESTO TOCA UN SERVIDOR. Los datos permanecen en los dispositivos
     del equipo; el relay solo rebota bytes cifrados que no puede leer, y el
     tablero los pinta y los olvida al cerrarse.
     ========================================================================== */
  async function armarFoto() {
    /* Se lee del backend local por su propia API, no del storage crudo: si
       manana cambia como se guarda, esto sigue funcionando. */
    async function get(ruta) {
      try {
        const r = await fetch("/api" + ruta);
        const j = await r.json();
        return Array.isArray(j) ? j : (j && typeof j === "object" ? j : null);
      } catch (_) { return null; }
    }
    /* Rutas verificadas contra mock-backend.js: el resumen se llama
       /api/dashboard, y /api/ventas/todas se agrego para el tablero (solo
       lectura, ya enriquecida con nombres). */
    /* liquidaciones y perchas se suman para las pestanias de Comisiones y
       Eventos del tablero (JFC 2026-08-18). Son las dos tablas mas chicas de
       todas y evitan que el tablero tenga que rehacer la cuenta del reparto por
       su cuenta — que es como dos pantallas terminan mostrando dos numeros
       distintos del mismo negocio. */
    const [productos, clientes, ventas, resumen, liquidaciones, perchas] = await Promise.all([
      get("/productos?ubicacionId=todas"),
      get("/clientes"),
      get("/ventas/todas?ubicacionId=todas"),
      get("/dashboard?ubicacionId=todas"),
      get("/liquidaciones"),
      get("/ubicaciones?todas=1"),
    ]);
    return {
      productos: productos || [],
      clientes: Array.isArray(clientes) ? clientes : [],
      ventas: ventas || [],
      resumen: resumen || null,
      liquidaciones: Array.isArray(liquidaciones) ? liquidaciones : [],
      perchas: Array.isArray(perchas) ? perchas : [],
      negocio: (function () {
        try { return (JSON.parse(localStorage.getItem("f123_owned") || "null") || {}).nombreNegocio || ""; }
        catch (_) { return ""; }
      })(),
      generadaEn: (new Date()).toISOString(),
    };
  }

  /* Corta una tabla larga en trozos parejos. Devuelve [] si no hay filas, para
     que el tablero pueda distinguir "sin datos" de "no llego nada". */
  function trocear(nombre, filas) {
    const out = [];
    const arr = Array.isArray(filas) ? filas : [];
    if (!arr.length) { out.push({ tabla: nombre, i: 0, total: 1, filas: [] }); return out; }
    const total = Math.ceil(arr.length / FOTO_FILAS_POR_TROZO);
    for (let i = 0; i < total; i++) {
      out.push({ tabla: nombre, i: i, total: total, filas: arr.slice(i * FOTO_FILAS_POR_TROZO, (i + 1) * FOTO_FILAS_POR_TROZO) });
    }
    return out;
  }

  async function responderFoto(pedido) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    /* Un tablero no contesta a otro tablero: solo responde quien tiene backend. */
    if (!window.OCSync && !window.fetch) return;
    /* Jitter: si hay dos telefonos del mismo negocio conectados, no mandan la
       foto entera los dos a la vez. */
    await new Promise((r) => setTimeout(r, Math.random() * 500));
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    let foto;
    try { foto = await armarFoto(); } catch (_) { return; }
    const trozos = []
      .concat(trocear("productos", foto.productos))
      .concat(trocear("clientes", foto.clientes))
      .concat(trocear("ventas", foto.ventas))
      .concat(trocear("liquidaciones", foto.liquidaciones))
      .concat(trocear("perchas", foto.perchas))
      .concat([{ tabla: "resumen", i: 0, total: 1, filas: [foto.resumen || {}] }]);
    for (let k = 0; k < trozos.length; k++) {
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      const op = {
        opId: uuidCorto(), deviceId: deviceId(), tipo: TIPO_FOTO_TROZO,
        para: pedido.deviceId || null,
        payload: Object.assign({ negocio: foto.negocio, generadaEn: foto.generadaEn, k: k, deTotal: trozos.length }, trozos[k]),
        fecha: (new Date()).toISOString(),
      };
      try { ws.send(await cifrar(claveActual, op)); } catch (_) { return; }
    }
  }

  /* ==========================================================================
     EL MANDO A DISTANCIA. Este dispositivo hace de manos del tablero.

     Por que asi y no reimplementando Avanzado dentro de tablero.html: la
     logica de negocio vive en un solo sitio. Si manana cambia como se agrega
     un encargado, cambia en mock-backend.js y el tablero se entera solo. Dos
     implementaciones de la misma regla es como se rompen los negocios.
     ========================================================================== */
  /* Verifica el PIN que llego del tablero y contesta SOLO el rol, nunca nada
     mas. Un PIN de encargado o de contador no abre el tablero: ese es el punto.
     El PIN viaja cifrado con la clave de sala, igual que todo lo demas. */
  async function responderPin(op) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const pin = String((op.payload && op.payload.pin) || "");
    if (!pin) return;

    /* BUG 1: el PIN de un ADMIN nunca abria el tablero. verificarOwnerOEmpleado
       solo devuelve "dueno" o "empleado"; los admins se dan de alta como
       usuarios nombrados y se verifican por /api/usuarios/verificar. Faltaba
       ese segundo camino, asi que el guard "dueno o admin" era en realidad
       "solo dueno". */
    let rol = "";
    try {
      /* El secreto puede estar todavia migrando cuando llega el pedido: sin
         esperar, un PIN valido se rechazaba por pura carrera de arranque. */
      if (window.OCSecure && window.OCSecure.migrarSiHaceFalta) {
        try { await window.OCSecure.migrarSiHaceFalta(); } catch (_) {}
      }
      if (window.OCSecure && window.OCSecure.verificarOwnerOEmpleado) {
        rol = (await window.OCSecure.verificarOwnerOEmpleado(pin)) || "";
      }
      if (rol !== "dueno") {
        const res = await fetch("/api/usuarios/verificar", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pin: pin }),
        });
        if (res.ok) {
          const u = await res.json();
          if (u && u.rol && u.activo !== false) rol = u.rol;
        }
      }
    } catch (_) {}

    const ok = rol === "dueno" || rol === "admin";

    /* BUG 2, y es el que rompia el caso real: en una sala con MAS DE UN
       dispositivo, todos contestaban, y el tablero se quedaba con la PRIMERA
       respuesta. Un telefono que no conoce ese PIN contestaba "no" antes que
       el que si lo conoce, y un PIN valido quedaba rechazado.

       Ahora el "no" NO se manda: quien no puede autorizar se calla, y el
       tablero cae en su propio timeout si de verdad nadie lo reconocio. Un
       silencio de 12 s es mejor que un rechazo falso e inmediato.

       Solo se contesta el "no" cuando este dispositivo es el UNICO en la sala:
       ahi el rechazo es informacion cierta y ahorra la espera. */
    if (!ok && presenciaN > 2) return;

    const r = {
      opId: uuidCorto(), deviceId: deviceId(), tipo: TIPO_RESPUESTA,
      payload: { pedido: (op.payload && op.payload.pedidoId) || op.opId, ok: ok,
                 datos: ok ? { rol: rol } : { error: "Ese PIN no abre el tablero." } },
      fecha: (new Date()).toISOString(),
    };
    try { ws.send(await cifrar(claveActual, r)); } catch (_) {}
  }

  function ordenPermitida(metodo, ruta) {
    return ORDENES_PERMITIDAS.some(function (p) { return p.m === metodo && p.re.test(ruta); });
  }

  async function responderOrden(op) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const p = op.payload || {};
    const metodo = String(p.metodo || "GET").toUpperCase();
    const ruta = String(p.ruta || "");
    const responder = async (cuerpo, ok) => {
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      const r = {
        opId: uuidCorto(), deviceId: deviceId(), tipo: TIPO_RESPUESTA,
        payload: { pedido: p.pedidoId || op.opId, ok: !!ok, datos: cuerpo },
        fecha: (new Date()).toISOString(),
      };
      try { ws.send(await cifrar(claveActual, r)); } catch (_) {}
    };
    if (!ordenPermitida(metodo, ruta)) {
      /* Se dice que no se permite, no se ignora: un tablero esperando en
         silencio una respuesta que nunca llega es peor que un no claro. */
      return responder({ error: "That action cannot be done from the dashboard." }, false);
    }
    /* Jitter, igual que en el catch-up: si hay dos telefonos del negocio
       conectados, no ejecutan la misma orden a la vez. Solo el primero que
       conteste importa; el tablero descarta las respuestas repetidas. */
    await new Promise((r) => setTimeout(r, Math.random() * 350));
    try {
      const opts = { method: metodo };
      let cuerpo = p.cuerpo || {};
      /* CASO ESPECIAL, y el unico: dar de alta a alguien. El backend exige el
         PIN, pero el PIN NO puede viajar al tablero ni teclearse alli: el
         tablero puede estar abierto en una pantalla que ve medio local. Asi
         que lo genera ESTE dispositivo, se lo manda al backend, y al tablero
         solo le contesta que ya esta. El PIN se muestra aqui, en la mano del
         duenio, que es donde tiene que verse. */
      let pinGenerado = "";
      if (metodo === "POST" && ruta === "/api/usuarios" && !cuerpo.pin) {
        const b = new Uint8Array(2);
        crypto.getRandomValues(b);
        pinGenerado = String(100 + ((b[0] << 8 | b[1]) % 900));   /* 100..999 */
        cuerpo = Object.assign({}, cuerpo, { pin: pinGenerado });
      }
      if (metodo !== "GET") {
        opts.headers = { "Content-Type": "application/json" };
        opts.body = JSON.stringify(cuerpo);
      }
      const res = await fetch(ruta, opts);
      const datos = await res.json();
      if (pinGenerado && res.ok !== false && !datos.error) {
        /* El aviso con el PIN sale en ESTE dispositivo. Nunca en la respuesta. */
        try {
          window.dispatchEvent(new CustomEvent("oc-alta-remota", {
            detail: { nombre: datos.nombre || cuerpo.nombre, rol: datos.rol || cuerpo.rol, pin: pinGenerado },
          }));
        } catch (_) {}
      }
      /* Por si acaso: nunca devolver un pin, venga de donde venga. */
      if (datos && typeof datos === "object" && "pin" in datos) { try { delete datos.pin; } catch (_) {} }
      await responder(datos, res.ok !== false);
    } catch (e) {
      await responder({ error: "No se pudo completar." }, false);
    }
  }

  /* Lo llama micelio-vivo.js cada minuto. Si el socket no esta abierto no se
     encola ni se reintenta: un latido viejo no informa de nada, y el silencio
     ES la senal que el otro lado necesita leer. */
  async function emitirLatido(quien) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    const op = {
      opId: uuidCorto(), deviceId: deviceId(), tipo: TIPO_LATIDO,
      payload: { id: quien.id, apodo: quien.apodo || "", rol: quien.rol || "" },
      fecha: (new Date()).toISOString(),
    };
    try { ws.send(await cifrar(claveActual, op)); return true; } catch (_) { return false; }
  }

  /* Lo usa el tablero. En la app no se llama nunca, pero se expone desde el
     mismo modulo para que las dos puntas hablen exactamente el mismo dialecto
     y no puedan desincronizarse por copia y pega. */
  async function pedirFoto() {
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    const op = {
      opId: uuidCorto(), deviceId: deviceId(), tipo: TIPO_FOTO_PEDIDA,
      payload: {}, fecha: (new Date()).toISOString(),
    };
    try { ws.send(await cifrar(claveActual, op)); return true; } catch (_) { return false; }
  }

  /* TEAM- Y F123- SON EL MISMO VALOR (JFC 2026-08-19).
     El codigo de equipo y la licencia se mostraban IGUAL, los dos con F123-, y
     la gente los confundia: JFC mismo puso 789 en su celular creyendo que asi
     entraba a su negocio y termino con dos licencias.

     La separacion es de PRESENTACION: de aqui para adentro la sala vale
     exactamente lo mismo que siempre, asi que ningun equipo ya sincronizado se
     cae. Lo unico que cambia es que el codigo de equipo se MUESTRA y se ACEPTA
     con prefijo TEAM-, y aqui se traduce a la forma interna.

     Se siguen aceptando los dos prefijos al teclear: quien tenga el codigo
     viejo anotado en un papel no se queda afuera. */
  function normalizarCodigo(codigo) {
    var v = String(codigo || "").trim().toUpperCase().replace(/\s+/g, "");
    if (v.indexOf("TEAM-") === 0) v = "F123-" + v.slice(5);
    return v;
  }
  /* Como se le muestra al dueno. Nunca se guarda asi. */
  function codigoParaMostrar(codigo) {
    var v = String(codigo || "").trim().toUpperCase();
    return v.indexOf("F123-") === 0 ? "TEAM-" + v.slice(5) : v;
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

  // Al reconectar, preguntar que me perdi. Mensaje ephemero (no de negocio):
  // no se guarda en el log ni en la cola de reintento — si falla, la proxima
  // conexion vuelve a preguntar, no hace falta insistir con este en concreto.
  async function pedirCatchup() {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const pedido = {
      opId: uuidCorto(), deviceId: deviceId(), tipo: TIPO_CATCHUP_PEDIDO,
      payload: construirVectorConocido(), fecha: (new Date()).toISOString(),
    };
    try { ws.send(await cifrar(claveActual, pedido)); } catch (_) {}
  }
  // Alguien pregunto que le falta. Le contesto con mis ops mas nuevas que las
  // que dice conocer — cada una viaja como una Op normal (mismo formato,
  // mismo cifrado), asi que aplicarOpRemota() del que pregunta la procesa
  // exactamente igual que si la hubiera recibido en vivo, con el mismo dedup
  // por opId. Jitter chico: si varios pares contestan a la vez, no lo hacen
  // todos en el mismo instante.
  async function responderCatchup(pedido) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const faltantes = buscarOpsFaltantes(pedido.payload, pedido.deviceId);
    if (!faltantes.length) return;
    await new Promise((r) => setTimeout(r, Math.random() * 400));
    for (const op of faltantes) {
      if (!ws || ws.readyState !== WebSocket.OPEN) return; // se desconecto a mitad de camino, no insistir
      try { ws.send(await cifrar(claveActual, op)); } catch (_) { return; }
    }
  }

  // --- Puente con mock-backend.js: emitirOpStock(tipo, payload) llama aqui ---
  window.OCSyncEmit = function (tipo, payload) {
    const sala = leerSala();
    if (!sala) return; // sync apagado: no-op total, cero overhead
    const op = {
      opId: uuidCorto(), deviceId: deviceId(), deviceNombre: (window.OCCurrentUser && window.OCCurrentUser.nombre) || null,
      lamport: siguienteLamport(), tipo, payload, fecha: (new Date()).toISOString(),
    };
    registrarEnLog(op); // guardo mi propia op para poder reenviarsela a un par que la haya perdido
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
      if (codigoNorm.length < 6) return { ok: false, error: "The code must be at least 6 characters." };
      /* FORMATO DE SALA (2026-08-14). Acepta el formato nuevo de 4 grupos con
         simbolo de verificacion y TAMBIEN el viejo, para no dejar afuera a
         ninguna licencia ya emitida. consultorio-123 acepta ademas el prefijo
         F123 que emitio por error antes del 2026-08-13.
         Si el codigo trae simbolo de verificacion y NO cuadra, se bloquea: eso
         es un codigo mal tecleado, y dejarlo pasar es lo que manda a alguien a
         una sala vacia sin entender por que no se sincroniza. */
      var _pre = ["F123"];
      var _cuerpo = codigoNorm.replace(new RegExp("^(" + _pre.join("|") + ")-"), "").replace(/-/g, "");
      var _prefijoOk = _pre.some(function (p) { return codigoNorm.indexOf(p + "-") === 0; });
      if (!_prefijoOk || (_cuerpo.length !== 8 && _cuerpo.length !== 12 && _cuerpo.length !== 17)) {
        return { ok: false, error: "Invalid team code — check that it is complete, in the format TEAM-XXXX-XXXX-XXXX-XXXXX." };
      }
      if (_cuerpo.length === 17) {
        var _B32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ", _CHK = _B32 + "*~$=U", _acc = 0, _mal = false;
        for (var _i = 0; _i < 16; _i++) {
          var _v = _B32.indexOf(_cuerpo.charAt(_i));
          if (_v < 0) { _mal = true; break; }
          _acc = (_acc * 32 + _v) % 37;
        }
        if (_mal || _CHK.charAt(_acc) !== _cuerpo.charAt(16)) {
          return { ok: false, error: "That code has a typo. Check it character by character." };
        }
      }
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
      if (!leerSala()) return { ok: false, error: "Sync is not active on this device." };
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
    /* Version presentable del codigo de sala (TEAM-...). El valor interno no
       cambia: esto es solo para pintar y para compartir. */
    salaParaMostrar() { const s = leerSala(); return s ? codigoParaMostrar(s.codigo) : null; },
    paraMostrar: codigoParaMostrar,
    onEstado(fn) { listenersEstado.push(fn); },
    /* Para el TABLERO DE CONTROL. Se exponen desde el mismo modulo que las
       contesta para que las dos puntas hablen exactamente el mismo dialecto y
       no puedan desincronizarse por copia y pega. */
    pedirFoto,
    emitirLatido,
  };

  // Reconexion automatica al volver a tener foco/red (celular que se bloqueo, wifi que parpadeo)
  window.addEventListener("online", () => { if (leerSala() && estadoActual !== "conectado") { reintentoMs = 1000; conectar(); } });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && leerSala() && (!ws || ws.readyState !== WebSocket.OPEN)) { reintentoMs = 1000; conectar(); }
  });

  // Arranque: si ya habia una sala configurada de antes, reconectar solo.
  if (leerSala()) conectar();
})();
