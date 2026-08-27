const fs = require("fs");
const file = process.argv[2];
const html = fs.readFileSync(file, "utf8");
const re = /<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/g;
let m, i = 0, ok = true;
while ((m = re.exec(html))) {
  i++;
  const code = m[1];
  try { new Function(code); } catch (e) { ok = false; console.log("SCRIPT #" + i + " SYNTAX ERROR:", e.message); }
}
console.log(file, "checked", i, "inline scripts; ok=" + ok);
