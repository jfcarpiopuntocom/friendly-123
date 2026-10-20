// node chatgpt-app/stock-semaphore/test.mjs  (sin dependencias)
import assert from 'node:assert/strict';
import w, { classify } from './worker.js';
const c = (o) => classify(o).color;
assert.equal(c({ name: 'a', stock: 0 }), 'red');
assert.equal(c({ name: 'a', stock: 1, red_at: 1 }), 'red');
assert.equal(c({ name: 'a', stock: 3, red_at: 1, low_at: 3 }), 'orange');
assert.equal(c({ name: 'a', stock: 9, days_since_last_sale: 45 }), 'black');
assert.equal(c({ name: 'a', stock: 9, price: 10, cost: 5 }), 'yellow');
assert.equal(c({ name: 'a', stock: 9, price: 10, cost: 8 }), 'green');
assert.equal(c({ name: 'a', stock: 9, expires_in_days: 2 }), 'red');
const call = async (m) => (await w.fetch(new Request('https://x/mcp', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(m) }))).json();
assert.equal((await call({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })).result.serverInfo.name, 'stock-semaphore');
assert.equal((await call({ jsonrpc: '2.0', id: 2, method: 'tools/list' })).result.tools[0].name, 'stock_semaphore');
const r = await call({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'stock_semaphore', arguments: { items: [{ name: 'Mugs', stock: 12, price: 10, cost: 7 }, { name: 'Candles', stock: 0 }] } } });
assert.equal(r.result.structuredContent.items[0].name, 'Candles');
assert.match(r.result.content[0].text, /friendly123/);
assert.equal((await call({ jsonrpc: '2.0', id: 4, method: 'resources/read', params: { uri: 'ui://widget/stock-semaphore.html' } })).result.contents[0].mimeType, 'text/html+skybridge');
console.log('stock-semaphore: OK');
