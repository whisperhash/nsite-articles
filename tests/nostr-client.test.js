import { describe, it, expect } from 'vitest';
import {
  fetchArticles,
  streamProfiles,
  ARTICLE_KIND,
  METADATA_KIND,
  DEFAULT_EOSE_TIMEOUT_MS,
  DEFAULT_PROFILE_EOSE_TIMEOUT_MS,
} from '../src/nostr-client.js';

function streamingPool(events) {
  return {
    calls: [],
    subscribeManyEose(relays, filter, params) {
      this.calls.push({ relays, filter, params });
      queueMicrotask(() => {
        for (const ev of events) params.onevent(ev);
        params.onclose?.();
      });
      return { close() {} };
    },
  };
}

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
      subscribeManyEose(relays, filter, params) {
        this.calls.push({ relays, filter, params });
        return { close() {} };
      },
    };
    const result = await fetchArticles(pool, RELAYS, {
      timeoutMs: 5,
      maxRounds: 1,
    });
    expect(result).toEqual([]);
  });

  it('returns partial events collected before the timeout fires', async () => {
    const article = makeArticle({ id: 'partial', ts: 1 });
    const pool = {
      subscribeManyEose(_relays, _filter, params) {
        setTimeout(() => params.onevent(article), 0);
        return { close() {} };
      },
    };
    const result = await fetchArticles(pool, RELAYS, {
      timeoutMs: 20,
      maxRounds: 1,
    });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('partial');
  });

  it('passes the filter to subscribeManyEose as a single object (SimplePool contract)', async () => {
    let captured;
    const pool = {
      subscribeManyEose(_relays, filter, params) {
        captured = filter;
        params.onclose?.();
        return { close() {} };
      },
    };
    await fetchArticles(pool, RELAYS, { timeoutMs: 10, maxRounds: 1 });
    expect(Array.isArray(captured)).toBe(false);
    expect(captured).toMatchObject({ kinds: [ARTICLE_KIND] });
  });
});

