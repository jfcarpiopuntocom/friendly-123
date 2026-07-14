// auth-ui.js — Control de acceso de Olimpo Control (100% en el navegador,
// sin servidor: las claves viven en localStorage). Dos capas claramente
// separadas: DUEÑO y EMPLEADO. Dentro de la del dueño, la info contable
// (cuentas T, P&L, balance) queda detrás de una SUBCLAVE aparte.
//
// ===========================================================================
// NOTAS DE DISEÑO (no visibles al usuario — comentarios de mantenimiento)
// ---------------------------------------------------------------------------
// La clave es un PIN de 3 DÍGITOS. El backbone real y lo que se compara es el
// número (ej. "159"). Cada tecla del pad MUESTRA su dígito (el usuario ve y
// toca dígitos) y, como adorno, unos emojis.
//
// SEGURIDAD / por qué los emojis se BARAJAN en cada carga:
//   En la versión anterior cada dígito tenía un TRÍO FIJO de emojis. Eso era
//   un fallo: el trío fijo ERA el dígito a la vista de cualquiera (delataba el
//   código). Ahora los emojis se reparten aleatoriamente entre las teclas en
//   cada apertura del candado (son intercambiables, no forman un grupo fijo
//   por dígito) y las casillas de la clave se ENMASCARAN con ● al ingresar.
//   Así ni el adorno ni las casillas revelan el código interno.
//
// Si en el futuro JFC quiere que la clave se ingrese por emojis en vez de por
// dígitos, el cambio es: mapear cada emoji tocado a su dígito subyacente. Hoy
// se ingresa por dígito (lo pidió explícitamente: "agrega dígitos").
//
// SEGURIDAD DE LOS PINS (crypto-store.js, cargar ANTES que este archivo):
//   Los 3 PINs (dueño, empleado(s), subclave contable) ya NO viven en texto
//   plano en localStorage. Se validan contra hashes PBKDF2 vía window.OCSecure
//   — ver crypto-store.js para el detalle. Este archivo solo orquesta la UI y
//   llama a OCSecure para verificar/guardar; nunca compara strings de PIN
//   directamente.
// ===========================================================================
(function () {
  // Versión embebida del build. Se compara contra version.json para detectar
  // actualizaciones sin que el usuario tenga que refrescar manualmente.
  const APP_VERSION = "1.0.2";

  // Pool de emojis de adorno — emojis de oficina/negocios, apropiados para
  // un sistema contable y de inventarios. Retrocompatibles: los PINs son
  // numéricos; emojis son adorno visual barajado en cada apertura (no afectan
  // el código almacenado ni los hashes).
  const EMOJI_POOL = [
    "💼", "📊", "📋", "📁", "🗂️", "📌", "📎", "📝", "🖊️", "✏️",
    "🔑", "🔒", "💰", "📦", "🏷️", "⚖️", "🔍", "🖨️", "📞", "📱",
    "🏢", "💡", "⏰", "📅", "🗓️", "💳",
  ];

  // Fisher-Yates: baraja una copia del arreglo (no muta el original).
  function barajar(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  let rol = null; // "dueno" | "empleado"
  // Rol DEMO oculto (JFC, 2026-07-02): la clave 456 entra con acceso de dueño
  // pero SIN poder cambiar claves ni correo. Para que un cliente pruebe todo
  // sin bloquear al dueño ni secuestrar la recuperación. NO se anuncia en la UI.
  const DEMO_PIN = "456";
  let demoSesion = false;
  let listo = window.OCSecure.migrarSiHaceFalta(); // promesa: migra oc_auth viejo (si existe) sin perder lo que el propietario ya configuró

  // ---------------------------------------------------------------------------
  // BLOQUEO POR FUERZA BRUTA (tronco 1 del árbol de problemas, JFC 2026-06-30)
  // ---------------------------------------------------------------------------
  // Al 5º intento fallido seguido, el teclado se bloquea 60s con cuenta
  // regresiva visible. Se guarda en sessionStorage (no localStorage) a
  // propósito: sobrevive a una recarga de página DURANTE el bloqueo (no es
  // una forma de saltárselo — recargar no libera el candado antes de tiempo),
  // pero se limpia solo si se cierra la pestaña, lo cual es aceptable porque
  // reabrir la pestaña no es un vector de fuerza bruta realista en un POS
  // físico. La ÚNICA forma de destrabarlo es que pasen los 60s de verdad; NO
  // hay botón de "reintentar" que lo salte.
  const BLOQUEO_TRAS_INTENTOS = 5;
  const BLOQUEO_DURACION_MS = 60 * 1000;
  function leerIntentos() {
    try { return JSON.parse(sessionStorage.getItem("oc_intentos")) || { fallos: 0, bloqueadoHasta: 0 }; }
    catch { return { fallos: 0, bloqueadoHasta: 0 }; }
  }
  function guardarIntentos(x) { sessionStorage.setItem("oc_intentos", JSON.stringify(x)); }
  function registrarFallo() {
    const st = leerIntentos();
    st.fallos += 1;
    if (st.fallos >= BLOQUEO_TRAS_INTENTOS) { st.bloqueadoHasta = Date.now() + BLOQUEO_DURACION_MS; st.fallos = 0; }
    guardarIntentos(st);
  }
  function registrarExito() { sessionStorage.removeItem("oc_intentos"); }
  function msRestantesBloqueo() {
    const st = leerIntentos();
    return Math.max(0, st.bloqueadoHasta - Date.now());
  }

  // ---------- CSS ----------
  const css = document.createElement("style");
  css.textContent = `
  #oc-gate{position:fixed;inset:0;z-index:9999;background:var(--azul-oscuro,#1c3049);
    display:flex;align-items:center;justify-content:center;padding:20px;}
  #oc-gate .caja{background:var(--blanco-calido,#fbf5e8);border:2px solid var(--brass,#9c7a35);
    border-radius:8px;padding:26px 22px;max-width:420px;width:100%;text-align:center;}
  #oc-gate h2{font-family:var(--font-display,sans-serif);color:var(--ink,#211c14);font-size:22px;margin:0 0 4px;}
  #oc-gate .sub{font-size:14px;color:var(--ink-soft,#5d5340);margin-bottom:18px;}
  .oc-slots{display:flex;gap:10px;justify-content:center;margin-bottom:16px;}
  .oc-slots .slot{width:58px;height:58px;border:2px solid var(--azul-medio,#2c4a68);border-radius:6px;
    display:flex;align-items:center;justify-content:center;font-size:26px;background:var(--crema,#f3e8cd);color:var(--ink,#211c14);}
  .oc-slots .slot.lleno{border-color:var(--rust,#b2461f);}
  .oc-pad{display:grid;grid-template-columns:repeat(5,1fr);gap:8px;}
  .oc-pad button{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;
    padding:8px 4px;border:2px solid var(--ink,#211c14);border-radius:6px;background:var(--crema,#f3e8cd);
    cursor:pointer;min-height:54px;}
  .oc-pad button .dig{font-family:var(--font-display,sans-serif);font-weight:700;font-size:20px;color:var(--ink,#211c14);line-height:1;}
  .oc-pad button .emo{font-size:13px;line-height:1;}
  .oc-pad button:active{transform:translateY(1px);}
  /* FIX 2026-07-07 (JFC: "se agrandan y arruinan todo"): digitar rapido el PIN
     disparaba el double-tap zoom de iOS. touch-action:manipulation lo elimina
     sin tocar el pinch-zoom de accesibilidad. */
  #oc-gate button, .oc-subgate button{touch-action:manipulation;}
  .oc-acciones{display:flex;gap:8px;margin-top:14px;}
  .oc-acciones button{flex:1;font-family:var(--font-display,sans-serif);font-size:14px;padding:12px;
    border-radius:6px;border:2px solid var(--azul-medio,#2c4a68);background:var(--blanco-calido,#fbf5e8);
    color:var(--azul-medio,#2c4a68);cursor:pointer;min-height:44px;text-transform:uppercase;}
  .oc-msg{min-height:20px;font-size:14px;font-weight:700;color:var(--rojo,#a3392a);margin-top:12px;}
  #oc-gate.err .caja,.oc-subgate.err .caja{animation:ocshake .35s;}
  @keyframes ocshake{0%,100%{transform:translateX(0)}25%{transform:translateX(-8px)}75%{transform:translateX(8px)}}
  #oc-logout{font-family:var(--font-display,sans-serif);font-size:13px;padding:8px 12px;border-radius:5px;
    border:2px solid var(--brass,#9c7a35);background:transparent;color:var(--blanco-calido,#fbf5e8);
    cursor:pointer;text-transform:uppercase;}
  /* --- Banner de actualización (version.json) --- */
  #oc-update-banner{margin-top:14px;border-top:1px solid var(--azul-medio,#2c4a68);padding-top:12px;display:none;}
  #oc-update-banner.visible{display:block;}
  #oc-update-banner .upd-txt{font-size:13px;color:var(--ink-soft,#5d5340);margin-bottom:8px;line-height:1.4;}
  #oc-update-banner .upd-txt strong{color:var(--ink,#211c14);}
  #oc-update-banner .upd-txt.requerida{color:var(--rojo,#a3392a);font-weight:700;}
  #oc-update-banner button#oc-btn-actualizar{
    font-family:var(--font-display,sans-serif);font-size:13px;padding:10px 16px;border-radius:6px;
    border:2px solid var(--azul-medio,#2c4a68);background:var(--azul-medio,#2c4a68);
    color:var(--blanco-calido,#fbf5e8);cursor:pointer;min-height:44px;width:100%;}
  #oc-update-banner button#oc-btn-actualizar.requerida{
    border-color:var(--rojo,#a3392a);background:var(--rojo,#a3392a);font-size:15px;}
  /* FIX 2026-07-02: la vista se renombró de "liquidaciones" a "comisiones";
     este selector seguía apuntando al data-vista viejo y el EMPLEADO veía el
     botón Comisiones (datos financieros del dueño). Mantener sincronizado con
     el data-vista del nav en index.html. */
  body.rol-empleado nav button[data-vista="avanzado"],
  body.rol-empleado nav button[data-vista="perchas"],
  body.rol-empleado nav button[data-vista="comisiones"]{display:none!important;}
  #oc-acct-lock{text-align:center;padding:22px;}
  #oc-acct-lock button{font-family:var(--font-display,sans-serif);font-size:14px;padding:12px 20px;
    border-radius:6px;border:2px solid var(--rust,#b2461f);background:var(--rust,#b2461f);
    color:var(--blanco-calido,#fbf5e8);cursor:pointer;min-height:44px;}
  .oc-subgate{position:fixed;inset:0;z-index:9999;background:rgba(28,48,73,0.92);
    display:flex;align-items:center;justify-content:center;padding:20px;}
  /* Rol DEMO: ocultar cambio de claves y de correo (todo lo demás funciona) */
  body.rol-demo #oc-clave-block, body.rol-demo #oc-email-edit,
  body.rol-demo #oc-email-save, body.rol-demo #oc-email-in{display:none!important;}
  `;
  document.head.appendChild(css);

  // ---------------------------------------------------------------------------
  // Construye un teclado de PIN reutilizable (lo usan el candado principal y el
  // de la subclave contable). Cada vez que se llama, BARAJA los emojis de
  // adorno entre las teclas. Las teclas muestran el dígito (lo que el usuario
  // toca) más emojis decorativos.
  //   padEl   : contenedor del grid de teclas
  //   slotsEl : contenedor de las 3 casillas (se enmascaran con ●)
  //   onComplete(code) : callback cuando se ingresan 3 dígitos
  // Devuelve un objeto { reset } para limpiar la entrada.
  // ---------------------------------------------------------------------------
  function montarTeclado(padEl, slotsEl, onComplete) {
    let entrada = [];
    const pool = barajar(EMOJI_POOL); // adorno barajado por sesión de teclado
    // Render de teclas 0-9 (dígitos en orden, visibles). A cada tecla le toca
    // un emoji distinto del pool barajado (intercambiable, no fijo por dígito).
    padEl.innerHTML = "";
    for (let d = 0; d <= 9; d++) {
      const b = document.createElement("button");
      b.dataset.d = String(d);
      b.innerHTML = `<span class="dig">${d}</span><span class="emo">${pool[d % pool.length]}</span>`;
      padEl.appendChild(b);
    }
    const slots = () => slotsEl.querySelectorAll(".slot");
    function pintar() {
      slots().forEach((s, i) => {
        if (entrada[i] != null) { s.textContent = "●"; s.classList.add("lleno"); } // enmascarado: no delata
        else { s.textContent = ""; s.classList.remove("lleno"); }
      });
    }
    // BUG FIJADO: montarTeclado() se vuelve a llamar en cada reintento (un PIN
    // equivocado re-baraja el teclado). Antes esto hacía padEl.addEventListener
    // de nuevo cada vez, ACUMULANDO listeners sobre el mismo nodo persistente
    // (#oc-pad / #oc-pad2 nunca se recrean, solo su innerHTML). Resultado: tras
    // N intentos fallidos, el siguiente PIN correcto disparaba validar()/
    // alCompletar() N+1 veces en paralelo. Fix: el listener se monta UNA sola
    // vez por nodo (guardado en un dataset flag) y lee el callback/estado
    // vigente desde padEl._ocTeclado, que cada llamada a montarTeclado() sí
    // reemplaza por completo.
    padEl._ocTeclado = { entrada: () => entrada, push: (d) => entrada.push(d), pintar, onComplete };
    if (!padEl.dataset.ocListenerMontado) {
      padEl.dataset.ocListenerMontado = "1";
      padEl.addEventListener("click", (e) => {
        const st = padEl._ocTeclado; // siempre el estado de la montada MÁS RECIENTE
        const b = e.target.closest("button[data-d]"); if (!b || st.entrada().length >= 3) return;
        st.push(Number(b.dataset.d));
        st.pintar();
        if (st.entrada().length === 3) { const code = st.entrada().join(""); setTimeout(() => st.onComplete(code), 150); }
      });
    }
    pintar();
    return { reset: () => { entrada = []; pintar(); } };
  }

  // ---------- Candado principal (DUEÑO / EMPLEADO) ----------
  const gate = document.createElement("div");
  gate.id = "oc-gate";
  gate.innerHTML = `
    <div class="caja">
      <h2>AMIGABLE-123</h2>
      <div class="sub">Toca tu clave de 3 dígitos para entrar</div>
      <div class="oc-slots" id="oc-slots"><div class="slot"></div><div class="slot"></div><div class="slot"></div></div>
      <div class="oc-pad" id="oc-pad"></div>
      <div class="oc-acciones">
        <button id="oc-borrar">Borrar</button>
        <button id="oc-recuperar">¿Olvidaste?</button>
      </div>
      <div class="oc-msg" id="oc-msg"></div>
      <div id="oc-update-banner">
        <div class="upd-txt" id="oc-upd-txt"></div>
        <button id="oc-btn-actualizar">Actualizar app</button>
      </div>
    </div>`;
  document.body.appendChild(gate);

  let teclado = null;
  let intervaloCountdown = null;
  function nuevoTeclado() {
    clearInterval(intervaloCountdown);
    const restante = msRestantesBloqueo();
    if (restante > 0) return mostrarBloqueo(restante);
    // Re-monta el teclado (re-baraja emojis) cada vez que aparece el candado.
    $("oc-pad").style.display = "";
    teclado = montarTeclado($("oc-pad"), $("oc-slots"), validar);
    $("oc-borrar").disabled = false;
  }
  // Reemplaza el teclado por una cuenta regresiva. No hay botón para saltarla:
  // la única salida es que el tiempo real transcurra (ver nota arriba).
  function mostrarBloqueo(msRestantes) {
    $("oc-pad").style.display = "none";
    $("oc-borrar").disabled = true;
    const pintar = () => {
      const restante = msRestantesBloqueo();
      if (restante <= 0) { clearInterval(intervaloCountdown); nuevoTeclado(); return; }
      $("oc-msg").style.color = "var(--rojo,#a3392a)";
      $("oc-msg").textContent = `Demasiados intentos. Espera ${Math.ceil(restante / 1000)}s.`;
    };
    pintar();
    intervaloCountdown = setInterval(pintar, 1000);
  }
  function $(id) { return document.getElementById(id); }

  function error(txt) {
    $("oc-msg").style.color = "var(--rojo,#a3392a)";
    $("oc-msg").textContent = txt;
    gate.classList.add("err");
    setTimeout(() => gate.classList.remove("err"), 400);
    nuevoTeclado(); // limpia y re-baraja (o muestra el bloqueo, si ya se cumplió)
  }
  async function validar(code) {
    await listo;
    // Bloqueo anti fuerza bruta de crypto-store (capa de datos): si está
    // activo, verificarOwner/Empleado devuelven false AUNQUE el PIN sea
    // correcto. Sin este chequeo previo, la UI diría "Clave incorrecta" a un
    // dueño con la clave buena — mensaje falso y desesperante. Se avisa
    // honesto, con segundos, y NO se registra otro fallo encima.
    const sb = window.OCSecure.segundosBloqueo
      ? Math.max(window.OCSecure.segundosBloqueo("owner"), window.OCSecure.segundosBloqueo("emp"))
      : 0;
    if (sb > 0) { error(`Demasiados intentos. Espera ${sb}s e intenta de nuevo.`); return; }
    if (await window.OCSecure.verificarOwner(code)) { registrarExito(); return entrar("dueno"); }
    if (await window.OCSecure.verificarEmpleado(code)) { registrarExito(); return entrar("empleado"); }
    if (code === DEMO_PIN) { registrarExito(); return entrar("demo"); }
    registrarFallo();
    const restante = msRestantesBloqueo();
    if (restante > 0) { error(`Demasiados intentos. Espera ${Math.ceil(restante / 1000)}s.`); return; }
    error("Clave incorrecta. Intenta de nuevo.");
  }
  function entrar(nuevoRol) {
    const esDemo = nuevoRol === "demo";
    demoSesion = esDemo;
    rol = esDemo ? "dueno" : nuevoRol; // el demo navega con acceso de dueño
    document.body.classList.toggle("rol-empleado", rol === "empleado");
    document.body.classList.toggle("rol-dueno", rol === "dueno");
    document.body.classList.toggle("rol-demo", esDemo);
    gate.style.display = "none";
    document.body.style.overflow = ""; // reabre el scroll del fondo
    // Primera impresion controlada: foco fuera de cualquier boton fantasma
    // del teclado y vista anclada al tope (el hero de HOY), no a una esquina.
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    window.scrollTo(0, 0);
    montarLogout();
    reiniciarInactividad();
    if (rol === "empleado") { const n = document.querySelector('nav button[data-vista="hoy"]'); if (n) n.click(); }
    window.dispatchEvent(new CustomEvent("oc-login", { detail: { rol, demo: esDemo } }));
  }

  // ---------------------------------------------------------------------------
  // TIMEOUT DE INACTIVIDAD (tronco 1, JFC 2026-06-30): 30 min sin ningún click
  // ni tecla en toda la página cierran la sesión solos. Crítico porque el POS
  // corre en una tablet compartida de percha — el empleado del turno
  // siguiente no debe encontrarse la sesión del dueño abierta con acceso a
  // liquidaciones y claves. Se reinicia con CUALQUIER click o keydown en el
  // documento (no solo dentro de la app), mientras haya alguien logueado.
  // ---------------------------------------------------------------------------
  const INACTIVIDAD_MS = 30 * 60 * 1000;
  let temporizadorInactividad = null;
  function reiniciarInactividad() {
    clearTimeout(temporizadorInactividad);
    if (!rol) return;
    temporizadorInactividad = setTimeout(() => cerrarSesion("Sesión cerrada por inactividad."), INACTIVIDAD_MS);
  }
  document.addEventListener("click", reiniciarInactividad);
  document.addEventListener("keydown", reiniciarInactividad);

  // Punto único de logout (manual o por inactividad) para que ambos caminos
  // limpien exactamente el mismo estado — antes solo existía inline dentro
  // del botón Salir, y un logout automático por inactividad habría tenido
  // que duplicar esa lógica (con el riesgo de que se desincronizaran).
  function cerrarSesion(mensaje) {
    clearTimeout(temporizadorInactividad);
    rol = null;
    demoSesion = false;
    document.body.classList.remove("rol-empleado", "rol-dueno", "rol-demo");
    nuevoTeclado();
    gate.style.display = "flex";
    document.body.style.overflow = "hidden"; // candado visible: el fondo no se mueve
    $("oc-msg").style.color = mensaje ? "var(--rojo,#a3392a)" : "";
    $("oc-msg").textContent = mensaje || "";
    const b = document.getElementById("oc-logout");
    if (b) b.remove();
    window.dispatchEvent(new CustomEvent("oc-logout"));
  }

  $("oc-borrar").addEventListener("click", () => { $("oc-msg").textContent = ""; if (teclado) teclado.reset(); });
  $("oc-recuperar").addEventListener("click", () => abrirFlujoReset());
  nuevoTeclado();

  // ---------------------------------------------------------------------------
  // VERIFICACIÓN DE VERSIÓN (JFC, 2026-07-03): fetch version.json (no-cache)
  // y compara contra APP_VERSION embebida. Ver OC/auth-ui.js para documentación
  // completa del comportamiento (requerida vs opcional).
  // ---------------------------------------------------------------------------
  async function verificarVersion() {
    try {
      const res = await fetch("./version.json?_=" + Date.now(), { cache: "no-cache" });
      if (!res.ok) return;
      const data = await res.json();
      if (!data.version || data.version === APP_VERSION) return;
      const banner = $("oc-update-banner");
      const txt    = $("oc-upd-txt");
      const btn    = $("oc-btn-actualizar");
      banner.classList.add("visible");
      if (data.requerida) {
        txt.className = "upd-txt requerida";
        txt.innerHTML = `<strong>Actualización requerida (v${data.version})</strong><br>${data.changelog || ""}`;
        btn.textContent  = "Actualizar app ahora";
        btn.className    = "requerida";
        $("oc-pad").style.display       = "none";
        $("oc-borrar").style.display    = "none";
        $("oc-recuperar").style.display = "none";
        $("oc-msg").textContent = "";
      } else {
        txt.className = "upd-txt";
        // FIX 2026-07-07: version.json es archivo propio, pero si Pages o un mirror
        // se compromete, esto era XSS directo. Se escapa antes de inyectar.
        const escV = (v) => String(v).replace(/[&<>"\']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "\'": "&#39;" }[c]));
        txt.innerHTML = `Nueva versión disponible: <strong>v${escV(data.version)}</strong>${data.changelog ? " — " + escV(data.changelog) : ""}`;
      }
      btn.addEventListener("click", () => { location.reload(true); });
    } catch { /* sin conexión o version.json ausente → silencio */ }
  }
  verificarVersion();

  // ---------------------------------------------------------------------------
  // "Olvide mi clave" (JFC, 2026-07-02): envia el PIN del dueno a su correo
  // registrado via EmailJS (email-recovery.js). El PIN se guarda ofuscado
  // (XOR+base64 en oc_secure.ownerPinR) -- legible para enviar, opaco en
  // localStorage. Sin correo o sin PIN recuperable, muestra instruccion clara.
  // Sin modales, sin pasos: solo el mensaje en pantalla.
  // ---------------------------------------------------------------------------
  async function abrirFlujoReset() {
    await listo;
    const email = window.OCSecure.leerCorreo();
    const pin = window.OCSecure.recuperarPinDueno();
    const msgEl = $("oc-msg");

    if (!email) {
      msgEl.style.color = "var(--ink-soft,#5d5340)";
      msgEl.textContent = "No hay correo configurado. Entra como dueno y registralo en Avanzado.";
      return;
    }
    if (!pin) {
      msgEl.style.color = "var(--ink-soft,#5d5340)";
      msgEl.textContent = "Cambia tu clave una vez en Avanzado para activar la recuperacion.";
      return;
    }

    msgEl.style.color = "var(--ink-soft,#5d5340)";
    msgEl.textContent = "Enviando…";
    const resultado = window.OCEmailRecovery
      ? await window.OCEmailRecovery.enviarCodigo(email, pin)
      : { enviado: false, codigo: pin };
    if (resultado.enviado) {
      msgEl.style.color = "var(--verde-suave,#2f7a4f)";
      msgEl.textContent = `Clave enviada a ${enmascarar(email)}.`;
    } else {
      // Respaldo: EmailJS no configurado o sin internet -- muestra el PIN en pantalla
      msgEl.style.color = "var(--ink,#211c14)";
      msgEl.textContent = `Tu clave de dueno: ${resultado.codigo}`;
    }
  }

  // ---------- Logout en el header ----------
  function montarLogout() {
    if (document.getElementById("oc-logout")) return;
    const header = document.querySelector("header");
    if (!header) return;
    const b = document.createElement("button");
    b.id = "oc-logout"; b.textContent = "Salir";
    b.addEventListener("click", () => cerrarSesion());
    header.appendChild(b);
  }

  // ---------- Utilidades ----------
  // Ofusca un correo: primera letra + puntos + dominio (j•••@gmail.com).
  function enmascarar(email) {
    const [u, dom] = String(email).split("@");
    if (!dom) return "•••";
    return `${u.slice(0, 1)}${"•".repeat(Math.max(2, u.length - 1))}@${dom}`;
  }

  // Expuesto para la vista Avanzado (capa contable).
  window.OCAuth = {
    rolActual: () => rol,
    esDemo: () => demoSesion,
    enmascarar,
    listo: () => listo,
    abrirFlujoReset,
    // Pide la subclave contable con su propio teclado (emojis barajados, casillas enmascaradas).
    pedirSubclaveContable() {
      return new Promise((resolve) => {
        const cont = document.createElement("div");
        cont.className = "oc-subgate";
        cont.innerHTML = `<div class="caja" style="background:var(--blanco-calido,#fbf5e8);border:2px solid var(--brass,#9c7a35);border-radius:8px;padding:26px 22px;max-width:420px;width:100%;text-align:center;">
          <h2 style="font-family:var(--font-display,sans-serif);color:var(--ink,#211c14);font-size:22px;margin:0 0 4px;">Capa contable</h2>
          <div class="sub" style="font-size:14px;color:var(--ink-soft,#5d5340);margin-bottom:18px;">Subclave de 3 dígitos para ver cuentas T, P&amp;G y balance</div>
          <div class="oc-slots" id="oc-slots2"><div class="slot"></div><div class="slot"></div><div class="slot"></div></div>
          <div class="oc-pad" id="oc-pad2"></div>
          <div class="oc-acciones"><button id="sc-cancelar">Cancelar</button><button id="sc-borrar">Borrar</button></div>
          <div class="oc-msg" id="oc-msg2"></div></div>`;
        document.body.appendChild(cont);
        let tec;
        async function alCompletar(code) {
          if (await window.OCSecure.verificarAcct(code)) { cont.remove(); resolve(true); }
          else {
            cont.querySelector("#oc-msg2").textContent = "Subclave incorrecta.";
            cont.classList.add("err"); setTimeout(() => cont.classList.remove("err"), 400);
            tec = montarTeclado(cont.querySelector("#oc-pad2"), cont.querySelector("#oc-slots2"), alCompletar); // re-baraja
          }
        }
        tec = montarTeclado(cont.querySelector("#oc-pad2"), cont.querySelector("#oc-slots2"), alCompletar);
        cont.querySelector("#sc-borrar").addEventListener("click", () => tec.reset());
        cont.querySelector("#sc-cancelar").addEventListener("click", () => { cont.remove(); resolve(false); });
      });
    },
  };
})();
