// serve-static.js — Servidor estático mínimo SOLO para previsualizar docs/
// (la demo de GitHub Pages) en local. No es parte del producto.
const http = require("http");
const fs = require("fs");
const path = require("path");
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml", ".json": "application/json" };
http.createServer((req, res) => {
  let f = path.join(__dirname, decodeURIComponent(req.url.split("?")[0]));
  if (f.endsWith("\\") || f.endsWith("/")) f += "index.html";
  fs.readFile(f, (err, data) => {
    if (err) { res.writeHead(404); res.end("404"); return; }
    res.writeHead(200, { "Content-Type": MIME[path.extname(f)] || "application/octet-stream" });
    res.end(data);
  });
}).listen(3003, () => console.log("AMIGABLE docs demo en http://localhost:3003"));
