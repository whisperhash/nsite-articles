import { SimplePool } from '../vendor/nostr-tools.js';

export const ARTICLE_KIND = 30023;
export const METADATA_KIND = 0;
export const TARGET_ARTICLE_COUNT = 21;
export const DEFAULT_ROUND_LIMIT = 60;
export const DEFAULT_MAX_ROUNDS = 5;
export const DEFAULT_EOSE_TIMEOUT_MS = 3000;
// Profiles stream in progressively over the lifetime of one long subscription:
// the UI updates per arrival, so a generous timeout doesn't block initial
// render — it just gives slow relays / large result sets time to deliver
// without us tearing the subscription down early.
export const DEFAULT_PROFILE_EOSE_TIMEOUT_MS = 15000;

export function createPool() {
  return new SimplePool();
}

export async function fetchArticles(pool, relays, opts = {}) {
  const target = opts.target ?? TARGET_ARTICLE_COUNT;
  const roundLimit = opts.roundLimit ?? DEFAULT_ROUND_LIMIT;
  const maxRounds = opts.maxRounds ?? DEFAULT_MAX_ROUNDS;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_EOSE_TIMEOUT_MS;

  const seen = new Map();
  let until;

  for (let round = 0; round < maxRounds; round++) {
    const filter = { kinds: [ARTICLE_KIND], limit: roundLimit };
    if (until !== undefined) filter.until = until;

    const batch = await queryWithTimeout(pool, relays, filter, timeoutMs);
    if (batch.length === 0) break;

    let oldestSeenInRound = Infinity;
    let addedAny = false;
    for (const ev of batch) {
      if (!seen.has(ev.id)) {
        seen.set(ev.id, ev);
        addedAny = true;
      }
      if (typeof ev.created_at === 'number' && ev.created_at < oldestSeenInRound) {
        oldestSeenInRound = ev.created_at;
      }
    }

    const tagged = collectTagged(seen, target);
    if (tagged.length >= target) return tagged;

    if (!addedAny) break;
    if (oldestSeenInRound === Infinity) break;
    const nextUntil = oldestSeenInRound - 1;
    if (until !== undefined && nextUntil >= until) break;
    until = nextUntil;
  }

  return collectTagged(seen, target);
}

function collectTagged(seen, target) {
  return [...seen.values()]
    .filter(hasAnyTTag)
    .sort((a, b) => b.created_at - a.created_at)
    .slice(0, target);
}

function hasAnyTTag(event) {
  const tags = event?.tags;
  if (!Array.isArray(tags)) return false;
  for (const tag of tags) {
    if (!Array.isArray(tag)) continue;
    if (tag[0] === 't' && typeof tag[1] === 'string' && tag[1].trim().length > 0) {
      return true;
    }
  }
  return false;
}

export function streamProfiles(pool, relays, pubkeys, onProfile, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_PROFILE_EOSE_TIMEOUT_MS;
  const unique = [...new Set(pubkeys)];
  if (unique.length === 0) return Promise.resolve();

  return new Promise((resolve) => {
    const latestTs = new Map();
    let sub;
    let settled = false;
    let timer;
    const finish = () => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      try { sub?.close(); } catch { /* ignore */ }
      resolve();
    };
    if (timeoutMs > 0) timer = setTimeout(finish, timeoutMs);
    sub = pool.subscribeManyEose(
      relays,
      { kinds: [METADATA_KIND], authors: unique },
      {
        onevent: (ev) => {
          const prev = latestTs.get(ev.pubkey);
          if (prev !== undefined && ev.created_at <= prev) return;
          const parsed = safeParseProfile(ev.content);
          if (!parsed) return;
          latestTs.set(ev.pubkey, ev.created_at);
          onProfile(ev.pubkey, parsed);
        },
        onclose: finish,
      },
    );
  });
}

function safeParseProfile(content) {
  if (typeof content !== 'string') return null;
  try {
    const obj = JSON.parse(content);
    return obj && typeof obj === 'object' ? obj : null;
  } catch {
    return null;
  }
}

async function queryWithTimeout(pool, relays, filter, timeoutMs) {
  if (!timeoutMs || timeoutMs <= 0) return pool.querySync(relays, filter);
  return new Promise((resolve) => {
    const events = [];
    let sub;
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      try { sub?.close(); } catch { /* ignore */ }
      resolve(events);
    };
    const timer = setTimeout(finish, timeoutMs);
    sub = pool.subscribeManyEose(relays, filter, {
      onevent: (ev) => events.push(ev),
      onclose: () => {
        clearTimeout(timer);
        finish();
      },
    });
  });
}
