import { describe, it, expect } from 'vitest';
import {
  fetchArticles,
  fetchProfiles,
  ARTICLE_KIND,
  METADATA_KIND,
} from '../src/nostr-client.js';

function makeArticle({ id, ts, tags = [['t', 'rust']], pubkey = 'pk' }) {
  return {
    id,
    kind: ARTICLE_KIND,
    pubkey,
    created_at: ts,
    content: '',
    sig: '',
    tags,
  };
}

class FakePool {
  constructor(scriptedBatches) {
    this.scripted = [...scriptedBatches];
    this.calls = [];
  }
  async querySync(relays, filter) {
    this.calls.push({ relays, filter: { ...filter } });
    return this.scripted.shift() ?? [];
  }
}

const RELAYS = ['wss://r1', 'wss://r2'];

describe('fetchArticles', () => {
  it('returns 21 events from a single round when relays have plenty', async () => {
    const batch = Array.from({ length: 30 }, (_, i) =>
      makeArticle({ id: `id${i}`, ts: 1000 - i }),
    );
    const pool = new FakePool([batch]);
    const result = await fetchArticles(pool, RELAYS, { timeoutMs: 0 });
    expect(result).toHaveLength(21);
    expect(result[0].id).toBe('id0');
    expect(result[20].id).toBe('id20');
    expect(pool.calls).toHaveLength(1);
  });

  it('sorts results by created_at desc', async () => {
    const batch = [
      makeArticle({ id: 'old', ts: 100 }),
      makeArticle({ id: 'new', ts: 300 }),
      makeArticle({ id: 'mid', ts: 200 }),
    ];
    const pool = new FakePool([batch]);
    const result = await fetchArticles(pool, RELAYS, { timeoutMs: 0 });
    expect(result.map((e) => e.id)).toEqual(['new', 'mid', 'old']);
  });

  it('drops events without any t tag', async () => {
    const batch = [
      makeArticle({ id: 'tagged', ts: 100, tags: [['t', 'rust']] }),
      makeArticle({ id: 'untagged', ts: 200, tags: [['p', 'somepubkey']] }),
      makeArticle({ id: 'empty', ts: 150, tags: [] }),
      makeArticle({ id: 'whitespace-t', ts: 175, tags: [['t', '   ']] }),
    ];
    const pool = new FakePool([batch]);
    const result = await fetchArticles(pool, RELAYS, { timeoutMs: 0 });
    expect(result.map((e) => e.id)).toEqual(['tagged']);
  });

  it('deduplicates by id across rounds', async () => {
    const r1 = [
      makeArticle({ id: 'a', ts: 1000 }),
      makeArticle({ id: 'b', ts: 900 }),
    ];
    const r2 = [
      makeArticle({ id: 'b', ts: 900 }),
      makeArticle({ id: 'c', ts: 800 }),
    ];
    const pool = new FakePool([r1, r2]);
    const result = await fetchArticles(pool, RELAYS, {
      target: 3,
      timeoutMs: 0,
    });
    expect(result.map((e) => e.id)).toEqual(['a', 'b', 'c']);
  });

  it('paginates with until = oldest_seen - 1', async () => {
    const r1 = [
      makeArticle({ id: 'a', ts: 1000 }),
      makeArticle({ id: 'b', ts: 800 }),
    ];
    const r2 = [makeArticle({ id: 'c', ts: 500 })];
    const pool = new FakePool([r1, r2]);
    await fetchArticles(pool, RELAYS, { target: 3, timeoutMs: 0 });
    expect(pool.calls[0].filter.until).toBeUndefined();
    expect(pool.calls[1].filter.until).toBe(799);
  });

  it('terminates at target across rounds', async () => {
    const r1 = Array.from({ length: 10 }, (_, i) =>
      makeArticle({ id: `r1-${i}`, ts: 1000 - i }),
    );
    const r2 = Array.from({ length: 15 }, (_, i) =>
      makeArticle({ id: `r2-${i}`, ts: 500 - i }),
    );
    const pool = new FakePool([r1, r2]);
    const result = await fetchArticles(pool, RELAYS, { timeoutMs: 0 });
    expect(result).toHaveLength(21);
    expect(pool.calls).toHaveLength(2);
  });

  it('honors maxRounds cap and returns what was collected', async () => {
    const sparse = (round) => [
      makeArticle({ id: `r${round}-0`, ts: 1000 - round * 10 }),
      makeArticle({ id: `r${round}-1`, ts: 999 - round * 10 }),
    ];
    const pool = new FakePool([sparse(0), sparse(1), sparse(2)]);
    const result = await fetchArticles(pool, RELAYS, {
      target: 21,
      maxRounds: 3,
      timeoutMs: 0,
    });
    expect(pool.calls).toHaveLength(3);
    expect(result).toHaveLength(6);
  });

  it('stops early when a round returns no events', async () => {
    const pool = new FakePool([
      [makeArticle({ id: 'a', ts: 1000 })],
      [],
    ]);
    const result = await fetchArticles(pool, RELAYS, {
      target: 21,
      maxRounds: 5,
      timeoutMs: 0,
    });
    expect(pool.calls).toHaveLength(2);
    expect(result).toHaveLength(1);
  });

  it('stops if pagination cursor does not advance', async () => {
    const r1 = [makeArticle({ id: 'a', ts: 1000 })];
    const r2 = [makeArticle({ id: 'a', ts: 1000 })];
    const pool = new FakePool([r1, r2]);
    const result = await fetchArticles(pool, RELAYS, {
      target: 21,
      maxRounds: 5,
      timeoutMs: 0,
    });
    expect(pool.calls.length).toBeLessThanOrEqual(2);
    expect(result.map((e) => e.id)).toEqual(['a']);
  });

  it('first REQ uses correct kinds and limit', async () => {
    const pool = new FakePool([[makeArticle({ id: 'a', ts: 1 })]]);
    await fetchArticles(pool, RELAYS, { roundLimit: 60, timeoutMs: 0 });
    expect(pool.calls[0].filter.kinds).toEqual([ARTICLE_KIND]);
    expect(pool.calls[0].filter.limit).toBe(60);
    expect(pool.calls[0].relays).toBe(RELAYS);
  });

  it('returns events from a slow pool when timeout fires (empty)', async () => {
    const pool = {
      calls: [],
      querySync(relays, filter) {
        this.calls.push({ relays, filter });
        return new Promise(() => {});
      },
    };
    const result = await fetchArticles(pool, RELAYS, {
      timeoutMs: 5,
      maxRounds: 1,
    });
    expect(result).toEqual([]);
  });
});

