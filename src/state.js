export function createState(initial = {}) {
  let state = { ...initial };
  const subscribers = new Set();

  return {
    get() {
      return state;
    },
    update(patch) {
      const delta = typeof patch === 'function' ? patch(state) : patch;
      state = { ...state, ...delta };
      for (const fn of subscribers) fn(state);
    },
    subscribe(fn) {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },
  };
}
