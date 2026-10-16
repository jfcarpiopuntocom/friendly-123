// Stateless compatibility proxy. No DO, database, key or per-frame fetch here.
// The upstream checks the registered secret-room capability before upgrading.
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const headers = { 'cache-control': 'no-store', 'access-control-allow-origin': '*' };
    if (url.pathname === '/health') return new Response('friendly supabase relay ok', { headers });
    const match = url.pathname.match(/^\/sala\/([A-Za-z0-9_-]{1,128})$/);
    if (!match) return new Response('not found', { status: 404, headers });
    if (request.method !== 'GET' || (request.headers.get('upgrade') || '').toLowerCase() !== 'websocket') return new Response('expected websocket', { status: 426, headers });
    if (!/^https:\/\/[a-z0-9]{20}\.supabase\.co$/.test(env.SUPABASE_ORIGIN || '')) return new Response('service unavailable', { status: 503, headers });
    try {
      const upstreamHeaders = new Headers();
      for (const name of ['upgrade', 'connection', 'sec-websocket-key', 'sec-websocket-version']) {
        const value = request.headers.get(name); if (value) upstreamHeaders.set(name, value);
      }
      // Keep the capability out of the upstream URL and out of gateway URL logs.
      upstreamHeaders.set('sec-websocket-protocol', 'friendly.' + match[1]);
      const upstream = await fetch(env.SUPABASE_ORIGIN + '/functions/v1/relay-legacy/socket', { headers: upstreamHeaders });
      if (upstream.status !== 101 || !upstream.webSocket) {
        await upstream.body?.cancel();
        return new Response('room unavailable', { status: upstream.status === 403 ? 403 : 503, headers });
      }
      const responseHeaders = new Headers(upstream.headers);
      // Original clients did not offer the upstream authentication protocol.
      // Their browser must not receive an unsolicited protocol selection.
      responseHeaders.delete('sec-websocket-protocol');
      responseHeaders.set('cache-control', 'no-store');
      return new Response(null, { status: 101, webSocket: upstream.webSocket, headers: responseHeaders });
    } catch (_) { return new Response('relay unavailable', { status: 503, headers }); }
  }
};
