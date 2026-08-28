#!/usr/bin/env node
/* gen-manifest.js — genera docs/version-manifest.json con el SHA-256 de cada
   archivo del SHELL de sw.js. Es la base del sistema de integridad de versión:
   cada parte de la app (sw.js, salud-app.js, index.html) verifica los hashes
   para ofrecer SIEMPRE la versión correcta en conjunto y autocorregirse.

   Uso:  node scripts/gen-manifest.js
   Se corre ANTES de cada push. check-sw.sh verifica que esté al día.

   El manifest NO se cachea por el SW con la estrategia normal (network-first
   lo revalida), pero el SW lo guarda en su cache para poder verificar offline.
   version.json sigue siendo la fuente de "hay versión nueva"; el manifest es
   la fuente de "¿estos archivos son los correctos?". */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.join(__dirname, "..");
const DOCS = path.join(ROOT, "docs");
const SW = path.join(DOCS, "sw.js");
const VERSION_JSON = path.join(DOCS, "version.json");
const OUT = path.join(DOCS, "version-manifest.json");

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function extraerShell(swSrc) {
  // Extrae el array SHELL = [ "./a.js", "./b.js", ... ] de sw.js.
  const m = swSrc.match(/const\s+SHELL\s*=\s*\[([\s\S]*?)\];/);
  if (!m) throw new Error("No se encontró const SHELL en sw.js");
  const items = m[1].match(/"([^"]+)"/g) || [];
  return items.map((s) => s.replace(/"/g, ""));
}

function main() {
  const swSrc = fs.readFileSync(SW, "utf8");
  const shell = extraerShell(swSrc);
  const version = JSON.parse(fs.readFileSync(VERSION_JSON, "utf8"));

  const files = {};
  const faltantes = [];
  for (const rel of shell) {
    if (rel === "./version-manifest.json") continue; // el manifest no se hashea a sí mismo (auto-referencial)
    const abs = path.join(DOCS, rel.replace(/^\.\//, ""));
    if (!fs.existsSync(abs)) { faltantes.push(rel); continue; }
    if (fs.statSync(abs).isDirectory()) continue; // "./" (raíz) no es un archivo
    files[rel] = "sha256-" + sha256(abs);
  }

  const manifest = {
    version: version.version,
    shell: version.shell,
    algoritmo: "sha256",
    /* Sin campo "generado": el manifest debe ser DETERMINISTA — solo cambia
       cuando cambian los archivos del shell o la versión. Un timestamp haría
       que git lo viera modificado en cada regeneración (ruido). */
    files,
  };

  fs.writeFileSync(OUT, JSON.stringify(manifest, null, 2) + "\n");
  console.log("version-manifest.json generado:");
  console.log("  version:", manifest.version, " shell:", manifest.shell);
  console.log("  archivos:", Object.keys(files).length);
  if (faltantes.length) {
    console.warn("  ⚠ FALTAN en disco (no se incluyen):", faltantes.join(", "));
  }
}

main();
