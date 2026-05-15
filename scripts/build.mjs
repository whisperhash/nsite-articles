import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');

const CSS_PLACEHOLDER = '<link rel="stylesheet" href="styles/style.css">';
const JS_PLACEHOLDER = '<script type="module" src="src/app.js"></script>';

export async function buildSite({ outDir, minify = true } = {}) {
  const targetDir = outDir ?? resolve(repoRoot, 'dist');

  const bundleResult = await build({
    entryPoints: [resolve(repoRoot, 'src/app.js')],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    minify,
    write: false,
    legalComments: 'inline',
  });
  if (bundleResult.outputFiles.length !== 1) {
    throw new Error(
      `esbuild produced ${bundleResult.outputFiles.length} output files; expected 1.`,
    );
  }
  const js = bundleResult.outputFiles[0].text;

  const css = readFileSync(resolve(repoRoot, 'styles/style.css'), 'utf8');
  const html = readFileSync(resolve(repoRoot, 'index.html'), 'utf8');

  if (/<\/script/i.test(js)) {
    throw new Error(
      'Bundled JS contains "</script" which would close the inline <script> tag early. Refusing to write a corrupt artifact.',
    );
  }
  if (/<\/style/i.test(css)) {
    throw new Error('CSS contains "</style" which would close the inline <style> tag early.');
  }

  for (const [label, needle] of [
    ['CSS link', CSS_PLACEHOLDER],
    ['JS script', JS_PLACEHOLDER],
  ]) {
    const occurrences = html.split(needle).length - 1;
    if (occurrences !== 1) {
      throw new Error(
        `Expected exactly 1 occurrence of ${label} placeholder in index.html, found ${occurrences}. Template drifted from build script expectations.`,
      );
    }
  }

  const inlineCss = `<style>${css}</style>`;
  const inlineJs = `<script type="module">${js}</script>`;
  const output = html
    .replace(CSS_PLACEHOLDER, () => inlineCss)
    .replace(JS_PLACEHOLDER, () => inlineJs);

  if (output.includes('href="styles/style.css"') || output.includes('src="src/app.js"')) {
    throw new Error(
      'Substitution failed: original asset references still present in output.',
    );
  }

  mkdirSync(targetDir, { recursive: true });
  const outPath = resolve(targetDir, 'index.html');
  writeFileSync(outPath, output);

  return { outPath, size: output.length, jsSize: js.length, cssSize: css.length };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { outPath, size, jsSize, cssSize } = await buildSite();
  console.log(
    `Built ${outPath} (${(size / 1024).toFixed(1)} KB; js=${(jsSize / 1024).toFixed(1)} KB, css=${(cssSize / 1024).toFixed(1)} KB)`,
  );
}
