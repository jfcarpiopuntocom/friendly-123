const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs"), path=require("node:path");
const root=path.join(__dirname,"../docs");
const read=n=>fs.readFileSync(path.join(root,n),"utf8");

test("app install identity exactly preserves legacy start_url fallback (no third identity)",()=>{
  const m=JSON.parse(read("manifest.json")),start=new URL(m.start_url,"https://jfcarpiopuntocom.github.io/friendly-123/manifest.json");
  const id=new URL(m.id,start.origin),fallback=start;
  assert.equal(id.href,fallback.href);
  assert.equal(m.scope,"./");
  assert.equal(m.display,"standalone");
});
test("dashboard is distinct installable PWA and never aliases the main app",()=>{
  const main=JSON.parse(read("manifest.json")),d=JSON.parse(read("dashboard.webmanifest"));
  const origin="https://jfcarpiopuntocom.github.io";
  assert.notEqual(new URL(main.id,origin).href,new URL(d.id,origin).href);
  assert.equal(new URL(d.start_url,origin+"/friendly-123/dashboard.webmanifest").pathname,"/friendly-123/dashboard.html");
  assert.equal(d.display,"standalone");
  assert.match(read("dashboard.html"),/rel="manifest" href="\.\/dashboard\.webmanifest"/);
});
test("PIN gate exposes manual per-install recovery, no destructive shortcut",()=>{
  const auth=read("auth-ui.js"),rescue=read("pwa-rescue.html");
  assert.match(auth,/id="oc-pwa-rescue-link"/);
  assert.match(auth,/href="\.\/pwa-rescue\.html"/);
  assert.match(rescue,/f123_pwa_install_tag_v1/);
  assert.match(rescue,/Export backup/);
  assert.match(rescue,/Pendientes y ACK Sync3: NO VERIFICABLES/);
  for(const dangerous of [/localStorage\.clear\s*\(/,/indexedDB\.deleteDatabase\s*\(/,/caches\.delete\s*\(/,/serviceWorker\.getRegistrations\s*\(/,/\.unregister\s*\(/]){
    assert.doesNotMatch(rescue,dangerous);
  }
});
test("service worker offline precaches the rescue and both distinct manifests",()=>{
  const sw=read("sw.js");
  for(const file of ["./pwa-rescue.html","./dashboard.webmanifest","./manifest.json"])assert.ok(sw.includes('"'+file+'"'));
});
