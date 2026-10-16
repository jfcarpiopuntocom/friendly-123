import { createClient } from '@supabase/supabase-js';
import { createRelayTransport } from './transport.mjs';
import { createRelayGateway } from './gateway.mjs';

// Build-time values are a public project URL and publishable key, never an
// administrative credential. No customer room is registered or activated here.
const client = createClient(F123_SUPABASE_URL, F123_SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  global: { fetch: async (input, init) => {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 5000);
    try { return await fetch(input, { ...init, signal: controller.signal }); }
    finally { clearTimeout(timer); }
  } }
});
const native = createRelayTransport({ client });
const gateway = createRelayGateway({
  async resolveRoute(room) {
    const result = await client.rpc('f123_relay_route', { p_room: room });
    if (result.error) throw result.error;
    return result.data;
  },
  native: room => native.connect(room)
});
window.F123Relay = gateway;
