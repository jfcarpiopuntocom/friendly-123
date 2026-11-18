/* friendly-123 · H6 Hermes/Belén: pure, read-only financial fact-chain validator.
   Exact canonical ordering + weak/strong hashes from docs/hechos.js.
   No IndexedDB, network, storage writes, UI or timestamps. No silent "best effort". */
(function (global) {
  "use strict";
  function hashDebil(txt) {
    var h1 = 0x811c9dc5, h2 = 0x01000193;
    for (var i = 0; i < txt.length; i++) {
      var c = txt.charCodeAt(i);
      h1 = (h1 ^ c) >>> 0; h1 = (h1 * 0x01000193) >>> 0;
      h2 = (h2 + c * (i + 1)) >>> 0;
    }
    return "w:" + h1.toString(16) + h2.toString(16);
  }
  function rechazar(razon) { return { ok: false, razon: razon }; }
  function verificarCadenas(lista) {
    // The adapter caller is authorized first. This validator only checks that
    // local fact bytes are internally consistent; hash chain != license proof.
    if (!Array.isArray(lista)) return Promise.resolve(rechazar("sin lectura de hechos"));
    var grupos = Object.create(null);
    for (var i = 0; i < lista.length; i++) {
      var h = lista[i], origen = h && h.instanceId;
      if (!origen || typeof h.id !== "string" || h.id.indexOf(origen + "-") !== 0)
        return Promise.resolve(rechazar("identidad invalida"));
      var sec = Number(h.id.slice(origen.length + 1));
      if (!Number.isSafeInteger(sec) || sec < 1)
        return Promise.resolve(rechazar("secuencia invalida"));
      (grupos[origen] || (grupos[origen] = [])).push({ h: h, sec: sec });
    }
    var autores = Object.keys(grupos);
    for (var j = 0; j < autores.length; j++) {
      var filas = grupos[autores[j]].sort(function (a, b) { return a.sec - b.sec; });
      var previo = "", esperado = 1;
      for (var k = 0; k < filas.length; k++) {
        var f = filas[k];
        if (f.sec !== esperado) return Promise.resolve(rechazar("hueco de secuencia"));
        if (f.h.hashPrevio !== previo) return Promise.resolve(rechazar("enlace de hash roto"));
        previo = f.h.hash; esperado++;
      }
    }
    return Promise.all(lista.map(function (h) {
      var base;
      try {
        base = JSON.stringify({id:h.id,instanceId:h.instanceId,autor:h.autor,
          reloj:h.reloj,ts:h.ts,tipo:h.tipo,datos:h.datos,hashPrevio:h.hashPrevio});
      } catch (_) { return null; }
      if (String(h.hash).slice(0,2) === "w:") return hashDebil(base);
      if (!global.crypto || !global.crypto.subtle || !global.crypto.subtle.digest)
        return null;
      try {
        return global.crypto.subtle.digest("SHA-256", new TextEncoder().encode(base)).then(function (buf) {
          return Array.from(new Uint8Array(buf)).map(function (b) {
            return b.toString(16).padStart(2,"0");
          }).join("");
        }).catch(function () { return null; });
      } catch (_) { return null; }
    })).then(function (checks) {
      for (var n=0; n<checks.length; n++) {
        if (checks[n]===null) return rechazar("hash no verificable en este navegador");
        if (checks[n]!==lista[n].hash) return rechazar("hash alterado");
      }
      return {ok:true,origenes:autores.length,hechos:lista.length};
    }).catch(function () { return rechazar("hash no verificable en este navegador"); });
  }
  global.F123HechosChain = Object.freeze({ verificarCadenas: verificarCadenas });
})(typeof window !== "undefined" ? window : this);
