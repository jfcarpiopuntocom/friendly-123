#!/usr/bin/env node
// Worker friendly123-com (friendly123.com): CI builder for Cloudflare Workers Builds.
// CRITICAL: accepts only the exact promoted stable commit, never master/next.
// No write to application data or another Worker. Source for /app/ = this repo's docs/.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..');
const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', timeout: 120000 }).trim();
const source = git('rev-parse', 'HEAD');
const remoteStable = git('ls-remote', 'origin', 'refs/heads/estable').split(/\s+/)[0];
if (!/^[a-f0-9]{40}$/.test(remoteStable) || source !== remoteStable) {
  throw new Error('STOP: Cloudflare may only publish exact origin/estable; local=' + source + ' stable=' + remoteStable);
}
const websiteDir = mkdtempSync(join(tmpdir(), 'f123-site-'));
try {
  execFileSync('git', ['clone', '--quiet', '--depth', '1', '--single-branch', '--branch', 'main',
    'https://github.com/jfcarpiopuntocom/website.git', websiteDir],
  { cwd: repo, timeout: 180000, stdio: 'inherit' });
  process.env.SITE_REPO = websiteDir;
  await import('./build.mjs');

  const dist = join(here, 'dist', 'app');
  const version = JSON.parse(readFileSync(join(dist, 'version.json'), 'utf8'));
  const manifestPath = join(dist, 'version-manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const sw = readFileSync(join(dist, 'sw.js'), 'utf8');
  if (manifest.shell !== version.shell || !sw.includes('const CACHE = "' + version.shell + '"')) {
    throw new Error('STOP: shell mismatch between SW, manifest and version.json');
  }
  // Only HTML with intentional official-domain SEO rewrites may change bytes;
  // the rest of the PWA must be byte-identical to the promoted stable release.
  const rewrites = new Set(['./index.html', './manual.html', './save.html']);
  const sha = file => 'sha256-' + createHash('sha256').update(readFileSync(file)).digest('hex');
  const changed = [];
  for (const [rel, expected] of Object.entries(manifest.files)) {
    const actual = sha(join(dist, rel.replace(/^\.\//, '')));
    if (expected === actual) continue;
    if (!rewrites.has(rel)) throw new Error('STOP: unexpected asset modification ' + rel);
    manifest.files[rel] = actual;
    changed.push(rel);
  }
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  writeFileSync(join(dist, '_release.json'), JSON.stringify({
    source: 'jfcarpiopuntocom/friendly-123', ref: 'estable', sha: source,
    shell: version.shell, cacheGeneration: version.cacheGeneration,
    seoRewrites: changed
  }, null, 2) + '\n');
  console.log('VERIFIED official domain app for exact stable release:', version.shell, source);
  console.log('SEO-only manifest corrections:', changed.join(', ') || '(none)');
} finally {
  rmSync(websiteDir, { recursive: true, force: true });
}
