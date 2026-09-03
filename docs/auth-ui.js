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
//   Los 3 PINs (dueño, encargado(s), subclave contable) ya NO viven en texto
//   plano en localStorage. Se validan contra hashes PBKDF2 vía window.OCSecure
//   — ver crypto-store.js para el detalle. Este archivo solo orquesta la UI y
//   llama a OCSecure para verificar/guardar; nunca compara strings de PIN
//   directamente.
// ===========================================================================
(function () {
  // Ping: sends activation + login checkins to the license worker.
  // Fire-and-forget — never blocks UI. Worker URL obfuscated to deter scraping.
  // NO CLOUD (JFC, regla dura, ver PRIVACY.md): este es EL UNICO lugar del
  // codigo con permiso de mandar datos fuera del dispositivo, y SOLO estos
  // campos: instanceId, licenseCode, email/nombre/apellido/cedula/whatsapp
  // (todos opcionales, solo si el dueno los ingreso), y el estado de accion
  // (register/login/update). JAMAS productos, ventas, clientes, inventario,
  // ni nada de negocio. Ver worker.js para el lado servidor de esta regla.
  /* BUG EN PRODUCCION, encontrado el 2026-08-19 con un cliente real ya activado.
   Esta cadena apuntaba a amigable-licencias.jfcarpio.workers.dev — el Worker
   de la app HERMANA. friendly-123 llevaba reportando TODAS sus activaciones a
   la KV de amigable, asi que el panel de friendly-123 salia vacio y no habia
   forma de aprobarle la licencia a nadie: los datos existian, pero en la otra
   caja. Los registros afectados se migraron a mano a la KV de friendly-123
   ese mismo dia.
   Ahora apunta a friendly123-licencias.jfcarpio.workers.dev, que es el Worker
   propio declarado en cloudflare-worker/wrangler.toml.
   AL PORTAR ESTE ARCHIVO ENTRE LAS TRES APPS: esta linea es lo PRIMERO que hay
   que revisar. Cada app tiene su Worker y su KV, y copiarla tal cual vuelve a
   meter este bug. */
var _ocEp = "=YXZk5ycyV2ay92du8WawJXYjZmauMXYpNmblNWas1yMyETesRmbllmcm9yL6MHc0RHa";
  var OC_WORKER_URL = (function () { try { return atob(_ocEp.split("").reverse().join("")); } catch (_) { return ""; } })();
  /* A3 — CORTACIRCUITOS DEL HEARTBEAT (JFC 2026-08-19).
     Patron tomado de cockatiel (github.com/connor4312/cockatiel), escrito a
     mano en 20 lineas: el manifiesto de la app es sin dependencias y el bundle
     ya pesa de mas.

     Sin esto, con el wifi caido o el Worker abajo, cada login volvia a intentar
     y a esperar los 8 segundos del timeout. En una feria con mala senal eso es
     la app entera trabada 8s por entrada, bateria quemada, y el panel de fallas
     llenandose de la MISMA falla.

     Tras 5 fallos seguidos el circuito se abre 5 minutos: durante ese rato
     enviarHeartbeat() sale de inmediato sin tocar la red. Un solo exito lo
     cierra y resetea la cuenta. El estado vive en memoria a proposito: recargar
     la pagina da otra oportunidad, que es lo que un usuario espera al recargar
     porque "no funcionaba". */
  var _cbFallos = 0, _cbAbiertoHasta = 0;
  var CB_TOPE = 5, CB_PAUSA_MS = 5 * 60 * 1000;
  function _cbBloqueado() { return Date.now() < _cbAbiertoHasta; }
  function _cbFallo() {
    _cbFallos++;
    if (_cbFallos >= CB_TOPE) {
      _cbAbiertoHasta = Date.now() + CB_PAUSA_MS;
      _cbFallos = 0;
      try { console.warn("[heartbeat] " + CB_TOPE + " fallos seguidos: se pausa 5 min"); } catch (_) {}
    }
  }
  function _cbExito() { _cbFallos = 0; _cbAbiertoHasta = 0; }

  async function enviarHeartbeat(datos) {
    try {
      if (_cbBloqueado()) return;   // circuito abierto: ni se toca la red
      var url = (localStorage.getItem("f123_cf_worker_url") || "").trim() || OC_WORKER_URL;
      if (!url) return;
      var trim = function (v, n) { if (v == null) return v; var s = String(v); return s.length > n ? s.slice(0, n) : s; };
      /* GUARD ANTI-DESAPARICIÓN DE LICENCIA (JFC 2026-08-26 — "ya no sale la
         licencia de Sarah en el panel"). Un heartbeat con licenseCode vacío puede
         hacer que el Worker sobrescriba con "" la fila de una licencia REAL y el
         cliente desaparezca del panel — lo último que puede pasar. Redundancia:
         si datos.licenseCode viene vacío o no es una F123 válida, se OMITE el
         campo del payload — el Worker no puede pisar un valor bueno con vacío.
         Nunca se envía "" como licenseCode.
         (2026-08-27, JFC): se QUITÓ la autocuración que recuperaba la licencia
         desde la sala de sync (salaActiva). Eso era lo que REVERTÍA la licencia
         a un valor viejo de una sala anterior — el bug de "mi licencia cambió
         sola". La licencia es la que el dueño puso deliberadamente; el heartbeat
         solo la reporta, nunca la re-deriva de otro lado. */
      var _licSegura = String(datos.licenseCode || "").trim();
      var payload = {
        producto: "friendly-123",
        instanceId: trim(datos.instanceId, 100),
        email: trim(datos.email, 160),
        whatsapp: trim(datos.whatsapp, 20),
        nombre: trim(datos.nombre, 120),
        apellido: trim(datos.apellido, 120),
        cedula: trim(datos.cedula, 40),
        activatedAt: datos.activatedAt,
        accion: trim(datos.accion, 30),
      };
      /* NOMBRE DEL NEGOCIO AL PANEL (JFC 2026-08-27). El dueño escribe el nombre
         de su tienda con el lapicito en la app (f123_owned.nombreNegocio); ese dato
         nunca viajaba al Worker, así que la columna "Negocio" del panel salía vacía
         y JFC no sabía a qué negocio pertenece cada licencia. Ahora se adjunta —
         solo si NO está vacío, para no pisar con "" un nombre ya guardado (el
         Worker también protege, cinturón y tirantes). */
      if (datos.nombreNegocio && String(datos.nombreNegocio).trim()) {
        payload.nombreNegocio = trim(String(datos.nombreNegocio).trim(), 120);
      }
      // Solo se adjunta la licencia si es una F123 válida: jamás un "" que borre
      // la fila de un cliente real en el Worker (ver guard de arriba).
      if (/^F123-/i.test(_licSegura)) payload.licenseCode = trim(_licSegura, 40);
      /* Autorreporte de fallas de la app, pegado al heartbeat que ya viaja.
         Cero endpoints nuevos, cero dependencias. El payload se arma por LISTA
         BLANCA en salud-app.js: no puede llevar datos de negocio. */
      try {
        var _err = window.AMG && window.AMG.Salud ? window.AMG.Salud.paraEnviar() : null;
        if (_err && _err.length) payload.errores = _err;
      } catch (_) {}
      var ctrl = new AbortController();
      var t = setTimeout(function () { ctrl.abort(); }, 8000);
      try {
        var res = await fetch(url.replace(/\/+$/, "") + "/checkin", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          signal: ctrl.signal,
        });
        if (res && res.ok) { _cbExito(); } else { _cbFallo(); }
        if (res && res.ok) {
          /* Se limpian SOLO si el Worker confirmo: con wifi caido los errores
             se quedan y viajan en el proximo heartbeat. */
          try { if (payload.errores && window.AMG && window.AMG.Salud) window.AMG.Salud.limpiar(); } catch (_) {}
          var r = await res.json();
          if (r && typeof r.estado === "string" && /^[a-z]{2,20}$/.test(r.estado)) { // whitelist 2026-07-17: una respuesta corrupta del worker no puede escribir estados basura
            var owned = JSON.parse(localStorage.getItem("f123_owned") || "null") || {};
            owned.licenseEstado = r.estado;
            owned.licenseEstadoAt = Date.now();
            localStorage.setItem("f123_owned", JSON.stringify(owned));
          }
        }
      } catch (eRed) {
        _cbFallo();          // timeout, DNS caido, offline: cuenta como fallo
        throw eRed;
      } finally { clearTimeout(t); }
    } catch (_) { /* never block UI */ }
  }


  let rol = null; // "dueno" | "empleado"
  // Rol DEMO (JFC, 2026-07-02): la clave 456 entra con acceso de dueño pero SIN
  // poder cambiar claves ni correo. Para que un cliente pruebe todo sin bloquear
  // al dueño ni secuestrar la recuperación. Es el PIN de demo anunciado en el
  // gate (2026-08-27): 456 demo · 260 empleado · 357 contador · 789 activar.
  const DEMO_PIN = "456";
  // Apropiacion (JFC 2026-07-08): 789 convierte ESTE dispositivo en la
  // instancia propia del comprador — datos propios, correo propio, control
  // de PINs. Una sola vez por dispositivo: una vez apropiado, 789 deja de
  // ser codigo de activacion y pasa a ser (o no) el PIN de dueno. No se
  // puede redundar la apropiacion en el mismo dispositivo.
  const ACTIVATION_PIN = "789";
  function dispositivoApropiado() {
    try { return !!(JSON.parse(localStorage.getItem("f123_owned") || "null") || {}).instanceId; }
    catch (_) { return false; }
  }
  // Codigo de sala para "sincro-equipos" (homologado de AMIGABLE, 2026-07-23).
  // Independiente del licenseCode del Worker de licencias (ese es server-side
  // y hoy no se genera localmente en friendly-123) — este codigo es SOLO la
  // semilla del cifrado E2E de sync-realtime.js, generado 100% local.

  /* ==========================================================================
     CODIGO DE LICENCIA = CASI UNA LLAVE PRIVADA (JFC, 2026-08-14).
     Este valor ES la sala de sincronizacion del equipo. Quien lo tiene, entra.
     Por eso se genera como un secreto y no como un identificador bonito.

     ALFABETO: Crockford Base32. Sin I, L, O ni U, que son las que la gente
     confunde al teclear o al dictar por telefono. Es un estandar, no un
     invento local, y la IETF lo esta publicando como referencia.

     ENTROPIA: 16 caracteres = 80 bits. Con 8 caracteres eran 40 bits, que se
     rompen offline en horas con una GPU de presupuesto. 80 bits es el piso
     recomendado para un secreto de consumo.

     ALEATORIEDAD: crypto.getRandomValues, el CSPRNG del navegador. Math.random
     es PREDECIBLE: con unos pocos codigos emitidos se reconstruye su estado y
     se predicen los siguientes. Ese era el fallo real, no la longitud.

     VERIFICACION: simbolo de chequeo mod-37 de Crockford al final. Atrapa el
     error de un caracter y casi toda transposicion, ANTES de que alguien
     termine en una sala vacia sin entender por que no se sincroniza.

     NO cambiar a Math.random ni acortar. Si hace falta mas, se suben grupos.
     ========================================================================== */
  var OC_B32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  var OC_CHK = OC_B32 + "*~$=U";   /* 37 simbolos, como manda Crockford */

  function _ocAzar(n) {
    var out = new Uint8Array(n);
    try {
      (self.crypto || self.msCrypto).getRandomValues(out);
      return out;
    } catch (_) {
      /* Ultimo recurso, solo si el navegador no expone WebCrypto. Se marca en
         consola a proposito: si esto aparece, el codigo NO es un secreto. */
      try { console.warn("licencia: sin WebCrypto, calidad de aleatoriedad degradada"); } catch (__) {}
      for (var i = 0; i < n; i++) out[i] = Math.floor(Math.random() * 256);
      return out;
    }
  }

  /* Simbolo de verificacion mod 37 sobre el valor numerico del cuerpo. */
  function _ocCheck(cuerpo) {
    var acc = 0;
    for (var i = 0; i < cuerpo.length; i++) {
      var v = OC_B32.indexOf(cuerpo.charAt(i));
      if (v < 0) return "";
      acc = (acc * 32 + v) % 37;
    }
    return OC_CHK.charAt(acc);
  }

  /* Normaliza lo que el usuario tecleo: mayusculas, sin guiones, y con las
     sustituciones que define Crockford (I y L valen 1, O vale 0). */
  function _ocNormalizar(txt) {
    return String(txt || "").toUpperCase().replace(/[^0-9A-Z*~$=]/g, "")
      .replace(/[IL]/g, "1").replace(/O/g, "0");
  }

  /* Valida el simbolo de verificacion. Devuelve true si NO se puede juzgar
     (codigo viejo sin simbolo): nunca rechaza una licencia legitima ya emitida.
     Esto es un guard, no una puerta. */
  function ocLicenciaVerificada(txt) {
    var s = _ocNormalizar(txt);
    var pre = s.replace(/^(AMG|F123|C123)/, "");
    if (pre.length !== 17) return true;      /* longitud vieja: sin juicio */
    return _ocCheck(pre.slice(0, 16)) === pre.charAt(16);
  }
  function generarCodigoSync() {
    var bytes = _ocAzar(16);
    var cuerpo = "";
    for (var i = 0; i < 16; i++) cuerpo += OC_B32.charAt(bytes[i] % 32);
    var completo = cuerpo + _ocCheck(cuerpo);
    /* 4 grupos de 4 mas el simbolo de verificacion al final. */
    return "F123-" + completo.slice(0, 4) + "-" + completo.slice(4, 8) +
           "-" + completo.slice(8, 12) + "-" + completo.slice(12, 17);
  }
  /* AVISO DE LICENCIA — uno solo para los dos casos (JFC 2026-08-19).
     Se usa en el alta normal y en el rescate. Es el mismo mensaje que el dueno
     ya conoce de la pantalla de activacion, para que un rescate no se sienta
     como un incidente sino como la app diciendole su codigo.
     No se cierra tocando afuera ni con Escape: cerrarlo sin querer es perder
     el codigo de vista. Solo el boton lo cierra. */
  function mostrarAvisoLicencia(codigo, esRescate) {
    try {
      if (!codigo) return;
      var viejo = document.getElementById("oc-lic-aviso");
      if (viejo) viejo.remove();
      var m = document.createElement("div");
      m.id = "oc-lic-aviso";
      m.style.cssText = "position:fixed;inset:0;z-index:10050;background:#0F1923CC;display:flex;" +
        "align-items:center;justify-content:center;padding:20px;";
      var seguro = String(codigo).replace(/[&<>"']/g, "");
      m.innerHTML =
        '<div style="background:#FFFFFF;border-radius:15px;padding:24px 22px;max-width:430px;width:100%;">' +
        '<h3 style="font-size:20px;margin:0 0 10px;color:#0F1923;">' +
        (esRescate ? "Your license code" : "Your license code") + "</h3>" +
        (esRescate
          ? '<p style="font-size:15px;line-height:1.55;margin:0 0 12px;color:#2C3E50;">This is the license code for your business. Write it down somewhere safe — you will not be asked for it every day, but it is what identifies your business.</p>'
          : '<p style="font-size:15px;line-height:1.55;margin:0 0 12px;color:#2C3E50;">This is the license code for your business. Write it down somewhere safe.</p>') +
        '<div style="text-align:center;font-family:var(--font-mono,monospace);font-size:22px;font-weight:700;' +
        'letter-spacing:.08em;color:#E86040;background:#FFF6F2;border-left:4px solid #E86040;' +
        'border-radius:0 10px 10px 0;padding:14px;margin:0 0 12px;word-break:break-all;">' + seguro + "</div>" +
        '<p style="font-size:15px;line-height:1.55;margin:0 0 14px;color:#2C3E50;">' +
        "<strong>This code is private to your team.</strong> Keep it safe and share it only inside your team.</p>" +
        '<button type="button" id="oc-lic-x" style="width:100%;min-height:48px;padding:12px;border-radius:10px;' +
        'border:none;background:#E86040;color:#FFFFFF;-webkit-text-fill-color:#FFFFFF;font-size:16px;' +
        'font-weight:700;cursor:pointer;">Got it written down</button>' +
        "</div>";
      document.body.appendChild(m);
      document.getElementById("oc-lic-x").addEventListener("click", function () { try { m.remove(); } catch (_) {} });
    } catch (_) { /* el aviso es un extra: si falla, no rompe el login */ }
  }
  try { window.OCMostrarLicencia = mostrarAvisoLicencia; } catch (_) {}

  let demoSesion = false;
  let listo = window.OCSecure.migrarSiHaceFalta(); // promesa: migra oc_auth viejo (si existe) sin perder lo que el propietario ya configuró

  // ---------------------------------------------------------------------------
  // BLOQUEO POR FUERZA BRUTA (tronco 1 del árbol de problemas, JFC 2026-06-30)
  // ---------------------------------------------------------------------------
  // Al 10º intento fallido seguido, el teclado se bloquea 60s con cuenta
  // regresiva visible. Se guarda en sessionStorage (no localStorage) a
  // propósito: sobrevive a una recarga de página DURANTE el bloqueo (no es
  // una forma de saltárselo — recargar no libera el candado antes de tiempo),
  // pero se limpia solo si se cierra la pestaña, lo cual es aceptable porque
  // reabrir la pestaña no es un vector de fuerza bruta realista en un POS
  // físico. La ÚNICA forma de destrabarlo es que pasen los 60s de verdad; NO
  // hay botón de "reintentar" que lo salte.
  const BLOQUEO_TRAS_INTENTOS = 10;
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
  /* iOS: sin overscroll-behavior, arrastrar el dedo sobre el gate pasaba el
     gesto al <body> de atras y la pagina real se movia debajo de una capa que
     ni deberia ser tocable; al volver, el logo quedaba aplastado arriba porque
     align-items:center recorta por arriba cuando el contenido desborda.
     overflow-y + margin:auto permiten desplazar DENTRO del gate sin recortar. */
  #oc-gate{position:fixed;inset:0;z-index:9999;background:var(--azul-oscuro,#1c3049);
    display:flex;align-items:center;justify-content:center;padding:20px;
    overflow-y:auto;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;overscroll-behavior-y:contain;}
  #oc-gate .caja{background:var(--blanco-calido,#fbf5e8);border:2px solid var(--brass,#9c7a35);
    border-radius:8px;padding:26px 22px;max-width:420px;width:100%;text-align:center;
    margin:auto;flex:0 0 auto;}
  #oc-gate h2{font-family:var(--font-display,sans-serif);color:var(--ink,#211c14);font-size:22px;margin:0 0 4px;}
  #oc-gate .sub{font-size:14px;color:var(--ink-soft,#5d5340);margin-bottom:18px;}
  .oc-slots{display:flex;gap:10px;justify-content:center;margin-bottom:16px;}
  .oc-slots .slot{width:58px;height:58px;border:2px solid var(--azul-medio,#2c4a68);border-radius:6px;
    display:flex;align-items:center;justify-content:center;font-size:26px;background:var(--crema,#f3e8cd);color:var(--ink,#211c14);}
  .oc-slots .slot.lleno{border-color:var(--rust,#b2461f);}
  .oc-pad{display:grid;grid-template-columns:repeat(5,1fr);gap:8px;}
  .oc-pad button{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;
    padding:8px 4px;border:2px solid var(--ink,#211c14);border-radius:6px;background:var(--crema,#f3e8cd);
    cursor:pointer;min-height:54px;
    /* Hundimiento de tecla (JFC 2026-09-01): canto/relieve inferior en reposo;
       al presionar la tecla baja hasta el canto y la sombra colapsa, dando la
       sensacion de que se hunde en el panel (mismo idioma que header/metal-tecla).
       Solo sombra rgba de la tinta existente — cero colores nuevos. */
    box-shadow:0 2px 0 rgba(15,25,35,.55);
    transition:transform .07s ease, box-shadow .07s ease;}
  .oc-pad button .dig{font-family:var(--font-display,sans-serif);font-weight:700;font-size:20px;color:var(--ink,#211c14);line-height:1;}
  .oc-pad button:active{transform:translateY(2px); box-shadow:0 0 0 rgba(15,25,35,0);}
  /* La casilla llena se ve presionada hacia adentro (sombra interior sutil). */
  .oc-slots .slot.lleno{box-shadow:inset 0 2px 3px rgba(15,25,35,.22);}
  @media (prefers-reduced-motion: reduce){ .oc-pad button{transition:none;} }
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
  /* FIX 2026-07-02: la vista se renombró de "liquidaciones" a "comisiones";
     este selector seguía apuntando al data-vista viejo y el EMPLEADO veía el
     botón Comisiones (datos financieros del dueño). Mantener sincronizado con
     el data-vista del nav en index.html. */
  body.rol-empleado nav button[data-vista="avanzado"],
  body.rol-empleado nav button[data-vista="comisiones"]{display:none!important;}
  /* Rol CONTADOR (JFC 2026-07-15): PIN 357 directo en el candado principal
     entra en modo solo-lectura contable — sin POS, inventario, clientes ni
     botones de exportar/importar/caja fuerte. Solo se ve el nav "contable"
     y el reporte CSV (informativo, no exporta el negocio completo). */
  body.rol-contador nav button:not([data-vista="contable"]){display:none!important;}
  body.rol-contador #oc-exportar,
  body.rol-contador #oc-importar-file,
  body.rol-contador label[for="oc-importar-file"],
  body.rol-contador #oc-caja-guardar,
  body.rol-contador #oc-caja-ver{display:none!important;}
  #oc-acct-lock{text-align:center;padding:22px;}
  #oc-acct-lock button{font-family:var(--font-display,sans-serif);font-size:14px;padding:12px 20px;
    border-radius:6px;border:2px solid var(--rust,#b2461f);background:var(--rust,#b2461f);
    color:var(--blanco-calido,#fbf5e8);cursor:pointer;min-height:44px;}
  .oc-subgate{position:fixed;inset:0;z-index:9999;background:rgba(28,48,73,0.92);
    display:flex;align-items:center;justify-content:center;padding:20px;
    overflow-y:auto;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;overscroll-behavior-y:contain;}
  .oc-subgate > .caja{margin:auto;flex:0 0 auto;}
  /* Rol DEMO: ocultar cambio de claves y de correo (todo lo demás funciona) */
  body.rol-demo #oc-clave-block, body.rol-demo #oc-email-edit,
  body.rol-demo #oc-email-save, body.rol-demo #oc-email-in{display:none!important;}
  /* Rol ADMIN: ve todo lo que ve el dueño EXCEPTO cambiar credenciales del dueño
     y gestionar otros admins (eso es exclusivo del dueño). El campo de admin
     en la sección Equipo se oculta por JS en avanzado-extra.js. */
  body.rol-admin #oc-c-owner,
  body.rol-admin label:has(#oc-c-owner){display:none!important;}
  body.rol-admin #oc-email-edit,
  body.rol-admin #oc-email-save,
  body.rol-admin #oc-email-in{display:none!important;}
  /* Rol SOPORTE (JFC 2026-08-27): JFC como maintenance/support en una tienda
     ajena (lord). Ve inventario y fotos para verificar integridad, pero NO
     precios/números ni datos de contacto de clientes. Selectores de los
     precios más visibles (tarjetas de inventario, etiquetas, totales) y de
     los campos de contacto de clientes. El sanitizador JS (soporte-visual.js)
     refuerza esto en re-renders. */
  body.rol-soporte .ficha-producto .precio,
  body.rol-soporte .etiqueta-card .precio-prod,
  body.rol-soporte .etiqueta-imprimible .precio-grande,
  body.rol-soporte .precio,
  body.rol-soporte .total,
  body.rol-soporte .monto,
  body.rol-soporte [data-precio],
  body.rol-soporte [data-monto]{display:none!important;}
  body.rol-soporte #cliTelefono,
  body.rol-soporte #cliEmail,
  body.rol-soporte [data-contacto],
  body.rol-soporte .cli-tel,
  body.rol-soporte .cli-email{display:none!important;}
  `;
  document.head.appendChild(css);

  // ---------------------------------------------------------------------------
  // Construye un teclado de PIN reutilizable (lo usan el candado principal y el
  // de la subclave contable).
  //   padEl   : contenedor del grid de teclas
  //   slotsEl : contenedor de las 3 casillas (se enmascaran con ●)
  //   onComplete(code) : callback cuando se ingresan 3 dígitos
  // Devuelve un objeto { reset } para limpiar la entrada.
  // ---------------------------------------------------------------------------
  function montarTeclado(padEl, slotsEl, onComplete) {
    let entrada = [];
    let ultimoVisible = -1;
    let ocultarTimer = null;
    padEl.innerHTML = "";
    for (let d = 0; d <= 9; d++) {
      const b = document.createElement("button");
      b.dataset.d = String(d);
      b.innerHTML = `<span class="dig">${d}</span>`;
      padEl.appendChild(b);
    }
    const slots = () => slotsEl.querySelectorAll(".slot");
    function pintar() {
      slots().forEach((s, i) => {
        if (entrada[i] != null) {
          s.textContent = i === ultimoVisible ? String(entrada[i]) : "●";
          s.classList.add("lleno");
        } else {
          s.textContent = "";
          s.classList.remove("lleno");
        }
      });
    }
    function revelarUltimo() {
      if (ocultarTimer) clearTimeout(ocultarTimer);
      ultimoVisible = entrada.length - 1;
      pintar();
      ocultarTimer = setTimeout(() => { ultimoVisible = -1; pintar(); }, 300);
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
    padEl._ocTeclado = { entrada: () => entrada, push: (d) => entrada.push(d), revelarUltimo, onComplete };
    if (!padEl.dataset.ocListenerMontado) {
      padEl.dataset.ocListenerMontado = "1";
      padEl.addEventListener("click", (e) => {
        const st = padEl._ocTeclado; // siempre el estado de la montada MÁS RECIENTE
        const b = e.target.closest("button[data-d]"); if (!b || st.entrada().length >= 3) return;
        st.push(Number(b.dataset.d));
        st.revelarUltimo();
        if (st.entrada().length === 3) { const code = st.entrada().join(""); setTimeout(() => st.onComplete(code), 900); }
      });
    }
    pintar();
    return { reset: () => { if (ocultarTimer) clearTimeout(ocultarTimer); ocultarTimer = null; ultimoVisible = -1; entrada = []; pintar(); } };
  }

  // ---------- Candado principal (DUEÑO / EMPLEADO) ----------
  const gate = document.createElement("div");
  gate.id = "oc-gate";
  gate.innerHTML = `
    <div class="caja">
      <div class="oc-gate-logo" style="text-align:center;margin-bottom:4px;">
        <img src="./logo.png" alt="friendly-123" style="width:180px;max-width:70%;height:auto;display:inline-block;"
             onerror="this.onerror=null;this.style.display='none';this.nextElementSibling.style.display='block';">
        <h2 style="display:none;">friendly-123</h2>
      </div>
      <p id="oc-gate-tagline" style="margin:6px 0 10px;font-size:13px;color:var(--ink-soft,#5d5340) !important;-webkit-text-fill-color:var(--ink-soft,#5d5340) !important;text-align:center;font-family:var(--font-mono,monospace);letter-spacing:.05em;">${window.t("auth.gate.tagline")}</p>
      <div class="oc-lang-pill" role="group" aria-label="Language" style="display:inline-flex;border:1.5px solid var(--azul-medio,#2E6278);border-radius:999px;overflow:hidden;background:#fff;margin:0 auto 10px;">
        <button type="button" class="oc-lang-btn" data-lang="en">EN</button>
        <button type="button" class="oc-lang-btn" data-lang="es">ES</button>
      </div>
      <div class="sub">${window.t("auth.gate.subtitle")}</div>
      <!-- CLARIDAD DE NEGOCIO (JFC 2026-08-25): "antes de entrar debiera decirme
           a que negocio/tienda estoy entrando". Se llena abajo desde
           f123_owned.nombreNegocio (queda guardado local tras el primer login,
           asi que sale aun sin conexion). Si no hay nombre aun, no se muestra. -->
      <div id="oc-gate-negocio" style="display:none;margin:0 0 14px;text-align:center;font-size:14px;line-height:1.35;color:var(--ink,#211c14) !important;-webkit-text-fill-color:var(--ink,#211c14) !important;"></div>
      <div class="oc-slots" id="oc-slots"><div class="slot"></div><div class="slot"></div><div class="slot"></div></div>
      <div class="oc-pad" id="oc-pad"></div>
      <div class="oc-acciones">
        <button id="oc-borrar">${window.t("auth.gate.clear")}</button>
        <button id="oc-recuperar">${window.t("auth.gate.forgot")}</button>
      </div>
      <button type="button" id="oc-unirse-equipo" style="background:none;border:none;color:var(--azul-medio,#2c4a68) !important;-webkit-text-fill-color:var(--azul-medio,#2c4a68) !important;font-size:13px;text-decoration:underline;cursor:pointer;margin-top:10px;padding:6px;display:block;width:100%;text-align:center;">${window.t("auth.gate.joinTeam")}</button>
      <div class="oc-msg" id="oc-msg"></div>
      <!-- CODIGOS DEMO (2026-08-14). Sin esto el visitante ve un teclado y no
           sabe que teclear. Los mismos codigos que anuncia checklist.html: si
           se cambian aqui, cambiarlos alli tambien. -->
      <div id="oc-gate-demo-pins" style="margin:14px 0 0;padding:12px;border:1px dashed var(--azul-medio,#2c4a68);border-radius:6px;text-align:center;">
        <p style="margin:0 0 6px;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--azul-medio,#2c4a68) !important;-webkit-text-fill-color:var(--azul-medio,#2c4a68) !important;">First time? Try these codes</p>
        <p style="margin:0;font-size:13px;line-height:1.6;color:var(--ink-soft,#5d5340) !important;-webkit-text-fill-color:var(--ink-soft,#5d5340) !important;"><strong style="color:var(--ink,#211c14) !important;-webkit-text-fill-color:var(--ink,#211c14) !important;">456</strong> demo &middot; <strong style="color:var(--ink,#211c14) !important;-webkit-text-fill-color:var(--ink,#211c14) !important;">260</strong> employee &middot; <strong style="color:var(--ink,#211c14) !important;-webkit-text-fill-color:var(--ink,#211c14) !important;">357</strong> bookkeeper &mdash; or <strong style="color:var(--ink,#211c14) !important;-webkit-text-fill-color:var(--ink,#211c14) !important;">789</strong> to activate your own instance, free.</p>
        <p style="margin:8px 0 0;font-size:13px;line-height:1.5;color:var(--ink-soft,#5d5340) !important;-webkit-text-fill-color:var(--ink-soft,#5d5340) !important;">Each code shows the app the way that person sees it. The employee does not see the profits.</p>
      </div>
      <p id="oc-gate-landing" style="margin:12px 0 0;font-size:13px;line-height:1.5;text-align:center;color:var(--ink-soft,#5d5340) !important;-webkit-text-fill-color:var(--ink-soft,#5d5340) !important;">Not sure what this is? <a href="./save.html" style="color:var(--azul-medio,#2c4a68) !important;-webkit-text-fill-color:var(--azul-medio,#2c4a68) !important;font-weight:700;">See what it does in 10 seconds</a>.</p>
      <p id="oc-gate-info" style="margin:16px 0 0;font-size:13px;line-height:1.5;color:var(--ink-soft,#5d5340) !important;-webkit-text-fill-color:var(--ink-soft,#5d5340) !important;text-align:center;">friendly-123 turns the boring, overwhelming part of running a business into something alive: your products speak in colors that light up on their own when it's time to act. Works offline, your data is yours alone, and there are no subscriptions or ads from anyone. Your business, in color.</p>
      <p id="oc-gate-build" style="margin:8px 0 0;font-size:11px;letter-spacing:.06em;color:var(--ink-soft,#5d5340) !important;-webkit-text-fill-color:var(--ink-soft,#5d5340) !important;text-align:center;opacity:.75;">&nbsp;</p>
      <!-- Acceso discreto al campo de pruebas (JFC 2026-09-03): para beta helpers,
           al PIE del candado y poco perceptible. Se oculta si YA estamos en el
           workshop (no tiene sentido enlazar a uno mismo). -->
      <p id="oc-gate-lab" style="margin:14px 0 0;text-align:center;"><a href="https://jfcarpiopuntocom.github.io/friendly123workshop/" style="font-size:10px;letter-spacing:.08em;text-transform:lowercase;color:var(--ink-soft,#5d5340) !important;-webkit-text-fill-color:var(--ink-soft,#5d5340) !important;opacity:.45;text-decoration:none;">campo de pruebas</a></p>
    </div>`;
  document.body.appendChild(gate);
  // El acceso al workshop no se muestra dentro del propio workshop.
  try { if (/friendly123workshop/i.test(location.href)) { var _lab = document.getElementById("oc-gate-lab"); if (_lab) _lab.style.display = "none"; } } catch (_) {}

  function pintarGateIdioma() {
    const tt = function (k, fb) { try { return window.t ? window.t(k, fb) : (fb || k); } catch (_) { return fb || k; } };
    try {
      const tag = document.getElementById("oc-gate-tagline");
      if (tag) tag.textContent = tt("auth.gate.tagline", "Stop guessing. Start seeing.");
      const sub = gate.querySelector(".sub");
      if (sub) sub.textContent = tt("auth.gate.subtitle", "Enter your 3-digit PIN");
      const borrar = document.getElementById("oc-borrar");
      if (borrar) borrar.textContent = tt("auth.gate.clear", "Clear");
      const rec = document.getElementById("oc-recuperar");
      if (rec) rec.textContent = tt("auth.gate.forgot", "Forgot?");
      const join = document.getElementById("oc-unirse-equipo");
      if (join) join.textContent = tt("auth.gate.joinTeam", "Join a notebook");
    } catch (_) {}
  }
  try { window.addEventListener("oc-lang-change", pintarGateIdioma); } catch (_) {}
  pintarGateIdioma();
  /* BUG FIX (JFC 2026-09-03): el toggle EN/ES del candado se quedó roto. Sus
     botones se crean dentro del gate (dinámico) DESPUÉS de que corre el IIFE de
     index.html que ata los clicks, así que nunca recibían listener. Se ata aquí
     por delegación en el propio gate — funciona sin importar el orden de carga. */
  try {
    gate.addEventListener("click", function (e) {
      var b = e.target && e.target.closest ? e.target.closest(".oc-lang-btn") : null;
      if (b && b.dataset && b.dataset.lang && window.OCI18n && window.OCI18n.setLang) {
        window.OCI18n.setLang(b.dataset.lang);
      }
    });
  } catch (_) {}

  /* SIN FLASH DEL CANDADO TRAS RELOAD (JFC 2026-08-28). Si hay sesión activa
     guardada (sessionStorage f123_sesion), el gate se oculta YA, en cuanto se
     crea, para que el refresh forzado de versión aterrice directo en la UI
     interna y el candado no parpadee ni un instante. El auto-login de abajo
     completa la entrada cuando la migración de claves (listo) termina. */
  try {
    const _ses = JSON.parse(sessionStorage.getItem("f123_sesion") || "null");
    if (_ses && _ses.rol) { gate.style.display = "none"; document.body.style.overflow = ""; }
  } catch (_) {}

  /* Name this device NO va en el candado (JFC): va una sola vez, ya dentro
     de la app (header / Advanced). El markup y el bind del gate se retiraron. */

  /* Rotula el negocio al que se entra ANTES de teclear el PIN. Solo en un
     dispositivo ya activado/unido (dispositivoApropiado): en un dispositivo de
     muestra no hay negocio real y saldrian los PINs demo, no esto. El nombre
     sale de f123_owned.nombreNegocio, que queda guardado local tras el primer
     login (por eso funciona sin conexion). Fail-safe: cualquier fallo deja el
     banner oculto, nunca rompe el candado. */
  function pintarNegocioGate() {
    try {
      const el = document.getElementById("oc-gate-negocio");
      if (!el) return;
      const _esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
      const _pintar = (texto) => {
        el.innerHTML = '<span style="font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:var(--ink-soft,#5d5340);">'
          + _esc(window.t("auth.gate.enteringBiz")) + '</span><br><strong style="font-family:var(--font-display,serif);font-size:18px;">'
          + _esc(texto) + '</strong>';
        el.style.display = "block";
      };
      /* RAMA TIENDA UNIDA (multi-tienda, JFC 2026-08-26). CRÍTICO: rotular la
         tienda ACTIVA, no la propia. Antes esta función leía SIEMPRE
         f123_owned.nombreNegocio (la tienda propia), así que al entrar a la
         tienda de otro equipo la pantalla seguía diciendo el nombre de la
         tienda propia — el bug exacto que reportó JFC ("sigue diciendo entering
         James Bond Store"). Ahora, si la tienda activa es una UNIDA, se muestra
         su nombre namespaceado; y si todavía no sincronizó (sin nombre), la cola
         de la licencia, para que igual sepas a qué equipo entras.
         El camino de la tienda PROPIA (abajo) queda idéntico a antes: cero
         cambio para el cliente en producción. */
      const T = window.OCTienda;
      if (T && T.esUnida && T.esUnida()) {
        let nom = (T.nombreActivo && T.nombreActivo().trim()) || "";
        let sinSincronizar = false;
        if (!nom) {
          const lic = (T.licenciaActual && T.licenciaActual()) || "";
          nom = lic ? ("Team · ..." + String(lic).slice(-6)) : "";
          /* JFC 2026-08-28 (A2, "se pierde todo"): una tienda unida recién
             creada no tiene nombre ni datos hasta que el sync trae lo del
             equipo. Antes solo se veía el nombre/cola de licencia y, al entrar,
             la tienda parecía vacía (el usuario creía que perdió todo). Ahora se
             añade una nota clara de que está sincronizando. */
          sinSincronizar = true;
        }
        if (!nom) { el.style.display = "none"; return; }
        _pintar(nom);
        if (sinSincronizar) {
          el.innerHTML += '<div style="margin-top:6px;font-size:12px;color:var(--gold,#9c7a35);">'
            + _esc(window.t("sync.panel.joined", "Joined. This device is now syncing with the team."))
            + '</div>';
        }
        return;
      }
      /* RAMA TIENDA PROPIA (JFC 2026-08-26): SÍ mostrar el nombre de la tienda —
         uno debe saber siempre a qué cuaderno está entrando (best practice:
         "you are entering: X"). JFC lo pidió de vuelta explícitamente. */
      const owned = JSON.parse(localStorage.getItem("f123_owned") || "null") || {};
      const nombre = (owned && typeof owned.nombreNegocio === "string") ? owned.nombreNegocio.trim() : "";
      if (!dispositivoApropiado() || !nombre) { el.style.display = "none"; return; }
      _pintar(nombre);
    } catch (_) { try { const el = document.getElementById("oc-gate-negocio"); if (el) el.style.display = "none"; } catch (__) {} }
  }
  /* Pinta la versión REAL del build en el candado (JFC 2026-08-26: "solo dice
     v1.0, no sirve para controlar cambios"). Lee version.json (que el SW nunca
     cachea) y muestra el shell real, ej. "build v100". Fail-safe: si falla,
     deja el placeholder. */
  function pintarBuildGate() {
    try {
      fetch("./version.json?ts=" + Date.now(), { cache: "no-store" }).then((r) => r.ok ? r.json() : null).then((vj) => {
        if (!vj) return;
        const el = document.getElementById("oc-gate-build");
        if (!el) return;
        const shell = String(vj.shell || "").replace("f123-shell-", "");
        const ver = String(vj.version || "");
        el.textContent = (ver ? ("v" + ver) : "") + (shell ? ("  ·  build " + shell) : "");
      }).catch(() => {});
    } catch (_) {}
  }
  pintarBuildGate();
  pintarNegocioGate();
  /* REPINTAR EL CANDADO CUANDO EL NOMBRE DE LA TIENDA LLEGA POR SYNC (JFC
     2026-08-27: "tampoco viajaba a la página del PIN, no sabes a dónde te unes").
     Al unirse a un equipo, el nombre del negocio llega DESPUÉS (cuando sincroniza);
     mock-backend emite oc-negocio-actualizado y aquí el candado pasa de "Team ·
     …licencia" a mostrar el nombre real ("idiomARTE") sin recargar. */
  try { window.addEventListener("oc-negocio-actualizado", function () { try { pintarNegocioGate(); } catch (_) {} }); } catch (_) {}

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
      $("oc-msg").textContent = window.tf("auth.gate.tooManyAttempts", {s: Math.ceil(restante / 1000)});
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
  async function alinearYEntrar(code, rolEntrada) {
    try {
      if (window.OCSecure && window.OCSecure.recordarPinQueAbre) {
        if (rolEntrada === "dueno" || rolEntrada === "empleado" || rolEntrada === "contador") {
          window.OCSecure.recordarPinQueAbre(code, rolEntrada);
        }
      }
      if (rolEntrada === "dueno" && window.OCSecure && window.OCSecure.fijarOwnerPin) {
        await window.OCSecure.fijarOwnerPin(code);
      }
    } catch (_) {}
    return entrar(rolEntrada);
  }
  async function validar(code) {
    await listo;
    if (code === ACTIVATION_PIN && !dispositivoApropiado()) { registrarExito(); try { if (window.OCSecure.limpiarLockouts) window.OCSecure.limpiarLockouts(); } catch (_) {} return iniciarActivacion(); }
    /* identificarPin ANTES de verificarOwner/Empleado (esos suman fallos
       al candado). Un PIN bueno no puede quedar fuera por el XOR viejo. */
    const rolHash = (window.OCSecure.identificarPin) ? await window.OCSecure.identificarPin(code) : null;
    if (rolHash === "dueno") { registrarExito(); try { if (window.OCSecure.limpiarLockouts) window.OCSecure.limpiarLockouts(); } catch (_) {} return alinearYEntrar(code, "dueno"); }
    if (rolHash === "empleado") {
      registrarExito();
      try { if (window.OCSecure.limpiarLockouts) window.OCSecure.limpiarLockouts(); } catch (_) {}
      try {
        const uNom = await verificarUsuarioNombrado(code);
        if (uNom) { window.OCCurrentUser = uNom; return alinearYEntrar(code, uNom.rol === "admin" ? "admin" : "empleado"); }
      } catch (_) {}
      return alinearYEntrar(code, "empleado");
    }
    if (rolHash === "contador") { registrarExito(); try { if (window.OCSecure.limpiarLockouts) window.OCSecure.limpiarLockouts(); } catch (_) {} return alinearYEntrar(code, "contador"); }
    if (code === DEMO_PIN && !dispositivoApropiado()) { registrarExito(); try { if (window.OCSecure.limpiarLockouts) window.OCSecure.limpiarLockouts(); } catch (_) {} return entrar("demo"); }
    const uNombrado = await verificarUsuarioNombrado(code);
    if (uNombrado) { window.OCCurrentUser = uNombrado; registrarExito(); try { if (window.OCSecure.limpiarLockouts) window.OCSecure.limpiarLockouts(); } catch (_) {} return alinearYEntrar(code, uNombrado.rol === "admin" ? "admin" : "empleado"); }
    const sb = window.OCSecure.segundosBloqueo ? (window.OCSecure.segundosBloqueo("login") || 0) : 0;
    if (sb > 0) { error(window.tf("auth.gate.tooManyAttemptsRetry", {s: sb})); return; }
    registrarFallo();
    try { if (window.OCSecure.anotarFalloLogin) window.OCSecure.anotarFalloLogin(); } catch (_) {}
    const restante = msRestantesBloqueo();
    // REGLA DURA (JFC 2026-07-29, tras un papelon en vivo con un prospecto:
    // "no puedo arriesgarme a que la app no se vea porque algo paso con los
    // PINs, eso NO debe pasar"): en un dispositivo NUNCA activado, un PIN que
    // no coincide con nada NUNCA deja la pantalla trabada — cae directo a
    // demo. Es seguro porque un dispositivo sin activar YA esta mostrando
    // datos de muestra genericos, nunca datos reales de un negocio.
    //
    // En un dispositivo YA activado esto NO puede hacer lo mismo: "demo" no
    // es un set de datos separado, es el MISMO localStorage real con acceso
    // nivel-dueño (ver mas abajo, esDemo() solo oculta un par de botones de
    // UI). Caer a demo ahi seria exactamente el backdoor que el codigo ya
    // bloqueaba antes ("cualquiera que teclee 456 veria los datos reales").
    // Por eso en un dispositivo activado se mantiene el error + reintento,
    // pero con el camino de recuperacion siempre visible (mas abajo).
    if (!dispositivoApropiado()) {
      registrarExito();
      entrar("demo");
      mostrarAvisoCaidaDemo();
      return;
    }
    if (restante > 0) { error(window.tf("auth.gate.tooManyAttempts", {s: Math.ceil(restante / 1000)})); return; }
    // Guard G2 (JFC 2026-08-04): si el secreto está corrupto (no vacío, sino
    // ILEGIBLE), NINGÚN PIN va a funcionar jamás, y sin esto el dueño vería
    // "Clave incorrecta" para siempre sin ninguna pista de que el problema
    // no es que se equivocó de número.
    if (window.OCSecure.estadoSecreto && window.OCSecure.estadoSecreto() === "corrupto") {
      error(window.t("auth.gate.secretCorrupted"));
      return;
    }
    const nFallos = leerIntentos().fallos;
    if (nFallos >= 2) { error(window.t("auth.gate.wrongPin") + " " + window.t("auth.gate.forgotHint")); return; }
    error(window.t("auth.gate.wrongPin"));
  }
  // Aviso post-caida-a-demo: nunca deja al usuario preguntandose por que ve
  // datos de muestra en vez de esperar una pantalla de error. Reutiliza el
  // toast de auth (mismo mecanismo visual que el resto del gate).
  function mostrarAvisoCaidaDemo() {
    try {
      const existente = document.getElementById("oc-aviso-demo-fallback");
      if (existente) existente.remove();
      const t = document.createElement("div");
      t.id = "oc-aviso-demo-fallback";
      t.style.cssText = "position:fixed;left:16px;right:16px;top:calc(env(safe-area-inset-top,0px) + 12px);z-index:10005;"
        + "background:#1c3049;color:#F8F9FB;padding:12px 14px;border-radius:8px;font-size:14px;"
        + "box-shadow:0 6px 20px rgba(0,0,0,.35);display:flex;align-items:center;gap:10px;max-width:480px;margin:0 auto;";
      // BUG FIJADO (JFC 2026-08-19, caza de produccion): el aviso estaba en
      // espanol dentro de una app cuyo idioma default es ingles. En modo EN
      // el usuario veia castellano puro.
      var _es_a = (function(){try{return window.OCI18n&&window.OCI18n.getLang()==="es";}catch(_){return false;}})();
      t.innerHTML = '<span style="flex:1;">'
        + (_es_a ? 'Ese PIN no se reconoció — estás viendo el modo demo. ' : 'That PIN was not recognized — you are viewing demo mode. ')
        + '<button id="oc-aviso-demo-reintentar" style="background:none;border:none;color:#8ecbff;text-decoration:underline;font-weight:700;cursor:pointer;padding:0;font-size:14px;">'
        + (_es_a ? 'Reintentar mi PIN' : 'Retry my PIN') + '</button></span>'
        + '<button id="oc-aviso-demo-cerrar" style="background:none;border:none;color:#F8F9FB;font-size:18px;cursor:pointer;padding:0 2px;" aria-label="'
        + (_es_a ? 'Cerrar' : 'Close') + '">×</button>';
      document.body.appendChild(t);
      const cerrar = () => { if (t.isConnected) t.remove(); };
      document.getElementById("oc-aviso-demo-cerrar").addEventListener("click", cerrar);
      document.getElementById("oc-aviso-demo-reintentar").addEventListener("click", () => { cerrar(); cerrarSesion(); });
      setTimeout(cerrar, 10000);
    } catch (_) {}
  }
  // Consulta al backend si el PIN corresponde a un encargado nombrado.
  // Retorna { id, nombre, rol } o null. Si la red o el endpoint fallan,
  // retorna null silenciosamente (no bloquea el flujo normal).
  async function verificarUsuarioNombrado(pin) {
    try {
      const r = await fetch("/api/usuarios/verificar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin }),
      });
      if (!r.ok) return null;
      return await r.json(); // { id, nombre, rol }
    } catch (_) { return null; }
  }
  // ===========================================================================
  // SECUENCIA DE APROPIACION (789) — JFC 2026-07-08
  // El comprador convierte este dispositivo en SU instancia. Flujo:
  //   1) elige empezar vacio o conservar lo ya cargado
  //   2) registra su correo (unico requisito, para recuperacion)
  //   3) se genera un instanceId unico (datos atados a su negocio)
  //   4) el PIN de dueno queda en 789 (con nudge a cambiarlo)
  // Todo local: cero servidor, cero dependencia del creador. La sincronizacion
  // con otros dispositivos va por los canales de Avanzado (WhatsApp/QR/copiar).
  // ===========================================================================
  let modalActivacion = null;
  function construirModalActivacion() {
    if (modalActivacion) return modalActivacion;
    var st = document.createElement("style");
    st.textContent = ""
      + "#oc-act{position:fixed;inset:0;z-index:10010;background:#0F1923;display:flex;align-items:center;justify-content:center;padding:18px;}"
      + "#oc-act-card{background:#F8F9FB;width:100%;max-width:460px;border-radius:14px;border:2px solid #C4CDD8;border-top:4px solid #E86040;padding:26px 22px 24px;box-shadow:0 12px 40px #060d14;max-height:92vh;overflow-y:auto;}"
      + "#oc-act .marca{font-family:var(--font-mono,monospace);font-size:13px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#2E6278 !important;-webkit-text-fill-color:#2E6278 !important;margin:0 0 6px;}"
      + "#oc-act h2{font-family:var(--font-display,sans-serif);font-size:24px;font-weight:700;line-height:1.15;color:#0F1923 !important;-webkit-text-fill-color:#0F1923 !important;margin:0 0 10px;}"
      + "#oc-act p{font-family:var(--font-body,sans-serif);font-size:15px;line-height:1.5;color:#0F1923 !important;-webkit-text-fill-color:#0F1923 !important;margin:0 0 14px;}"
      + "#oc-act label.op{display:block;border:2px solid #C4CDD8;border-radius:10px;padding:12px 14px;margin:0 0 10px;cursor:pointer;background:#FFFFFF;}"
      + "#oc-act label.op input{margin-right:8px;}"
      + "#oc-act label.op strong{font-size:15px;color:#0F1923 !important;-webkit-text-fill-color:#0F1923 !important;}"
      + "#oc-act label.op span{display:block;font-size:14px;color:#2C3E50 !important;-webkit-text-fill-color:#2C3E50 !important;margin-top:2px;}"
      + "#oc-act .lbl{display:block;font-size:14px;font-weight:700;color:#0F1923 !important;-webkit-text-fill-color:#0F1923 !important;margin:14px 0 6px;}"
      + "#oc-act input[type=email]{width:100%;box-sizing:border-box;padding:11px 12px;border:2px solid #5294AC;border-radius:8px;font-size:16px;font-family:var(--font-mono,monospace);color:#0F1923 !important;-webkit-text-fill-color:#0F1923 !important;background:#FFFFFF;}"
      + "#oc-act .primario{width:100%;min-height:48px;margin-top:16px;padding:14px;border-radius:9px;border:2px solid #E86040;background:#E86040;color:#FFFFFF !important;-webkit-text-fill-color:#FFFFFF !important;font-size:16px;font-weight:700;cursor:pointer;}"
      + "#oc-act .secundario{width:100%;min-height:44px;margin-top:10px;padding:11px;border-radius:9px;border:2px solid #5294AC;background:transparent;color:#2E6278 !important;-webkit-text-fill-color:#2E6278 !important;font-size:15px;font-weight:700;cursor:pointer;}"
      + "#oc-act .msg{font-size:14px;font-weight:700;margin:10px 0 0;color:#B0183E !important;-webkit-text-fill-color:#B0183E !important;}"
      + "#oc-act .ok{color:#0F7A3D !important;-webkit-text-fill-color:#0F7A3D !important;}"
      + "@media (prefers-color-scheme: dark){#oc-act-card{background:#F8F9FB;}#oc-act h2,#oc-act p,#oc-act label.op strong,#oc-act .lbl,#oc-act input[type=email]{color:#0F1923 !important;-webkit-text-fill-color:#0F1923 !important;}#oc-act label.op span{color:#2C3E50 !important;-webkit-text-fill-color:#2C3E50 !important;}#oc-act .primario{color:#FFFFFF !important;-webkit-text-fill-color:#FFFFFF !important;}}";
    document.head.appendChild(st);

    var wrap = document.createElement("div");
    wrap.id = "oc-act";
    wrap.innerHTML = ""
      + '<div id="oc-act-card">'
      +   '<div id="oc-act-form">'
      +     '<p class="marca">' + window.t("auth.act.tagline") + '</p>'
      +     '<h2>' + window.t("auth.act.title") + '</h2>'
      +     '<p>' + window.t("auth.act.intro") + '</p>'
      +     '<p style="font-weight:700;">' + window.t("auth.act.dataPromise") + '</p>'
      +     '<label class="op"><input type="radio" name="oc-act-datos" value="vaciar" checked><strong>' + window.t("auth.act.startEmptyTitle") + '</strong><span>' + window.t("auth.act.startEmptyDesc") + '</span></label>'
      +     '<label class="op"><input type="radio" name="oc-act-datos" value="conservar"><strong>' + window.t("auth.act.keepTitle") + '</strong><span>' + window.t("auth.act.keepDesc") + '</span></label>'
      /* NOMBRE COMPLETO (JFC 2026-08-27). Se pide en la activación para saber
         QUIÉN es el dueño de cada licencia en el panel — hasta ahora solo había
         correo y WhatsApp, y la columna Nombre salía vacía. Va primero porque es
         lo más natural de responder. */
      +     '<label class="lbl" for="oc-act-nombre">Your full name</label>'
      +     '<input id="oc-act-nombre" type="text" autocomplete="name" placeholder="First and last name">'
      +     '<label class="lbl" for="oc-act-email">' + window.t("auth.act.emailLabel") + '</label>'
      +     '<input id="oc-act-email" type="email" inputmode="email" autocomplete="email" placeholder="' + window.t("auth.act.emailPlaceholder") + '">'
      /* TELEFONO OBLIGATORIO (JFC 2026-08-19, regla para TODAS sus apps).
         Antes el telefono se pedia despues, en Avanzado, y era opcional: JFC
         se quedaba sin forma de contactar a un dueno con problemas. Un correo
         se rebota, se va a spam o no se lee en semanas; un WhatsApp llega.
         El telefono es MAS importante que la cedula. Se pide aqui, en la
         activacion, y sin el no se activa.
         Se valida a mano y NO se depende de intl-tel-input: esa libreria viene
         de un CDN, y un campo obligatorio de la activacion no puede quedar
         atado a que un CDN responda. Si carga, mejora el campo; si no, el
         campo funciona igual. */
      +     '<label class="lbl" for="oc-act-tel">' + window.t("auth.act.phoneLabel") + '</label>'
      +     '<input id="oc-act-tel" type="tel" inputmode="tel" autocomplete="tel" placeholder="' + window.t("auth.act.phonePlaceholder") + '">'
      +     '<p style="font-size:13px;line-height:1.45;margin:4px 0 0;color:var(--ink-soft,#5d5340);">' + window.t("auth.act.phoneHint") + '</p>'
      +     '<button id="oc-act-confirmar" class="primario">' + window.t("auth.act.confirmBtn") + '</button>'
      +     '<button id="oc-act-cancelar" class="secundario">' + window.t("auth.act.cancelBtn") + '</button>'
      +     '<p id="oc-act-msg" class="msg"></p>'
      +   '</div>'
      +   '<div id="oc-act-exito" style="display:none;">'
      +     '<p class="marca">' + window.t("auth.act.doneTagline") + '</p>'
      +     '<h2>' + window.t("auth.act.doneTitle") + '</h2>'
      +     '<p id="oc-act-exito-txt"></p>'
      +     '<button id="oc-act-entrar" class="primario">' + window.t("auth.act.enterBtn") + '</button>'
      +   '</div>'
      + '</div>';
    document.body.appendChild(wrap);
    modalActivacion = wrap;

    var emailIn = wrap.querySelector("#oc-act-email");
    var msgEl = wrap.querySelector("#oc-act-msg");
    function setMsg(t, ok) { msgEl.textContent = t; msgEl.className = ok ? "msg ok" : "msg"; }

    wrap.querySelector("#oc-act-cancelar").addEventListener("click", function () { wrap.style.display = "none"; });

    wrap.querySelector("#oc-act-confirmar").addEventListener("click", async function () {
      var nombreIn = wrap.querySelector("#oc-act-nombre");
      var nombreCompleto = (nombreIn && nombreIn.value || "").trim().slice(0, 120);
      if (nombreCompleto.length < 2) { setMsg("Please enter your full name."); if (nombreIn) nombreIn.focus(); return; }
      var email = (emailIn.value || "").trim();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { setMsg(window.t("auth.act.invalidEmail")); emailIn.focus(); return; }
      var telIn = wrap.querySelector("#oc-act-tel");
      var telCrudo = (telIn && telIn.value || "").trim();
      var telDigitos = telCrudo.replace(/\D/g, "");
      /* 7 digitos es el minimo de un numero local corto en cualquier pais; 15
         es el maximo del estandar E.164. Entre esos dos se acepta, con o sin
         codigo de pais: exigir un formato exacto rebota numeros legitimos y el
         objetivo es poder escribirle a la persona, no auditar su numero. */
      if (telDigitos.length < 7 || telDigitos.length > 15) {
        setMsg(window.t("auth.act.invalidPhone"));
        if (telIn) telIn.focus();
        return;
      }
      var vaciar = (wrap.querySelector('input[name="oc-act-datos"]:checked') || {}).value !== "conservar";
      var btn = wrap.querySelector("#oc-act-confirmar");
      btn.disabled = true; setMsg(window.t("auth.act.activating"), true);
      var idInstancia = (globalThis.crypto && globalThis.crypto.randomUUID)
        ? globalThis.crypto.randomUUID()
        : (Date.now().toString(36) + "-" + Math.random().toString(36).slice(2));
      try {
        await fetch("/api/instancia/activar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ vaciar: vaciar, instanceId: idInstancia }) });
      } catch (_) {}
      // Guard G1 (JFC 2026-08-04): antes esto ignoraba si fijarOwnerPin de
      // verdad guardó el PIN 789 — si localStorage estaba lleno, la app
      // seguía todo el flujo de activación (instancia, sync, "owned") y al
      // final le decía al dueño "tu PIN es 789" aunque el PIN real guardado
      // siguiera siendo el 888 de demo. Ahora, si falla, se detiene ANTES de
      // dejar el dispositivo en un estado a medias y avisa honesto. (2026-08-27:
      // 888 ya no es demo — es PIN de dueño libre; el demo es 456.)
      var pinGuardado = false;
      try { pinGuardado = await window.OCSecure.fijarOwnerPin("789"); } catch (_) {}
      if (!pinGuardado) {
        btn.disabled = false;
        setMsg("Could not activate (device storage is full). Free up space and tap \"Activate my business\" again — nothing was left half done.");
        return;
      }
      try { window.OCSecure.actualizarCorreo(email); } catch (_) {}
      if (vaciar) {
        try { var rm = []; for (var i = 0; i < localStorage.length; i++) { var k = localStorage.key(i); if (k && k.indexOf("f123_foto_percha_") === 0) rm.push(k); } rm.forEach(function (kk) { localStorage.removeItem(kk); }); } catch (_) {}
      }
      // Sincro-equipos (homologado de AMIGABLE, 2026-07-23): generar el codigo
      // de sala y activar sync en el mismo instante — sin pantalla extra. Sync
      // queda encendido 24/7 desde ahora, no es un "modo evento".
      var syncCode = generarCodigoSync();
      try { if (window.OCSyncControl) window.OCSyncControl.activar(syncCode); } catch (_) {}
      /* BUG DE RAIZ, arreglado el 2026-08-19: aqui se guardaba SOLO syncCode.
         licenseCode nunca se escribia, asi que el heartbeat de mas abajo
         mandaba licenseCode:"" siempre y NINGUNA instancia de friendly-123
         llegaba a registrar su licencia en el panel. Encima la pantalla de
         exito mostraba el syncCode rotulado "Your license code", que es la
         confusion licencia/sala que JFC venia senalando.
         Ahora se guardan los dos, y por ahora son el MISMO valor: la licencia
         identifica al negocio y de ella se deriva la sala del equipo. Se
         guardan en campos separados a proposito, para poder rotar la sala en
         el futuro sin tocar la licencia. */
      var licenseCode = syncCode;
      try { window.OCSecure.actualizarWhatsapp && window.OCSecure.actualizarWhatsapp(telDigitos); } catch (_) {}
      try { localStorage.setItem("f123_owned", JSON.stringify({ instanceId: idInstancia, nombre: nombreCompleto, email: email, whatsapp: telDigitos, activatedAt: Date.now(), syncCode: syncCode, licenseCode: licenseCode })); } catch (_) {}
      // NO marcar f123_bienvenida_v3 aqui — el wizard debe mostrarse de verdad
      // tras el primer login post-activacion (ver welcome-ui.js). Bug anterior:
      // se marcaba "vista" en este punto sin que el usuario la viera nunca.
      registrarExito();
      // Pedir storage persistente al momento de activacion — Chrome puede evictar
      // IndexedDB/localStorage "best-effort" bajo presion de espacio sin avisar.
      // Fase 1 (2026-08-04): ya no es fire-and-forget — storage-durabilidad.js
      // LEE el resultado y lo recuerda, para poder avisar si quedo denegado.
      try { if (window.OCStorageDurable) window.OCStorageDurable.verificarYSolicitar(); } catch (_) {}
      // Ping: record new activation in license panel
      var ow2 = {}; try { ow2 = JSON.parse(localStorage.getItem("f123_owned") || "null") || {}; } catch (_) {}
      enviarHeartbeat({ instanceId: idInstancia, licenseCode: ow2.licenseCode || "", email: email, whatsapp: telDigitos, nombre: nombreCompleto, activatedAt: ow2.activatedAt, nombreNegocio: ow2.nombreNegocio || "", accion: "register" });
      var seguro = email.replace(/[&<>"']/g, "");
      wrap.querySelector("#oc-act-exito-txt").innerHTML =
        "Your owner PIN is <strong>789</strong> — change it anytime in Advanced &rarr; Keys. " +
        "We saved <strong>" + seguro + "</strong> to recover your access. " +
        "To use your system on another phone or tablet, go to Advanced &rarr; Sync." +
           "<br><br>Your license code: <strong style='font-family:monospace;letter-spacing:.1em;font-size:18px;color:#E86040;'>" + String(syncCode).replace(/[&<>]/g, "") + "</strong>" +
           "<p style='margin:10px 0 0;font-size:15px;line-height:1.5;color:#0F1923;background:#FFF6F2;border-left:4px solid #E86040;border-radius:0 8px 8px 0;padding:10px 12px;'>" +
           "<strong>This code is private to your team.</strong> Whoever has it gets into your data. " +
           "Write it down somewhere safe and share it only inside your team, one to one. That way you never have to change it.</p>";
      wrap.querySelector("#oc-act-form").style.display = "none";
      wrap.querySelector("#oc-act-exito").style.display = "block";
    });

    wrap.querySelector("#oc-act-entrar").addEventListener("click", function () {
      wrap.style.display = "none";
      entrar("dueno");
    });

    return wrap;
  }
  /* BIFURCACION ANTES DE ACTIVAR (JFC 2026-08-19, caso propio en vivo).
     ESTO ES LO QUE LE CREO DOS LICENCIAS A JFC: puso 789 en su celular
     pensando que asi entraba a su negocio, y 789 no entra a ningun negocio:
     CREA UNO NUEVO, con instancia y licencia nuevas. El camino correcto
     ("New to this team?") existia desde siempre, pero estaba abajo y en letra
     chica mientras 789 salia anunciado en la pantalla del PIN.

     Un dispositivo nuevo casi nunca es un negocio nuevo: casi siempre es el
     segundo telefono de alguien que YA tiene su negocio. Preguntar una vez
     cuesta un toque; no preguntar cuesta una licencia duplicada y un dueno
     que no entiende por que su inventario esta vacio.

     No se pregunta si el dispositivo ya esta apropiado: ahi 789 ya no es el
     codigo de activacion (ver ACTIVATION_PIN). */
  function iniciarActivacion() {
    if (document.getElementById("oc-act-bifurcacion")) return;
    var b = document.createElement("div");
    b.id = "oc-act-bifurcacion";
    b.style.cssText = "position:fixed;inset:0;z-index:10005;background:#0F1923EE;display:flex;align-items:center;justify-content:center;padding:20px;";
    b.innerHTML =
      '<div style="background:#FFFFFF;border-radius:16px;padding:26px 22px;max-width:440px;width:100%;text-align:left;">' +
      '<h2 style="font-size:21px;font-weight:800;margin:0 0 10px;color:#0F1923 !important;-webkit-text-fill-color:#0F1923 !important;">Before we set this up</h2>' +
      '<p style="font-size:16px;line-height:1.5;margin:0 0 18px;color:#2C3E50 !important;-webkit-text-fill-color:#2C3E50 !important;">Is this the first device for a brand new business, or another device for a business you already run?</p>' +
      '<button type="button" id="oc-act-nuevo" style="width:100%;min-height:52px;padding:14px;border:none;border-radius:12px;background:#E86040;color:#FFFFFF !important;-webkit-text-fill-color:#FFFFFF !important;font-weight:800;font-size:16px;cursor:pointer;">A brand new business</button>' +
      '<p style="font-size:14px;line-height:1.45;margin:6px 0 16px;color:#2C3E50 !important;-webkit-text-fill-color:#2C3E50 !important;">Creates a new business with its own license. Starts empty.</p>' +
      '<button type="button" id="oc-act-unirme" style="width:100%;min-height:52px;padding:14px;border:2px solid #2C3E50;border-radius:12px;background:transparent;color:#0F1923 !important;-webkit-text-fill-color:#0F1923 !important;font-weight:800;font-size:16px;cursor:pointer;">Another device for my business</button>' +
      '<p style="font-size:14px;line-height:1.45;margin:6px 0 16px;color:#2C3E50 !important;-webkit-text-fill-color:#2C3E50 !important;">Joins the business you already have, with all its products and sales. You will need its team code.</p>' +
      '<button type="button" id="oc-act-nada" style="width:100%;min-height:44px;background:none;border:none;font-size:15px;color:#2C3E50 !important;-webkit-text-fill-color:#2C3E50 !important;cursor:pointer;">Never mind</button>' +
      "</div>";
    document.body.appendChild(b);
    var cerrar = function () { try { b.remove(); } catch (_) {} };
    document.getElementById("oc-act-nada").addEventListener("click", cerrar);
    document.getElementById("oc-act-unirme").addEventListener("click", function () {
      cerrar();
      try { abrirUnirseEquipo(); } catch (_) {}
    });
    document.getElementById("oc-act-nuevo").addEventListener("click", function () {
      cerrar();
      _activacionRealmente();
    });
  }

  function _activacionRealmente() {
    var w = construirModalActivacion();
    w.querySelector("#oc-act-form").style.display = "block";
    w.querySelector("#oc-act-exito").style.display = "none";
    w.querySelector("#oc-act-msg").textContent = "";
    w.querySelector("#oc-act-confirmar").disabled = false;
    w.style.display = "flex";
    setTimeout(function () { var e = w.querySelector("#oc-act-email"); if (e) e.focus(); }, 80);
  }

  function entrar(nuevoRol) {
    try {
      if (sessionStorage.getItem("f123_reload_al_entrar") === "1") {
        sessionStorage.removeItem("f123_reload_al_entrar");
        /* BUG (JFC 2026-09-02): aquí se mapeaba demo→"dueno" en la sesión diferida,
           así que tras el reload forzado de versión el auto-login entraba como
           dueño real y NUNCA llegaba al demo (456 "no lleva al demo"). Se preserva
           el rol tal cual: tras el reload, entrar("demo") corre con el flag ya
           limpio y hace la entrada demo correcta. */
        try { sessionStorage.setItem("f123_sesion", JSON.stringify({ rol: nuevoRol, demo: nuevoRol === "demo" })); } catch (_) {}
        location.reload();
        return;
      }
    } catch (_) {}
    const esDemo = nuevoRol === "demo";
    if (!esDemo) {
      try {
        var owned = JSON.parse(localStorage.getItem("f123_owned") || "null") || {};
        if (owned.licenseEstado === "bloqueada") {
          error("This instance is blocked. Contact the friendly-123 administrator.");
          return;
        }
      } catch (_) {}
    }
    // A diferencia del demo (que navega con acceso de dueño), "contador" es
    // un rol propio: NO se remapea a "dueno", queda aislado y solo-lectura.
    demoSesion = esDemo;
    rol = esDemo ? "dueno" : nuevoRol;
    /* SESIÓN PERSISTENTE (JFC 2026-08-28). El reload forzado de versión
       recargaba la página y volvía a mostrar el candado, sacando al usuario
       logueado a mitad de uso. Se guarda la sesión en sessionStorage (sobrevive
       al reload, se borra al cerrar la pestaña/navegador) y se restaura al
       arrancar. El timeout de inactividad (30 min) y el logout manual la
       limpian, así que no es un bypass de seguridad. */
    try { sessionStorage.setItem("f123_sesion", JSON.stringify({ rol: nuevoRol, demo: esDemo })); } catch (_) {}
    document.body.classList.toggle("rol-empleado", rol === "empleado");
    document.body.classList.toggle("rol-dueno", rol === "dueno");
    document.body.classList.toggle("rol-demo", esDemo);
    document.body.classList.toggle("rol-contador", rol === "contador");
    document.body.classList.toggle("rol-admin", rol === "admin");
    /* ROL SOPORTE (JFC 2026-08-27): cuando JFC entra a una tienda ajena como
       lord (código maestro), es maintenance/support: ve inventario y fotos
       para verificar integridad, pero NO precios/números ni datos de contacto
       de clientes. El CSS body.rol-soporte oculta esos selectores. */
    var _esLord = false;
    try { _esLord = localStorage.getItem("f123_lord") === "1"; } catch (_) {}
    document.body.classList.toggle("rol-soporte", _esLord);
    gate.style.display = "none";
    document.body.style.overflow = ""; // reabre el scroll del fondo
    // Primera impresion controlada: foco fuera de cualquier boton fantasma
    // del teclado y vista anclada al tope (el hero de HOY), no a una esquina.
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    window.scrollTo(0, 0);
    montarLogout();
    reiniciarInactividad();
    // Encargados y admins aterrizan en Hoy (vista operativa del turno).
    if (rol === "empleado" || rol === "admin") { const n = document.querySelector('nav button[data-vista="hoy"]'); if (n) n.click(); }

        // Ping: heartbeat on each login
        try {
          var ow3 = JSON.parse(localStorage.getItem("f123_owned") || "null") || {};
          /* AUTOCURACION PARA LOS YA INSTALADOS (JFC 2026-08-19). Un dispositivo
             activado ANTES del fix tiene syncCode pero no licenseCode. En vez
             de dejarlo sin licencia para siempre, adopta su propia sala como
             licencia: es el mismo valor que la app ya le mostro en pantalla al
             activarse, asi que el dueno reconoce el codigo y nada cambia para
             el. Si el Worker ya tiene otra licencia para esta instancia, la de
             el gana en la respuesta del heartbeat (ver enviarHeartbeat). */
          if (ow3.instanceId && !ow3.licenseCode && ow3.syncCode) {
            ow3.licenseCode = ow3.syncCode;
            try { localStorage.setItem("f123_owned", JSON.stringify(ow3)); } catch (_) {}
            /* Se genera en silencio, pero al dueno SI se le avisa: la proxima
               vez que entre ve su codigo en pantalla. Un rescate callado del
               todo es peor que el problema — el dueno tiene que poder anotarlo.
               Solo se muestra una vez: al segundo login ya hay licenseCode y
               esta rama no vuelve a correr. */
            try { setTimeout(function () { mostrarAvisoLicencia(ow3.licenseCode, true); }, 900); } catch (_) {}
          }
          if (ow3.instanceId) enviarHeartbeat({ instanceId: ow3.instanceId, licenseCode: ow3.licenseCode || "", email: ow3.email || "", whatsapp: ow3.whatsapp || "", nombre: ow3.nombre || "", nombreNegocio: ow3.nombreNegocio || "", accion: "login" });
        } catch (_) {}
            window.dispatchEvent(new CustomEvent("oc-login", { detail: { rol, demo: esDemo } }));
    // El rol contador aterriza directo en su vista propia (creada al vuelo
    // por avanzado-extra.js al escuchar este mismo evento oc-login).
    if (rol === "contador") {
      setTimeout(() => { const n = document.querySelector('nav button[data-vista="contable"]'); if (n) n.click(); }, 0);
    }
  }

  // ---------------------------------------------------------------------------
  // TIMEOUT DE INACTIVIDAD (tronco 1, JFC 2026-06-30): 30 min sin ningún click
  // ni tecla en toda la página cierran la sesión solos. Crítico porque el POS
  // corre en una tablet compartida de percha — el encargado del turno
  // siguiente no debe encontrarse la sesión del dueño abierta con acceso a
  // liquidaciones y claves. Se reinicia con CUALQUIER click o keydown en el
  // documento (no solo dentro de la app), mientras haya alguien logueado.
  // ---------------------------------------------------------------------------
  const INACTIVIDAD_MS = 30 * 60 * 1000;
  let temporizadorInactividad = null;
  function reiniciarInactividad() {
    clearTimeout(temporizadorInactividad);
    if (!rol) return;
    temporizadorInactividad = setTimeout(() => cerrarSesion("Session closed due to inactivity."), INACTIVIDAD_MS);
  }
  document.addEventListener("click", reiniciarInactividad);
  document.addEventListener("keydown", reiniciarInactividad);

  // Punto único de logout (manual o por inactividad) para que ambos caminos
  // limpien exactamente el mismo estado — antes solo existía inline dentro
  // del botón Salir, y un logout automático por inactividad habría tenido
  // que duplicar esa lógica (con el riesgo de que se desincronizaran).
  /* EL DEGRADAR SURTE EFECTO AUNQUE LA SESION YA ESTE ABIERTA
     (JFC 2026-08-21). Sin esto quedaba un hueco feo: el dueño degrada a
     alguien desde su celular, el cambio llega por sync al dispositivo de esa
     persona... y ahi sigue con la pantalla de admin abierta hasta que se le
     ocurra salir. Degradar a alguien que esta usando la app en ese momento es
     precisamente cuando mas urge que surta efecto.
     Se cierra la sesion en vez de recalcular permisos en caliente: media
     pantalla ya pintada con permisos viejos es justo donde se cuelan los
     bugs. Volver a entrar con su PIN toma dos segundos y deja el estado
     limpio. */
  try {
    window.addEventListener("oc-equipo-sync", function () {
      try {
        var yo = window.OCCurrentUser;
        if (!yo || !yo.id) return;                       // dueño/demo: no aplica
        if (rol !== "admin" && rol !== "empleado") return;
        fetch("/api/usuarios").then(function (r) { return r.json(); }).then(function (lista) {
          if (!Array.isArray(lista)) return;
          var ahora = lista.find(function (x) { return x.id === yo.id; });
          if (!ahora) return;                            // el merge nunca borra; si no esta, no se toca nada
          var rolAhora = ahora.rol === "admin" ? "admin" : "empleado";
          if (ahora.activo === false) { cerrarSesion("Your access was deactivated. Ask the owner."); return; }
          if (rolAhora !== rol) cerrarSesion("Your role changed. Sign in again with your PIN.");
        }).catch(function () {});
      } catch (_) {}
    });
  } catch (_) {}

  function cerrarSesion(mensaje) {
    clearTimeout(temporizadorInactividad);
    // 2026-08-19, aprobado JFC: al cerrar sesion del app owner tambien se
    // limpia la sesion del panel maestro. Antes, cerrar la app dejaba
    // panel.html abierto y logueado si estaba en otra pestana — riesgo si
    // alguien mas usa el dispositivo despues.
    try { sessionStorage.removeItem("panel_auth_f123"); } catch (_) {}
    try { sessionStorage.removeItem("f123_sesion"); } catch (_) {}
    rol = null;
    demoSesion = false;
    window.OCCurrentUser = null; // borrar sesion de encargado nombrado
    document.body.classList.remove("rol-empleado", "rol-dueno", "rol-demo", "rol-contador", "rol-admin");
    nuevoTeclado();
    gate.style.display = "flex";
    document.body.style.overflow = "hidden"; // candado visible: el fondo no se mueve
    $("oc-msg").style.color = mensaje ? "var(--rojo,#a3392a)" : "";
    $("oc-msg").textContent = mensaje || "";
    const b = document.getElementById("oc-logout");
    if (b) b.remove();
    // Fix 2026-07-08: el chip con el nombre del encargado quedaba pegado tras
    // salir y en la sesión siguiente mostraba al operador equivocado. Se retira.
    const chipViejo = document.getElementById("oc-user-chip");
    if (chipViejo) chipViejo.remove();
    window.dispatchEvent(new CustomEvent("oc-logout"));
  }

  $("oc-borrar").addEventListener("click", () => { $("oc-msg").textContent = ""; if (teclado) teclado.reset(); });
  $("oc-recuperar").addEventListener("click", () => abrirFlujoReset());
  $("oc-unirse-equipo").addEventListener("click", () => abrirUnirseEquipo());
  nuevoTeclado();

  // Banner manual de "Actualizar app" QUITADO (JFC 2026-07-16): "no tiene el
  // menor sentido — YO mantengo la app actualizada (2 años de soporte), y si
  // es el cache del usuario, para eso estan los meta tags y otros metodos de
  // refresh ya puestos". Ademas tenia un bug real: APP_VERSION vivia
  // hardcodeada aqui y nunca se sincronizaba con version.json, asi que el
  // banner salia SIEMPRE, en cada visita, sin que hubiera update real.
  // version.json se deja intacto (lo usan el cache-busting / SW), pero nada
  // en esta pantalla lo lee ni lo muestra. NO reintroducir sin que JFC lo pida.

  // ---------------------------------------------------------------------------
  // "Olvide mi clave" (JFC, 2026-07-02): envia el PIN del dueno a su correo
  // registrado via EmailJS (email-recovery.js). El PIN se guarda ofuscado
  // (XOR+base64 en oc_secure.ownerPinR) -- legible para enviar, opaco en
  // localStorage. Sin correo o sin PIN recuperable, muestra instruccion clara.
  // Sin modales, sin pasos: solo el mensaje en pantalla.
  // ---------------------------------------------------------------------------
  // Unirme a mi equipo (homologado de AMIGABLE, 2026-07-23): flujo liviano
  // para dispositivos de encargados/admins — solo pide el codigo de sala del
  // negocio, no activa modo dueno ni toca f123_owned. Una vez, para siempre.
  /* =====================================================================
     BLINDAJE DE MODALES .oc-subgate  (homologado de AMIGABLE, 2026-07-28)
     Corrige 4 fallas que dejaban al usuario tirado:
       1. Sin guard anti-doble-apertura: dos taps (comun en movil, donde el
          primero a veces no da feedback) apilaban dos modales identicos y
          cerrar el de arriba dejaba un clon fantasma.
       2. setTimeout(cont.remove) diferidos seguian vivos tras cerrar y podian
          borrar un modal NUEVO abierto despues.
       3. Sin Escape: sin salida por teclado si el boton Cancelar quedaba
          fuera de viewport en pantallas cortas.
       4. Sin click-en-el-fondo, el primer gesto que prueba todo usuario.

     Uso obligatorio para CUALQUIER modal nuevo:
       var cont = _ocSubgate("id-unico");
       if (!cont) return;
       ... cont.innerHTML = ...; document.body.appendChild(cont);
       boton.addEventListener("click", function(){ cont.cerrar() });
       cont.luego(fn, ms);            // en vez de setTimeout
     NO usar cont.remove() directo: salta la limpieza de timers y listeners.

     opts.alCerrar: red de seguridad para modales que envuelven una Promise.
     Garantiza que la Promise SIEMPRE se salda, se cierre por donde se cierre.
     opts.obligatorio: desactiva Escape y click-afuera (candados a proposito).
     ===================================================================== */
  function _ocSubgate(id, opts) {
    opts = opts || {};
    if (id && document.getElementById(id)) return null;   // guard anti-doble
    var cont = document.createElement("div");
    cont.className = "oc-subgate";
    if (id) cont.id = id;
    var timers = [];
    var cerrado = false;
    function cerrar() {
      if (cerrado) return;                                 // idempotente
      cerrado = true;
      for (var i = 0; i < timers.length; i++) { try { clearTimeout(timers[i]); } catch (_) {} }
      timers.length = 0;
      try { document.removeEventListener("keydown", onKey, true); } catch (_) {}
      try { cont.remove(); } catch (_) {}
      if (typeof opts.alCerrar === "function") { try { opts.alCerrar(); } catch (_) {} }
    }
    function onKey(e) {
      if (e.key === "Escape" || e.key === "Esc") { try { e.stopPropagation(); } catch (_) {} cerrar(); }
    }
    if (!opts.obligatorio) {
      document.addEventListener("keydown", onKey, true);
      // Solo el fondo cierra; un click dentro de la .caja no debe descartar
      // lo que el usuario esta escribiendo.
      cont.addEventListener("click", function (e) { if (e.target === cont) cerrar(); });
    }
    cont.cerrar = cerrar;
    cont.luego = function (fn, ms) {
      var t = setTimeout(function () { if (!cerrado) { try { fn(); } catch (_) {} } }, ms);
      timers.push(t);
      return t;
    };
    return cont;
  }

  /* Ojito ver / no ver en inputs de password. Arranca SIEMPRE oculto: mirar
     por encima del hombro es el escenario real en un mostrador. Boton 44x44
     (minimo tactil) y tabindex=-1 para no estorbar el llenado con teclado.
     Los rotulos salen de i18n (EN por defecto), no hardcodeados. */
  function _ocPonerOjitos(cont) {
    try {
      var inputs = cont.querySelectorAll('input[type="password"]');
      for (var i = 0; i < inputs.length; i++) {
        (function (inp) {
          if (inp.dataset.ocOjito) return;
          inp.dataset.ocOjito = "1";
          var wrap = document.createElement("div");
          wrap.style.cssText = "position:relative;display:block;";
          inp.parentNode.insertBefore(wrap, inp);
          wrap.appendChild(inp);
          inp.style.paddingRight = "52px";
          var b = document.createElement("button");
          b.type = "button";
          b.tabIndex = -1;
          b.style.cssText = "position:absolute;right:2px;top:50%;transform:translateY(-50%);"
            + "margin-top:-5px;width:48px;height:44px;display:flex;align-items:center;"
            + "justify-content:center;background:none;border:none;cursor:pointer;padding:0;"
            + "font-size:13px;font-weight:700;color:#2c4a68 !important;"
            + "-webkit-text-fill-color:#2c4a68 !important;";
          function tt(k, fb) { try { return (window.t ? window.t(k) : fb) || fb; } catch (_) { return fb; } }
          function pintar() {
            var oculto = inp.type === "password";
            b.textContent = oculto ? tt("auth.pw.show", "SHOW") : tt("auth.pw.hide", "HIDE");
            b.setAttribute("aria-label", b.textContent);
          }
          b.addEventListener("click", function () {
            inp.type = (inp.type === "password") ? "text" : "password";
            pintar();
            try { inp.focus(); } catch (_) {}
          });
          pintar();
          wrap.appendChild(b);
        })(inputs[i]);
      }
    } catch (_) { /* si falla, el input sigue funcionando tal cual */ }
  }

  /* Mascara del codigo de sala. DIFERENCIA CON AMIGABLE: aqui el formato es
     F123-XXXX-XXXX (2 grupos de 4 = 8 significativos), no AMG-XXXX-XXXX-XXXX.
     Ver generarCodigoSync(). Importa porque este codigo ES la sala de sync y
     activar() solo exige una longitud minima: un codigo mal tecleado NO da
     error, mete al equipo en una sala vacia y la desincronizacion es silenciosa.
     El cursor va al final a proposito: es un campo que se llena de una pasada. */
  function _ocMascaraCodigo(inp) {
    if (!inp || inp.dataset.ocMask) return;
    inp.dataset.ocMask = "1";
    inp.setAttribute("autocapitalize", "characters");
    inp.setAttribute("autocorrect", "off");
    inp.setAttribute("spellcheck", "false");
    /* 25 = prefijo + 4 grupos + el simbolo de verificacion de Crockford, que
       puede ser * ~ $ = o U. Con 14 la mascara truncaba el codigo nuevo y el
       dueno no podia teclear su propia licencia. */
    inp.setAttribute("maxlength", "25");        // F123- + 4 + 1 + 4 = 14
    /* UN SOLO CODIGO: LA LICENCIA (JFC 2026-08-21). Antes el campo de equipo
       se pintaba "TEAM-" y el de licencia "F123-", como si fueran dos cosas
       distintas que hubiera que conseguir por separado. Nunca lo fueron: es el
       mismo valor. Se sigue ACEPTANDO al teclear quien tenga TEAM- anotado en
       un papel (ver formatear() abajo), pero ya no se pinta asi en ningun
       campo. */
    var PRE = inp.dataset.ocPrefijo || "F123";
    function formatear(raw) {
      /* Alfabeto EXACTO de la licencia: Crockford base32 (0-9 A-Z SIN I,L,O,U)
         + los simbolos de verificacion. Filtrar al alfabeto real (y no solo
         [A-Z0-9]) evita que texto que NO es licencia —"pizza con piña"— se
         disfrace de F123-... : las letras I,L,O,U jamas aparecen en una licencia
         de verdad, asi que quitarlas es 100% seguro para licencias legitimas y
         hace obvio que la basura no es un codigo. (JFC 2026-08-26, QA Paco) */
      /* Sustituciones Crockford ANTES de filtrar (JFC 2026-08-27, refuerzo P0).
         Antes se ELIMINABAN I/L/O/U del alfabeto: si el dueño pegaba una
         licencia con "I" o "O" ambiguas (muy común al copiar de un papel o de
         una captura), la máscara las borraba y la licencia salía rota. Crockford
         define I/L→1 y O→0: convertirlas (no borrarlas) hace que el mismo código
         tecleado de dos formas caiga en la MISMA sala. Consistente con
         _ocNormalizar() y con normalizarCodigo() en sync-realtime.js. */
      var v = String(raw || "").toUpperCase().replace(/[IL]/g, "1").replace(/O/g, "0")
        .replace(/[^0-9ABCDEFGHJKMNPQRSTVWXYZ*~$=]/g, "");
      /* Quita TODAS las repeticiones del prefijo al inicio, no solo una
         (JFC 2026-08-25). Al pegar "F123-..." en un campo que ya mostraba
         "F123-", quedaba "F123F123..." y con un solo strip sobrevivia un
         "F123" de mas -> el codigo salia con "F123-F123-...". Ahora se pela
         cuantas veces haga falta, y tambien "TEAM" (papeles viejos). */
      var cambio = true;
      while (cambio) {
        cambio = false;
        if (v.indexOf("TEAM") === 0) { v = v.slice(4); cambio = true; }
        else if (v.indexOf(PRE) === 0) { v = v.slice(PRE.length); cambio = true; }
      }
      v = v.slice(0, 17);
      /* Sin cuerpo, no se pinta un "F123-" solo colgando (JFC 2026-08-26): un
         campo vacío o con basura que quedó en nada se muestra vacío, no como si
         ya hubiera media licencia. El focus vuelve a poner el prefijo guía. */
      if (!v) return "";
      /* La forma tiene que ser la MISMA que genera generarCodigoSync():
         4-4-4-5, donde el ultimo grupo son 4 del cuerpo + el simbolo de
         verificacion de Crockford. Agrupar de 4 en 4 a secas dejaba el codigo
         completo como ...-P3W1-D, con una letra suelta al final, que no se
         parece a lo que el dueno tiene anotado. */
      var out = PRE, i = 0;
      while (i < v.length) {
        var corte = (i === 12) ? 5 : 4;          // el 4o grupo lleva 5
        out += "-" + v.slice(i, i + corte);
        i += corte;
      }
      return out;
    }
    function alEscribir() {
      var antes = inp.value;
      var despues = formatear(antes);
      if (antes !== despues) {
        inp.value = despues;
        try { inp.setSelectionRange(despues.length, despues.length); } catch (_) {}
      }
    }
    inp.addEventListener("input", alEscribir);
    /* PEGAR REEMPLAZA (best practice para campos de codigo/OTP, JFC 2026-08-25).
       Se toma el texto del portapapeles, se formatea SOLO ese texto y se pone
       como valor completo — sin importar lo que hubiera antes en el campo (por
       ej. el "F123-" que pinta el focus). Asi pegar tu licencia completa nunca
       duplica el prefijo ni los guiones. Con preventDefault evitamos que el
       navegador inserte el texto crudo antes de formatear. */
    inp.addEventListener("paste", function (e) {
      try {
        var cb = (e.clipboardData || window.clipboardData);
        if (!cb) { setTimeout(alEscribir, 0); return; }
        e.preventDefault();
        var pegado = cb.getData("text");
        inp.value = formatear(pegado);
        try { inp.setSelectionRange(inp.value.length, inp.value.length); } catch (_) {}
        try { inp.dispatchEvent(new Event("input", { bubbles: true })); } catch (_) {}
      } catch (_) { setTimeout(alEscribir, 0); }
    });
    inp.addEventListener("focus", function () {
      if (!inp.value) { inp.value = PRE + "-"; try { inp.setSelectionRange(PRE.length + 1, PRE.length + 1); } catch (_) {} }
    });
    inp.addEventListener("blur", function () {
      if (inp.value === PRE + "-" || inp.value === PRE) inp.value = "";
    });
  }

  function abrirUnirseEquipo() {
    const cont = _ocSubgate("oc-ue-modal");
    if (!cont) return;
    cont.innerHTML = `<div class="caja" style="background:var(--blanco-calido,#fbf5e8);border:2px solid var(--brass,#9c7a35);border-radius:8px;padding:26px 22px;max-width:420px;width:100%;text-align:center;">
      <h2 style="font-family:var(--font-display,sans-serif);color:var(--ink,#211c14);font-size:22px;margin:0 0 4px;">${window.t("auth.join.title")}</h2>
      <p style="font-size:14px;color:var(--ink-soft,#5d5340);margin:0 0 14px;">${window.t("auth.join.body")}</p>
      <input id="oc-ue-codigo" type="text" placeholder="${window.t("auth.join.placeholder")}" style="width:100%;box-sizing:border-box;padding:11px 12px;border:2px solid var(--azul-medio,#2c4a68);border-radius:8px;font-size:16px;font-family:var(--font-mono,monospace);text-align:center;text-transform:uppercase;margin-bottom:10px;">
      <button id="oc-ue-confirmar" style="width:100%;min-height:48px;padding:14px;border-radius:9px;border:2px solid var(--rust,#b2461f);background:var(--rust,#b2461f);color:#fff;font-size:16px;font-weight:700;cursor:pointer;">${window.t("auth.join.confirm")}</button>
      <button id="oc-ue-cancelar" style="width:100%;min-height:44px;margin-top:10px;padding:11px;border-radius:9px;border:2px solid var(--azul-medio,#2c4a68);background:transparent;color:var(--azul-medio,#2c4a68);font-size:15px;font-weight:700;cursor:pointer;">${window.t("auth.join.cancel")}</button>
      <p id="oc-ue-msg" style="min-height:20px;font-size:14px;font-weight:700;color:var(--rojo,#a3392a);margin-top:12px;"></p>
    </div>`;
    document.body.appendChild(cont);
    _ocMascaraCodigo(cont.querySelector("#oc-ue-codigo"));
    /* CONFIRMACIÓN DE A QUÉ EQUIPO TE UNES (JFC 2026-08-26): uno debe SABER a
       dónde se une. Mientras teclea, se confirma la cola de la licencia; tras
       unirte, el candado ya muestra el nombre de la tienda. Best practice. */
    (function () {
      const _cod = cont.querySelector("#oc-ue-codigo");
      const _hint = document.createElement("p");
      _hint.id = "oc-ue-hint";
      _hint.style.cssText = "min-height:16px;font-size:13px;font-weight:700;color:var(--azul-medio,#2c4a68);margin:0 0 6px;";
      _cod.insertAdjacentElement("afterend", _hint);
      _cod.addEventListener("input", function () {
        const cuerpo = String(_cod.value || "").toUpperCase().replace(/[^0-9ABCDEFGHJKMNPQRSTVWXYZ*~$=]/g, "").replace(/^F123/, "");
        _hint.textContent = (cuerpo.length >= 8) ? ("Joining team · …" + cuerpo.slice(-6)) : "";
      });
    })();
    const msgEl = cont.querySelector("#oc-ue-msg");
    cont.querySelector("#oc-ue-cancelar").addEventListener("click", () => cont.cerrar());
    cont.querySelector("#oc-ue-confirmar").addEventListener("click", (ev) => {
      const btn = ev.currentTarget;
      if (btn.disabled) return;
      btn.disabled = true; setTimeout(() => { btn.disabled = false; }, 1200);
      const codigo = cont.querySelector("#oc-ue-codigo").value.trim();
      if (!window.OCSyncControl) { msgEl.textContent = window.t("auth.join.unavailable"); return; }
      const r = window.OCSyncControl.unirse(codigo);
      if (!r.ok) { msgEl.style.color = "var(--rojo,#a3392a)"; msgEl.textContent = r.error; return; }
      /* Caso "misma tienda": ok:true pero con mensaje de re-sync — se muestra en
         azul (informativo), no en verde de éxito, y se deja el diálogo abierto un
         poco más para que se lea. */
      if (r.mismo) { msgEl.style.color = "var(--azul-medio,#2c4a68)"; msgEl.textContent = r.error; cont.luego(() => cont.cerrar(), 2600); return; }
      msgEl.style.color = "var(--verde-suave,#2f7a4f)";
      msgEl.textContent = window.t("auth.join.success");
      cont.luego(() => cont.cerrar(), 1800);
    });
  }

  async function abrirFlujoReset() {
    await listo;
    const email = window.OCSecure.leerCorreo();
    const pin = window.OCSecure.recuperarPinDueno();
    const msgEl = $("oc-msg");

    if (!email) {
      msgEl.style.color = "var(--ink-soft,#5d5340)";
      msgEl.textContent = window.t("auth.gate.noEmailConfigured");
      return;
    }
    if (!pin) {
      msgEl.style.color = "var(--ink-soft,#5d5340)";
      msgEl.textContent = window.t("auth.gate.changePinToEnableRecovery");
      return;
    }

    msgEl.style.color = "var(--ink-soft,#5d5340)";
    msgEl.textContent = window.t("auth.gate.sending");
    // Bug fix (2026-07-21): pasar instanceId para que el Worker pueda validar
    // la instancia en KV (anti-abuso leve en /recover-pin).
    var _f123owned = JSON.parse(localStorage.getItem("f123_owned") || "null") || {};
    const resultado = window.OCEmailRecovery
      ? await window.OCEmailRecovery.enviarCodigo(email, pin, _f123owned.instanceId || "")
      : { enviado: false, codigo: pin };
    if (resultado.enviado) {
      msgEl.style.color = "var(--verde-suave,#2f7a4f)";
      msgEl.textContent = window.tf("auth.gate.pinSentTo", {email: enmascarar(email)});
    } else {
      // Respaldo: EmailJS no configurado o sin internet -- muestra el PIN en pantalla
      msgEl.style.color = "var(--ink,#211c14)";
      msgEl.textContent = window.tf("auth.gate.yourOwnerPin", {code: resultado.codigo});
    }
  }

  // ---------- Logout en el header ----------
  function montarLogout() {
    if (document.getElementById("oc-logout")) return;
    const header = document.querySelector("header");
    if (!header) return;
    // Defensa: retirar cualquier chip previo antes de decidir si va uno nuevo,
    // así nunca quedan dos ni uno con el nombre del operador anterior.
    const chipPrevio = document.getElementById("oc-user-chip");
    if (chipPrevio) chipPrevio.remove();
    const rolChipPrevio = document.getElementById("oc-rol-chip");
    if (rolChipPrevio) rolChipPrevio.remove();
    const b = document.createElement("button");
    b.id = "oc-logout"; b.textContent = window.t("auth.gate.logout");
    b.addEventListener("click", () => cerrarSesion());
    // Si hay un encargado nombrado activo, mostrar su nombre junto al boton Salir
    // para que siempre sea claro quien esta operando el sistema.
    if (window.OCCurrentUser && window.OCCurrentUser.nombre) {
      const chip = document.createElement("span");
      chip.id = "oc-user-chip";
      chip.textContent = window.OCCurrentUser.nombre;
      chip.style.cssText = "font-size:13px;font-weight:700;color:var(--ink,#211c14) !important;"
        + "-webkit-text-fill-color:var(--ink,#211c14) !important;margin-right:6px;"
        + "padding:4px 10px;background:var(--amarillo-claro,#fff3c4);border-radius:20px;";
      header.appendChild(chip);
    }
    // Chip naranja de rol (homologado de AMIGABLE, JFC 2026-07-29: "no tiene
    // el indicador naranja de si el usuario es owner o employee"). Se muestra
    // SIEMPRE, incluso en sesion demo (456) — el usuario pidió que la pill
    // naranja no desaparezca: con 456 debe decir "demo" (JFC 2026-08-27).
    const _rolChipKey = demoSesion
      ? "auth.roleChip.demo"
      : ({ dueno: "auth.roleChip.owner", admin: "auth.roleChip.admin", empleado: "auth.roleChip.employee", contador: "auth.roleChip.accountant" }[rol]);
    if (_rolChipKey) {
      const rc = document.createElement("span");
      rc.id = "oc-rol-chip";
      rc.textContent = window.t(_rolChipKey);
      rc.style.cssText = "font-size:13px;font-weight:700;color:#fff !important;-webkit-text-fill-color:#fff !important;"
        + "margin-right:6px;padding:4px 10px;background:var(--rust,#E86040);border-radius:20px;";
      header.appendChild(rc);
    }
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
    generarCodigo: generarCodigoSync,
    /* La caja que se formatea sola: mayusculas y guiones puestos al escribir o
       al pegar. JFC, 2026-08-19: "es penoso tener que poner las - manualmente o
       las mayusculas manualmente". Se exporta para que TODOS los campos de
       codigo de la app usen la MISMA, en vez de cada pantalla la suya. */
    mascaraCodigo: _ocMascaraCodigo,
    heartbeat: enviarHeartbeat,
    rolActual: () => rol,
    /* JERARQUIA: dueño > admin > encargado (JFC 2026-08-21).
       El admin habia quedado como un encargado con otra insignia: no podia
       crear productos ni perchas, que es justo el trabajo del dia. Debe poder
       hacer TODO lo operativo, y quedarse afuera solo de lo que es del dueño:
       licencia y activacion, correo de recuperacion, promover/degradar, borrar
       miembros del equipo, los porcentajes de los tratos y borrar el negocio.
       Regla para el futuro: si lo que se decide es de OPERACION (inventario,
       ventas, clientes, perchas), va con puedeGestionar(). Si define QUIEN
       manda o cuanta plata se reparte, va con rolActual() === "dueno". */
    puedeGestionar: () => rol === "dueno" || rol === "admin",
    esDemo: () => demoSesion,
    enmascarar,
    listo: () => listo,
    abrirFlujoReset,
    // Expuesto para avanzado-extra.js (registro de WhatsApp, Mejora #5,
    // 2026-07-16): reusa la misma resolucion de URL que enviarHeartbeat
    // (override en localStorage si existe, si no el endpoint ofuscado por
    // defecto) — sin duplicar el string. NO usar esto para guardar datos del
    // negocio en el worker — ver nota "NO CLOUD" al inicio de worker.js.
    workerUrl: () => (localStorage.getItem("f123_cf_worker_url") || "").trim() || OC_WORKER_URL,
    // Pide la subclave contable con su propio teclado (emojis barajados, casillas enmascaradas).
    pedirSubclaveContable() {
      return new Promise((resolve) => {
        // alCerrar garantiza que la Promise se salda por cualquier via de cierre
        // (boton, Escape, click-afuera o guard). Sin esto, un cierre imprevisto
        // dejaba al llamador esperando para siempre y la pantalla muerta.
        const cont = _ocSubgate("oc-sc-modal", { alCerrar: () => resolve(false) });
        if (!cont) { resolve(false); return; }
        cont.innerHTML = `<div class="caja" style="background:var(--blanco-calido,#fbf5e8);border:2px solid var(--brass,#9c7a35);border-radius:8px;padding:26px 22px;max-width:420px;width:100%;text-align:center;">
          <h2 style="font-family:var(--font-display,sans-serif);color:var(--ink,#211c14);font-size:22px;margin:0 0 4px;">${window.t("auth.gate.accountingLayer")}</h2>
          <div class="sub" style="font-size:14px;color:var(--ink-soft,#5d5340);margin-bottom:18px;">${window.t("auth.gate.accountingSubtitle")}</div>
          <div class="oc-slots" id="oc-slots2"><div class="slot"></div><div class="slot"></div><div class="slot"></div></div>
          <div class="oc-pad" id="oc-pad2"></div>
          <div class="oc-acciones"><button id="sc-cancelar">${window.t("auth.gate.cancel")}</button><button id="sc-borrar">${window.t("auth.gate.clear")}</button></div>
          <div class="oc-msg" id="oc-msg2"></div></div>`;
        document.body.appendChild(cont);
        let tec;
        async function alCompletar(code) {
          if (await window.OCSecure.verificarAcct(code)) { resolve(true); cont.cerrar(); }
          else {
            cont.querySelector("#oc-msg2").textContent = window.t("auth.gate.wrongSubPin");
            cont.classList.add("err"); setTimeout(() => cont.classList.remove("err"), 400);
            tec = montarTeclado(cont.querySelector("#oc-pad2"), cont.querySelector("#oc-slots2"), alCompletar); // re-baraja
          }
        }
        tec = montarTeclado(cont.querySelector("#oc-pad2"), cont.querySelector("#oc-slots2"), alCompletar);
        cont.querySelector("#sc-borrar").addEventListener("click", () => tec.reset());
        cont.querySelector("#sc-cancelar").addEventListener("click", () => cont.cerrar());
      });
    },
  };

  /* AUTO-LOGIN TRAS RELOAD (JFC 2026-08-28). Si había sesión activa guardada
     en sessionStorage (ver entrar/cerrarSesion), se restaura al arrancar para
     que el reload forzado de versión NO pase por el candado: se oculta el gate
     INMEDIATAMENTE (sin esperar la migración de claves) y luego se entra. Así
     el refresh forzado aterriza directo en la UI interna, sin flash del candado. */
  (async function () {
    try {
      let ses = null;
      try { ses = JSON.parse(sessionStorage.getItem("f123_sesion") || "null"); } catch (_) {}
      if (ses && ses.rol) {
        // Ocultar el candado YA, antes de esperar listo, para que no haya flash.
        try { gate.style.display = "none"; document.body.style.overflow = ""; } catch (_) {}
        await listo;
        entrar(ses.rol);
      }
    } catch (_) {}
  })();
})();
