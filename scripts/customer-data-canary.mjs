#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import cp from 'node:child_process';
import crypto from 'node:crypto';

const root = process.cwd();
const mode = process.argv.includes('--enforce') ? 'enforce' : 'shadow';
const out = { gate:'customer-data-canary', mode, status:'PASS', blockers:[], warnings:[], evidence:[] };
const add = (kind, code, detail) => { out[kind].push({code,detail}); if(kind==='blockers') out.status='BLOCK'; else if(out.status==='PASS') out.status='WATCH'; };
const read = p => fs.readFileSync(path.join(root,p),'utf8');
const exists = p => fs.existsSync(path.join(root,p));
const run = cmd => cp.execSync(cmd,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();

async function cryptoIsolation() {
  const subtle = crypto.webcrypto.subtle;
  const enc = new TextEncoder();
  const derive = async code => {
    const base = await subtle.importKey('raw',enc.encode(code),'PBKDF2',false,['deriveKey']);
    return subtle.deriveKey({name:'PBKDF2',salt:enc.encode('amigable-sync-v1'),iterations:100000,hash:'SHA-256'},base,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
  };
  const A='F123-CANARY-A-0001', B='F123-CANARY-B-0002';
  const ka=await derive(A), kb=await derive(B), iv=crypto.webcrypto.getRandomValues(new Uint8Array(12));
  const plain=enc.encode(JSON.stringify({tenant:'CANARY-A',product:'ALPHA-ONLY'}));
  const cipher=await subtle.encrypt({name:'AES-GCM',iv},ka,plain);
  const ok=JSON.parse(new TextDecoder().decode(await subtle.decrypt({name:'AES-GCM',iv},ka,cipher)));
  if(ok.tenant!=='CANARY-A') add('blockers','RC001','Correct canary tenant could not read its own payload');
  let wrongOpened=false; try { await subtle.decrypt({name:'AES-GCM',iv},kb,cipher); wrongOpened=true; } catch {}
  if(wrongOpened) add('blockers','RC002','Wrong canary tenant decrypted another tenant payload');
  out.evidence.push({code:'crypto-room-isolation', pass:!wrongOpened});
}

try {
  await cryptoIsolation();

  for (const p of ['docs/auth-ui.js','docs/dashboard.html','docs/sync-realtime.js','test/sync-zero-trust.test.js']) {
    if (!exists(p)) add('blockers','RC003',`Required isolation evidence missing: ${p}`);
  }
  if (exists('docs/auth-ui.js')) {
    const s=read('docs/auth-ui.js');
    if (!s.includes('f123_owned') || !s.includes('f123_tienda_activa')) add('blockers','RC004','Owner/admin demo guard is missing from auth-ui.js');
  }
  if (exists('docs/dashboard.html')) {
    const s=read('docs/dashboard.html');
    if (!s.includes('f123_owned') || !s.includes('f123_tienda_activa')) add('blockers','RC005','Dashboard local-data ownership guard is missing');
  }

  let diff='';
  try { diff=run(`git diff --no-ext-diff --unified=0 ${process.env.GUARD_BASE || 'origin/master'}...HEAD -- docs cloudflare-worker cloudflare-sync-relay`); }
  catch { try { diff=run('git diff --no-ext-diff --unified=0 HEAD~1..HEAD -- docs cloudflare-worker cloudflare-sync-relay'); } catch { add('warnings','RC006','Could not scan added production lines'); } }
  const added=diff.split(/\r?\n/).filter(l=>l.startsWith('+')&&!l.startsWith('+++')).join('\n');

  const foreign = new RegExp(process.env.CANARY_FOREIGN_MARKERS || 'cappuccino|capuccino|espresso|sample business|demo customer|demo product','i');
  if (foreign.test(added)) add('blockers','RC007','Foreign/demo fixture marker added to production code');

  const licenseLike=/F123-[A-Z0-9]{4,}(?:-[A-Z0-9]{4,}){2,}/g;
  const licenses=[...added.matchAll(licenseLike)].map(m=>m[0]).filter(x=>!/(CANARY|PRUEBA|TEST|AAAA|BBBB|CCCC|DDDD|CLIENTE-DE-PRUEBA|DOBLE-DE-PRUEBA)/i.test(x));
  if(licenses.length) add('blockers','RC008',`Possible real license literal added to production code: ${[...new Set(licenses)].join(', ')}`);

  const suspiciousTenantBypass=[/room(Id)?\s*=\s*["'][^"']+["']/i,/license(Code)?\s*=\s*["'][^"']+["']/i,/f123_owned["']?\s*[:,=]\s*["'][^"']+["']/i];
  for(const re of suspiciousTenantBypass) if(re.test(added)) add('warnings','RC009',`Review possible hard-coded tenant identity: ${re}`);

  if (exists('test/sync-zero-trust.test.js')) {
    const z=read('test/sync-zero-trust.test.js');
    if(!/una sala equivocada NO descifra/i.test(z)) add('blockers','RC010','Cross-license cryptographic isolation regression is missing');
  }
} catch(e) { add('blockers','RC999',e.stack||e.message||String(e)); }

fs.mkdirSync('.artifacts',{recursive:true});
fs.writeFileSync('.artifacts/customer-data-canary.json',JSON.stringify(out,null,2));
console.log(JSON.stringify(out,null,2));
if(out.status==='BLOCK' || (mode==='enforce' && out.status==='WATCH')) process.exit(1);
