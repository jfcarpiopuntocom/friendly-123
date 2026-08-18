/*!
 * plan-pagos-ui.js — friendly-123 · Interfaz de cuotas y abonos
 * ============================================================================
 * Fase B del plan (PLAN-cuotas-2026-08-13.md). El motor esta en plan-pagos.js
 * y este archivo NO calcula nada de dinero: solo pinta lo que el motor deriva.
 * Si algo de aca se borra, ningun saldo ni ninguna cuota se pierde.
 *
 * DONDE VIVE CADA COSA, Y POR QUE (decidido con las reglas de arquitectura de
 * informacion de NN/g, no por gusto):
 *
 *   LA ALERTA va en Hoy. Un contador de cuotas atrasadas en el tablero que el
 *   dueno abre cada manana. Responde el trabajo diario, "a quien llamo hoy",
 *   sin costar un boton de menu. Esconderlo seria "el split equivocado": un
 *   plan de pagos NO es una funcion poco usada.
 *
 *   LA GESTION va dentro de Clientes, con un filtro. No hay boton nuevo en el
 *   menu: cada enlace de navegacion que se agrega empeora las decisiones de
 *   todos los demas, y un plan de pagos ES una cuenta por cobrar con
 *   calendario, no una seccion aparte.
 *
 * COPY (research de cobranza, 2026-08-13): el aviso se encuadra como un olvido,
 * nunca como una falta. "No ha llegado la cuota", jamas "usted no pago". Y los
 * recordatorios se espacian; esta UI no repite nada a diario.
 *
 * NARANJA, NO ROJO: el rojo tiene significado en el semaforo Simon, es
 * emergencia de stock. Un cliente atrasado es "urgente, pronto", que en el
 * lenguaje de esta app es naranja. NO cambiar a rojo.
 * ============================================================================
 */
