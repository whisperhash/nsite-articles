import { describe, it, expect, vi } from 'vitest';
import { createState } from '../src/state.js';

describe('createState', () => {
  it('returns the initial state from get()', () => {
    const s = createState({ a: 1, b: 'two' });
    expect(s.get()).toEqual({ a: 1, b: 'two' });
  });

  it('defaults to an empty object when no initial value is given', () => {
    const s = createState();
    expect(s.get()).toEqual({});
  });

  it('merges object patches shallowly into the current state', () => {
    const s = createState({ a: 1, b: 2 });
    s.update({ b: 20, c: 3 });
    expect(s.get()).toEqual({ a: 1, b: 20, c: 3 });
  });

  it('accepts a function patch that receives the current state', () => {
    const s = createState({ count: 1 });
    s.update((current) => ({ count: current.count + 1 }));
    s.update((current) => ({ count: current.count + 1 }));
    expect(s.get()).toEqual({ count: 3 });
  });

  it('notifies subscribers on every update with the new state', () => {
    const s = createState({ count: 0 });
    const sub = vi.fn();
    s.subscribe(sub);
    s.update({ count: 1 });
    s.update({ count: 2 });
    expect(sub).toHaveBeenCalledTimes(2);
    expect(sub).toHaveBeenLastCalledWith({ count: 2 });
  });

  it('does not notify subscribers when a subscriber is added (only on subsequent updates)', () => {
    const s = createState({ a: 1 });
    const sub = vi.fn();
    s.subscribe(sub);
    expect(sub).not.toHaveBeenCalled();
  });

  it('supports multiple subscribers — all fire on each update', () => {
    const s = createState({});
    const a = vi.fn();
    const b = vi.fn();
    s.subscribe(a);
    s.subscribe(b);
    s.update({ x: 1 });
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('subscribe() returns an unsubscribe function that removes the listener', () => {
    const s = createState({});
    const sub = vi.fn();
    const unsubscribe = s.subscribe(sub);
    s.update({ x: 1 });
    expect(sub).toHaveBeenCalledTimes(1);

    unsubscribe();
    s.update({ x: 2 });
    expect(sub).toHaveBeenCalledTimes(1);
  });

  it('replaces state immutably — get() returns a new object reference after update', () => {
    const s = createState({ a: 1 });
    const before = s.get();
    s.update({ a: 2 });
    const after = s.get();
    expect(before).not.toBe(after);
    expect(before).toEqual({ a: 1 });
    expect(after).toEqual({ a: 2 });
  });

  it('subscribers receive the post-update state, not a stale snapshot', () => {
    const s = createState({ count: 0 });
    const seen = [];
    s.subscribe((current) => seen.push(current.count));
    s.update({ count: 1 });
    s.update({ count: 2 });
    s.update((c) => ({ count: c.count * 10 }));
    expect(seen).toEqual([1, 2, 20]);
  });
});
