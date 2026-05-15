export function extractTags(event) {
  const out = new Set();
  const tags = event?.tags;
  if (!Array.isArray(tags)) return out;
  for (const tag of tags) {
    if (!Array.isArray(tag)) continue;
    if (tag[0] !== 't') continue;
    const value = tag[1];
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (trimmed.length === 0) continue;
    const normalized = trimmed.startsWith('#') ? trimmed.slice(1) : trimmed;
    if (normalized.length === 0) continue;
    out.add(normalized.toLowerCase());
  }
  return out;
}

export function buildTagCounts(events) {
  const counts = new Map();
  for (const ev of events) {
    for (const tag of extractTags(ev)) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return [...counts.entries()].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
  );
}

export function filterEvents(events, selectedTags, mode) {
  if (!selectedTags || selectedTags.size === 0) return events;
  if (mode !== 'AND' && mode !== 'OR') {
    throw new Error(`filterEvents: mode must be 'AND' or 'OR', got ${mode}`);
  }
  return events.filter((ev) => {
    const tags = extractTags(ev);
    if (mode === 'AND') {
      for (const t of selectedTags) if (!tags.has(t)) return false;
      return true;
    }
    for (const t of selectedTags) if (tags.has(t)) return true;
    return false;
  });
}