describe('fetchProfiles', () => {
  it('returns empty Map for no pubkeys', async () => {
    const pool = new FakePool([]);
    const result = await fetchProfiles(pool, RELAYS, [], { timeoutMs: 0 });
    expect(result.size).toBe(0);
    expect(pool.calls).toHaveLength(0);
  });

  it('deduplicates input pubkeys before query', async () => {
    const pool = new FakePool([[]]);
    await fetchProfiles(pool, RELAYS, ['a', 'b', 'a', 'b'], { timeoutMs: 0 });
    expect(pool.calls[0].filter.authors).toEqual(['a', 'b']);
    expect(pool.calls[0].filter.kinds).toEqual([METADATA_KIND]);
  });

  it('parses content JSON into profile objects', async () => {
    const events = [
      {
        pubkey: 'p1',
        created_at: 100,
        content: JSON.stringify({ name: 'Alice', picture: 'https://x/y.png' }),
      },
      {
        pubkey: 'p2',
        created_at: 200,
        content: JSON.stringify({ display_name: 'Bob' }),
      },
    ];
    const pool = new FakePool([events]);
    const result = await fetchProfiles(pool, RELAYS, ['p1', 'p2'], { timeoutMs: 0 });
    expect(result.get('p1')).toEqual({ name: 'Alice', picture: 'https://x/y.png' });
    expect(result.get('p2')).toEqual({ display_name: 'Bob' });
  });

  it('picks the newest metadata event per pubkey', async () => {
    const events = [
      { pubkey: 'p1', created_at: 100, content: JSON.stringify({ name: 'old' }) },
      { pubkey: 'p1', created_at: 300, content: JSON.stringify({ name: 'new' }) },
      { pubkey: 'p1', created_at: 200, content: JSON.stringify({ name: 'mid' }) },
    ];
    const pool = new FakePool([events]);
    const result = await fetchProfiles(pool, RELAYS, ['p1'], { timeoutMs: 0 });
    expect(result.get('p1')).toEqual({ name: 'new' });
  });

  it('skips events with unparseable content', async () => {
    const events = [
      { pubkey: 'p1', created_at: 100, content: 'not json' },
      { pubkey: 'p2', created_at: 100, content: JSON.stringify({ name: 'ok' }) },
    ];
    const pool = new FakePool([events]);
    const result = await fetchProfiles(pool, RELAYS, ['p1', 'p2'], { timeoutMs: 0 });
    expect(result.has('p1')).toBe(false);
    expect(result.get('p2')).toEqual({ name: 'ok' });
  });

  it('skips events whose content parses to non-object', async () => {
    const events = [
      { pubkey: 'p1', created_at: 100, content: '42' },
      { pubkey: 'p2', created_at: 100, content: 'null' },
      { pubkey: 'p3', created_at: 100, content: '"a string"' },
    ];
    const pool = new FakePool([events]);
    const result = await fetchProfiles(pool, RELAYS, ['p1', 'p2', 'p3'], { timeoutMs: 0 });
    expect(result.size).toBe(0);
  });
});
