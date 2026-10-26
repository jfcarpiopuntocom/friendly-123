// Durable A/B preimages: a rejected candidate is never a recovery snapshot.
(function () {
  "use strict";
  const colas = new Map();
  function crear(opciones) {
    const storage = opciones.storage || window.localStorage;
    const base = opciones.claveBase;
    const claveJournal = base + "_journal";
    const leerClave = opciones.leer || function (clave) {
      const aislamiento = window.AMG && window.AMG.Aislamiento;
      return aislamiento && aislamiento.leerEstadoEstricto
        ? aislamiento.leerEstadoEstricto(clave) : storage.getItem(clave);
    };
    const clave = (letra) => base + "_" + letra;
    function cuerpo(raw) { try { return JSON.parse(raw); } catch (_) { return null; } }
    function nuevoToken() {
      const cripto = window.crypto;
      if (cripto && cripto.randomUUID) return cripto.randomUUID();
      if (!cripto || !cripto.getRandomValues) throw new Error("Secure storage transaction IDs unavailable");
      return Array.from(cripto.getRandomValues(new Uint32Array(4)), n => n.toString(16).padStart(8, "0")).join("");
    }
    function leer() {
      for (let intento = 0; intento < 3; intento++) {
        const rawJournal = leerClave(claveJournal);
        const puntero = leerClave(base + "_ptr");
        const fisicos = { A: leerClave(clave("A")), B: leerClave(clave("B")) };
        if (rawJournal !== leerClave(claveJournal)) continue;
        if (rawJournal === null && puntero !== null && puntero !== "A" && puntero !== "B") throw new Error("Invalid A/B pointer");
        let registro = null, activo = puntero;
        const buffers = { ...fisicos };
        if (rawJournal !== null) {
          registro = cuerpo(rawJournal);
          if (!registro || registro.v !== 1 || !["PREPARED", "COMMITTED"].includes(registro.phase) ||
              !["A", "B"].includes(registro.destino) || ![null, "A", "B"].includes(registro.activo) ||
              registro.activo === registro.destino ||
              !(registro.anterior === null || typeof registro.anterior === "string") ||
              typeof registro.token !== "string" || !registro.token ||
              typeof registro.candidateRaw !== "string" ||
              !cuerpo(registro.candidateRaw) || cuerpo(registro.candidateRaw)._abCommit !== registro.token ||
              cuerpo(registro.candidateRaw)._rev !== registro.revision ||
              !Number.isSafeInteger(registro.revision) || registro.revision < 1 ||
              ![null, "A", "B"].includes(registro.punteroAnterior)) throw new Error("Invalid A/B recovery journal");
          if (registro.phase === "PREPARED") {
            buffers[registro.destino] = registro.anterior;
            activo = registro.activo;
          } else {
            activo = registro.destino;
            buffers[activo] = registro.candidateRaw;
          }
        }
        const conflictos = [], danados = [];
        if (registro) for (const letra of ["A", "B"]) {
          const raw = fisicos[letra], body = cuerpo(raw);
          if (!body || typeof body !== "object") { if (raw !== null) danados.push(letra); continue; }
          const ajeno = letra === registro.destino && raw !== registro.candidateRaw &&
            (registro.phase !== "PREPARED" || raw !== registro.anterior);
          if (ajeno || Number(body._rev) > registro.revision) conflictos.push(letra);
        }
        const revisiones = Object.values(buffers).map(raw => Number((cuerpo(raw) || {})._rev) || 0);
        return { activo, buffers, revMax: Math.max(0, ...revisiones, registro ? registro.revision : 0), registro, fisicos, puntero, rawJournal, conflictos, danados };
      }
      throw new Error("A/B state changed during recovery read");
    }
    let espejoPermitido = false;
    function guardarAhora(raw) {
      espejoPermitido = false;
      try {
        const body = cuerpo(raw);
        if (!body || !Number.isSafeInteger(body._rev) || body._rev < 1) return false;
        if (!body._abCommit) { body._abCommit = nuevoToken(); raw = JSON.stringify(body); }
        let vista = leer();
        if (body._rev <= vista.revMax) return false;
        const anterior = vista.registro;
        if (vista.conflictos.length) return false;
        if (anterior && anterior.phase === "COMMITTED" && vista.fisicos[anterior.destino] !== anterior.candidateRaw) {
          espejoPermitido = true; // Corrupt physical bytes stay untouched; healthy IDB may still commit.
          return false;
        }
        if (anterior && anterior.phase === "PREPARED") {
          const pendiente = vista.fisicos[anterior.destino];
          if (vista.puntero !== anterior.punteroAnterior ||
              (pendiente !== anterior.anterior && pendiente !== anterior.candidateRaw)) return false;
          espejoPermitido = true; // The pending bytes and preimage are known; IDB may still commit.
          if (pendiente !== anterior.anterior) {
            if (anterior.anterior === null) storage.removeItem(clave(anterior.destino));
            else storage.setItem(clave(anterior.destino), anterior.anterior);
            const observado = leerClave(clave(anterior.destino));
            if (observado !== anterior.anterior) {
              espejoPermitido = observado === anterior.candidateRaw &&
                leerClave(base + "_ptr") === vista.puntero && leerClave(claveJournal) === vista.rawJournal;
              return false;
            }
          }
          vista = leer();
        }
        if (body._rev <= vista.revMax) return false;
        const activo = vista.activo || "B", destino = activo === "A" ? "B" : "A";
        const registro = { v: 1, phase: "PREPARED", activo: vista.activo, destino,
          anterior: vista.buffers[destino], candidateRaw: raw, token: body._abCommit,
          revision: body._rev, punteroAnterior: vista.puntero };
        const preparado = JSON.stringify(registro);
        espejoPermitido = true;
        storage.setItem(claveJournal, preparado);
        if (leerClave(claveJournal) !== preparado) { espejoPermitido = false; return false; }
        storage.setItem(clave(destino), raw);
        if (leerClave(clave(destino)) !== raw || leerClave(base + "_ptr") !== vista.puntero ||
            leerClave(claveJournal) !== preparado) { espejoPermitido = false; return false; }
        registro.phase = "COMMITTED";
        const confirmado = JSON.stringify(registro);
        storage.setItem(claveJournal, confirmado);
        // A successful native atomic set is durable even if a later read fails.
        // The pointer is a legacy hint; the confirmed journal is the commit boundary.
        try { storage.setItem(base + "_ptr", destino); } catch (_) {}
        return true;
      } catch (_) { return false; }
    }
    function conCandado(ejecutar) {
      const candados = window.navigator && window.navigator.locks;
      if (candados && candados.request) {
        if (typeof AbortController !== "function") return Promise.reject(new Error("Abortable storage lock unavailable"));
        const control = new AbortController();
        let entro = false;
        const reloj = setTimeout(() => { if (!entro) control.abort(); }, 10000);
        return Promise.resolve(candados.request("f123-estado-ab:" + base, {signal: control.signal}, () => {
          entro = true; clearTimeout(reloj); return ejecutar();
        })).finally(() => clearTimeout(reloj));
      }
      // Existing single-tab compatibility guard owns browsers without Web Locks.
      const previo = colas.get(base);
      const resultado = previo ? previo.then(ejecutar) : ejecutar();
      if (resultado && typeof resultado.then === "function") {
        const pendiente = Promise.resolve(resultado).then(() => {}, () => {});
        colas.set(base, pendiente);
        pendiente.then(() => { if (colas.get(base) === pendiente) colas.delete(base); });
      }
      return resultado;
    }
    return { leer, guardarAhora, conCandado, nuevoToken, permiteEspejo: () => espejoPermitido,
      guardar: raw => conCandado(() => guardarAhora(raw)), claveJournal };
  }
  function avisarConflicto() {
    try {
      if (document.getElementById("oc-ab-conflicto")) return;
      const aviso = document.createElement("div"); aviso.id = "oc-ab-conflicto"; aviso.setAttribute("role", "alert");
      aviso.style.cssText = "position:fixed;top:0;left:0;right:0;z-index:10005;background:#7C1722;color:#FFFFFF;font-size:16px;font-weight:700;padding:12px;text-align:center";
      const es = window.OCI18n && window.OCI18n.getLang && window.OCI18n.getLang() === "es";
      aviso.textContent = es ? "Hay copias guardadas en conflicto. Se conservaron todas; se muestra la última confirmada. Los guardados nuevos están bloqueados. El respaldo incluye ambas copias."
        : "Saved copies conflict. All copies are preserved; the last confirmed state is shown. New saves are blocked. The backup includes both copies.";
      (document.body || document.documentElement).appendChild(aviso);
    } catch (_) {}
  }
  window.OCEstadoAB = { crear, avisarConflicto };
})();
