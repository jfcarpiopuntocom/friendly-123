const fs = require("fs");
const file = process.argv[2];
// 2026-09-24 (Opus 5.5): se quitan los comentarios HTML antes de buscar: la palabra "<script>" dentro de
// un comentario (el del cargador, v384) abria un falso bloque y daba "Unexpected identifier de".
const html = fs.readFileSync(file, "utf8").replace(/<!--[\s\S]*?-->/g, "");
// 2026-09-24: se saltan los <script type="application/ld+json"> (son JSON, no JS): daban falso error desde v386.
const re = /<script(?![^>]*src)(?![^>]*type="application\/ld\+json")[^>]*>([\s\S]*?)<\/script>/g;
let m, i = 0, ok = true;
while ((m = re.exec(html))) {
  i++;
  const code = m[1];
  try { new Function(code); } catch (e) { ok = false; console.log("SCRIPT #" + i + " SYNTAX ERROR:", e.message); }
}
console.log(file, "checked", i, "inline scripts; ok=" + ok);