describe('streamProfiles', () => {
  it('emits no callbacks and opens no subscription for an empty pubkey list', async () => {
    const pool = { subscribeManyEose() { throw new Error('should not be called'); } };
    const seen = [];
    await streamProfiles(pool, RELAYS, [], (pk, p) => seen.push([pk, p]));
    expect(seen).toEqual([]);
  });

  it('deduplicates input pubkeys before subscribing', async () => {
    const pool = streamingPool([]);
    await streamProfiles(pool, RELAYS, ['a', 'b', 'a', 'b'], () => {});
    expect(pool.calls[0].filter.authors).toEqual(['a', 'b']);
    expect(pool.calls[0].filter.kinds).toEqual([METADATA_KIND]);
  });

  it('emits parsed profiles via the callback as events arrive', async () => {
    const events = [
      { pubkey: 'p1', created_at: 100, content: JSON.stringify({ name: 'Alice', picture: 'https://x/y.png' }) },
      { pubkey: 'p2', created_at: 200, content: JSON.stringify({ display_name: 'Bob' }) },
    ];
    const seen = new Map();
    await streamProfiles(streamingPool(events), RELAYS, ['p1', 'p2'], (pk, p) => seen.set(pk, p));
    expect(seen.get('p1')).toEqual({ name: 'Alice', picture: 'https://x/y.png' });
    expect(seen.get('p2')).toEqual({ display_name: 'Bob' });
  });

  it('only emits the newest metadata event per pubkey', async () => {
    const events = [
      { pubkey: 'p1', created_at: 100, content: JSON.stringify({ name: 'old' }) },
      { pubkey: 'p1', created_at: 300, content: JSON.stringify({ name: 'new' }) },
      { pubkey: 'p1', created_at: 200, content: JSON.stringify({ name: 'mid' }) },
    ];
    const seen = [];
    await streamProfiles(streamingPool(events), RELAYS, ['p1'], (pk, p) => seen.push([pk, p]));
    // Older or same-timestamp events for an already-emitted pubkey are skipped.
    expect(seen.map(([, p]) => p.name)).toEqual(['old', 'new']);
  });

  it('skips events with unparseable or non-object content', async () => {
    const events = [
      { pubkey: 'p1', created_at: 100, content: 'not json' },
      { pubkey: 'p2', created_at: 100, content: '42' },
      { pubkey: 'p3', created_at: 100, content: JSON.stringify({ name: 'ok' }) },
    ];
    const seen = new Map();
    await streamProfiles(streamingPool(events), RELAYS, ['p1', 'p2', 'p3'], (pk, p) => seen.set(pk, p));
    expect(seen.has('p1')).toBe(false);
    expect(seen.has('p2')).toBe(false);
    expect(seen.get('p3')).toEqual({ name: 'ok' });
  });

  it('passes the filter to subscribeManyEose as a single object (SimplePool contract)', async () => {
    let captured;
    const pool = {
      subscribeManyEose(_relays, filter, params) {
        captured = filter;
        params.onclose?.();
        return { close() {} };
      },
    };
    await streamProfiles(pool, RELAYS, ['p1', 'p2'], () => {});
    expect(Array.isArray(captured)).toBe(false);
    expect(captured).toMatchObject({ kinds: [METADATA_KIND], authors: ['p1', 'p2'] });
  });

  it('uses a generous default timeout to outlast slow relays', () => {
    // The relay-side EOSE fallback in nostr-tools is 4.4s; our default must
    // exceed it so slow relays can deliver all matching kind:0 events. The
    // generous timeout is safe because the UI renders progressively per
    // arrival — initial paint isn't blocked on this window.
    expect(DEFAULT_PROFILE_EOSE_TIMEOUT_MS).toBeGreaterThan(DEFAULT_EOSE_TIMEOUT_MS);
    expect(DEFAULT_PROFILE_EOSE_TIMEOUT_MS).toBeGreaterThanOrEqual(10000);
  });

  it('delivers profile events progressively, not buffered until EOSE', async () => {
    // The core of this refactor: callbacks fire as each event arrives, so the
    // UI can render avatars one by one rather than waiting for the whole batch.
    let onevent;
    let onclose;
    const pool = {
      subscribeManyEose(_r, _f, params) {
        onevent = params.onevent;
        onclose = params.onclose;
        return { close() {} };
      },
    };
    const seen = [];
    const done = streamProfiles(pool, RELAYS, ['p1', 'p2'], (pk, p) => seen.push([pk, p.name]));
    // Synchronously deliver one event — the callback must have fired by the
    // time control returns here, before any EOSE/close.
    onevent({ pubkey: 'p1', created_at: 100, content: JSON.stringify({ name: 'Alice' }) });
    expect(seen).toEqual([['p1', 'Alice']]);
    // A later event for the other author also fires before close.
    onevent({ pubkey: 'p2', created_at: 200, content: JSON.stringify({ name: 'Bob' }) });
    expect(seen).toEqual([['p1', 'Alice'], ['p2', 'Bob']]);
    onclose();
    await done;
  });

  it('captures profile events that arrive after the article-fetch timeout would have fired', async () => {
    const pool = {
      subscribeManyEose(_relays, _filter, params) {
        // Event arrives well past the article timeout — still must come through.
        setTimeout(() => {
          params.onevent({ pubkey: 'p1', created_at: 100, content: JSON.stringify({ picture: 'https://x/y.png' }) });
          params.onclose?.();
        }, DEFAULT_EOSE_TIMEOUT_MS + 50);
        return { close() {} };
      },
    };
    const seen = new Map();
    await streamProfiles(pool, RELAYS, ['p1'], (pk, p) => seen.set(pk, p));
    expect(seen.get('p1')?.picture).toBe('https://x/y.png');
  }, DEFAULT_PROFILE_EOSE_TIMEOUT_MS + 2000);
});

