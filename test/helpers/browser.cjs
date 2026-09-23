// Isolated browser fixture: no network, real credentials, or disk-backed business data.
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
function storage() {
  const entries = new Map();
  return { get length() { return entries.size; }, key: i => [...entries.keys()][i],
    getItem: k => entries.get(k) ?? null, setItem: (k, v) => entries.set(k, String(v)),
    removeItem: k => entries.delete(k) };
}
function browser(ls = storage()) {
  const listeners = new Map();
  const w = { localStorage: ls, sessionStorage: storage(),
    location: { origin: 'http://fixture.invalid', reload() {} },
    addEventListener(type, fn) { if (!listeners.has(type)) listeners.set(type, []); listeners.get(type).push(fn); },
    dispatchEvent(event) { for (const fn of listeners.get(event.type) || []) fn(event); },
    fetch: async () => { throw new Error('Network prohibited in sync fixture'); },
    CustomEvent: class { constructor(type, options) { this.type = type; Object.assign(this, options); } },
    URL, console: { warn() {}, error() {}, log() {} },
    setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    crypto: { randomUUID }, navigator: {}, Response, Headers, Request, JSON,
    document: { getElementById: () => null, querySelectorAll: () => [],
      createElement: () => ({ style: {}, setAttribute() {}, addEventListener() {}, appendChild() {} }),
      addEventListener() {}, body: null, documentElement: { appendChild() {} } } };
  w.window = w; w.globalThis = w; w.self = w;
  // The app loads crypto-store before mock-backend; model a healthy PIN
  // verifier by default, while individual tests can override it to fail.
  w.OCSecure = { estadoSecreto: () => 'ok', coincidePin: async () => false, leerPinsVisibles: () => null };
  vm.createContext(w);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../../docs/mock-backend.js'), 'utf8'), w);
  w.request = async (url, method = 'GET', body) => {
    const response = await w.fetch(url, { method, body: body === undefined ? undefined : JSON.stringify(body) });
    const result = await response.json();
    if (response.status >= 400) throw new Error(`${method} ${url}: ${response.status} ${JSON.stringify(result)}`);
    return result;
  };
  w.catalog = () => JSON.parse(JSON.stringify(w.OCSync.catalogoPropio()));
  w.receive = source => w.OCSync.aplicarCatalogo(source.catalog(), null);
  return w;
}
module.exports = { browser };
