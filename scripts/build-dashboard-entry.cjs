// Extracts the real inline dashboard blocks once; subsequent runs build from src/dashboard.
const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');
const root = path.join(__dirname, '..');
const htmlPath = path.join(root, 'docs/dashboard.html');
const sourceDir = path.join(root, 'src/dashboard');
const html = fs.readFileSync(htmlPath, 'utf8');
function parse(source) {
  // Tokenize tags while honoring comments and raw-text script/style contents.
  const out = []; let i = 0;
  while ((i = source.indexOf('<', i)) >= 0) {
    if (source.startsWith('<!--', i)) { const end = source.indexOf('-->', i + 4); i = end < 0 ? source.length : end + 3; continue; }
    if (source[i + 1] === '!' || source[i + 1] === '?') { const end = source.indexOf('>', i + 2); i = end < 0 ? source.length : end + 1; continue; }
    let p = i + 1, closing = false;
    if (source[p] === '/') { closing = true; p++; }
    const nameStart = p;
    while (/[A-Za-z0-9:-]/.test(source[p] || '')) p++;
    if (p === nameStart) { i++; continue; }
    const tag = source.slice(nameStart, p).toLowerCase(), attrs = {};
    let quote = '';
    while (p < source.length) {
      const c = source[p++];
      if (quote) { if (c === quote) quote = ''; continue; }
      if (c === '"' || c === "'") { quote = c; continue; }
      if (c === '>') break;
    }
    if (closing) { i = p; continue; }
    let a = nameStart + tag.length;
    while (a < p - 1) {
      while (/\s|\//.test(source[a] || '') && a < p - 1) a++;
      const k0 = a; while (a < p - 1 && !/[\s=/>]/.test(source[a])) a++;
      if (a === k0) { a++; continue; }
      const key = source.slice(k0, a).toLowerCase();
      while (/\s/.test(source[a] || '') && a < p - 1) a++;
      let value = null;
      if (source[a] === '=') {
        a++; while (/\s/.test(source[a] || '') && a < p - 1) a++;
        const q = source[a] === '"' || source[a] === "'" ? source[a++] : '';
        const v0 = a;
        if (q) { while (a < p - 1 && source[a] !== q) a++; value = source.slice(v0, a); a++; }
        else { while (a < p - 1 && !/[\s>]/.test(source[a])) a++; value = source.slice(v0, a); }
      }
      attrs[key] = value;
    }
    if (tag === 'script' || tag === 'style') {
      const lower = source.toLowerCase(), close = lower.indexOf(`</${tag}`, p);
      if (close < 0) throw Error(`Unclosed <${tag}> in dashboard HTML`);
      const closeEnd = source.indexOf('>', close) + 1;
      out.push({ tag, attrs, body: source.slice(p, close), start: i, end: closeEnd }); i = closeEnd;
    } else {
      if (tag === 'link') out.push({ tag, attrs, start: i, end: p });
      i = p;
    }
  }
  return out;
}
const blocks = parse(html);
const inlineScripts = blocks.filter(b => b.tag === 'script' && !('src' in b.attrs));
const inlineStyles = blocks.filter(b => b.tag === 'style');
if (!fs.existsSync(sourceDir)) {
  if (!inlineScripts.length || !inlineStyles.length) throw Error('Initial extraction requires inline script and style blocks');
  fs.mkdirSync(sourceDir, { recursive: true });
  fs.writeFileSync(path.join(sourceDir, 'dashboard-main.js'), inlineScripts.map(b => b.body).join('\n'), 'utf8');
  fs.writeFileSync(path.join(sourceDir, 'dashboard-main.css'), inlineStyles.map(b => b.body).join('\n'), 'utf8');
  let next = html;
  for (const b of [...blocks].filter(x => x.tag === 'script' && !('src' in x.attrs) || x.tag === 'style').sort((a,b)=>b.start-a.start)) {
    const styleIndex = inlineStyles.findIndex(x => x.start === b.start);
    const scriptIndex = inlineScripts.findIndex(x => x.start === b.start);
    const replacement = b.tag === 'style' && styleIndex === 1 ? '<link rel="stylesheet" href="./dashboard-main.min.css">' :
      b.tag === 'script' && scriptIndex === 0 ? '<script src="./dashboard-main.min.js"></script>' : '';
    next = next.slice(0, b.start) + replacement + next.slice(b.end);
  }
  fs.writeFileSync(htmlPath, next, 'utf8');
}
const mainJs = fs.readFileSync(path.join(sourceDir, 'dashboard-main.js'), 'utf8');
const mainCss = fs.readFileSync(path.join(sourceDir, 'dashboard-main.css'), 'utf8');
const minify = (loader, contents) => esbuild.transformSync(contents, { loader, target: 'es2020', minifySyntax: true, minifyWhitespace: true, minifyIdentifiers: false, legalComments: 'none' }).code;
const outputs = [
  [path.join(root, 'docs/dashboard-main.min.js'), minify('js', mainJs)],
  [path.join(root, 'docs/dashboard-main.min.css'), minify('css', mainCss)]
];
if (process.argv.includes('--check')) {
  const current = fs.readFileSync(htmlPath, 'utf8');
  const tags = parse(current);
  if (tags.some(b => b.tag === 'style' || b.tag === 'script' && !('src' in b.attrs))) throw Error('Inline dashboard blocks remain');
  const script = tags.filter(b => b.tag === 'script' && b.attrs.src === './dashboard-main.min.js');
  const css = tags.filter(b => b.tag === 'link' && b.attrs.href === './dashboard-main.min.css');
  if (script.length !== 1 || 'defer' in script[0].attrs || 'async' in script[0].attrs || 'type' in script[0].attrs || css.length !== 1) throw Error('Dashboard entry tags are missing, duplicated, or not classic/blocking');
  for (const [file, expected] of outputs) if (fs.readFileSync(file, 'utf8') !== expected) throw Error(`Generated asset differs: ${path.relative(root,file)}`);
  console.log('Dashboard extraction and minified assets are reproducible; main JS remains classic and blocking.');
} else {
  for (const [file, output] of outputs) fs.writeFileSync(file, output, 'utf8');
  console.log('Built docs/dashboard-main.min.js and docs/dashboard-main.min.css from src/dashboard.');
}
