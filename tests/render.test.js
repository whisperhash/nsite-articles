// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import {
  renderArticles,
  renderHashtags,
  renderMode,
  renderStatus,
  __test,
} from '../src/render.js';
import { createState } from '../src/state.js';
import { buildTagCounts, filterEvents } from '../src/filters.js';

const article = ({
  id,
  ts,
  title = 'A title',
  pubkey = 'a'.repeat(64),
  tags = [['t', 'rust']],
  d = 'slug',
}) => ({
  id,
  kind: 30023,
  pubkey,
  created_at: ts,
  content: '',
  sig: '',
  tags: [['title', title], ['d', d], ...tags],
});

describe('renderArticles', () => {
  let container;
  beforeEach(() => {
    container = document.createElement('div');
  });

  it('renders one card per article with title, name, and time', () => {
    const articles = [
      article({ id: '1', ts: Math.floor(Date.now() / 1000) - 60, title: 'Hello' }),
    ];
    const profiles = new Map([[articles[0].pubkey, { name: 'Alice', picture: 'https://x/y.png' }]]);
    renderArticles(container, articles, profiles);
    const cards = container.querySelectorAll('.card');
    expect(cards).toHaveLength(1);
    expect(cards[0].querySelector('.card-title').textContent).toBe('Hello');
    expect(cards[0].querySelector('.card-name').textContent).toBe('Alice');
    expect(cards[0].querySelector('.card-avatar').src).toBe('https://x/y.png');
    expect(cards[0].dataset.id).toBe('1');
  });

  it('wraps the whole card in an external link to njump.to with naddr', () => {
    const ev = article({ id: '1', ts: 100, title: 'Hello', d: 'my-slug' });
    renderArticles(container, [ev], new Map());
    const card = container.querySelector('.card');
    const anchor = card.querySelector('a.card-link');
    expect(anchor).not.toBeNull();
    expect(anchor.getAttribute('href')).toMatch(/^https:\/\/njump\.to\/naddr1/);
    expect(anchor.getAttribute('target')).toBe('_blank');
    expect(anchor.getAttribute('rel')).toBe('noopener noreferrer');
    expect(anchor.querySelector('.card-title').textContent).toBe('Hello');
    expect(anchor.querySelector('.card-author')).not.toBeNull();
    expect(anchor.querySelector('.card-time')).not.toBeNull();
  });

  it('uses a non-anchor wrapper when d tag is missing (no clickable target)', () => {
    const ev = {
      id: '1',
      kind: 30023,
      pubkey: 'a'.repeat(64),
      created_at: 100,
      content: '',
      sig: '',
      tags: [['title', 'No slug']],
    };
    renderArticles(container, [ev], new Map());
    const card = container.querySelector('.card');
    expect(card.querySelector('a.card-link')).toBeNull();
    expect(card.querySelector('div.card-link')).not.toBeNull();
    expect(card.querySelector('.card-title').textContent).toBe('No slug');
  });

  it('shows empty state when no articles', () => {
    renderArticles(container, [], new Map());
    expect(container.querySelector('.empty-state')).not.toBeNull();
    expect(container.querySelector('.card')).toBeNull();
  });

  it('falls back to truncated npub when profile name is missing', () => {
    const ev = article({ id: '1', ts: 100, pubkey: '0'.repeat(64) });
    renderArticles(container, [ev], new Map());
    const name = container.querySelector('.card-name').textContent;
    expect(name.startsWith('npub1')).toBe(true);
    expect(name).toMatch(/…/);
  });

  it('prefers display_name over name', () => {
    const ev = article({ id: '1', ts: 100 });
    const profiles = new Map([[ev.pubkey, { name: 'low', display_name: 'High' }]]);
    renderArticles(container, [ev], profiles);
    expect(container.querySelector('.card-name').textContent).toBe('High');
  });

  it('renders untitled when no title tag', () => {
    const ev = { id: '1', kind: 30023, pubkey: 'p'.repeat(64), created_at: 100, tags: [], content: '', sig: '' };
    renderArticles(container, [ev], new Map());
    expect(container.querySelector('.card-title').textContent).toBe('(untitled)');
  });

  it('marks avatar as placeholder when no picture', () => {
    const ev = article({ id: '1', ts: 100 });
    renderArticles(container, [ev], new Map([[ev.pubkey, { name: 'Alice' }]]));
    const avatar = container.querySelector('.card-avatar');
    expect(avatar.classList.contains('card-avatar--placeholder')).toBe(true);
    expect(avatar.getAttribute('src')).toBeNull();
  });

  it('replaces previous content on re-render', () => {
    renderArticles(container, [article({ id: '1', ts: 100 })], new Map());
    renderArticles(container, [article({ id: '2', ts: 200 })], new Map());
    const cards = container.querySelectorAll('.card');
    expect(cards).toHaveLength(1);
    expect(cards[0].dataset.id).toBe('2');
  });
});

describe('renderHashtags', () => {
  let container;
  beforeEach(() => {
    container = document.createElement('div');
  });

  it('renders one checkbox per tag with count', () => {
    const counts = [['rust', 5], ['design', 3], ['web', 1]];
    renderHashtags(container, counts, new Set());
    const items = container.querySelectorAll('li');
    expect(items).toHaveLength(3);
    const first = items[0];
    expect(first.querySelector('input[type="checkbox"]').dataset.tag).toBe('rust');
    expect(first.querySelector('.hashtag-name').textContent).toBe('#rust');
    expect(first.querySelector('.hashtag-count').textContent).toBe('5');
  });

  it('reflects selected tags as checked', () => {
    const counts = [['rust', 5], ['design', 3]];
    renderHashtags(container, counts, new Set(['design']));
    const checkboxes = container.querySelectorAll('input[type="checkbox"]');
    expect(checkboxes[0].checked).toBe(false);
    expect(checkboxes[1].checked).toBe(true);
  });

  it('shows empty state when no tags', () => {
    renderHashtags(container, [], new Set());
    expect(container.querySelector('.empty-state')).not.toBeNull();
  });
});

