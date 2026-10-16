// Reuse one loopback server/browser; each synthetic case gets a clean context.
require('./sin-red-produccion.cjs');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
async function readyEnvironment({ root = path.resolve(__dirname, '../../docs'), engine = 'chromium' } = {}) {
  root = path.resolve(root);
  const server = http.createServer(async (req, res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
      const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
      if (!file.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
      const body = await fs.readFile(file);
      res.writeHead(200, { 'Content-Type': ({ '.html': 'text/html', '.js': 'application/javascript', '.json': 'application/json', '.css': 'text/css' })[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(body);
    } catch { res.writeHead(404); res.end(); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try { browser = await require('playwright')[engine].launch({ headless: true }); }
  catch (error) { await new Promise(resolve => server.close(resolve)); throw error; }
  return {
    origin,
    async context(options = {}) {
      const ctx = await browser.newContext({ ...options, serviceWorkers: 'block' });
      await ctx.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
      await ctx.routeWebSocket(/.*/, socket => socket.close({ code: 1008, reason: 'Isolated synthetic fixture' }));
      return ctx;
    },
    async close() { try { await browser.close(); } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } }
  };
}
module.exports = { readyEnvironment };
