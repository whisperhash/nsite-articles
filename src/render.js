import { nip19 } from '../vendor/nostr-tools.js';
import { extractTags } from './filters.js';

export function renderArticles(container, articles, profiles) {
  container.replaceChildren();
  if (articles.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty-state';
    empty.textContent = 'No articles match the current filters.';
    container.appendChild(empty);
    return;
  }
  for (const ev of articles) {
    container.appendChild(buildCard(ev, profiles?.get(ev.pubkey)));
  }
}

function buildCard(event, profile) {
  const card = document.createElement('article');
  card.className = 'card';
  card.dataset.id = event.id;

  const header = document.createElement('header');
  header.className = 'card-author';

  const avatar = document.createElement('img');
  avatar.className = 'card-avatar';
  avatar.alt = '';
  avatar.loading = 'lazy';
  if (profile?.picture && typeof profile.picture === 'string') {
    avatar.src = profile.picture;
  } else {
    avatar.classList.add('card-avatar--placeholder');
  }
  avatar.addEventListener('error', () => {
    avatar.removeAttribute('src');
    avatar.classList.add('card-avatar--placeholder');
  });

  const nameEl = document.createElement('span');
  nameEl.className = 'card-name';
  nameEl.textContent = profileDisplayName(event.pubkey, profile);

  header.append(avatar, nameEl);

  const title = document.createElement('h2');
  title.className = 'card-title';
  title.textContent = articleTitle(event);

  const time = document.createElement('time');
  time.className = 'card-time';
  const date = new Date(event.created_at * 1000);
  time.dateTime = date.toISOString();
  time.title = date.toLocaleString();
  time.textContent = relativeTime(date);

  card.append(header, title, time);
  return card;
}

function articleTitle(event) {
  if (Array.isArray(event.tags)) {
    for (const tag of event.tags) {
      if (Array.isArray(tag) && tag[0] === 'title' && typeof tag[1] === 'string') {
        const trimmed = tag[1].trim();
        if (trimmed.length > 0) return trimmed;
      }
    }
  }
  return '(untitled)';
}

function profileDisplayName(pubkey, profile) {
  const candidate = profile?.display_name ?? profile?.name;
  if (typeof candidate === 'string' && candidate.trim().length > 0) {
    return candidate.trim();
  }
  return truncateNpub(pubkey);
}

function truncateNpub(pubkey) {
  try {
    const npub = nip19.npubEncode(pubkey);
    return `${npub.slice(0, 12)}…${npub.slice(-4)}`;
  } catch {
    return `${pubkey.slice(0, 8)}…${pubkey.slice(-4)}`;
  }
}

function relativeTime(date) {
  const diffMs = Date.now() - date.getTime();
  const sec = Math.round(diffMs / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const days = Math.round(hr / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months}mo ago`;
  const years = Math.round(months / 12);
  return `${years}y ago`;
}

export function renderHashtags(container, tagCounts, selectedTags) {
  container.replaceChildren();
  if (tagCounts.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty-state';
    empty.textContent = 'No hashtags found.';
    container.appendChild(empty);
    return;
  }
  const list = document.createElement('ul');
  list.className = 'hashtag-list';
  for (const [tag, count] of tagCounts) {
    const li = document.createElement('li');
    const label = document.createElement('label');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.value = tag;
    checkbox.dataset.tag = tag;
    checkbox.checked = selectedTags?.has(tag) ?? false;
    const name = document.createElement('span');
    name.className = 'hashtag-name';
    name.textContent = `#${tag}`;
    const countEl = document.createElement('span');
    countEl.className = 'hashtag-count';
    countEl.textContent = String(count);
    label.append(checkbox, name, countEl);
    li.appendChild(label);
    list.appendChild(li);
  }
  container.appendChild(list);
}

export function renderMode(toggle, mode) {
  for (const input of toggle.querySelectorAll('input[name="mode"]')) {
    input.checked = input.value === mode;
  }
}

export function renderStatus(container, message) {
  if (!message) {
    container.replaceChildren();
    container.hidden = true;
    return;
  }
  container.hidden = false;
  container.textContent = message;
}

export const __test = { articleTitle, profileDisplayName, truncateNpub, extractTags };
