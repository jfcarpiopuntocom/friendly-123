// Reproducible browser asset. Inputs are public configuration, never service_role.
const fs = require('node:fs'), path = require('node:path');
const root = path.join(__dirname, '..');
const esbuild = require(path.join(root, 'supabase-relay/node_modules/esbuild'));
const configPath = process.argv[2];
if (!configPath) throw Error('Supply a local JSON file with url and publishableKey');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
if (!/^https:\/\/[a-z0-9]{20}\.supabase\.co$/.test(config.url) || !/^sb_publishable_[A-Za-z0-9_-]+$/.test(config.publishableKey)) throw Error('Only public Supabase configuration is accepted');
esbuild.buildSync({
  entryPoints: [path.join(root, 'supabase-relay/browser-entry.mjs')],
  outfile: path.join(root, 'docs/vendor/supabase-relay.min.js'),
  bundle: true, minify: true, format: 'iife', target: ['es2020'], legalComments: 'eof',
  // Preserve literal whitespace through escaped strings instead of raw
  // multiline templates; never trim generated source inside SDK strings.
  supported: { 'template-literal': false },
  define: { F123_SUPABASE_URL: JSON.stringify(config.url), F123_SUPABASE_PUBLISHABLE_KEY: JSON.stringify(config.publishableKey) }
});
console.log('Built local encrypted relay adapter; no room activated.');