(function (global) {
  "use strict";

  var COLORES = {
    al_dia:     { bg: "#00C87A", txt: "on track" },
    adelantado: { bg: "#00C87A", txt: "ahead" },
    atrasado:   { bg: "#E86040", txt: "behind" },
    /* The plan is done: nothing is owed. No more payments get announced. */
    cumplido:   { bg: "#00C87A", txt: "paid off" }
  };

  var css = document.createElement("style");
  css.textContent = "" +
    "#pp-hoy{display:none;margin:0 0 14px;padding:14px 16px;border-radius:14px;background:#FFF1EC;border-left:5px solid #E86040;}" +
    "#pp-hoy.hay{display:block;}" +
    "#pp-hoy .t{font-size:17px;font-weight:800;color:#0F1923 !important;-webkit-text-fill-color:#0F1923 !important;margin:0 0 4px;}" +
    "#pp-hoy .s{font-size:15px;line-height:1.5;color:#2C3E50 !important;-webkit-text-fill-color:#2C3E50 !important;margin:0 0 10px;}" +
    "#pp-hoy button{min-height:44px;padding:10px 18px;border:none;border-radius:10px;background:#E86040;" +
      "color:#FFFFFF !important;-webkit-text-fill-color:#FFFFFF !important;font-weight:800;font-size:15px;cursor:pointer;}" +
    ".pp-chip{display:inline-block;font-size:14px;font-weight:700;padding:6px 12px;border-radius:8px;" +
      "color:#FFFFFF !important;-webkit-text-fill-color:#FFFFFF !important;}" +
    ".pp-prox{display:block;font-size:14px;color:#2C3E50 !important;-webkit-text-fill-color:#2C3E50 !important;margin-top:6px;}" +
    "#pp-filtro{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 14px;}" +
    "#pp-filtro button{min-height:44px;padding:10px 16px;border:2px solid #E2E8ED;border-radius:10px;background:#FFFFFF;" +
      "font-size:14px;font-weight:700;color:#2C3E50 !important;-webkit-text-fill-color:#2C3E50 !important;cursor:pointer;}" +
    "#pp-filtro button.on{background:#0F1923;border-color:#0F1923;color:#FFFFFF !important;-webkit-text-fill-color:#FFFFFF !important;}" +
    ".pp-modal{position:fixed;inset:0;z-index:9998;background:rgba(15,25,35,.82);display:flex;align-items:center;" +
      "justify-content:center;padding:20px;overflow-y:auto;}" +
    ".pp-caja{background:#FFFFFF;border-radius:16px;padding:24px 20px;max-width:440px;width:100%;margin:auto;}" +
    ".pp-caja h3{font-size:20px;font-weight:800;color:#0F1923 !important;-webkit-text-fill-color:#0F1923 !important;margin:0 0 14px;}" +
    ".pp-fg{margin-bottom:14px;}" +
    ".pp-fg label{display:block;font-size:14px;font-weight:700;color:#0F1923 !important;-webkit-text-fill-color:#0F1923 !important;margin-bottom:6px;}" +
    ".pp-fg input,.pp-fg select{width:100%;min-height:44px;padding:10px 12px;border:2px solid #E2E8ED;border-radius:10px;" +
      "font-size:16px;background:#FFFFFF;color:#0F1923 !important;-webkit-text-fill-color:#0F1923 !important;}" +
    ".pp-check{display:flex;align-items:center;gap:10px;min-height:44px;font-size:16px;font-weight:700;" +
      "color:#0F1923 !important;-webkit-text-fill-color:#0F1923 !important;cursor:pointer;}" +
    ".pp-check input{width:22px;height:22px;}" +
    ".pp-resumen{font-size:15px;line-height:1.5;color:#0F1923 !important;-webkit-text-fill-color:#0F1923 !important;" +
      "background:#F8F9FB;border-left:4px solid #00C87A;border-radius:0 8px 8px 0;padding:12px 14px;margin:0 0 14px;}" +
    ".pp-btn{width:100%;min-height:48px;padding:12px;border:none;border-radius:12px;background:#E86040;" +
      "color:#FFFFFF !important;-webkit-text-fill-color:#FFFFFF !important;font-weight:800;font-size:16px;cursor:pointer;}" +
    ".pp-btn.gris{background:#FFFFFF;border:2px solid #E2E8ED;color:#2C3E50 !important;-webkit-text-fill-color:#2C3E50 !important;margin-top:10px;}" +
    ".pp-msg{font-size:15px;font-weight:700;margin:10px 0 0;}" +
    ".pp-anular{display:block;margin-top:8px;min-height:44px;padding:8px 14px;border:2px solid #E2E8ED;" +
      "border-radius:10px;background:#FFFFFF;font-size:14px;font-weight:700;" +
      "color:#2C3E50 !important;-webkit-text-fill-color:#2C3E50 !important;cursor:pointer;}";
  document.head.appendChild(css);

  /* Formateador PLANO, a proposito. El fmtMoney() de index.html devuelve un
     <span> con markup, y este modulo pinta con textContent: usarlo mostraria
     la etiqueta cruda en pantalla. */
  function fmt(n) {
    return "$" + (Number(n) || 0).toFixed(2);
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  /* API es un const en el scope de index.html, invisible desde aca. Se replica
     la unica constante que hace falta en vez de exportarla y arriesgar que
     alguien la reasigne desde fuera. */
  var API = "/api";

  function esDueno() {
    try {
      var r = global.OCAuth && global.OCAuth.rolActual && global.OCAuth.rolActual();
      return r === "dueno" || r === "admin";
    } catch (_) { return false; }
  }

  // ---------------------------------------------------------------------------
  // B1 y B4 · el chip del cliente dice el estado, y la proxima cuota en palabras
  // ---------------------------------------------------------------------------
  /* Se engancha DESPUES de pintarSaldoCartera (index.html) en vez de
     reemplazarla: si este archivo no carga, el saldo se sigue viendo igual. */
  function adornar(clienteId) {
    var el = document.getElementById("cartera-" + clienteId);
    if (!el || !global.AMG || !global.AMG.PlanPagos) return;
    // La casilla de avisarme manda: si esta apagada, no se anuncia nada.
    var avisar = true;
    try { avisar = global.AMG.Cartera ? global.AMG.Cartera.alertaActiva(clienteId) : true; } catch (_) {}
    global.AMG.PlanPagos.estadoDelPlan(clienteId).then(function (e) {
      if (!e.hayPlan) return;
      if (document.getElementById("pp-chip-" + clienteId)) return;
      var c = COLORES[e.estado] || COLORES.al_dia;
      var extra = e.diferencia < 0 ? " " + fmt(-e.diferencia) : (e.diferencia > 0 ? " " + fmt(e.diferencia) : "");
      var s = document.createElement("span");
      if (avisar || e.estado !== "atrasado") {
        s.id = "pp-chip-" + clienteId;
        s.className = "pp-chip";
        s.style.background = c.bg;
        s.style.marginLeft = "8px";
        s.textContent = c.txt + extra;
        el.appendChild(s);
      }
      if (e.proximoVencimiento) {
        var p = document.createElement("span");
        p.className = "pp-prox";
        p.textContent = "Next payment: " + fmt(e.montoCuota) + " on " +
          global.AMG.PlanPagos.fechaEnPalabras(e.proximoVencimiento);
        el.appendChild(p);
      }
      /* Cancel the agreement. Owner only, same as recording credit: an employee
         does not renegotiate. The engine does NOT delete the old plan, it emits
         plan_pago_anulado, so the history shows there was a renegotiation
         instead of hiding it. And the balance is untouched: cancelling an
         agreement does not forgive a debt. */
      if (esDueno()) {
        var b = document.createElement("button");
        b.className = "pp-anular";
        b.type = "button";
        b.textContent = "Change the plan";
        b.addEventListener("click", function () { modalAnular(clienteId); });
        el.appendChild(b);
      }
    }).catch(function () {});
  }

  var original = global.pintarSaldoCartera;
  if (typeof original === "function") {
    global.pintarSaldoCartera = function (clienteId) {
      var r = original.apply(this, arguments);
      Promise.resolve(r).then(function () { adornar(clienteId); }).catch(function () {});
      return r;
    };
  }

  // ---------------------------------------------------------------------------
  // B2 · acordar el plan en el mismo momento en que se fia
  // ---------------------------------------------------------------------------
  /* Reemplaza el prompt() del fiado por un modal de verdad. El plan se acuerda
     cuando se fia, en la vida real: ponerlo en otra pantalla garantiza que
     nadie lo use. */
  function modalFiar(clienteId, nombre) {
    if (document.getElementById("pp-modal-fiar")) return;
    var m = document.createElement("div");
    m.className = "pp-modal";
    m.id = "pp-modal-fiar";
    m.innerHTML =
      '<div class="pp-caja">' +
        '<h3>Record credit for ' + esc(nombre) + '</h3>' +
        '<div class="pp-fg"><label for="pp-monto">How much</label>' +
          '<input id="pp-monto" type="number" inputmode="decimal" min="0" step="0.01"></div>' +
        '<div class="pp-fg"><label for="pp-motivo">Reason (optional)</label>' +
          '<input id="pp-motivo" type="text" autocomplete="off"></div>' +
        '<label class="pp-check"><input type="checkbox" id="pp-conplan"> Set up a payment plan</label>' +
        '<div id="pp-campos" style="display:none;margin-top:12px;">' +
          '<div class="pp-fg"><label for="pp-cuotas">Number of payments</label>' +
            '<input id="pp-cuotas" type="number" inputmode="numeric" min="1" step="1" value="3"></div>' +
          '<div class="pp-fg"><label for="pp-frec">How often</label>' +
            '<select id="pp-frec"><option value="mensual">Monthly</option>' +
            '<option value="quincenal">Every two weeks</option>' +
            '<option value="semanal">Weekly</option></select></div>' +
          '<div class="pp-fg"><label for="pp-desde">First payment due</label>' +
            '<input id="pp-desde" type="date"></div>' +
          '<div class="pp-fg"><label for="pp-gracia">Start warning after how many days late</label>' +
            '<input id="pp-gracia" type="number" inputmode="numeric" min="0" step="1" value="0"></div>' +
          '<p class="pp-resumen" id="pp-resumen"></p>' +
        '</div>' +
        '<button type="button" class="pp-btn" id="pp-ok">Record</button>' +
        '<button type="button" class="pp-btn gris" id="pp-cancel">Cancel</button>' +
        '<p class="pp-msg" id="pp-msg"></p>' +
      '</div>';
    document.body.appendChild(m);

    var $ = function (id) { return m.querySelector("#" + id); };
    var hoy = new Date();
    $("pp-desde").value = new Date(hoy.getTime() - hoy.getTimezoneOffset() * 60000).toISOString().slice(0, 10);

    function cerrar() { try { m.remove(); } catch (_) {} document.removeEventListener("keydown", onKey, true); }
    function onKey(ev) { if (ev.key === "Escape" || ev.key === "Esc") { ev.stopPropagation(); cerrar(); } }
    document.addEventListener("keydown", onKey, true);
    m.addEventListener("click", function (ev) { if (ev.target === m) cerrar(); });
    $("pp-cancel").addEventListener("click", cerrar);

    function resumir() {
      var total = Number($("pp-monto").value) || 0;
      var n = Math.max(1, Math.floor(Number($("pp-cuotas").value) || 1));
      if (!(total > 0)) { $("pp-resumen").textContent = "Enter the amount first."; return; }
      var cuota = total / n;
      var cada = { mensual: "a month", quincenal: "every two weeks", semanal: "a week" }[$("pp-frec").value];
      $("pp-resumen").textContent = n + " payments of " + fmt(cuota) + " " + cada + ".";
    }
    ["pp-monto", "pp-cuotas", "pp-frec"].forEach(function (id) {
      $(id).addEventListener("input", resumir);
      $(id).addEventListener("change", resumir);
    });
    $("pp-conplan").addEventListener("change", function () {
      $("pp-campos").style.display = this.checked ? "block" : "none";
      if (this.checked) resumir();
    });

    $("pp-ok").addEventListener("click", function (ev) {
      var btn = ev.currentTarget;
      if (btn.disabled) return;
      btn.disabled = true;
      setTimeout(function () { btn.disabled = false; }, 1000);
      var msg = $("pp-msg");
      var monto = Number($("pp-monto").value);
      if (!(monto > 0)) { msg.style.color = "#B0183E"; msg.textContent = "The amount must be greater than zero."; return; }
      var conPlan = $("pp-conplan").checked;
      var motivo = $("pp-motivo").value || "";

      /* HUECO LUIS (2026-08-13): validar el plan ANTES de tocar el dinero.
         Antes se cobraba primero y se validaba despues, asi que un campo vacio
         dejaba el cargo hecho, un error tecnico en pantalla, y cada reintento
         volvia a fiar. Aca no se toca un centavo hasta que el plan cierre. */
      var nCuotas = 0, fechaPlan = null;
      if (conPlan) {
        nCuotas = Math.floor(Number($("pp-cuotas").value));
        if (!(nCuotas >= 1)) {
          msg.style.color = "#B0183E";
          msg.textContent = "Enter how many payments, at least one.";
          return;
        }
        fechaPlan = new Date(($("pp-desde").value || "") + "T00:00:00");
        if (isNaN(fechaPlan.getTime())) {
          msg.style.color = "#B0183E";
          msg.textContent = "Pick the date of the first payment.";
          return;
        }
      }

      /* El cargo va PRIMERO y el plan despues, a proposito: si el plan falla,
         la deuda igual quedo registrada. Al reves se perderia el dinero. */
      fetch(API + "/clientes/" + clienteId + "/fiar", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ monto: monto, motivo: motivo })
      }).then(function (r) { return r.json(); }).then(function (r) {
        if (r && r.error) throw new Error(r.error);
        if (!conPlan) return null;
        return global.AMG.PlanPagos.crearPlan(clienteId, {
          montoTotal: monto,
          numCuotas: nCuotas,
          frecuencia: $("pp-frec").value,
          primerVencimiento: fechaPlan,
          avisarDesdeDias: Math.max(0, Number($("pp-gracia").value) || 0),
          motivo: motivo
        });
      }).then(function () {
        cerrar();
        if (global.pintarSaldoCartera) global.pintarSaldoCartera(clienteId);
        refrescarHoy();
      }).catch(function (e) {
        /* If we got here after the charge already went through, retrying would
           record the credit twice. Close the modal and tell the whole truth. */
        cerrar();
        if (global.pintarSaldoCartera) global.pintarSaldoCartera(clienteId);
        refrescarHoy();
        global.alert("The credit was recorded, but the payment plan could not be saved. " +
          "You can set it up later. (" + ((e && e.message) || "error") + ")");
      });
    });

    $("pp-monto").focus();
  }
  global.fiarCliente = modalFiar;

  /* Abonar tambien pasa a modal. Con prompt() no se puede mostrar cuanto debe
     ni cuanto falta para la cuota, que es justo lo que hace falta saber en el
     momento de recibir la plata. Y desentonaba con el modal de fiar. */
  function modalAbonar(clienteId, nombre) {
    if (document.getElementById("pp-modal-abono")) return;
    var m = document.createElement("div");
    m.className = "pp-modal";
    m.id = "pp-modal-abono";
    m.innerHTML =
      '<div class="pp-caja">' +
        '<h3>Record a payment</h3>' +
        '<p class="pp-resumen" id="pp-ab-ctx">Loading...</p>' +
        '<div class="pp-fg"><label for="pp-ab-monto">Payment amount</label>' +
          '<input id="pp-ab-monto" type="number" inputmode="decimal" min="0" step="0.01"></div>' +
        '<button type="button" class="pp-btn" id="pp-ab-ok">Record payment</button>' +
        '<button type="button" class="pp-btn gris" id="pp-ab-cancel">Cancel</button>' +
        '<p class="pp-msg" id="pp-ab-msg"></p>' +
      '</div>';
    document.body.appendChild(m);
    var q = function (id) { return m.querySelector("#" + id); };

    function cerrar() { try { m.remove(); } catch (_) {} document.removeEventListener("keydown", onKey, true); }
    function onKey(ev) { if (ev.key === "Escape" || ev.key === "Esc") { ev.stopPropagation(); cerrar(); } }
    document.addEventListener("keydown", onKey, true);
    m.addEventListener("click", function (ev) { if (ev.target === m) cerrar(); });
    q("pp-ab-cancel").addEventListener("click", cerrar);

    /* Contexto ANTES de escribir el monto: cuanto debe y, si hay plan, cuanto
       falta para ponerse al dia. Sugerir ese numero ahorra la cuenta mental. */
    fetch(API + "/clientes/" + clienteId + "/cartera")
      .then(function (r) { return r.json(); })
      .then(function (info) {
        var debe = info && info.saldo < 0 ? -info.saldo : 0;
        return global.AMG.PlanPagos.estadoDelPlan(clienteId).then(function (e) {
          var t = debe > 0 ? "Owes " + fmt(debe) + "." : "No outstanding balance.";
          if (e.hayPlan && e.diferencia < 0) {
            var falta = -e.diferencia;
            t += " " + fmt(falta) + " would bring them current.";
            q("pp-ab-monto").value = falta.toFixed(2);
          } else if (e.hayPlan) {
            t += " They are " + (e.diferencia > 0 ? "ahead of" : "on track with") + " their plan.";
          }
          q("pp-ab-ctx").textContent = t;
        });
      }).catch(function () { q("pp-ab-ctx").textContent = ""; });

    q("pp-ab-ok").addEventListener("click", function (ev) {
      var btn = ev.currentTarget;
      if (btn.disabled) return;
      btn.disabled = true;
      setTimeout(function () { btn.disabled = false; }, 1000);
      var msg = q("pp-ab-msg");
      var monto = Number(q("pp-ab-monto").value);
      if (!(monto > 0)) { msg.style.color = "#B0183E"; msg.textContent = "The amount must be greater than zero."; return; }
      fetch(API + "/clientes/" + clienteId + "/abonar", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ monto: monto, motivo: "Abono" })
      }).then(function (r) { return r.json(); }).then(function (r) {
        if (r && r.error) throw new Error(r.error);
        cerrar();
        if (global.pintarSaldoCartera) global.pintarSaldoCartera(clienteId);
        refrescarHoy();
      }).catch(function (e) {
        msg.style.color = "#B0183E";
        msg.textContent = (e && e.message) || "Could not record the payment.";
      });
    });

    q("pp-ab-monto").focus();
  }
  global.abonarCliente = modalAbonar;

  /* Cancel the installment agreement. Nothing is deleted and the balance is
     untouched: it emits a plan_pago_anulado fact, and from then on the engine
     stops seeing an active plan. If a new one is agreed later, it is created
     fresh and the history shows both. */
  function modalAnular(clienteId) {
    if (document.getElementById("pp-modal-anular")) return;
    var m = document.createElement("div");
    m.className = "pp-modal";
    m.id = "pp-modal-anular";
    m.innerHTML =
      '<div class="pp-caja">' +
        '<h3>Change the installment agreement</h3>' +
        '<p class="pp-resumen">The debt is NOT forgiven: the balance stays the same. What gets cancelled is the agreed schedule. You can set up new installments later from Record credit.</p>' +
        '<div class="pp-fg"><label for="pp-an-motivo">Why it is changing (optional)</label>' +
          '<input id="pp-an-motivo" type="text" autocomplete="off"></div>' +
        '<button type="button" class="pp-btn" id="pp-an-ok">Cancel the agreement</button>' +
        '<button type="button" class="pp-btn gris" id="pp-an-cancel">Leave it as is</button>' +
        '<p class="pp-msg" id="pp-an-msg"></p>' +
      '</div>';
    document.body.appendChild(m);
    function cerrar() { try { m.remove(); } catch (_) {} document.removeEventListener("keydown", onKey, true); }
    function onKey(ev) { if (ev.key === "Escape" || ev.key === "Esc") { ev.stopPropagation(); cerrar(); } }
    document.addEventListener("keydown", onKey, true);
    m.addEventListener("click", function (ev) { if (ev.target === m) cerrar(); });
    m.querySelector("#pp-an-cancel").addEventListener("click", cerrar);
    m.querySelector("#pp-an-ok").addEventListener("click", function (ev) {
      var btn = ev.currentTarget;
      if (btn.disabled) return;
      btn.disabled = true;
      global.AMG.PlanPagos.anularPlan(clienteId, m.querySelector("#pp-an-motivo").value || "")
        .then(function () {
          cerrar();
          var chip = document.getElementById("pp-chip-" + clienteId);
          if (chip) chip.remove();
          if (global.pintarSaldoCartera) global.pintarSaldoCartera(clienteId);
          refrescarHoy();
        })
        .catch(function (e) {
          btn.disabled = false;
          var msg = m.querySelector("#pp-an-msg");
          msg.style.color = "#B0183E";
          msg.textContent = (e && e.message) || "Could not cancel it.";
        });
    });
  }

  // ---------------------------------------------------------------------------
  // B3 · la alerta en Hoy, y el filtro en Clientes
  // ---------------------------------------------------------------------------
  function clientesConEstado() {
    if (!global.AMG || !global.AMG.PlanPagos) return Promise.resolve([]);
    return fetch(API + "/clientes").then(function (r) { return r.json(); }).then(function (d) {
      var lista = (d && d.clientes) || d || [];
      return Promise.all(lista.map(function (c) {
        return global.AMG.PlanPagos.estadoDelPlan(c.id).then(function (e) {
          return { id: c.id, nombre: c.nombre, estado: e };
        });
      }));
    }).catch(function () { return []; });
  }

  function refrescarHoy() {
    var caja = document.getElementById("pp-hoy");
    if (!caja) return;
    if (!esDueno()) { caja.classList.remove("hay"); return; }
    clientesConEstado().then(function (todos) {
      var atrasados = todos.filter(function (x) {
        if (!x.estado.hayPlan || x.estado.estado !== "atrasado") return false;
        // La casilla de avisarme manda tambien aca.
        try { return global.AMG.Cartera ? global.AMG.Cartera.alertaActiva(x.id) : true; } catch (_) { return true; }
      });
      if (!atrasados.length) { caja.classList.remove("hay"); caja.innerHTML = ""; return; }
      var total = atrasados.reduce(function (a, x) { return a + Math.abs(x.estado.diferencia); }, 0);
      var n = atrasados.length;
      caja.innerHTML =
        '<p class="t">' + n + (n === 1 ? " payment has not arrived" : " payments have not arrived") + '</p>' +
        '<p class="s">' + fmt(total) + ' in total, from ' + (n === 1 ? "one customer" : n + " customers") +
          ' on a payment plan.</p>' +
        '<button type="button" id="pp-ver">See who they are</button>';
      caja.classList.add("hay");
      caja.querySelector("#pp-ver").addEventListener("click", function () {
        var b = document.querySelector('nav button[data-vista="clientes"]');
        if (b) b.click();
        setTimeout(function () { aplicarFiltro("atrasados"); }, 400);
      });
    });
  }

  var filtroActual = "todos";
  function aplicarFiltro(cual) {
    filtroActual = cual;
    var barra = document.getElementById("pp-filtro");
    if (barra) {
      barra.querySelectorAll("button").forEach(function (b) {
        b.classList.toggle("on", b.dataset.f === cual);
      });
    }
    clientesConEstado().then(function (todos) {
      var mapa = {};
      todos.forEach(function (x) { mapa[x.id] = x.estado; });
      document.querySelectorAll('[id^="cartera-"]').forEach(function (el) {
        var id = el.id.replace("cartera-", "");
        var e = mapa[id] || { hayPlan: false };
        var mostrar = cual === "todos" ||
          (cual === "conplan" && e.hayPlan) ||
          (cual === "atrasados" && e.hayPlan && e.estado === "atrasado");
        // Se oculta la TARJETA entera, no solo el chip: filtrar a medias es peor
        // que no filtrar, porque deja al dueno contando tarjetas vacias.
        var card = el.closest(".cliente-card") || el.parentElement;
        if (card) card.style.display = mostrar ? "" : "none";
      });
    });
  }

  function montar() {
    var hoy = document.getElementById("vista-hoy");
    if (hoy && !document.getElementById("pp-hoy")) {
      var d = document.createElement("div");
      d.id = "pp-hoy";
      hoy.insertBefore(d, hoy.firstChild);
    }
    var cli = document.getElementById("vista-clientes");
    if (cli && !document.getElementById("pp-filtro") && esDueno()) {
      var f = document.createElement("div");
      f.id = "pp-filtro";
      f.innerHTML =
        '<button type="button" data-f="todos" class="on">All</button>' +
        '<button type="button" data-f="conplan">On a plan</button>' +
        '<button type="button" data-f="atrasados">Behind</button>';
      var ancla = cli.querySelector("details");
      if (ancla && ancla.nextSibling) cli.insertBefore(f, ancla.nextSibling);
      else cli.appendChild(f);
      f.querySelectorAll("button").forEach(function (b) {
        b.addEventListener("click", function () { aplicarFiltro(b.dataset.f); });
      });
    }
    refrescarHoy();
  }

  global.addEventListener("oc-login", function () { setTimeout(montar, 600); });
  /* Al cerrar sesion la alerta desaparece: un encargado no debe ver la lista
     global de quien debe, ni siquiera de refilon. */
  global.addEventListener("oc-logout", function () {
    var c = document.getElementById("pp-hoy");
    if (c) { c.classList.remove("hay"); c.innerHTML = ""; }
  });

  global.AMG = global.AMG || {};
  global.AMG.PlanPagosUI = { VERSION: "1.0.0", refrescarHoy: refrescarHoy, aplicarFiltro: aplicarFiltro, montar: montar };
})(typeof window !== "undefined" ? window : this);
