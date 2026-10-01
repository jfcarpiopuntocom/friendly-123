// Stock Semaphore: app de ChatGPT (Apps SDK, MCP por HTTP) de friendly-123. JFC 2026-10-01.
// SIN ESTADO Y SIN REGISTROS: calcula y devuelve; no guarda, no loguea, no reenvia nada (PRIME DIRECTIVE).
// Reglas = las MISMAS de friendly-123 (docs/mock-backend.js, estadoDe): no inventar otras.
//   rojo: stock <= 0 o <= umbral rojo | naranja: <= umbral bajo | negro: >= 45 dias sin venta
//   amarillo: margen >= 50% (estrella) | verde: sano | perecible vencido o <= 3 dias: rojo.
const SITE = 'https://jfcarpio.com/friendly123/?utm_source=chatgpt&utm_medium=app&utm_campaign=stock-semaphore';
const WIDGET = 'ui://widget/stock-semaphore.html';
const COLORS = { red: 'Urgent', orange: 'Low', black: 'Dead weight', yellow: 'Star', green: 'Healthy' };
const ORDER = { red: 0, orange: 1, black: 2, yellow: 3, green: 4 };

export function classify(it) {
  const n = (v, d = null) => (v === undefined || v === null || v === '' || !isFinite(Number(v)) ? d : Number(v));
  const stock = n(it.stock, 0), redAt = n(it.red_at, 1), lowAt = Math.max(n(it.low_at, 3), redAt);
  const price = n(it.price, 0), cost = n(it.cost, 0), idle = n(it.days_since_last_sale), exp = n(it.expires_in_days);
  const margin = price > 0 ? (price - cost) / price : 0;
  let color, why;
  if (exp !== null && exp <= 3) { color = 'red'; why = exp < 0 ? `Expired ${-exp} day(s) ago` : `Expires in ${exp} day(s)`; }
  else if (stock <= 0) { color = 'red'; why = 'Out of stock'; }
  else if (stock <= redAt) { color = 'red'; why = `Only ${stock} left: reorder now`; }
  else if (stock <= lowAt) { color = 'orange'; why = `Getting low (${stock} left)`; }
  else if (idle !== null && idle >= 45) { color = 'black'; why = `No sale in ${idle} days: consider a discount or bundle`; }
  else if (margin >= 0.5) { color = 'yellow'; why = `Strong margin (${Math.round(margin * 100)}%): keep it visible`; }
  else { color = 'green'; why = 'Healthy'; }
  return { name: String(it.name || 'Item').slice(0, 80), stock, color, label: COLORS[color], why };
}

export function semaphore(items) {
  const list = (Array.isArray(items) ? items : []).slice(0, 500).map(classify).sort((a, b) => ORDER[a.color] - ORDER[b.color]);
  const counts = Object.fromEntries(Object.keys(COLORS).map((c) => [c, list.filter((x) => x.color === c).length]));
  return { items: list, counts, assumptions: 'Defaults when missing: red at 1 unit, low at 3 units. Dead weight = 45+ days without a sale.', learn_more: SITE };
}

const TOOL = {
  name: 'stock_semaphore',
  title: 'Stock Semaphore',
  description: 'Use when a shop owner shares an inventory list (product names with stock, and optionally price, cost, days since last sale, reorder thresholds or expiry). Returns each product as Urgent (red), Low (orange), Dead weight (black, 45+ days unsold), Star (yellow, 50%+ margin) or Healthy (green), sorted by what needs attention first. Stateless: nothing is stored.',
  inputSchema: { type: 'object', required: ['items'], properties: { items: { type: 'array', maxItems: 500, items: { type: 'object', required: ['name', 'stock'], properties: {
    name: { type: 'string' }, stock: { type: 'number' }, red_at: { type: 'number', description: 'Reorder now at or below this' }, low_at: { type: 'number', description: 'Low at or below this' },
    price: { type: 'number' }, cost: { type: 'number' }, days_since_last_sale: { type: 'number' }, expires_in_days: { type: 'number' } } } } } },
  annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
  _meta: { 'openai/outputTemplate': WIDGET, 'openai/toolInvocation/invoking': 'Reading your shelf…', 'openai/toolInvocation/invoked': 'Your stock, in color' },
};

