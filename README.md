# Nostr long-form article browser

A single-page static web app that fetches the latest 21 Nostr long-form articles
(`kind:30023`, NIP-23) that carry at least one `t` (hashtag) tag from a small
set of relays. Articles are displayed with title, author name + picture, and
the publication time formatted in the visitor's local timezone and locale.
Clicking a card opens the article on [njump.to](https://njump.to) (via a NIP-19
`naddr` with relay hints). A sidebar of hashtags (with counts) lets you filter
the visible set via an AND / OR toggle.

The site is built to run entirely in the browser and is deployed as an **nsite**
(NIP-512 / kind:34128 manifest + blobs on [Blossom](https://github.com/hzrd149/blossom)
servers). No runtime CDN dependencies — `nostr-tools` is bundled into the repo.

## Stack

- Vanilla JS modules, no framework. Dev serves the raw source files; deploy
  inlines everything into a single self-contained HTML via [scripts/build.mjs](scripts/build.mjs).
- `nostr-tools@2.23.3`, bundled into [vendor/nostr-tools.js](vendor/nostr-tools.js) by [scripts/build-vendor.mjs](scripts/build-vendor.mjs).
- [Vitest](https://vitest.dev) + jsdom for tests.
- [nsyte](https://github.com/sandwichfarm/nsyte) for deploys (signs via NIP-46 / Amber).

## Quick start

```bash
npm install
npm run build:vendor    # one-time, regenerates vendor/nostr-tools.js from npm
npm test
npm run dev             # http://localhost:8000 — serves source files for fast iteration
```

`npm run dev` runs `python3 -m http.server` because browsers block WebSockets
from `file://` URLs. Any static server works.

To test-drive the production bundle locally:

```bash
npm run build           # writes dist/index.html (single inlined file)
npm run preview         # http://localhost:8000 served from dist/
```

`dev` and `preview` use the same port; stop one before starting the other.

## Project layout

```
index.html              page shell (dev template; build inlines into it)
src/
  app.js                bootstrap: wire DOM ↔ state ↔ relay client
  nostr-client.js       paginated fetch (kind:30023) + profile lookup (kind:0)
  filters.js            extractTags, buildTagCounts, filterEvents (pure)
  render.js             DOM rendering
  state.js              tiny pub/sub state holder
  relays.js             runtime relay list (mirrors .nsite/config.json)
styles/style.css        layout, cards, dark theme
vendor/nostr-tools.js   bundled nostr-tools (committed; consumed by dev + build)
scripts/
  build-vendor.mjs      esbuild → vendor/nostr-tools.js (run on nostr-tools upgrades)
  build.mjs             esbuild + inline → dist/index.html (run by predeploy)
tests/                  vitest suites
.nsite/config.json      nsyte deploy config
dist/index.html         build output, gitignored — the *only* file deployed
```

## Tests

```bash
npm test                # run once
npm run test:watch      # vitest watch mode
```

Default `npm test` runs (sub-second):
- `filters.test.js` — pure-function coverage of tag extraction / counts / AND-OR filter.
- `state.test.js` — pub/sub store: get, object & functional update, multi-subscriber, unsubscribe.
- `nostr-client.test.js` — paginated fetch + profile lookup against a mock `SimplePool`.
- `render.test.js` — jsdom; cards, whole-card link, hashtag list, mode toggle, integration with state + filters.
- `build.test.js` — invokes `scripts/build.mjs` into a temp dir, asserts the inlined bundle parses, the placeholders are gone, and the script element has no `src` attribute.

`deployed-integrity.test.js` is **gated** on `RUN_DEPLOYED=1` and verifies a
real deployment (see [Verifying a deploy](#verifying-a-deploy)).

## Deploying as an nsite

You'll need:
- [Deno](https://deno.com) (for `nsyte`, invoked via `deno run -A jsr:@nsyte/cli`).
- [Amber](https://github.com/greenart7c3/Amber) on Android with a Nostr key.

### One-time pairing

1. In Amber, open the key you want to publish as → **Show bunker URL** → copy it.
2. Get the URL to your development machine somehow (Signal / Telegram to yourself works fine — it's a connection token, not an nsec).
3. From the repo root:

   ```bash
   deno run -A jsr:@nsyte/cli bunker connect '<bunker://...>'
   ```

4. Amber will prompt to approve the connection on your phone — tap approve.
5. **Grant standing approval for `kind:34128`** in Amber's session view for this
   app. Without this, every deploy prompts on your phone once per file.

nsyte stores the bunker pubkey and references it from `.nsite/config.json`;
the secret stays in your OS keychain.

### Deploy

```bash
npm run deploy
```

This runs `predeploy` (tests + `build`) and then `nsyte deploy ./dist`:
- The build step inlines `styles/style.css` and the esbuild-bundled `src/app.js`
  (which transitively pulls in `vendor/nostr-tools.js`) into a single
  `dist/index.html`.
- nsyte uploads that single blob to the Blossom servers in `.nsite/config.json`
  and publishes one `kind:34128` event for `/index.html` to the relays.

Because the deployable artifact is one file, the deploy is atomic — there's no
window where a partly-updated set of files can serve a broken page.

Your site is live at `https://<your-npub>.nsite.lol/` and any other nsite
gateway (e.g. `https://<your-npub>.npub.site/`).

### Verifying a deploy

After deploying, verify hashes match end-to-end:

```bash
DEPLOY_NPUB=npub1abc... npm run verify:deployed
```

Optional: `NSITE_GATEWAY=npub.site npm run verify:deployed` to point at a
different gateway. For each file under `dist/`:
1. Queries relays for a `kind:34128` event with matching `d` tag; asserts the
   event's `x` (sha256) tag equals the local file hash.
2. `fetch`es the gateway URL and asserts the response body sha256 matches.

This catches Blossom upload failures, stale manifest events, and gateway
resolution issues without needing a browser.

## Tuning

Relays and Blossom servers are split across two files (keep them in sync):
- `src/relays.js` — used by the app at runtime.
- `.nsite/config.json` — used by nsyte at deploy time.

To change the article count or pagination behaviour, see the constants at the
top of [src/nostr-client.js](src/nostr-client.js): `TARGET_ARTICLE_COUNT`,
`DEFAULT_ROUND_LIMIT`, `DEFAULT_MAX_ROUNDS`, `DEFAULT_EOSE_TIMEOUT_MS`.

## Notes

- **Sometimes <21 cards.** `fetchArticles` loops up to 5 rounds of 60 events
  each, paginating with `until` based on the oldest event seen. If the relay
  set is unusually sparse for tagged long-form, it returns whatever was found.
  With the configured relays this almost always fills 21 in round 1.
- **Standing-approval security.** Granting Amber permanent permission for
  `kind:34128` means anyone with access to your development machine can replace the site
  content as your npub. The blast radius is limited to the nsite manifest kind
  — DMs / notes / etc. require separate approvals — and re-deploying restores
  the site. Revoke from Amber if needed.
- **Gateway uptime.** The blob + manifest layer is decentralized, but visitors
  hit a single gateway. Alternate gateways serve the same content; advertise
  more than one if availability matters.
