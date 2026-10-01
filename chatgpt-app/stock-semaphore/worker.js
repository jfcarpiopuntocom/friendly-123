// Stock Semaphore: ChatGPT app (MCP over HTTP) for friendly-123. JFC 2026-10-01.
// STATELESS + NO APP LOGS: computes and returns; does not store or forward inventory data.
// Rules mirror docs/mock-backend.js estadoDe(): stock -> dormancy -> margin, then expiry may override by severity.
const SITE = 'https://jfcarpio.com/friendly123/?utm_source=chatgpt&utm_medium=app&utm_campaign=stock-semaphore';
const PRIVACY = 'https://jfcarpio.com/friendly123/chatgpt-app/privacy/';
const WIDGET = 'ui://widget/stock-semaphore-v2.html';
const MIME = 'text/html;profile=mcp-app';
const ORDER = { red: 0, orange: 1, black: 2, yellow: 3, green: 4 };
const LEGACY_PROTOCOLS = ['2025-11-25', '2025-06-18', '2025-03-26'];

const I18N = {
  en: {
    labels: { red: 'Urgent', orange: 'Low', black: 'Dead weight', yellow: 'Star', green: 'Healthy' },
    out: 'Out of stock', red: (n) => `Only ${n} left: reorder now`, low: (n) => `Getting low (${n} left)`,
    dormant: (n) => `No sale in ${n} days: consider a discount or bundle`, margin: (p) => `Strong margin (${p}%): keep it visible`, healthy: 'Healthy',
    expired: (n) => `Expired ${n} day(s) ago: remove it`, expiresSoon: (n) => `Expires in ${n} day(s): sell it now`, expiresFirst: (n) => `Expires in ${n} days: sell it first`,
    summary: (c) => `${c.red} urgent · ${c.orange} low · ${c.black} dead weight · ${c.yellow} stars · ${c.green} healthy`,
    cta: 'Keep this live for your shop: friendly-123 (demo code 456)',
    privacy: 'Privacy: inventory pasted into ChatGPT passes through OpenAI. Stock Semaphore does not store or forward your inventory and does not write it to an application log.',
    privacyLink: 'Privacy & terms',
    assumptions: 'Defaults when missing: red at 1 unit, low at 3 units. Dead weight = 45+ days without a sale.'
  },
  es: {
    labels: { red: 'Urgente', orange: 'Bajo', black: 'Peso muerto', yellow: 'Estrella', green: 'Sano' },
    out: 'Sin stock', red: (n) => `Queda ${n}: repón ahora`, low: (n) => `Queda poco (${n})`,
    dormant: (n) => `Sin venta en ${n} días: considera descuento o combo`, margin: (p) => `Margen fuerte (${p}%): mantenlo visible`, healthy: 'Sano',
    expired: (n) => `Venció hace ${n} día(s): retíralo`, expiresSoon: (n) => `Vence en ${n} día(s): véndelo ya`, expiresFirst: (n) => `Vence en ${n} días: véndelo primero`,
    summary: (c) => `${c.red} urgentes · ${c.orange} bajos · ${c.black} peso muerto · ${c.yellow} estrellas · ${c.green} sanos`,
    cta: 'Mantén este semáforo vivo en tu negocio: friendly-123 (demo 456)',
    privacy: 'Privacidad: el inventario pegado en ChatGPT pasa por OpenAI. Stock Semaphore no guarda ni reenvía tu inventario ni lo escribe en un registro de la app.',
    privacyLink: 'Privacidad y términos',
    assumptions: 'Si faltan umbrales: rojo en 1 unidad y bajo en 3. Peso muerto = 45+ días sin venta.'
  }
};

function langOf(locale) { return String(locale || '').toLowerCase().startsWith('es') ? 'es' : 'en'; }
function num(v, d = null) { return v === undefined || v === null || v === '' || !isFinite(Number(v)) ? d : Number(v); }

export function classify(it, locale = 'en') {
  const lang = langOf(locale), t = I18N[lang];
  const stock = num(it.stock, 0), redAt = Math.max(0, num(it.red_at, 1)), lowAt = Math.max(num(it.low_at, 3), redAt);
  const price = num(it.price, 0), cost = num(it.cost, 0), idle = num(it.days_since_last_sale), exp = num(it.expires_in_days);
  const margin = price > 0 ? (price - cost) / price : 0;
  let base;
  if (stock <= 0) base = { color: 'red', level: 3, why: t.out };
  else if (stock <= redAt) base = { color: 'red', level: stock <= Math.ceil(redAt / 2) ? 2 : 1, why: t.red(stock) };
  else if (stock <= lowAt) { const diff = stock - redAt; base = { color: 'orange', level: diff <= 1 ? 3 : diff <= 3 ? 2 : 1, why: t.low(stock) }; }
  else if (idle !== null && idle >= 45) base = { color: 'black', level: idle >= 120 ? 3 : idle >= 60 ? 2 : 1, why: t.dormant(idle) };
  else if (margin >= 0.5) base = { color: 'yellow', level: margin >= 0.70 ? 3 : margin >= 0.55 ? 2 : 1, why: t.margin(Math.round(margin * 100)) };
  else base = { color: 'green', level: stock >= 15 ? 3 : stock >= 7 ? 2 : 1, why: t.healthy };

  let expiry = null;
  if (exp !== null) {
    if (exp < 0) expiry = { color: 'red', level: 3, why: t.expired(Math.abs(exp)) };
    else if (exp <= 3) expiry = { color: 'red', level: exp <= 1 ? 3 : 2, why: t.expiresSoon(exp) };
    else if (exp <= 7) expiry = { color: 'orange', level: exp <= 5 ? 2 : 1, why: t.expiresFirst(exp) };
  }
  const state = expiry && ORDER[expiry.color] <= ORDER[base.color] ? expiry : base;
  return { name: String(it.name || (lang === 'es' ? 'Producto' : 'Item')).slice(0, 80), stock, color: state.color, level: state.level, label: t.labels[state.color], why: state.why };
}

