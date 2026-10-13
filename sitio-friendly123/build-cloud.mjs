#!/usr/bin/env node
// friendly123-com: fail-closed Cloudflare Workers Builds production builder.
// Reads public Git sources only. NEVER writes KV, licenses, product data, or other Workers.
// Only a promoted 'estable' commit may become friendly123.com/app/.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..');
const git = (...args) => execFileSync('git', args, {
  cwd: repo, encoding: 'utf8', timeout: 120000, maxBuffer: 8 * 1024 * 1024
}).trim();
const validSha = x => /^[a-f0-9]{40}$/.test(x);
const fail = message => { throw new Error('STOP friendly123-com: ' + message); };
const sha = file => 'sha256-' + createHash('sha256').update(readFileSync(file)).digest('hex');

// A branch name in the build UI is not enough. Require the EXACT remote approved commit.
const source = git('rev-parse', 'HEAD');
const remoteStable = git('ls-remote', 'origin', 'refs/heads/estable').split(/\s+/)[0];
if (!validSha(source) || !validSha(remoteStable) || source !== remoteStable)
  fail('checkout is not the current origin/estable; local=' + source + ' stable=' + remoteStable);

// A moving website/main must NEVER silently replace already-approved landing content.
const websiteSha = readFileSync(join(here, 'website-source-lock.sha'), 'utf8').trim();
if (!validSha(websiteSha)) fail('missing or invalid approved website SHA');
const websiteDir = mkdtempSync(join(tmpdir(), 'f123-site-'));
try {
  execFileSync('git', ['clone', '--quiet', '--depth', '1', '--single-branch', '--branch', 'main',
    'https://github.com/jfcarpiopuntocom/website.git', websiteDir], { cwd: repo, timeout: 180000, stdio: 'inherit' });
  // A past, independently approved SHA remains usable even after website/main advances.
  execFileSync('git', ['-C', websiteDir, 'fetch', '--quiet', '--depth', '1', 'origin', websiteSha],
    { cwd: repo, timeout: 180000, stdio: 'inherit' });
  const actualWebsiteSha = execFileSync('git', ['-C', websiteDir, 'rev-parse', 'FETCH_HEAD'],
    { encoding: 'utf8', timeout: 30000 }).trim();
  if (actualWebsiteSha !== websiteSha) fail('website source does not match pinned SHA');

  process.env.SITE_REPO = websiteDir;
  process.env.SITE_REF = websiteSha;
  await import('./build.mjs');

  const distRoot = join(here, 'dist');
  const app = join(distRoot, 'app');
  const version = JSON.parse(readFileSync(join(app, 'version.json'), 'utf8'));
  const sourceVersion = JSON.parse(readFileSync(join(repo, 'docs', 'version.json'), 'utf8'));
  const sourceManifest = JSON.parse(readFileSync(join(repo, 'docs', 'version-manifest.json'), 'utf8'));
  const manifestPath = join(app, 'version-manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const sw = readFileSync(join(app, 'sw.js'), 'utf8');
  if (!version.shell || version.shell !== sourceVersion.shell ||
      version.cacheGeneration !== sourceVersion.cacheGeneration ||
      version.shell !== manifest.shell || version.shell !== sourceManifest.shell ||
      !sw.includes('const CACHE = "' + version.shell + '"'))
    fail('source/SW/version/manifest shells or cache generations are inconsistent');

  const sourceFiles = sourceManifest.files;
  if (!sourceFiles || typeof sourceFiles !== 'object' || Object.keys(sourceFiles).length < 20 ||
      JSON.stringify(Object.keys(manifest.files).sort()) !== JSON.stringify(Object.keys(sourceFiles).sort()))
    fail('manifest keys changed, missing, or too few');

  // Verify committed source bytes BEFORE permitting any sanctioned SEO rewriting.
  const rewrites = new Set(['./index.html', './manual.html', './save.html']);
  const changed = [];
  for (const [rel, expected] of Object.entries(sourceFiles)) {
    if (!/^\.\/[a-zA-Z0-9_./-]+$/.test(rel) || rel.includes('..') ||
        !/^sha256-[a-f0-9]{64}$/.test(expected))
      fail('invalid manifest entry ' + rel);
    const path = rel.slice(2);
    if (sha(join(repo, 'docs', path)) !== expected)
      fail('unverified source asset ' + rel);
    const packaged = join(app, path);
    if (!existsSync(packaged)) fail('missing packaged asset ' + rel);
    const actual = sha(packaged);
    if (expected === actual) continue;
    if (!rewrites.has(rel)) fail('unexpected change in packaged app asset ' + rel);
    manifest.files[rel] = actual;
    changed.push(rel);
  }

  // Do not ship a broken old landing: builder may only refer to WebP if sharp generated it.
  if (!existsSync(join(distRoot, 'index.html')) ||
      !existsSync(join(distRoot, '_headers')) ||
      !existsSync(join(distRoot, '_redirects')) ||
      !existsSync(join(app, 'index.html')) ||
      !existsSync(join(app, 'sw.js'))) fail('essential static files missing');

  // If estable moved during build, reject this stale build BEFORE deployment.
  const latestStable = git('ls-remote', 'origin', 'refs/heads/estable').split(/\s+/)[0];
  if (latestStable !== source) fail('estable changed during build; retry latest SHA');

  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  // Static proof: a GET never consults Cloudflare KV. No customer data exposed.
  writeFileSync(join(app, '_release.json'), JSON.stringify({
    source: 'jfcarpiopuntocom/friendly-123',
    ref: 'estable',
    sha: source,
    websiteSha,
    shell: version.shell,
    cacheGeneration: version.cacheGeneration,
    seoRewrites: changed
  }, null, 2) + '\n');

  console.log('PASS official domain app:', version.shell, source);
  console.log('Pinned marketing source:', websiteSha);
  console.log('Verified files:', Object.keys(sourceFiles).length, '| SEO-only changes:', changed);
} finally {
  rmSync(websiteDir, { recursive: true, force: true });
}
