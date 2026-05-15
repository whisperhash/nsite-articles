import { describe, it, expect } from 'vitest';
import { extractTags, buildTagCounts, filterEvents } from '../src/filters.js';

const ev = (id, tags) => ({
  id,
  kind: 30023,
  created_at: 0,
  pubkey: 'p',
  content: '',
  sig: '',
  tags,
});

describe('extractTags', () => {
  it('returns empty set for events with no tags array', () => {
    expect(extractTags({})).toEqual(new Set());
    expect(extractTags({ tags: null })).toEqual(new Set());
  });

  it('returns empty set for events with empty tags array', () => {
    expect(extractTags(ev('a', []))).toEqual(new Set());
  });

  it('extracts only t tags', () => {
    const e = ev('a', [
      ['t', 'foo'],
      ['p', 'somepubkey'],
      ['e', 'someevent'],
      ['t', 'bar'],
    ]);
    expect(extractTags(e)).toEqual(new Set(['foo', 'bar']));
  });

  it('lowercases tag values', () => {
    const e = ev('a', [['t', 'FOO'], ['t', 'Bar']]);
    expect(extractTags(e)).toEqual(new Set(['foo', 'bar']));
  });

  it('deduplicates same tag within one event', () => {
    const e = ev('a', [['t', 'foo'], ['t', 'foo'], ['t', 'FOO']]);
    expect(extractTags(e)).toEqual(new Set(['foo']));
  });

  it('ignores tags with non-string or empty values', () => {
    const e = ev('a', [
      ['t'],
      ['t', ''],
      ['t', '   '],
      ['t', 42],
      ['t', 'real'],
    ]);
    expect(extractTags(e)).toEqual(new Set(['real']));
  });

  it('ignores malformed tag entries', () => {
    const e = ev('a', [null, 'not-an-array', ['t', 'ok']]);
    expect(extractTags(e)).toEqual(new Set(['ok']));
  });

  it('trims whitespace', () => {
    const e = ev('a', [['t', '  spaced  ']]);
    expect(extractTags(e)).toEqual(new Set(['spaced']));
  });
});

describe('buildTagCounts', () => {
  it('returns empty array for no events', () => {
    expect(buildTagCounts([])).toEqual([]);
  });

  it('counts each tag once per event', () => {
    const events = [
      ev('1', [['t', 'foo'], ['t', 'bar']]),
      ev('2', [['t', 'foo']]),
      ev('3', [['t', 'baz']]),
    ];
    expect(buildTagCounts(events)).toEqual([
      ['foo', 2],
      ['bar', 1],
      ['baz', 1],
    ]);
  });

  it('does not double-count duplicate t tags within one event', () => {
    const events = [ev('1', [['t', 'foo'], ['t', 'FOO'], ['t', 'foo']])];
    expect(buildTagCounts(events)).toEqual([['foo', 1]]);
  });

  it('sorts ties alphabetically', () => {
    const events = [
      ev('1', [['t', 'zeta']]),
      ev('2', [['t', 'alpha']]),
      ev('3', [['t', 'mu']]),
    ];
    expect(buildTagCounts(events)).toEqual([
      ['alpha', 1],
      ['mu', 1],
      ['zeta', 1],
    ]);
  });

  it('sorts by count desc primarily', () => {
    const events = [
      ev('1', [['t', 'rare']]),
      ev('2', [['t', 'common']]),
      ev('3', [['t', 'common']]),
      ev('4', [['t', 'common']]),
    ];
    expect(buildTagCounts(events)).toEqual([
      ['common', 3],
      ['rare', 1],
    ]);
  });
});

describe('filterEvents', () => {
  const events = [
    ev('1', [['t', 'rust'], ['t', 'web']]),
    ev('2', [['t', 'rust']]),
    ev('3', [['t', 'web'], ['t', 'design']]),
    ev('4', []),
  ];

  it('returns all events when selection is empty', () => {
    expect(filterEvents(events, new Set(), 'OR')).toBe(events);
    expect(filterEvents(events, new Set(), 'AND')).toBe(events);
  });

  it('returns all events when selection is null/undefined', () => {
    expect(filterEvents(events, null, 'OR')).toBe(events);
    expect(filterEvents(events, undefined, 'AND')).toBe(events);
  });

  it('OR mode: includes events matching any selected tag', () => {
    const result = filterEvents(events, new Set(['rust']), 'OR');
    expect(result.map((e) => e.id)).toEqual(['1', '2']);
  });

  it('OR mode with multiple tags: union of matches', () => {
    const result = filterEvents(events, new Set(['rust', 'design']), 'OR');
    expect(result.map((e) => e.id)).toEqual(['1', '2', '3']);
  });

  it('AND mode with single tag: same as OR', () => {
    const result = filterEvents(events, new Set(['rust']), 'AND');
    expect(result.map((e) => e.id)).toEqual(['1', '2']);
  });

  it('AND mode with multiple tags: only events containing all', () => {
    const result = filterEvents(events, new Set(['rust', 'web']), 'AND');
    expect(result.map((e) => e.id)).toEqual(['1']);
  });

  it('AND mode: events without any t tags never match', () => {
    const result = filterEvents(events, new Set(['rust']), 'AND');
    expect(result.find((e) => e.id === '4')).toBeUndefined();
  });

  it('throws on invalid mode', () => {
    expect(() => filterEvents(events, new Set(['rust']), 'XOR'))
      .toThrow(/mode must be 'AND' or 'OR'/);
  });

  it('selection is case-insensitive only when caller lowercases (extractTags lowercases)', () => {
    expect(filterEvents(events, new Set(['rust']), 'OR').map((e) => e.id))
      .toEqual(['1', '2']);
    expect(filterEvents(events, new Set(['RUST']), 'OR').map((e) => e.id))
      .toEqual([]);
  });
});