export function semaphore(items, locale = 'en') {
  const lang = langOf(locale), t = I18N[lang];
  const list = (Array.isArray(items) ? items : []).slice(0, 500).map((x) => classify(x, lang)).sort((a, b) => ORDER[a.color] - ORDER[b.color] || b.level - a.level || a.name.localeCompare(b.name));
  const counts = Object.fromEntries(Object.keys(ORDER).map((c) => [c, list.filter((x) => x.color === c).length]));
  return { items: list, counts, locale: lang, assumptions: t.assumptions, learn_more: SITE, privacy: PRIVACY };
}

const ITEM_SCHEMA = { type: 'object', required: ['name', 'stock'], additionalProperties: false, properties: {
  name: { type: 'string', maxLength: 80 }, stock: { type: 'number' }, red_at: { type: 'number', description: 'Reorder now at or below this' }, low_at: { type: 'number', description: 'Low at or below this' },
  price: { type: 'number' }, cost: { type: 'number' }, days_since_last_sale: { type: 'number' }, expires_in_days: { type: 'number' }
} };
const OUTPUT_SCHEMA = { type: 'object', required: ['items', 'counts', 'locale', 'assumptions', 'learn_more', 'privacy'], properties: {
  items: { type: 'array', items: { type: 'object', required: ['name', 'stock', 'color', 'level', 'label', 'why'], properties: { name: { type: 'string' }, stock: { type: 'number' }, color: { type: 'string' }, level: { type: 'number' }, label: { type: 'string' }, why: { type: 'string' } } } },
  counts: { type: 'object' }, locale: { type: 'string' }, assumptions: { type: 'string' }, learn_more: { type: 'string' }, privacy: { type: 'string' }
} };

const TOOL = {
  name: 'stock_semaphore', title: 'Stock Semaphore',
  description: 'Use when a shop owner shares an inventory list. Classifies each product with the same visual rules used by friendly-123: Urgent/red, Low/orange, Dead weight/black (45+ days unsold), Star/yellow (50%+ margin), or Healthy/green. Expiry can raise severity. Stateless: the app code does not store or forward inventory data.',
  inputSchema: { type: 'object', required: ['items'], additionalProperties: false, properties: { items: { type: 'array', minItems: 1, maxItems: 500, items: ITEM_SCHEMA } } },
  outputSchema: OUTPUT_SCHEMA,
  annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
  _meta: { ui: { resourceUri: WIDGET }, 'openai/outputTemplate': WIDGET, 'openai/toolInvocation/invoking': 'Reading your shelf…', 'openai/toolInvocation/invoked': 'Your stock, in color' }
};

