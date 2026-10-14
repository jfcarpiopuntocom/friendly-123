// Official app reads the same published stable source; no client-data transfer.
const SOURCE='https://jfcarpiopuntocom.github.io/friendly-123/';
const SECURITY={"Strict-Transport-Security":"max-age=31536000; includeSubDomains","X-Content-Type-Options":"nosniff","Referrer-Policy":"strict-origin-when-cross-origin","Permissions-Policy":"camera=(self), microphone=(), geolocation=(self), payment=()","Content-Security-Policy-Report-Only":"default-src 'self'; script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://unpkg.com https://cdn.sheetjs.com https://cdn.tailwindcss.com https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://unpkg.com https://cdn.jsdelivr.net; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob: https:; media-src 'self' blob: data:; connect-src 'self' https://friendly123-licencias.jfcarpio.workers.dev wss://friendly123-sync-relay.jfcarpio.workers.dev https://o4512176001908736.ingest.us.sentry.io https://us.i.posthog.com https://ipapi.co; frame-src 'self'; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self' https://wa.me"};
export async function serveApp(request,env,readSource=fetch){
 const u=new URL(request.url);
 if(u.pathname!=='/app'&&!u.pathname.startsWith('/app/'))return env.ASSETS.fetch(request);
 if(u.pathname==='/app'){u.pathname='/app/';return new Response(null,{status:301,headers:{Location:u.href,'Cache-Control':'no-cache'}});}
 if(!['GET','HEAD'].includes(request.method))return new Response('Method not allowed',{status:405,headers:{Allow:'GET, HEAD'}});
 let relative=u.pathname.replace(/^\/app\/?/,'')||'index.html';
 try{if(decodeURIComponent(relative).split('/').some(p=>p==='..'||p==='.')||relative.includes('\\'))return new Response('Not found',{status:404});}catch(_){return new Response('Not found',{status:404});}
 const proof=relative==='_release.json';
 if(proof)relative='release-proof.json';
 const source=new URL(relative,SOURCE);if(!source.href.startsWith(SOURCE))return new Response('Not found',{status:404});
 // Public nonce avoids a stale CDN alias; never forward cookies, headers or business query data.
 source.searchParams.set('official',String(Date.now()));
 try{
  const upstream=await readSource(source.href,{method:request.method,redirect:'manual',cache:'no-store',signal:AbortSignal.timeout(10000)});
  if(upstream.status>=300&&upstream.status<400)return new Response('App source temporarily unavailable',{status:503,headers:{'Cache-Control':'no-store'}});
  const h=new Headers(upstream.headers);h.set('Cache-Control','public, no-cache, max-age=0, must-revalidate, no-transform');for(const [k,v]of Object.entries(SECURITY))h.set(k,v);h.delete('set-cookie');h.delete('content-length');
  if(proof&&upstream.ok&&request.method==='GET'){const p=await upstream.json();if(!/^[a-f0-9]{40}$/.test(p.commit||'')||!/^f123-shell-v\d+$/.test(p.shell||''))throw Error('invalid source proof');h.set('Content-Type','application/json');h.delete('content-encoding');return new Response(JSON.stringify({...p,source:'jfcarpiopuntocom/friendly-123',ref:'estable',sha:p.commit,delivery:'same-published-source'}),{status:200,headers:h});}
  return new Response(upstream.body,{status:upstream.status,headers:h});
 }catch(_){return new Response('App source temporarily unavailable. Existing offline copies remain on your device.',{status:503,headers:{'Cache-Control':'no-store','Content-Type':'text/plain; charset=utf-8'}});}
}
export default {fetch(request,env){return serveApp(request,env);}};
