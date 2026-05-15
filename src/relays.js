// Article-discovery relays. Keep in sync with `.nsite/config.json` — nsyte
// uses that file at deploy time, and the deployed nsite content must be
// reachable from the same relays the browser reads from.
const ARTICLE_RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.primal.net',
];

// Profile-aggregator relays. These specialise in kind:0 metadata; many authors
// publish their profile event here even when they don't post articles to the
// article relays. Without this, most avatars render as gradient placeholders.
const PROFILE_RELAYS = ['wss://purplepag.es'];

export const RUNTIME_RELAYS = [...ARTICLE_RELAYS, ...PROFILE_RELAYS];
