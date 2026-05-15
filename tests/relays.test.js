import { describe, it, expect } from 'vitest';
import { RUNTIME_RELAYS } from '../src/relays.js';

describe('runtime relay configuration', () => {
  it('includes a profile-aggregator relay so kind:0 metadata coverage is wide', () => {
    // The article-discovery relays we use (damus, nos.lol, primal) have spotty
    // kind:0 coverage — many authors publish their metadata elsewhere. Without at
    // least one profile-aggregator relay in the list, streamProfiles emits no
    // callbacks for those authors and their cards render as gradient placeholders.
    const profileAggregators = ['wss://purplepag.es'];
    const hasAggregator = RUNTIME_RELAYS.some((r) => profileAggregators.includes(r));
    expect(hasAggregator).toBe(true);
  });
});
