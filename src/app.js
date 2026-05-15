import { RUNTIME_RELAYS } from './relays.js';
import { createPool, fetchArticles, fetchProfiles } from './nostr-client.js';
import { buildTagCounts, filterEvents } from './filters.js';
import { createState } from './state.js';
import {
  renderArticles,
  renderHashtags,
  renderMode,
  renderStatus,
} from './render.js';

const els = {
  status: document.getElementById('status'),
  hashtags: document.getElementById('hashtags'),
  articles: document.getElementById('articles'),
  modeToggle: document.getElementById('mode-toggle'),
};

const state = createState({
  articles: [],
  profiles: new Map(),
  tagCounts: [],
  selectedTags: new Set(),
  mode: 'OR',
});

state.subscribe((s) => {
  const visible = filterEvents(s.articles, s.selectedTags, s.mode);
  renderArticles(els.articles, visible, s.profiles);
  renderHashtags(els.hashtags, s.tagCounts, s.selectedTags);
  renderMode(els.modeToggle, s.mode);
});

els.hashtags.addEventListener('change', (e) => {
  const input = e.target;
  if (!(input instanceof HTMLInputElement) || input.type !== 'checkbox') return;
  const tag = input.dataset.tag;
  if (!tag) return;
  const next = new Set(state.get().selectedTags);
  if (input.checked) next.add(tag);
  else next.delete(tag);
  state.update({ selectedTags: next });
});

els.modeToggle.addEventListener('change', (e) => {
  const input = e.target;
  if (!(input instanceof HTMLInputElement) || input.name !== 'mode') return;
  if (input.value !== 'AND' && input.value !== 'OR') return;
  state.update({ mode: input.value });
});

async function bootstrap() {
  renderStatus(els.status, 'Loading articles…');
  const pool = createPool();
  try {
    const articles = await fetchArticles(pool, RUNTIME_RELAYS);
    const tagCounts = buildTagCounts(articles);
    state.update({ articles, tagCounts });

    if (articles.length === 0) {
      renderStatus(els.status, 'No tagged articles found on the configured relays.');
      return;
    }

    renderStatus(els.status, `Loaded ${articles.length} article${articles.length === 1 ? '' : 's'}. Fetching authors…`);
    const pubkeys = [...new Set(articles.map((a) => a.pubkey))];
    const profiles = await fetchProfiles(pool, RUNTIME_RELAYS, pubkeys);
    state.update({ profiles });
    renderStatus(els.status, null);
  } catch (err) {
    console.error(err);
    renderStatus(els.status, `Failed to load articles: ${err?.message ?? err}`);
  } finally {
    try { pool.close(RUNTIME_RELAYS); } catch { /* SimplePool.close is safe to call but may not exist on every version */ }
  }
}

bootstrap();
