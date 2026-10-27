'use strict';
const fs = require('node:fs');
const path = require('node:path');

// Source-level VM assertions read the extracted source; browser servers serve the real HTML/assets.
function readFileSync(file, options) {
  const raw = fs.readFileSync(file, options);
  let html = Buffer.isBuffer(raw) ? raw.toString('utf8') : raw;
  const root = path.resolve(__dirname, '../..');
  if (!/[/\\](?:index|dashboard)\.html$/.test(String(file))) return raw;
  html = html.replace(/<script\b[^>]*\bsrc=["']\.\/(app-[^"']+|dashboard-[^"']+)\.min\.js["'][^>]*><\/script>/g,
    (tag, name) => '<script>\n' + fs.readFileSync(path.join(root, 'src', name.startsWith('app-') ? 'app' : 'dashboard', name + '.js'), 'utf8') + '\n</script>');
  html = html.replace(/<link\b[^>]*\bhref=["']\.\/(app-[^"']+|dashboard-[^"']+)\.min\.css["'][^>]*>/g,
    (tag, name) => '<style>\n' + fs.readFileSync(path.join(root, 'src', name.startsWith('app-') ? 'app' : 'dashboard', name + '.css'), 'utf8') + '\n</style>');
  html = html.replace(/\r\n/g, '\n');
  return Buffer.isBuffer(raw) ? Buffer.from(html, 'utf8') : html;
}
module.exports = { readFileSync };