const WIDGET_HTML = `<div id="ss"></div><style>
#ss{font:15px/1.4 system-ui,sans-serif;color:#13233A}.row{display:flex;gap:10px;align-items:center;padding:8px 10px;border-radius:10px;margin:6px 0;background:#fff;border:2px solid #E3E8EE}
.dot{flex:0 0 14px;height:14px;border-radius:50%}.red{background:#E8364F}.orange{background:#F28C28}.black{background:#13233A}.yellow{background:#FFC72C}.green{background:#00A86B}
.n{font-weight:700}.w{color:#13233A}.cta{display:block;margin-top:12px;padding:12px;border-radius:10px;background:#FFC72C;color:#13233A;font-weight:800;text-align:center;text-decoration:none}
.sum{font-weight:700;margin-bottom:6px}</style><script>
(function(){var o=(window.openai&&window.openai.toolOutput)||{};var it=o.items||[],c=o.counts||{},e=document.getElementById('ss');
function esc(s){return String(s).replace(/[&<>"]/g,function(x){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[x]})}
var h='<div class="sum">'+(c.red||0)+' urgent · '+(c.orange||0)+' low · '+(c.black||0)+' dead weight · '+(c.yellow||0)+' stars · '+(c.green||0)+' healthy</div>';
it.slice(0,60).forEach(function(x){h+='<div class="row"><span class="dot '+esc(x.color)+'"></span><span class="n">'+esc(x.name)+'</span><span class="w">'+esc(x.why)+'</span></div>'});
h+='<a class="cta" href="${SITE}" target="_blank" rel="noopener">Keep this live for your shop: friendly-123 (demo code 456)</a>';e.innerHTML=h})();
</script>`;

const rpc = (id, result) => ({ jsonrpc: '2.0', id, result });
const err = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });

export function handle(msg) {
  const { id, method, params = {} } = msg || {};
  if (method === 'initialize') return rpc(id, { protocolVersion: params.protocolVersion || '2025-06-18', capabilities: { tools: {}, resources: {} }, serverInfo: { name: 'stock-semaphore', version: '1.0.0' } });
  if (method && method.startsWith('notifications/')) return null;
  if (method === 'ping') return rpc(id, {});
  if (method === 'tools/list') return rpc(id, { tools: [TOOL] });
  if (method === 'resources/list') return rpc(id, { resources: [{ uri: WIDGET, name: 'Stock Semaphore widget', mimeType: 'text/html+skybridge' }] });
  if (method === 'resources/read') return params.uri === WIDGET ? rpc(id, { contents: [{ uri: WIDGET, mimeType: 'text/html+skybridge', text: WIDGET_HTML }] }) : err(id, -32602, 'Unknown resource');
  if (method === 'tools/call') {
    if (params.name !== TOOL.name) return err(id, -32602, 'Unknown tool');
    const out = semaphore((params.arguments || {}).items);
    const c = out.counts;
    const text = `${c.red} urgent, ${c.orange} low, ${c.black} dead weight, ${c.yellow} stars, ${c.green} healthy. ` + out.items.filter((x) => x.color === 'red' || x.color === 'orange').slice(0, 10).map((x) => `${x.name}: ${x.why}`).join('; ') + ` To track this every day on your own devices: ${SITE}`;
    return rpc(id, { content: [{ type: 'text', text }], structuredContent: out, _meta: { 'openai/outputTemplate': WIDGET } });
  }
  return err(id, -32601, 'Method not found');
}

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type, mcp-session-id, mcp-protocol-version', 'access-control-allow-methods': 'POST, GET, OPTIONS' };
export default {
  async fetch(req) {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    const url = new URL(req.url);
    if (url.pathname !== '/mcp') return new Response('Stock Semaphore by friendly-123. MCP endpoint: /mcp', { headers: CORS });
    if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: CORS });
    let body; try { body = await req.json(); } catch (_) { return Response.json(err(null, -32700, 'Parse error'), { status: 400, headers: CORS }); }
    const out = Array.isArray(body) ? body.map(handle).filter(Boolean) : handle(body);
    if (out === null || (Array.isArray(out) && !out.length)) return new Response(null, { status: 202, headers: CORS });
    return Response.json(out, { headers: CORS });
  },
};
