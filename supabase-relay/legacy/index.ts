import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import { createRelayTransport } from '../transport.mjs';
import { attachLegacySocket } from './bridge.mjs';

// No service-role credential is used. Authentication is the owner's approved
// secret-room capability, checked before the HTTP upgrade by the same adapter.
// Keep the capability out of the URL: the proxy/browser supplies a WS protocol.
Deno.serve(async request => {
  const url = new URL(request.url);
  if (url.pathname.endsWith('/health')) return new Response('friendly relay compatibility ok', { headers: { 'cache-control': 'no-store' } });
  if (request.method !== 'GET' || (request.headers.get('upgrade') || '').toLowerCase() !== 'websocket') return new Response('expected websocket', { status: 426 });
  const offered = (request.headers.get('sec-websocket-protocol') || '').split(',').map(p => p.trim());
  const capabilities = offered.filter(p => /^friendly\.[A-Za-z0-9_-]{1,128}$/.test(p));
  if (capabilities.length !== 1) return new Response('forbidden', { status: 403 });
  const room = capabilities[0].slice(9);
  const apiUrl = Deno.env.get('SUPABASE_URL'), anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!apiUrl || !anonKey) return new Response('service unavailable', { status: 503 });
  const client = createClient(apiUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(6000) }) }
  });
  const transport = createRelayTransport({ client }), relay = transport.connect(room);
  const cleanup = () => transport.dispose();
  const initialFrames = []; let initialBytes = 0;
  const collect = event => {
    initialBytes += typeof event.data === 'string' ? new TextEncoder().encode(event.data).length : event.data.byteLength || 0;
    if (initialBytes > 4 * 1024 * 1024) relay.close();
    else initialFrames.push(event.data);
  };
  relay.addEventListener('message', collect);
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('join timeout')), 8000);
      relay.onopen = () => { clearTimeout(timer); resolve(undefined); };
      relay.onclose = () => { clearTimeout(timer); reject(new Error('room unavailable')); };
    });
    relay.onopen = relay.onclose = null;
    const { socket, response } = Deno.upgradeWebSocket(request, { protocol: capabilities[0] });
    relay.removeEventListener('message', collect);
    // Required by the provider: keep the worker alive until the socket closes.
    // End before the Free plan's wall-clock limit so clients reconnect cleanly.
    EdgeRuntime.waitUntil(attachLegacySocket({ incoming: socket, relay, cleanup, initialFrames }));
    return response;
  } catch (_) {
    await cleanup();
    return new Response('room unavailable', { status: 403, headers: { 'cache-control': 'no-store' } });
  }
});
