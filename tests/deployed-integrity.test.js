import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { nip19, SimplePool } from '../vendor/nostr-tools.js';
import { RUNTIME_RELAYS } from '../src/relays.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');

const npub = process.env.DEPLOY_NPUB;
const gateway = process.env.NSITE_GATEWAY ?? 'nsite.lol';
const NSITE_MANIFEST_KIND = 15128;

let pubkey;
let files;

beforeAll(() => {
  if (!npub) {
    throw new Error(
      'Set DEPLOY_NPUB=npub1… (the site identity) to run integrity tests. '
        + 'Optionally set NSITE_GATEWAY (default: nsite.lol).',
    );
  }
  const decoded = nip19.decode(npub);
  if (decoded.type !== 'npub') {
    throw new Error(`DEPLOY_NPUB must be an npub1…, got "${decoded.type}"`);
  }
  pubkey = decoded.data;
  files = collectRuntimeFiles();
  if (files.length === 0) {
    throw new Error('No runtime files found to verify. Did you run `npm run build`?');
  }
});

function collectRuntimeFiles() {
  const distDir = resolve(repoRoot, 'dist');
  return walkDir(distDir)
    .filter((p) => statSync(p).isFile())
    .map((abs) => {
      const buf = readFileSync(abs);
      const hash = createHash('sha256').update(buf).digest('hex');
      const path = '/' + relative(distDir, abs).split('\\').join('/');
      return { absPath: abs, path, hash, size: buf.length };
    });
}

function walkDir(dir) {
  let out = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out = out.concat(walkDir(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

describe('deployed integrity', () => {
  it('site manifest event lists every runtime file with the correct hash', async () => {
    const pool = new SimplePool();
    try {
      const events = await pool.querySync(RUNTIME_RELAYS, {
        authors: [pubkey],
        kinds: [NSITE_MANIFEST_KIND],
      });
      expect(events.length, `no kind:${NSITE_MANIFEST_KIND} manifest event found`).toBeGreaterThan(0);
      const manifest = events.sort((a, b) => b.created_at - a.created_at)[0];
      for (const f of files) {
        const pathTag = manifest.tags.find((t) => t[0] === 'path' && t[1] === f.path);
        expect(pathTag, `no path tag for ${f.path} in manifest ${manifest.id}`).toBeDefined();
        expect(pathTag[2], `manifest hash mismatch for ${f.path} (local=${f.hash})`).toBe(f.hash);
      }
    } finally {
      try { pool.close(RUNTIME_RELAYS); } catch { /* ignore */ }
    }
  }, 30_000);

  it('every runtime file is served by the gateway with matching sha256', async () => {
    for (const f of files) {
      const url = `https://${npub}.${gateway}${f.path}`;
      const res = await fetch(url);
      expect(res.status, `gateway returned ${res.status} for ${url}`).toBe(200);
      const buf = new Uint8Array(await res.arrayBuffer());
      const hex = createHash('sha256').update(buf).digest('hex');
      expect(hex, `gateway body hash mismatch for ${url} (local=${f.hash})`).toBe(f.hash);
    }
  }, 60_000);
});
