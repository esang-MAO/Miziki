# Miziki

A local-first music player for iPhone (installed from Safari to the home screen), served from GitHub Pages at
https://esang-mao.github.io/Miziki/miziki.html. It plays FLAC, WAV, ALAC and MP3 files the user picks from their device. Nothing is uploaded. An optional social layer (Supabase) sits on top, and the player must work fully without it.

Long-term plan: finish modularizing the codebase, build out the Supabase social layer, then wrap the app with Capacitor for the App Store.

**This file documents current state only.** For the history of how any of this came to be — which PR introduced a field, why a design changed, what a past bug was — read `git log`/`git blame` and `docs/CHANGELOG.md`, not this file. When you extend a module, update this file's description of it to match the new current state; don't append "since step N" narration here.

## Repo layout

- `miziki.html` — the markup shell: CSP/referrer meta tags, `theme-boot.js` (pre-paint theme), stylesheet links in cascade order, the tab bar/sidebar, mini-player, crate/library/profile routes, full-player overlay with desktop side panel, gatefold, sealed-record/picture-sleeve sheets, Sundown sheet, EQ/queue/share/credits/edit sheets, then `<script type="module" src="src/main.js">` preceded by the classic `src/miziki-social.js` script (so `MizikiSocial` is global before `main.js` runs).
- `src/main.js` — the boot file: imports what it needs, calls each `wireX()` from `src/wiring/` once, runs the startup sequence, then `restoreLibrary()` (opens storage, loads tracks, restores state, rebuilds indexes, heals thumbnails/details/crate-art/loudness/hooks, inits `MizikiSocial`, runs the launch intro) and wires backup-sync's `onBackup('applied', ...)` listener. The one module allowed to import `renderTracks`/`applyDiscVariant`/`renderProfile`/`isProfileRouteVisible` together — a module, not a classic script.
- `src/wiring/` — one file per UI area, each exporting a single `wireX()` that only attaches listeners: lifecycle, transport, library-view, search, import, library-management, gatefold (also the global Escape handler), sundown, character, edit, account, share, overlays, routes, pull-refresh.
- `src/state.js` — exports `S`, the one app-state object (audio graph, tracks/queue/mode, character/EQ/loudness/mono-balance, sessions, Sundown/day-arc fields, sync bookkeeping, theme, privacy flags, assorted runtime-only fields) and `current()`. Also the two social config constants. No imports — every other module can safely depend on it.
- `src/storage/` — `idb.js` (raw IndexedDB wrapper for database `miziki`; closes on `onversionchange`, degrades on `onblocked`); `prefs.js` (`serializePrefs`/`parsePrefs`, plus forward-compatible round-tripping of unknown keys); `repo.js` (named storage interface over the IndexedDB stores); `meta.js` (`queueSave`/`restoreMeta`/`applyPrefs` — debounced persistence that re-applies every setting on load).
- `src/shell/` — the navigation shell: `nav-stack.js` (the one history-based layer stack every overlay/sheet registers with); `mini-player.js`; `sidebar.js`; `routes.js` (route switching, Sundown-sheet redirect, library scroll lock); `header.js`; `player-overlay.js`/`start-sequence.js`/`handoff.js`/`put-away.js` (the open/close/hand-off/put-away ceremonies — iOS-gesture-sensitive, rule 9); `player-side-panel.js`; `sundown-sheet.js`; `pull-refresh.js`.
- `src/util/` — small leaves: dom, async, text, math, `motion.js` (`REDUCED`), `viewport.js` (desktop breakpoint).
- `src/record-art/` — `tiers.js` (quality tiers, key helpers, variants); `metals.js`; `looks.js` (`applyDiscVariant`, look picker); `peek.js` (shared pressing-peek drawing); `etchings.js` (dead-wax); `format.js` (pure: side-split, the 7″/10″/12″ format table, speed override, rotation Hz, naming/encoding).
- `src/sundown/` — `day.js` (seven-phase day model, pure); `arc.js` (Day Arc v2 dial model, maintained independently of `day.js`); `solar.js` (sun-position math, `computeRate` — the one place Pure's rate-always-1 rule lives); `location.js` (geolocation, fallback sun times, midnight recompute); `rhythm.js` (listening-rhythm pure logic).
- `src/crate/` — `constants.js`, `geometry.js` (shared with launch intro), `tiers.js` (art cache), `model.js` (grouping/sections/virtual bins), `view.js` (rendering, gesture, desktop detail panel).
- `src/launch/intro.js` — the launch-intro sequence: card-stack animation, last-played-album resolution, its setting.
- `src/player/` — `sleep-timer.js`; `eq-sheet.js`; `transport.js` (`load`/`play`/`pause`/`seek`/`startSource` — the iOS-gesture-critical path, rule 9); `clock.js` (the render loop, sky/phase/label mirrors); `background.js`; `controls.js`; `scrub.js` (spin-to-scrub and real scratch audio); `buffers.js` (decoded-audio LRU cache); `queue.js`.
- `src/audio/` — `engine.js` (the Web Audio graph: Pure/Vinyl routing, character chain, output stage — see "How the app is put together"); `mode.js`; `scratch-processor.js`/`limiter-processor.js` (AudioWorkletProcessors, classic scripts); `level-match.js`; `loudness.js` (BS.1770 loudness/true-peak, pure); `eq.js` (EQ's pure half); `hook.js`/`hook-preview.js` (hook detection, pure).
- `src/ui/` — `path-note.js`, `haptic.js`, `theme.js` (Auto/Light/Dark/Nychthemeron).
- `src/theme-boot.js` — anti-flash head script: sets `data-theme` from a `localStorage` mirror before CSS applies.
- `src/library/` — `model.js`; `tags/` (byte-level format parsers, pure); `import.js` (import loop, dup detection, loudness/hook measurement); `duplicates-ui.js`; `edit.js` (overlay edits, undo, format override); `delete.js` (deletion, Forget Library — clears only `tracks`/crate-art/thumbnails, never stats/settings); `duplicate-scan.js`; `credits.js`; `artist-shelves.js` (the artist page's local shelves — Your most spun, You & [artist], Your pressings — read-only over on-device stats, docs/21_ARTIST_PAGE.md); `connected.js` (the artist page's Connected shelf — related artists' records from the shared MusicBrainz cache, docs/20_CONNECTED.md); `favorites.js` (system playlist); `search.js`; `view.js` (library screen render/select, `renderTracks`); `sealed.js`; `thumbs.js` (thumbnail gen/healing).
- `src/gatefold/` — `view.js` (open/close, tracklist, side splits, hand-off); `sealed-sheet.js`; `picture-sleeve.js` (single-track singles).
- `src/history/` — the only place writing listening counters: `played.js`, `sessions.js`, `clear.js`, `achievements.js`.
- `src/profile/` — `badges.js`; `records.js` (pressings & metals screen); `rhythm-card.js`; `storefront.js` (shared by the profile's own storefront and a friend's); `settings.js` (sign-in, Account screen, device list); `privacy.js`; `legal.js` (synced with `docs/PRIVACY_POLICY.md`/`docs/TERMS_OF_USE.md`); `screens.js` (`renderProfile`, Settings screen).
- `src/social/screens/` — `friend-store.js` (social nav stack, a friend's storefront, the record sheet); `home.js`. `src/social/demo.js` — `?social=demo` fixtures, dynamically imported so they never ship to users.
- `src/share/` — `styles.js` (shared primitives); one composer per card type (`crate-card.js`, `now-playing-card.js`, `record-card.js`, `pressings-card.js`, `season-card.js`); `sheet.js` (the one share sheet every card opens through).
- `src/sync/` — `images.js` (re-encode/hash before upload); `backup.js` (the sync engine — never imports `library/view.js`/`record-art/looks.js`/`storage/meta.js`, to avoid their wide circular-import webs); `merge.js` (pure merge primitives); `backup-doc.js` (doc schema, conversion, versioning, checksum).
- `scripts/derive-makeup-table.mjs` — re-run if the Vinyl chain's topology changes; derives `level-match.js`'s makeup-gain table from a real render.
- `src/styles/` — numbered CSS files, cascade order matters; `fonts.css` self-hosts `@font-face`. `00-base.css` holds the token scale; `22-theme.css` holds light/Nychthemeron overrides.
- `src/fonts/` — self-hosted Antonio/Archivo/IBM Plex Mono, Latin subset, OFL licensed.
- `src/miziki-social.js` — the social client (`MizikiSocial`). Classic script, not a module; wired via `env`-passed accessor functions, not imports, so it stays import-free.
- `supabase/functions/` — edge functions: `mb-connections/` (the only code that calls MusicBrainz — fills the connected-crate cache, off unless the `MB_ENABLED` secret is `true`) and `_shared/mb-connections.js` (its pure parsing, plain JS so `tests/unit/connected.test.js` runs it under Node).
- `supabase/migrations/` — schema/RPCs/RLS, applied in numeric order. **Never edit an applied migration** — add a new one. From `012_migrations_log.sql` on, each asserts the prior version is logged and logs its own.
- `tests/unit/` — `node:test` tests for extracted pure functions (`npm run test:unit`); several mock modules that would otherwise need a browser or a wide unrelated dependency web — expected here, not a smell.
- `tests/client.test.js` — social-client tests against a local Postgres. `tests/perf/` — `nav.perf.js` (`npm run perf`, not CI) plus fixtures.
- `tests/audio-render/` — the offline-render harness for audio PRs: serves the repo unbuilt (native relative imports, no bundler) and drives Chromium/WebKit against real `OfflineAudioContext` specs. Not CI; run by hand, paste results into the PR.
- `docs/` — plan docs for multi-PR efforts, `docs/PRIVACY_POLICY.md`/`docs/TERMS_OF_USE.md` (canonical legal-screen source), `docs/MODERATION.md`, `docs/design/`, `docs/perf/BASELINE.md`, `docs/CHANGELOG.md` (full history — read for *why*, not current state).

## How the app is put together

- **Global state** lives in `S` (`src/state.js`) plus whatever top-level state each module still owns. Expect coupling through `S`.
- **Audio:** a Web Audio graph. Two paths: **Pure** (reference — character chain fully disconnected, rate always exactly 1.0) and **Vinyl** (wow & flutter → saturation → top-end softening → bus compression, plus Sundown's rate change). Sundown only ever reaches the recording in Vinyl — `computeRate()` (`src/sundown/solar.js`) returns `1` outright in Pure, the one place that rule lives. **Pure means untouched by Vinyl, not untouched altogether:** the output stage (normalization, EQ, mono/balance, limiter, desktop volume) applies in both modes, downstream of the rejoin point. The sleep-timer fade and user volume apply in Pure too — level changes in the shared output stage, not changes to the recording.
- **Scratch:** in Vinyl with the Scratch toggle on (default), spinning the disc by hand plays the real track forward/backward via an `AudioWorkletNode` (`src/audio/scratch-processor.js`). Off, or in Pure, spin-to-scrub is silent fast-navigation only. Saved in `S.char.scratch`; missing means On.
- **Background playback** is optional, via a media element plus `navigator.mediaSession`. Works on iPhone — don't regress it.
- **Persistence:** IndexedDB database `miziki` (see `src/storage/idb.js` for the version), stores `tracks`/`meta`/`sessions`/`overlays`/`artwork`/`profile`/`achievements`/`collection`. If storage is unavailable, every call no-ops and the app runs session-only.
  - **Never rename the database or drop/rename a store.** Schema changes go through a version bump with a non-destructive `onupgradeneeded`, plus a matching upgrade test in `tests/unit/idb.test.js` proving old data survives.
  - `DB.open()` flags `DB.staleVersion`/`DB.ok=false` on `onversionchange` and `DB.blocked` on `onblocked`, both surfaced via `DB.onNotice(fn)` — never a silent fork.
  - **Every new saved setting goes into both `serializePrefs` and `parsePrefs`**, **gets a default in `S`**, **and gets a round-trip test in `tests/unit/prefs.test.js`.**
  - **`src/history/` is the only place that writes listening counters.** Go through `played.js`/`sessions.js`/`clear.js`'s exports, never `S.trackPlayCounts`/etc. directly.
  - **"Forget library" removes your songs and keeps your listening stats** — it clears only `tracks`/crate-art/thumbnails; `meta`/`sessions`/`overlays`/`achievements`/`collection` are untouched, so playlists/edits/custom covers/order/sealed state reconnect once a matching file is re-added. "Clear listening history" is the one place that resets stats.
  - IndexedDB and saved prefs are origin-scoped — a new domain/shell starts with an empty library and every toggle at its default.
- **Account backup (Supabase):** signed in, a device debounce-uploads changed fields (`src/sync/backup.js`, ~30s), flushes on backgrounding, pulls-and-merges on launch/foreground. Signed out, nothing uploads. Audio, embedded art, crate tiers/thumbnails, and anything already synced via the social layer are never backed up. A custom cover and profile picture are the exception: real image bytes, uploaded to Supabase Storage, never inside the sync doc — see the table below.

  | Data | Class | Merge rule |
  |---|---|---|
  | Per-device play/session/metal/eligibility counters, `phasePlayCounts`/`albumPhaseCounts` | backed up | sum across devices (nested sum for the per-album map) |
  | `trackLastPlayed`, `albumLastPlayed` | backed up | max |
  | `rareUnlocked`, `achievements`, `collection` | backed up | union; earliest earned date wins on overlap |
  | `S.sealed` | backed up | broken anywhere stays broken everywhere |
  | `sessions` store (in-progress play-through) | device-only, excluded | merging two devices' in-progress sessions could corrupt the completion rule; nothing durable is lost since a session only affects anything persistent once it completes |
  | `overlays` (track edits, text only) | backed up | last write wins by timestamp; a revert is a tombstone that also wins by timestamp |
  | `playlists`/Favorites, `albumOrder`, `albumSort`, `albumDisplay`, `trackDisplay`, `albumEdge`, `albumLookPref`, `albumFormat` override | backed up | last write wins **per key** (not per whole field) |
  | playlist membership | backed up | add-wins CRDT per `(playlist, track identity)` pair |
  | `prefs`, profile display name, profile picture claim | backed up | last write wins per field |
  | a custom cover's/the profile picture's own image bytes | backed up (Supabase Storage, not the sync doc) | last write wins per track identity/account; a revert is a `hash: null` tombstone |
  | listening-rhythm shared snapshot (`{verdict, shares}` only) | opt-in, default off, needs ≥20 counted plays | single-writer; a separate `profiles.listening_rhythm` column, read via a visibility-gated RPC, not the sync doc |
  | `tracks` (audio, embedded art), crate-tier/thumbnail blobs, `t.details.replayGain`/`.loudness`/`.hookStart`/`.hookEnd` | excluded | re-derived locally from whatever's on the device |
  | social meta (ratings/notes/pins/follows) | excluded | already syncs through the social layer |
  | `deviceId`, `theme`, `S.deviceVolume`, the custom-slipmat flags/image, the sun-times cache, the home-feed cache, `S.rhythmPushedAt`, `S.phasePlayCountsByDay` | device-only | stripped from the uploaded copy (or never read from it) — each follows the device, not the account, for a stated reason (appearance/volume/slipmat are device preferences; the caches and rhythm-push bookkeeping are pure local plumbing) |

  **Rule: every new saved key goes into this table** (backed up, device-only, or excluded) when it's added. A key that rides inside `prefs`/an existing per-device counter with no special handling needs no new row — only a key that gets its *own* carve-out (like `theme`) does.

  `library_backup` is one row per `(user_id, device_id)`, owner-only RLS on every op, no view/feed/RPC reads another user's row — the server never parses `doc` itself; every merge rule above is enforced client-side in `src/sync/merge.js`/`backup-doc.js`.

  A clear on one device stays cleared everywhere: `fromDocs()`'s `ownReset` flag means this device must zero and persist every per-device history counter, via an awaited `'reset'` event `main.js` answers with `resetLocalHistory()`. Accepted gap: offline plays on this device, after another device's clear but before this device's next sync, get reset too — a play carries no timestamp of its own to separate before/after.

## What's stored server-side, and who can see it

(For the privacy policy/App Store label, not for extending the sync engine.) Every table lives in the user's own Supabase project; the app makes no other third-party requests. The one server-side exception is the `mb-connections` edge function, which (once `MB_ENABLED` is on) sends an artist's name to musicbrainz.org to fill the shared cache — never who asked. **Audio, embedded art, and location (used only for Sundown's sun times) never leave the device, signed in or not.** A custom cover and the profile picture are the one exception, uploaded re-encoded/EXIF-stripped.

| Server-side table/column | What it holds | Who can see it |
|---|---|---|
| `library_backup.doc` | Listening stats, achievements/Collection/rare-unlock/sealed state, track-edit text, playlists/ordering/display prefs, app settings, display name, a cover/picture *claim* (pointer only) | Only the owning account — owner-only RLS, no grant to `anon` |
| Storage bucket `covers` | Re-encoded custom-cover image bytes | Only the owning account (private bucket, owner-only RLS) |
| Storage bucket `avatars` | Re-encoded profile-picture image bytes | **Anyone**, including signed out (it doubles as the public account avatar); only the owner can write |
| `profiles` (handle, display name, avatar, bio) | The social-layer profile | Anyone the visibility setting (private/friends/public) and blocks allow |
| `profiles.listening_rhythm` | Opt-in `{verdict, shares}` snapshot, never raw plays | Gated by its own visibility-checking RPC, not the blanket profile-select policy |
| `now_spinning`, `crate_items`, `digging_list`, `verified_stats`, `release_credits` | The social layer's opt-in sharing surface, including per-record credits | Same visibility rule as `profiles`, enforced by RLS |
| `follows`, `blocks` | Who follows/blocks whom | Visible only to the owner, via RLS; follow counts are exposed more broadly through an RPC |
| `feed_events` | The home-feed event log (never a milestone/metal unlock); rows expire 45 days after creation | Only where the underlying event is already visible |
| `reports` | Filed reports against other accounts/content | Moderation-only |
| `mb_artists`, `artist_connections` | Shared MusicBrainz cache for the Connected shelf: artist names/MBIDs, related artists, their release groups and buy links — public catalog data, no `user_id` | Anyone, signed in or out (read-only; only the `mb-connections` edge function writes, with the service role) |
| `auth.users` (Supabase Auth) | Email, used only for the emailed one-time sign-in code | Supabase's own auth infrastructure — no password is ever stored |

**Download my data** (Privacy screen): a `miziki-data-YYYY-MM-DD.json` export of local stats/settings/playlists/track-edit text always, plus the account/social/backup snapshot when signed in.

## CSS token scale

`src/styles/00-base.css`'s `:root` defines the app's whole type/spacing/elevation/radius scale. **No font-size or spacing value outside these tokens without a comment saying why.**

**Type** (`--fs-*` font-size, `--lh-*` its own paired line-height):

| Token | Size/line-height | Role |
|---|---|---|
| `--fs-micro`/`--lh-micro` | 10px / 1.3 | annotations: times, kHz, stat labels |
| `--fs-label`/`--lh-label` | 11px / 1.3 | tabs, tab bar, segments, eyebrows |
| `--fs-caption`/`--lh-caption` | 12px / 1.45 | helper text, sub-lines |
| `--fs-body`/`--lh-body` | 14px / 1.5 | secondary lines, paragraphs |
| `--fs-row`/`--lh-row` | 16px / 1.35 | list titles, setting names, inputs |
| `--fs-title`/`--lh-title` | 20px / 1.2 | card values, sheet titles |
| `--fs-head`/`--lh-head` | 24px / 1.15 | section heads, crate album name |
| `--fs-hero`/`--lh-hero` | 28px / 1.1 | player title, dial word |
| `--fs-display`/`--lh-display` | 36px / 1 | phase name, big stats |
| `--fs-giant`/`--lh-giant` | 44px / 1 | profile name, dial time |

Letter-spacing follows size, not a token of its own: `.10em` at `--fs-micro`, `.08em` at `--fs-label`, `.02em` on Antonio (`var(--display)`) at `--fs-head` and up, `0` otherwise — unless a rule already carries its own hand-tuned value (an eyebrow, a crumb), which stays as authored. Antonio stays to no more than two sizes per screen.

**Spacing:** `--sp-1` 4px · `--sp-2` 8px · `--sp-3` 12px · `--sp-4` 16px · `--sp-5` 24px · `--sp-6` 32px · `--sp-7` 48px · `--sp-8` 64px. A heading sits closer to what it heads than to what's above it. **Radii:** `--radius-control` 4px, `--radius-card` 12px; circles stay plain `50%`.

**Elevation:** `--sh-1` (mini-player/buttons), `--sh-2` (cards/crate-neighbour cards/the dial), `--sh-3` (the current crate card, platter/sleeve, sheets/popovers) — each a tight contact shadow plus a soft cast shadow, routed through `--shadow` so light theme lifts every one of these at once.

**Buttons:** solid accent for the one primary action per screen; accent outline only for the selected option in a segmented control; real switches for on/off settings; borderless mono text for everything else; slider tracks fill at 45% accent.

**Borders:** no per-row hairline in a song/artist list (an `:active` tint marks a row instead); no border-top on both `.mini-player` and `.tabbar` where they meet (they read as one piece of bottom chrome); exactly one hairline under a sticky header.

## Design rules

- **Amber never signals state.** `--amber`/`--amber-tint`/`--amber-shade` are Miziki's one accent color, not a status color — never pressed/success/error. A pressed or selected state uses a ring, a filled background, or a weight change, never "turns amber" where it wasn't already amber.
- **No second warm in the chrome.** The app's chrome (panels, chips, cards, dividers) gets exactly one warm color family at a time — amber in dark theme's existing surfaces, the stock/bin/plinth family in the crate.
- **No mauve neutral, and no amber tricolour.** A neutral surface stays on the muted/warm-grey family, never drifts toward a mauve/purple read. No single screen uses amber for three distinct meanings at once (accent, a phase color, and a status) — a phase/status color comes from the secondaries (`--prussian`/`--verdigris`/`--puce`/`--olive`/`--olive-deep`), never a second use of amber.

## Security

- **Miziki makes no third-party requests at runtime, other than the user's own Supabase project, when one is configured.** Fonts, the social client library, and the app's own code are all bundled or self-hosted. **A future change that adds a new external host needs both a CSP update and a privacy note here saying what that host receives and when.**
- **Content Security Policy** (`miziki.html`'s `<meta http-equiv="Content-Security-Policy">` — a second line of defense, since GitHub Pages can't set a real response header): see the live tag for the exact policy. `style-src` needs `'unsafe-inline'` for the app's inline `style="..."` writes (crate/gatefold pose math, disc backgrounds) — no inline `<script>` anywhere. `worker-src 'self' blob:` lets the scratch/limiter AudioWorklets register. `connect-src`/`img-src` carry the Supabase project's own origins for sign-in, REST/auth, and the realtime "now spinning" subscription.
- **Supabase client is bundled, not CDN-loaded** (`@supabase/supabase-js`, exact-pinned in `package.json`). `main.js` only `await import()`s it when both social config keys are non-empty; with keys empty, the bundler proves the import unreachable and strips it entirely, so it costs nothing for a user who never configures social.
- **Tag text (song title/artist/album — untrusted, from a file's own embedded metadata) must never reach `innerHTML`/`outerHTML`/`insertAdjacentHTML` with anything but a plain string literal.** Build the DOM with `textContent`/`createElement`/`createTextNode` instead. Enforced by an ESLint `no-restricted-syntax` rule (`eslint.config.js`) that only objects to a non-literal right-hand side/argument — static markup literals are unaffected.
- **Server-side RLS-helper functions never belong in a schema the Data API exposes.** `is_blocked_between`, `item_visibility`, `effective_visibility`, `can_view` live in a `private` schema never added to Supabase's exposed Data API schema list, with execute revoked from `public`/`anon` and kept for `authenticated` (which the RLS policies calling them still need).

## Refactor rules

1. **No behavior changes in refactor PRs.** A move is a move. Fixes and features go in separate PRs.
2. **One extraction per branch and PR**, small enough to review as a diff.
3. **Deployed URL must not change:** it stays `https://esang-mao.github.io/Miziki/miziki.html`, because the home-screen app is saved to that URL. The build must keep base path `/Miziki/` and output a file named `miziki.html`.
4. Prefer ES modules with explicit imports and exports over new globals. When a module needs `S`, import `state.js` rather than reaching for `window`.
5. Keep section comments and spec references (e.g. "CREDITS spec §2") when moving code — they're the project's design history.
6. After every extraction, run the build, then the device checklist below.
7. **An importing module cannot reassign an exported `let`.** Live bindings are read-only on the import side. `const` exports are fine to mutate *properties* of (e.g. `S.tracks = …`). If one module needs to reassign another's top-level `let`, fold the value into `S` or export a setter — never work around this with `window`.
8. **An extracted module may import from `main.js` only as a temporary step, and only inside functions, never at module top level.** Zero modules currently import from `main.js` anywhere in `src/` — treat any that reappear as a backlog to clear, not a pattern to extend.
9. **The iOS audio-gesture rules are load-bearing and must survive every move untouched.** `play()`'s first call is `bgPrime()`, before any `await` — iOS only allows audio to start inside the original tap. When touching playback code: never add, remove, or reorder an `await`; never make a synchronous function `async` or the reverse; keep the `S.gen` generation counter and `onended` handler logic exactly as-is; keep `startSource`'s encoder delay/padding handling unchanged.
10. **Every PR must pass `npm run lint` with zero warnings.** The rule set is small on purpose (`no-undef` and a handful of core-ESLint safety checks, no style rules) — it catches a dropped-import-while-still-used bug before merge. A deliberately-unused catch-clause binding/var/argument gets a leading underscore (`_e`, …) rather than being left bare; a genuinely dead import/declaration gets removed.
11. **Audio PRs add an offline-render test** (`tests/audio-render/specs/*.js`, `npm run test:audio-render`) proving the property the PR claims against a real `OfflineAudioContext`, in both Chromium and WebKit where WebKit is installed — iOS runs WebKit, so a Chromium-only pass doesn't prove the fix holds there.

## Device checklist (run on iPhone, from the home-screen app, after each change)

- [ ] App opens; the launch intro plays (and is skipped when turned off)
- [ ] Existing library is still there after the update (IndexedDB intact)
- [ ] Add songs and add a folder; FLAC, WAV, ALAC and MP3 play
- [ ] Pure and Vinyl switch works; character sliders audibly change Vinyl
- [ ] Album A playing, surface noise on → pick album B from the crate. Music audible after the lead-in. Repeat with A paused.
- [ ] Sundown auto rate and the preview slider; manual rate
- [ ] Sleeve pull, mini-player to full-player morph, spin-to-scrub, scratching with Scratch on/off
- [ ] Crate view, gatefold, sealed records
- [ ] Queue: play next, add, reorder, shuffle and repeat
- [ ] Edit track info and revert; remove from library
- [ ] Tap the player's spec line: shows Untouched/Converted/Shaped and matches what's actually on (EQ, normalization, Vinyl, a resampled rate)
- [ ] Background playback plus lock-screen controls with the screen locked
- [ ] Lock the screen with the background toggle on, across a track boundary inside an album: no gap. Across an album boundary: next album starts within a second or two.
- [ ] Take a phone call (or ask Siri something) while a track is playing: music pauses, no crash, no second source. Lock-screen Play and in-app Play both resume from exactly where it stopped.
- [ ] Lock-screen/Control Center Play-Pause reflects actual playback state with Background playback both on and off, not just the one route.
- [ ] Lock-screen artwork shows (not blank) and survives the app being backgrounded a while. Lock-screen scrubber/position stays in step with the music through a Sundown slowdown, same as the in-app scrubber.
- [ ] Background playback off: background the app (don't lock the phone) with a track playing, then return. Playback stays paused (never auto-resumes) and the scrubber/platter show the real position.
- [ ] Sleep timer
- [ ] Share image: each style and format saves
- [ ] With social config empty, social screens show the calm "not set up" state

## Commands

- `npm install` — Vite, `fake-indexeddb`, `eslint`/`globals`, `@playwright/test` — dev-only, not part of the built app.
- `npm run dev` — Vite dev server at `http://localhost:5173/Miziki/` (note the `/Miziki/`).
- `npm run build` — builds to `dist/miziki.html` plus `dist/assets/` and `dist/src/miziki-social.js` (copied verbatim, since Vite only bundles `type="module"` scripts). `dist/` is gitignored.
- `npm run preview` — serves built `dist/` at `http://localhost:4173/Miziki/`, closest to real GitHub Pages.
- `npm run lint` — ESLint over the whole repo, zero errors/warnings required. Both CI pipelines run this before `npm run test:unit`.
- `npm test` — `tests/client.test.js` against a local Postgres (see its header for connection defaults).
- `npm run test:unit` — `node:test` under `--experimental-test-module-mocks` (Node 22). No Postgres needed. Both CI pipelines run this before building.
- `npm run perf` — `tests/perf/nav.perf.js`: builds `dist/`, seeds a synthetic 2,000-track library, drives Chromium under 4x CPU throttling to measure nav timing and reload time (median/p95 over 15 reps) plus backup-doc byte size. Writes `docs/perf/BASELINE.md`. **Not run in CI** — pass `--out <path>` to avoid overwriting the checked-in baseline.
- `npm run test:audio-render` — `tests/audio-render/run.js`: serves the repo unbuilt, drives Chromium/WebKit against each spec under `tests/audio-render/specs/` with a real `OfflineAudioContext`. Skips an engine with no installed browser. **Not run in CI** — run by hand on an audio PR, paste numbers into the description.

## Deploy previews (Netlify)

Every PR gets a Netlify deploy preview, separate from the real GitHub Pages deploy — **GitHub Pages stays on `/Miziki/` and is untouched by this.**

- `netlify.toml` runs `npm run build` with `MIZIKI_BASE=/` (previews live at their own root, not `/Miziki/`), publishes `dist`, rewrites `/` to `/miziki.html` (status 200).
- Locally: `MIZIKI_BASE=/ npm run build && MIZIKI_BASE=/ npm run preview`, then open `http://localhost:4173/miziki.html`.
- A preview is a different origin from GitHub Pages, so its IndexedDB starts empty and prefs default off — not a code regression.
- `miziki.netlify.app` (production domain) no longer updates on purpose — `netlify.toml`'s `[build].ignore` skips a rebuild whenever `$BRANCH` is `main`; every PR's own preview is unaffected.

### Node version

Node **22**. Set in `.github/workflows/deploy.yml`, `netlify.toml` (`NODE_VERSION`), and `package.json`'s `engines` field — needed by `npm run test:unit` for `--experimental-test-module-mocks`.

## Changelog

The full step-by-step history of every refactor and feature PR in this project — what changed, why, and how each step was verified — lives in `docs/CHANGELOG.md`, not here. Read it when you need the reasoning behind a past decision or a detailed account of what a specific step actually did; don't read it whole as a map of current state — this file is that map.