export const WIDGET_HTML = `<div id="ss"></div><style>
#ss{font:15px/1.45 system-ui,-apple-system,sans-serif;color:#13233A;max-width:760px}.sum{font-weight:850;font-size:16px;margin:0 0 8px}.row{display:grid;grid-template-columns:16px minmax(100px,.75fr) 1.5fr;gap:10px;align-items:center;padding:9px 10px;border-radius:10px;margin:6px 0;background:#fff;border:2px solid #E3E8EE}.dot{width:14px;height:14px;border-radius:50%}.red{background:#E8364F}.orange{background:#F28C28}.black{background:#13233A}.yellow{background:#FFC72C}.green{background:#00A86B}.n{font-weight:800}.w{color:#13233A}.cta{display:block;margin-top:12px;padding:12px;border-radius:10px;background:#FFC72C;color:#13233A;font-weight:850;text-align:center;text-decoration:none}.privacy{font-size:13px;line-height:1.35;margin-top:10px;padding-top:10px;border-top:1px solid #D7DEE7}.privacy a{color:#13233A;font-weight:750}.empty{padding:12px;border:2px solid #E3E8EE;border-radius:10px}@media(max-width:520px){.row{grid-template-columns:16px 1fr}.w{grid-column:2}}</style><script>
(function(){var o=(window.openai&&window.openai.toolOutput)||{};var lang=o.locale==='es'?'es':'en',it=o.items||[],c=o.counts||{},e=document.getElementById('ss');
function esc(s){return String(s).replace(/[&<>\\"]/g,function(x){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[x]})}
var summary=lang==='es'?(c.red||0)+' urgentes · '+(c.orange||0)+' bajos · '+(c.black||0)+' peso muerto · '+(c.yellow||0)+' estrellas · '+(c.green||0)+' sanos':(c.red||0)+' urgent · '+(c.orange||0)+' low · '+(c.black||0)+' dead weight · '+(c.yellow||0)+' stars · '+(c.green||0)+' healthy';
var h='<div class="sum">'+summary+'</div>';if(!it.length)h+='<div class="empty">'+(lang==='es'?'Pega una lista de inventario para verla en colores.':'Paste an inventory list to see it in color.')+'</div>';
it.slice(0,60).forEach(function(x){h+='<div class="row"><span class="dot '+esc(x.color)+'"></span><span class="n">'+esc(x.name)+'</span><span class="w">'+esc(x.why)+'</span></div>'});
h+='<a class="cta" href="${SITE}" target="_blank" rel="noopener">'+(lang==='es'?'Mantén este semáforo vivo en tu negocio: friendly-123 (demo 456)':'Keep this live for your shop: friendly-123 (demo code 456)')+'</a>';
h+='<div class="privacy">'+(lang==='es'?'Privacidad: el inventario pegado en ChatGPT pasa por OpenAI. Stock Semaphore no guarda ni reenvía tu inventario ni lo escribe en un registro de la app. ':'Privacy: inventory pasted into ChatGPT passes through OpenAI. Stock Semaphore does not store or forward your inventory and does not write it to an application log. ')+'<a href="${PRIVACY}" target="_blank" rel="noopener">'+(lang==='es'?'Privacidad y términos':'Privacy & terms')+'</a></div>';e.innerHTML=h})();
</script>`;

const RESOURCE_META = { ui: { prefersBorder: true, csp: { connectDomains: [], resourceDomains: [] } }, 'openai/widgetDescription': 'A color-coded inventory triage card for Stock Semaphore.', 'openai/widgetPrefersBorder': true, 'openai/widgetCSP': { connect_domains: [], resource_domains: [], redirect_domains: ['https://jfcarpio.com'] } };
const rpc = (id, result) => ({ jsonrpc: '2.0', id, result });
const err = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });
function negotiated(requested) { return LEGACY_PROTOCOLS.includes(requested) ? requested : LEGACY_PROTOCOLS[0]; }

export function handle(msg) {
  const { id, method, params = {} } = msg || {};
  if (method === 'initialize') return rpc(id, { protocolVersion: negotiated(params.protocolVersion), capabilities: { tools: {}, resources: {} }, serverInfo: { name: 'stock-semaphore', version: '1.1.0' } });
  if (method && method.startsWith('notifications/')) return null;
  if (method === 'ping') return rpc(id, {});
  if (method === 'tools/list') return rpc(id, { tools: [TOOL] });
  if (method === 'resources/list') return rpc(id, { resources: [{ uri: WIDGET, name: 'Stock Semaphore widget', mimeType: MIME }] });
  if (method === 'resources/read') return params.uri === WIDGET ? rpc(id, { contents: [{ uri: WIDGET, mimeType: MIME, text: WIDGET_HTML, _meta: RESOURCE_META }] }) : err(id, -32602, 'Unknown resource');
  if (method === 'tools/call') {
    if (params.name !== TOOL.name) return err(id, -32602, 'Unknown tool');
    const locale = params._meta && params._meta['openai/locale'];
    const out = semaphore((params.arguments || {}).items, locale);
    const c = out.counts, t = I18N[out.locale];
    const focus = out.items.filter((x) => x.color === 'red' || x.color === 'orange').slice(0, 10).map((x) => `${x.name}: ${x.why}`).join('; ');
    const text = `${t.summary(c)}.${focus ? ' ' + focus + '.' : ''} ${out.locale === 'es' ? 'Para mantenerlo actualizado en tus dispositivos' : 'To keep it updated on your own devices'}: ${SITE}`;
    return rpc(id, { content: [{ type: 'text', text }], structuredContent: out, _meta: { ui: { resourceUri: WIDGET }, 'openai/outputTemplate': WIDGET } });
  }
  return err(id, -32601, 'Method not found');
}

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type, mcp-session-id, mcp-protocol-version', 'access-control-allow-methods': 'POST, GET, OPTIONS' };
export default { async fetch(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  const url = new URL(req.url);
  if (url.pathname !== '/mcp') return new Response('Stock Semaphore by friendly-123. MCP endpoint: /mcp', { headers: CORS });
  if (req.method === 'GET') return new Response('SSE stream not used by this stateless prototype', { status: 405, headers: CORS });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: CORS });
  let body; try { body = await req.json(); } catch (_) { return Response.json(err(null, -32700, 'Parse error'), { status: 400, headers: CORS }); }
  const out = Array.isArray(body) ? body.map(handle).filter(Boolean) : handle(body);
  if (out === null || (Array.isArray(out) && !out.length)) return new Response(null, { status: 202, headers: CORS });
  return Response.json(out, { headers: CORS });
} };
