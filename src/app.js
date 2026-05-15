import { RUNTIME_RELAYS } from './relays.js';
import { createPool, fetchArticles, streamProfiles } from './nostr-client.js';
import { buildTagCounts, filterEvents } from './filters.js';
import { createState } from './state.js';
import {
  renderArticles,
  renderHashtags,
  renderMode,
  renderPaneMessage,
} from './render.js';

const els = {
  hashtags: document.getElementById('hashtags'),
  articles: document.getElementById('articles'),
  modeToggle: document.getElementById('mode-toggle'),
};

const state = createState({
  statusMessage: 'Loading articles…',
  articles: [],
  profiles: new Map(),
  tagCounts: [],
  selectedTags: new Set(),
  mode: 'OR',
});

function render(s) {
  if (s.statusMessage) {
    renderPaneMessage(els.articles, s.statusMessage);
  } else {
    const visible = filterEvents(s.articles, s.selectedTags, s.mode);
    renderArticles(els.articles, visible, s.profiles);
  }
  renderHashtags(els.hashtags, s.tagCounts, s.selectedTags);
  renderMode(els.modeToggle, s.mode);
}

state.subscribe(render);
render(state.get());

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
  const pool = createPool();
  try {
    const articles = await fetchArticles(pool, RUNTIME_RELAYS);
    if (articles.length === 0) {
      state.update({ statusMessage: 'No tagged articles found on the configured relays.' });
      return;
    }
    const tagCounts = buildTagCounts(articles);
    state.update({ statusMessage: null, articles, tagCounts });

    const pubkeys = [...new Set(articles.map((a) => a.pubkey))];
    await streamProfiles(pool, RUNTIME_RELAYS, pubkeys, (pubkey, profile) => {
      const next = new Map(state.get().profiles);
      next.set(pubkey, profile);
      state.update({ profiles: next });
    });
  } catch (err) {
    console.error(err);
    state.update({ statusMessage: `Failed to load articles: ${err?.message ?? err}` });
  } finally {
    // SimplePool.close exists on v2 but guard anyway.
    try { pool.close(RUNTIME_RELAYS); } catch { /* ignore */ }
  }
}

bootstrap();
