#!/usr/bin/env node
/* Offline-only comparator for three exported instance reports.
   No transport, mutation, upload, auto-merge or auto-GO. */
"use strict";
const fs = require("node:fs");
function comparar(reports) {
  if (!Array.isArray(reports) || reports.length < 2)
    throw Error("Se requieren al menos dos informes independientes.");
  reports.forEach((r, i) => {
    if (!r || r.esquema !== "friendly-123-reconciliacion-v1")
      throw Error("Formato incompatible en captura " + (i + 1));
    if (!r.comercial || !r.transporte) throw Error("Captura incompleta " + (i + 1));
  });
  const versions = new Set(reports.map(r => r.version || "desconocida"));
  const paths = {
    inventario: r => r.comercial.inventario,
    ventas: r => r.comercial.ventas,
    fotos: r => r.comercial.fotos,
    acceso: r => r.comercial.acceso,
    pagos: r => r.comercial.dinero.payouts,
    gastos: r => r.comercial.dinero.gastos,
    transferencias: r => r.comercial.dinero.transferencias,
    ajustesComision: r => r.comercial.dinero.ajustesComision,
    movimientos: r => r.comercial.dinero.movimientos
  };
  const dominios = {};
  for (const [nombre, fn] of Object.entries(paths)) {
    const snapshots = reports.map(fn);
    const hashes = snapshots.map(s => s && s.huella || "");
    const allKnown = hashes.every(Boolean);
    const same = allKnown && new Set(hashes).size === 1;
    const byId = reports.map((r, i) => new Map(((snapshots[i] && snapshots[i].filas) || []).map(v => [v.clave, v])));
    const union = new Set(byId.flatMap(m => [...m.keys()]));
    const distintos = [];
    for (const id of union) {
      const values = byId.map(m => m.has(id) ? JSON.stringify(m.get(id)) : null);
      if (new Set(values).size !== 1) distintos.push({ clave: id, presente: values.map(v => v !== null) });
    }
    dominios[nombre] = {
      estado: !allKnown ? "no verificado" : same ? "huellas iguales, ACK sin verificar" : "divergente observado",
      huellas: hashes, clavesDiferentes: distintos.length, primerasDiferencias: distintos.slice(0, 200),
      recortado: distintos.length > 200
    };
  }
  const sets = reports.map(r => new Set(
    r.transporte.opsYjs && Array.isArray(r.transporte.opsYjs.opIds) ? r.transporte.opsYjs.opIds : []
  ));
  const unionOps = new Set(sets.flatMap(s => [...s]));
  const faltantes = reports.map((r, i) => [...unionOps].filter(id => !sets[i].has(id)).sort());
  const backlog = reports.map(r => ({
    pendientesLegacy: r.transporte.legado && r.transporte.legado.cola ? r.transporte.legado.cola.total : null,
    pendientesPorCanal: Object.fromEntries(Object.entries(r.transporte.canales || {}).map(([name, c]) => [name, c.pendientesRelay])),
    sinACKPorOpId: !(r.transporte.acuseRemotoPorOpId && r.transporte.acuseRemotoPorOpId.disponible)
  }));
  const completos = reports.every(r => r.transporte.opsYjs && r.transporte.opsYjs.disponible === true &&
    r.transporte.opsYjs.truncado === false);
  return {
    esquema: "friendly-123-comparacion-v1", capturas: reports.map((r, i) => ({
      indice: i + 1, generadoEn: r.generadoEn, dispositivo: r.dispositivo, version: r.version
    })),
    versionesIguales: versions.size === 1,
    dominios,
    operaciones: { comparacionCompleta: completos, diferentes: [...unionOps].length,
      faltaRecibirOAplicar: faltantes.map((ids, i) => ({ captura: i + 1,
        total: ids.length, opIds: ids.slice(0, 1000), truncado: ids.length > 1000 })) },
    backlog,
    veredicto: "NO-GO",
    motivo: "No hay evidencia de ACK durable remoto por opId, ni pruebas físicas controladas ni respaldos verificados. Diferencia entre capturas tomadas en distintos instantes no prueba pérdida definitiva.",
    advertencias: ["La comparación no modifica ningún dato.", "No usar huellas iguales como certificación GO.",
      "Identificadores/huellas seudónimos; resguardar los archivos porque contienen cifras comerciales."]
  };
}
if (require.main === module) {
  const paths = process.argv.slice(2);
  if (paths.length < 2) {
    console.error("Uso: node scripts/compare-reconciliacion.cjs PC.json Safari.json Opera.json");
    process.exitCode = 2;
  } else {
    try {
      const informes = paths.map(p => JSON.parse(fs.readFileSync(p, "utf8")));
      process.stdout.write(JSON.stringify(comparar(informes), null, 2) + "\n");
    } catch (e) { console.error(e.message); process.exitCode = 1; }
  }
}
module.exports = { comparar };
