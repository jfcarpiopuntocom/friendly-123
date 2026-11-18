const path = require('node:path');
const esbuild = require('esbuild');

esbuild.build({
  absWorkingDir: path.join(__dirname, '..'),
  nodePaths: (process.env.NODE_PATH || '').split(path.delimiter).filter(Boolean),
  entryPoints: ['src/yparty-piloto.js'],
  outfile: 'docs/vendor/yparty-piloto.min.js',
  platform: 'browser',
  format: 'iife',
  bundle: true,
  minify: true,
  legalComments: 'inline',
  plugins: [{
    name: 'friendly-yjs',
    setup(build) {
      build.onResolve({ filter: /^yjs$/ }, () => ({ path: 'yjs', namespace: 'friendly' }));
      build.onLoad({ filter: /.*/, namespace: 'friendly' }, () => ({
        contents: 'export const { Doc, encodeStateVector, encodeStateAsUpdate, applyUpdate } = window.Y;'
      }));
    }
  }]
}).catch(() => { process.exitCode = 1; });