describe('renderMode', () => {
  it('checks the radio matching the mode', () => {
    const toggle = document.createElement('div');
    toggle.innerHTML = `
      <input type="radio" name="mode" value="OR" id="or">
      <input type="radio" name="mode" value="AND" id="and">
    `;
    renderMode(toggle, 'AND');
    expect(toggle.querySelector('#or').checked).toBe(false);
    expect(toggle.querySelector('#and').checked).toBe(true);
    renderMode(toggle, 'OR');
    expect(toggle.querySelector('#or').checked).toBe(true);
    expect(toggle.querySelector('#and').checked).toBe(false);
  });
});

describe('renderStatus', () => {
  it('shows message and reveals container', () => {
    const el = document.createElement('div');
    el.hidden = true;
    renderStatus(el, 'Loading...');
    expect(el.textContent).toBe('Loading...');
    expect(el.hidden).toBe(false);
  });

  it('clears and hides container with no message', () => {
    const el = document.createElement('div');
    el.textContent = 'Loading...';
    el.hidden = false;
    renderStatus(el, null);
    expect(el.textContent).toBe('');
    expect(el.hidden).toBe(true);
  });
});

describe('state + filter integration', () => {
  it('rendering reacts to selectedTags change via filterEvents', () => {
    const container = document.createElement('div');
    const articles = [
      { id: '1', kind: 30023, pubkey: 'p1', created_at: 300, content: '', sig: '',
        tags: [['title', 'A'], ['t', 'rust']] },
      { id: '2', kind: 30023, pubkey: 'p2', created_at: 200, content: '', sig: '',
        tags: [['title', 'B'], ['t', 'design']] },
      { id: '3', kind: 30023, pubkey: 'p3', created_at: 100, content: '', sig: '',
        tags: [['title', 'C'], ['t', 'rust'], ['t', 'design']] },
    ];
    const state = createState({ articles, selectedTags: new Set(), mode: 'OR' });
    state.subscribe((s) => {
      const visible = filterEvents(s.articles, s.selectedTags, s.mode);
      renderArticles(container, visible, new Map());
    });

    state.update({ selectedTags: new Set(['rust']) });
    expect(container.querySelectorAll('.card')).toHaveLength(2);

    state.update({ selectedTags: new Set(['rust', 'design']), mode: 'AND' });
    expect(container.querySelectorAll('.card')).toHaveLength(1);
    expect(container.querySelector('.card').dataset.id).toBe('3');

    state.update({ mode: 'OR' });
    expect(container.querySelectorAll('.card')).toHaveLength(3);

    state.update({ selectedTags: new Set() });
    expect(container.querySelectorAll('.card')).toHaveLength(3);
  });

  it('buildTagCounts feeds renderHashtags', () => {
    const container = document.createElement('div');
    const articles = [
      { id: '1', tags: [['t', 'rust'], ['t', 'web']] },
      { id: '2', tags: [['t', 'rust']] },
    ];
    renderHashtags(container, buildTagCounts(articles), new Set(['rust']));
    const labels = [...container.querySelectorAll('.hashtag-name')].map((n) => n.textContent);
    expect(labels).toEqual(['#rust', '#web']);
    const checked = container.querySelector('input[type="checkbox"][data-tag="rust"]');
    expect(checked.checked).toBe(true);
  });
});

describe('internal helpers', () => {
  it('truncateNpub formats hex pubkeys', () => {
    const out = __test.truncateNpub('0'.repeat(64));
    expect(out.startsWith('npub1')).toBe(true);
    expect(out).toMatch(/…/);
  });

  it('formatTimestamp returns a locale-aware medium date + short time', () => {
    const date = new Date('2026-05-15T14:30:00Z');
    const out = __test.formatTimestamp(date, 'en-US', { timeZone: 'UTC' });
    expect(out).toContain('May 15, 2026');
    expect(out).toMatch(/2:30/);
    expect(out).toMatch(/PM/);
  });

  it('formatTimestampPrecise includes weekday and timezone', () => {
    const date = new Date('2026-05-15T14:30:00Z');
    const out = __test.formatTimestampPrecise(date, 'en-US', { timeZone: 'UTC' });
    expect(out).toContain('Friday');
    expect(out).toContain('May 15, 2026');
    expect(out).toContain('UTC');
    expect(out.length).toBeGreaterThan(
      __test.formatTimestamp(date, 'en-US', { timeZone: 'UTC' }).length,
    );
  });
});

describe('card timestamp', () => {
  it("renders the article's created_at as a friendly local timestamp", () => {
    const container = document.createElement('div');
    const ts = Math.floor(new Date('2026-05-15T14:30:00Z').getTime() / 1000);
    const ev = article({ id: '1', ts });
    renderArticles(container, [ev], new Map());
    const timeEl = container.querySelector('.card-time');
    expect(timeEl).not.toBeNull();
    expect(timeEl.getAttribute('datetime')).toBe('2026-05-15T14:30:00.000Z');
    expect(timeEl.textContent).toMatch(/2026/);
    expect(timeEl.title).toMatch(/2026/);
    expect(timeEl.title.length).toBeGreaterThan(timeEl.textContent.length);
  });
});
