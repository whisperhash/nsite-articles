import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');

const pkg = JSON.parse(
  readFileSync(resolve(repoRoot, 'node_modules/nostr-tools/package.json'), 'utf8'),
);

await build({
  stdin: {
    contents: `export * from 'nostr-tools';\n`,
    resolveDir: repoRoot,
    sourcefile: 'vendor-entry.mjs',
    loader: 'js',
  },
  bundle: true,
  format: 'esm',
  outfile: resolve(repoRoot, 'vendor/nostr-tools.js'),
  platform: 'browser',
  target: 'es2022',
  legalComments: 'inline',
  banner: {
    js: `// nostr-tools@${pkg.version} - bundled by scripts/build-vendor.mjs\n`
      + `// Re-run \`npm run build:vendor\` after upgrading nostr-tools in package.json.\n`,
  },
});

console.log(`vendor/nostr-tools.js built from nostr-tools@${pkg.version}`);
