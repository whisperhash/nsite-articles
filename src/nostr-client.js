import { SimplePool } from '../vendor/nostr-tools.js';

export const ARTICLE_KIND = 30023;
export const METADATA_KIND = 0;
export const TARGET_ARTICLE_COUNT = 21;
export const DEFAULT_ROUND_LIMIT = 60;
export const DEFAULT_MAX_ROUNDS = 5;
export const DEFAULT_EOSE_TIMEOUT_MS = 3000;

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

export async function fetchProfiles(pool, relays, pubkeys, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_EOSE_TIMEOUT_MS;
  const unique = [...new Set(pubkeys)];
  if (unique.length === 0) return new Map();

  const events = await queryWithTimeout(
    pool,
    relays,
    { kinds: [METADATA_KIND], authors: unique },
    timeoutMs,
  );

  const latest = new Map();
  for (const ev of events) {
    const prev = latest.get(ev.pubkey);
    if (!prev || ev.created_at > prev.created_at) latest.set(ev.pubkey, ev);
  }

  const profiles = new Map();
  for (const [pubkey, ev] of latest) {
    const parsed = safeParseProfile(ev.content);
    if (parsed) profiles.set(pubkey, parsed);
  }
  return profiles;
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
  const query = pool.querySync(relays, filter);
  if (!timeoutMs || timeoutMs <= 0) return query;
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve([]), timeoutMs);
  });
  try {
    return await Promise.race([query, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
