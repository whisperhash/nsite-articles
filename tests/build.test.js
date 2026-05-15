import { describe, it, expect, beforeAll } from 'vitest';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { JSDOM } from 'jsdom';
import { buildSite } from '../scripts/build.mjs';

let outPath;
let html;
let doc;

beforeAll(async () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'nostr-articles-build-'));
  const result = await buildSite({ outDir: tmpDir });
  outPath = result.outPath;
  html = readFileSync(outPath, 'utf8');
  doc = new JSDOM(html).window.document;
}, 30_000);

describe('build.mjs', () => {
  it('writes index.html into the target directory', () => {
    expect(existsSync(outPath)).toBe(true);
    expect(outPath.endsWith('/index.html')).toBe(true);
  });

  it('produces well-formed HTML with the expected page structure', () => {
    expect(doc.querySelector('html')).not.toBeNull();
    expect(doc.querySelector('head > title')?.textContent).toBe('Latest Nostr articles');
    expect(doc.querySelector('body > .topbar')).not.toBeNull();
    expect(doc.querySelector('body > main.layout')).not.toBeNull();
    expect(doc.querySelector('#hashtags')).not.toBeNull();
    expect(doc.querySelector('#articles')).not.toBeNull();
    expect(doc.querySelector('#mode-toggle')).not.toBeNull();
  });

  it('inlines the stylesheet as a <style> element with real rules', () => {
    const styles = doc.querySelectorAll('style');
    expect(styles).toHaveLength(1);
    const text = styles[0].textContent;
    expect(text.length).toBeGreaterThan(500);
    expect(text).toContain('.card');
    expect(text).toContain('--accent');
  });

  it('inlines the JS bundle as a single <script type="module"> with no src attribute', () => {
    const moduleScripts = doc.querySelectorAll('script[type="module"]');
    expect(moduleScripts).toHaveLength(1);
    const script = moduleScripts[0];
    expect(script.getAttribute('src')).toBeNull();
    expect(script.textContent.length).toBeGreaterThan(10000);
  });

  it('removes every dev-mode asset reference', () => {
    expect(html).not.toMatch(/href="styles\/style\.css"/);
    expect(html).not.toMatch(/src="src\/app\.js"/);
    expect(doc.querySelector('link[rel="stylesheet"]')).toBeNull();
    expect(doc.querySelector('script[src]')).toBeNull();
  });

  it('the inlined script does not contain the literal placeholder string (regression: $& expansion)', () => {
    const script = doc.querySelector('script[type="module"]').textContent;
    expect(script).not.toContain('<script type="module" src="src/app.js"></script>');
  });

  it('preserves the runtime DOM hooks that app.js binds to', () => {
    expect(doc.querySelector('input[type="radio"][name="mode"][value="OR"]')).not.toBeNull();
    expect(doc.querySelector('input[type="radio"][name="mode"][value="AND"]')).not.toBeNull();
  });
});
