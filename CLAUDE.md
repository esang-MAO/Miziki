# Miziki

A local-first music player for iPhone (installed from Safari to the home screen), served from GitHub Pages at
https://esang-mao.github.io/Miziki/miziki.html. It plays FLAC, WAV, ALAC and MP3 files the user picks from their device. Nothing is uploaded. An optional social layer (Supabase) sits on top, and the player must work fully without it.

Long-term plan: modularize the codebase, build out the Supabase social layer, then wrap the app with Capacitor for the App Store.

## Repo layout

- `miziki.html` holds the markup. The main player script used to be one big inline `<script>` block at the end of `<body>`; it now lives in `src/main.js` (step 2a), loaded via `<script type="module" src="src/main.js">` in that same position. It is still one big ~10,100-line file — splitting *that* up is the rest of step 2 and beyond. See "Refactor rules" below.
- `src/main.js` is the main player script — the audio graph, the library, every route and overlay, all ~536 top-level functions, importing `S` and the small shared helpers below rather than defining them inline (step 2b onward). A module now, not a classic script: nothing it declares at the top level is a property of `window` (confirmed nothing relies on that — see the step 2a PR). `src/miziki-social.js` stays a classic script loaded just before it, so `MizikiSocial` is already a real global by the time this runs.
- `src/state.js` exports `S` (the one app-state object — audio context, tracks, queue, mode, character settings, sessions, etc.; `S.scrubbing` was a top-level `let` in `main.js` until step 3c, see rule 7), `current()` (`S.tracks[S.index] || null` — moved here in step 3b since nearly every part of the app calls it), plus `SOCIAL_SUPABASE_URL` and `SOCIAL_SUPABASE_ANON_KEY`. The foundation every later extraction imports from.
- `src/util/dom.js` exports `$()` (a `document.querySelector` shorthand) and `el()`, the tiny `createElement` helper used ~450 times across the app.
- `src/util/async.js` exports `sleep()`.
- `src/util/text.js` exports `normKey()`, the normalization helper (lowercase, NFKD, strip diacritics/punctuation) used ~40 times app-wide for matching artist/album/title.
- `src/util/math.js` exports `clamp()`.
- `src/record-art/tiers.js` — quality tiers (`trackTier`) and variant selection (`albumKey`, `trackIdentityKey`, `VARIANT_DEFS`, `selectVariant`, `variantBackground`) for record-art rendering.
- `src/sundown/solar.js` — sun position math (`computeSun`, `solarEvent`, `nowClock`, `sunProgress`, `easedProgress`, `computeRate`) behind Sundown's auto playback rate.
- `src/sundown/location.js` — geolocation and Car Mode motion handling (`askLocation`, `fallbackSun`, `toggleSleevePull`, `toggleMotion`, `applyVolume`). Imports `drawSun` from `clock.js` and `queueSave` back from `main.js` (a deliberate circular import — see "Refactor rules" below).
- `src/crate/constants.js` — the small block of crate-view layout constants (`CRATE_ORIGIN_Y`, `CRATE_PALETTE`, `CRATE_VISIBLE_A`, `CRATE_DPR`, `CRATE_ALPHABET`).
- `src/player/sleep-timer.js` — the sleep timer (SLEEP spec §5): `updateSleepUI`, `stopSleepState`, `sleepStopPlayback`, `sleepCheckDeadline`, `openSleepSheet`, `closeSleepSheet`. Imports `pause` from `transport.js` and `drawTime` from `clock.js`. No longer imports anything from `main.js` (step 3c).
- `src/audio/engine.js` — the audio graph (`makeContext`, `buildGraph`, `satCurve`, `applyCharacter`, `routeSource`) and `ensureContext()` (from the "file loading" section — rebuilds the context when a file's sample rate differs). Imports `applyVolume` from `location.js`, `stop` from `transport.js`, and `applyOutputRoute` back from `main.js` (circular, same reason as above; step 3a).
- `src/player/transport.js` — `load`, `startSource`, `play`, `stop`, `pause`, `seek` (step 3b). The iOS-gesture-critical path: `bgPrime()` is the first call in `play()`, before any `await`, because iOS only allows audio to start inside the original tap; no `await` was added, removed or reordered when this moved, and the `S.gen` generation counter / `onended` logic (how a stale source is kept from advancing the queue) and the encoder delay/padding handling in `startSource` (PLAYBACK spec §1) are unchanged. Imports `drawTime`/`settleTrackEnd` from `clock.js`, `setPathNote` from `ui/path-note.js`, and ~18 more functions back from `main.js` (circular, same reason as above) — screen updates, background-playback helpers and queue/session functions it calls directly, in the same order as before. That's the widest circular import of the step-3 series; see rule 8 and the step 3b/3c changelog entries below for the full list and the future-cleanup note.
- `src/player/clock.js` — the render loop (step 3c): `tick`, `settleTrackEnd`, `frame`, the hidden-page `setInterval` fallback, `fmt`, `drawTime`, `drawSun`. Imports `sleepCheckDeadline` from `sleep-timer.js` and `computeRate`/`sunProgress`/`easedProgress` from `solar.js` (both real, non-`main.js` peer imports), plus `bgPosition`/`addPlayedRange`/`checkTrackCompletion`/`easeOutCubic`/`REDUCED` back from `main.js` (circular, same reason as above). The `maxDt` caps (0.1s for frames, 120s for the hidden-page timer), the order of work in `tick` (sleep deadline, then rate, then position, then played ranges and completion) and the 90ms/220ms redraw throttles are all unchanged — sessions, metals and the 95% rule depend on this clock.
- `src/player/scrub.js` — spin-to-scrub (step 3c): `wireSpinToScrub`, `angleDelta` (exported for its unit test, same as `solarEvent` in step 2c), and their constants. Imports `drawTime` from `clock.js` and `pause`/`play`/`seek` from `transport.js` — no `main.js` import.
- `src/ui/path-note.js` — `setPathNote()` (step 3c), the general on-screen note helper. It happened to live in the spin-to-scrub section but isn't about scrubbing, so it got its own module rather than moving into `scrub.js`. No `main.js` import.
- `tests/unit/` holds `node:test` unit tests for pure functions extracted out of `main.js` (`tiers.test.js`, `solar.test.js`, `engine.test.js`, `clock.test.js`), run via `npm run test:unit`. Separate from `tests/client.test.js`, which needs Postgres. `engine.test.js` and `clock.test.js` use Node's module-mocking (`node --experimental-test-module-mocks`, see Commands) to replace whichever real modules in their import chain would otherwise need a browser (`main.js`'s DOM-dependent top-level code) or hang the test process (`clock.js`'s real `setInterval` — see the step 3c changelog entry) — each mocks the *whole* module it needs to avoid pulling in, not just its own direct imports, since `mock.module`/`mock.timers` replace by resolved specifier/global, not per-importer.
- `src/styles/` holds the CSS, split out of what used to be one inline `<style>` block, one file per section (`00-base.css`, `01-header.css`, …), referenced from `miziki.html` as separate `<link rel="stylesheet">` tags in that same original order. Cascade order matters — that numeric prefix is load order, not importance, and the files must stay in it.
- `src/miziki-social.js` is the social client (Supabase). It exposes the `MizikiSocial` global. **This is the source of truth and the only copy** — `miziki.html` loads it directly (as a plain classic `<script src="src/miziki-social.js">`, not `type="module"`, so it keeps executing synchronously in place the same as the inline copy it used to be; see the comment above that tag for why a relative path, not an absolute one — it's also what makes this reference work unchanged under both bases below).
- `supabase/migrations/` holds the schema, RPCs, digging list and follow counts. Apply them in numeric order. Never edit a migration that has already been applied. Add a new numbered file instead.
- `tests/client.test.js` holds Node tests for the social client against a real local Postgres (see `tests/supabase_stub.sql`). The player itself has no automated tests yet.
- `vite.config.js` builds `miziki.html` (not `index.html`) as the one entry point, output to `dist/`. `base` reads from the `MIZIKI_BASE` env var, defaulting to `/Miziki/` when unset — the GitHub Actions workflow never sets it, so the real GitHub Pages deploy is unaffected; see "Deploy previews" below for the other value it takes. It also copies `src/miziki-social.js` into `dist/src/miziki-social.js` verbatim — Vite only bundles `type="module"` scripts referenced from HTML, so the plain classic script above needs that explicit copy step or it would 404 in the built app.
- `netlify.toml` configures Netlify's PR deploy previews. See "Deploy previews" below.

## How the app is put together

- **Global state** lives in one object, `S` (audio context, tracks, queue, mode, character settings, sessions, etc.), plus ~89 other top-level variables and ~536 top-level functions that share scope. Expect hidden coupling through `S` and these globals.
- **Audio:** Web Audio graph (`AudioContext`, `decodeAudioData`). There are two paths: **Pure** (reference, with the character chain fully disconnected, not just turned down) and **Vinyl** (wow & flutter → saturation → top-end softening → bus compression, in that order). Playback rate follows sunset and dusk ("Sundown"), using solar position from geolocation.
- **Car Mode** raises volume with GPS speed. Speed always comes from GPS and never from the accelerometer.
- **Background playback** is optional and routes through a media element plus `navigator.mediaSession` for lock-screen controls. It works on iPhone today, so don't regress it.
- **Persistence:** IndexedDB database `miziki`, **version 4**, with stores `tracks`, `meta`, `sessions`, `overlays`, `artwork`, `profile`, `achievements` and `collection`. It holds the original files plus tags, so the library survives restarts. If storage is unavailable, every call no-ops and the app runs session-only.
  - **Never rename the database or drop or rename a store.** Users' libraries live there. Schema changes go through a version bump with a non-destructive `onupgradeneeded`.
  - IndexedDB is tied to the origin. Moving the app to a new domain (or a native shell) starts users with an empty library unless there is a migration or export path. The same goes for saved prefs in the `meta` store, including toggles like **Background playback** — a fresh origin starts with `S.bgAudio = false` (the default in `state.js`), even if it's on at the usual URL. This is why background/lock-screen playback can look broken on a Netlify preview the first time: the fix is to flip the toggle on there too, not a code change.
- **Social config:** `SOCIAL_SUPABASE_URL` and `SOCIAL_SUPABASE_ANON_KEY` are empty, which means the social layer is inert. supabase-js loads from the jsDelivr CDN only when social is enabled. The anon key is safe in client code because RLS is the real protection.
- `?social=demo` turns on a dev-only demo mode for the social screens. It must not run in production.
- Fonts come from Google Fonts (Antonio, Archivo, IBM Plex Mono).

## Refactor rules (modularization in progress)

1. **No behavior changes in refactor PRs.** A move is a move. Fixes and features go in separate PRs.
2. **One extraction per branch and PR**, small enough to review as a diff.
3. **Deployed URL must not change:** it stays `https://esang-mao.github.io/Miziki/miziki.html`, because the home-screen app is saved to that URL. The build must keep base path `/Miziki/` and output a file named `miziki.html`.
4. Prefer ES modules with explicit imports and exports over new globals. When a module needs `S`, import a shared `state` module rather than reaching for `window`.
5. Keep the section comments and spec references (e.g. "CREDITS spec §2") when moving code. They are the project's design history.
6. After every extraction, run the build, then the device checklist below.
7. **An importing module cannot reassign an exported `let`.** Live bindings are read-only on the import side — only the module that declared the `let` can assign to it. `const` exports are fine to mutate *properties* of (e.g. `S.tracks = …` on the exported `S` object), since that isn't reassigning the binding itself; the rule only bites for a top-level `let` whose value gets replaced wholesale. If code in one module needs to reassign a top-level `let` defined in another, either fold that value into `S` (so it's a property write, not a rebinding) or export a small setter function from the module that owns it. Never work around this with `window`. There are roughly two dozen such top-level `let`s still in `main.js` (`socialAuth`, `GF`, `SEALSHEET`, `saveTimer`, and others) — deal with one only once an extraction actually moves code across the boundary it crosses, not preemptively.
8. **An extracted module may import from `main.js` only as a temporary step**, and only use those imports inside functions, never at module top level — the same shape as the circular imports from step 2c. Each later extraction should move those targets out of `main.js` too, so the number of imports from `main.js` keeps shrinking rather than growing. Modules currently importing from `main.js`:
   - `src/sundown/location.js` imports `queueSave`.
   - `src/audio/engine.js` imports `applyOutputRoute` (step 3a).
   - `src/player/transport.js` imports `sessionOnLoad`, `updateShellAlbum`, `applyDiscVariant`, `renderTracks`, `renderMiniPlayer`, `updateGatefoldNowPlaying`, `updateCreditsButtonForCurrent`, `updateFavoriteButtons`, `advance`, `preloadNextTrack`, `bgPrime`, `showRoute`, `ensureBuffer`, `breakSeal`, `clearSpinDown`, `touchActiveSession`, `bgRouteActive`, `bgIdleNow`, `bgPosition` (step 3b — still the widest, since transport is one of the most-depended-on sections in the app).
   - `src/player/clock.js` imports `bgPosition`, `addPlayedRange`, `checkTrackCompletion`, `easeOutCubic`, `REDUCED` (step 3c).

   `src/player/sleep-timer.js`, `src/player/scrub.js` and `src/ui/path-note.js` import nothing from `main.js` — step 3c moved their last remaining `main.js`-sourced names (`drawTime`/`setPathNote`) into modules of their own.

   A future cleanup, noted here rather than done now (step 3b): transport's calls back into `main.js` are direct calls, not events or callbacks, so the order things happen in is exactly what it was before the move. Replacing them with an event/callback layer would change that order and risk breaking the iOS audio-gesture rules (rule 9 below), so it's left as direct, temporary circular imports until the functions on the other end are themselves extracted. The same applies to `clock.js`'s circular import.
9. **The iOS audio-gesture rules are load-bearing and must survive every move untouched.** `play()`'s first call is `bgPrime()`, before any `await` — iOS only allows audio to start inside the original tap, so anything that delays past the first microtask boundary breaks it. When moving or refactoring playback code: never add, remove or reorder an `await`; never make a synchronous function `async` or the reverse; keep the `S.gen` generation counter and `onended` handler logic exactly as they are (they're how a stale source is kept from advancing the queue); keep the encoder delay/padding handling in `startSource` (PLAYBACK spec §1) unchanged.

### Revised extraction order

1. ~~Audio graph (out 1), then render loop and spin-to-scrub.~~ **Done** — steps 3a (`src/audio/engine.js`), 3b (`src/player/transport.js`, `current()`), 3c (`src/player/clock.js`, `src/player/scrub.js`, `src/ui/path-note.js`, `S.scrubbing`). What's left in `main.js`: persistence and library, queue, background playback, the screens, and `wiring` (see "After step 3" below).
2. Persistence behind a storage interface (19 sections reference it, so do this carefully), then library, metadata edits, deletion and clear-history.
3. Queue and visible queue, favorites, search, liner notes and credits.
4. Background playback (more coupled than it looks: out 9), share image (out 16, ~920 lines), profile, social screens.
5. Navigation shell, start sequence, launch intro (out 23), gatefold (~1,450 lines, out 21), and wiring last.

## Device checklist (run on iPhone, from the home-screen app, after each change)

- [ ] App opens; the launch intro plays (and is skipped when turned off)
- [ ] Existing library is still there after the update (IndexedDB intact)
- [ ] Add songs and add a folder; FLAC, WAV, ALAC and MP3 play
- [ ] Pure and Vinyl switch works; character sliders audibly change Vinyl
- [ ] Sundown auto rate and the preview slider; manual rate
- [ ] Sleeve pull, mini-player to full-player morph, spin-to-scrub
- [ ] Crate view, gatefold, sealed records
- [ ] Queue: play next, add, reorder, shuffle and repeat
- [ ] Edit track info and revert; remove from library
- [ ] Background playback plus lock-screen controls with the screen locked
- [ ] Car Mode reads speed (test while driving as a passenger, or skip)
- [ ] Sleep timer
- [ ] Share image: each style and format saves
- [ ] With social config empty, social screens show the calm "not set up" state

## Commands

- `npm install` — install Vite (the only dependency so far).
- `npm run dev` — Vite dev server at `http://localhost:5173/Miziki/` (note the `/Miziki/` — `base` is mounted in dev too, so `http://localhost:5173/` alone 404s).
- `npm run build` — builds to `dist/miziki.html` plus `dist/assets/` (bundled, hashed CSS and, since step 2a, the bundled `main.js`) and `dist/src/miziki-social.js` (copied verbatim, see `vite.config.js`). `dist/` is gitignored.
- `npm run preview` — serves the built `dist/` at `http://localhost:4173/Miziki/`, closest to what GitHub Pages actually serves.
- `npm test` — runs `tests/client.test.js` (needs a local Postgres; see below).
- `npm run test:unit` — runs `tests/unit/*.test.js` with Node's built-in `node:test`, under `--experimental-test-module-mocks` (needed by `engine.test.js`'s `mock.module()`; requires Node 22, see "Node version" below). No Postgres, no extra dependency. Both CI pipelines (`deploy.yml` and the Netlify build) run this before building, so a failing unit test blocks both deploys.

Social client tests need a local Postgres. See the header of `tests/client.test.js` for the connection defaults (`PGHOST=/var/tmp/pgmz`, `PGPORT=5544`, database `mz`).

## Deploy previews (Netlify)

Every PR gets a Netlify deploy preview, separate from the real GitHub Pages
deploy — **GitHub Pages stays on `/Miziki/` and is untouched by this.**

- `netlify.toml` runs `npm run build` with `MIZIKI_BASE=/` (Netlify previews
  live at their own root domain, not under a `/Miziki/` subpath the way the
  GitHub Pages project site does) and `NODE_VERSION=20`, publishes `dist`,
  and rewrites `/` to `/miziki.html` (status 200, not a redirect — the URL
  bar stays at the preview root) so the preview link opens the app
  directly instead of 404ing on an index page that doesn't exist.
- To test the same build locally: `MIZIKI_BASE=/ npm run build`, then
  `MIZIKI_BASE=/ npm run preview` (the preview server also reads `base`
  from the build, so it has to be set the same way or it'll try to serve
  from `/Miziki/` again) — then open `http://localhost:4173/miziki.html`.
- `MIZIKI_BASE` only changes `base` in `vite.config.js`; nothing else
  about the build differs between the two targets.
- A Netlify preview is a different origin from GitHub Pages, so its
  IndexedDB starts empty: an existing library doesn't show up, and prefs
  (including **Background playback**) default off. If lock-screen
  playback stops on a fresh preview, that's this, not a regression —
  toggle Background playback on for that origin too.

### What changed in step 1 (tooling)

No behavior change — this step only adds build tooling and moves code, per the refactor rules above.

- Added Vite (`package.json`, `vite.config.js`) with a GitHub Actions workflow (`.github/workflows/deploy.yml`) that builds and deploys `dist/` to GitHub Pages on every push to `main`.
- The inline `<style>` block became 21 files under `src/styles/`, referenced via `<link rel="stylesheet">` tags in the same order, immediately after the Google Fonts links (unchanged).
- The vendored copy of the social client inside `miziki.html` is gone; it now loads `src/miziki-social.js` directly, as a classic script (not a module) so timing stays identical — the main script right after it still does a synchronous `typeof MizikiSocial` check.
- Verified (see the PR): confirmed the two social-client copies were byte-identical before removing the vendored one; diffed the built `dist/miziki.html` against the pre-step-1 original with the CSS and social-script regions normalized out — the only remaining difference was a stale comment folded into the new one above the script tag. Nothing in the ~10,100-line main script changed.

### What changed in step 2c (lowest-coupling extractions + first unit tests)

No behavior change — a move is a move, per the refactor rules above.

- Extracted the five lowest-coupling sections out of `main.js`, in order: record-art quality tiers + variant selection (`src/record-art/tiers.js`), solar (`src/sundown/solar.js`), the crate-view constants block (`src/crate/constants.js`), location & motion (`src/sundown/location.js`), and the sleep timer (`src/player/sleep-timer.js`). Section comments and spec references (e.g. "SLEEP spec §5", "CRATE spec §3") moved with the code.
- `normKey()`, defined inside the tiers section but used ~40 times app-wide, moved to its own `src/util/text.js` instead of staying in `tiers.js`.
- `clamp()` moved to `src/util/math.js`, and the local `$()` shorthand moved into `src/util/dom.js` alongside `el()` — both were still defined locally in `main.js` and used by the newly-extracted modules, so leaving them in place would have meant copying them instead of moving them.
- `location.js` and `sleep-timer.js` each import a few functions back from `main.js` (`drawSun`/`queueSave`, and `pause`/`drawTime`/`setPathNote` respectively) — a deliberate circular import. Those functions got `export` added in `main.js` with no other change; this is the standard, safe shape for extracting a section that leaf-level code elsewhere in `main.js` still depends on, before that code is extracted too.
- Added the first player unit tests: `tests/unit/tiers.test.js` (`trackTier`) and `tests/unit/solar.test.js` (`solarEvent`, checked against a published sunset time for Columbia, MD plus a polar no-sunset case), run via the new `npm run test:unit` (Node's built-in `node:test`, no new dependency). Wired into both CI pipelines ahead of the build, so a failing unit test blocks both deploys.
- Verified lossless: each new module was diffed against the exact original lines it was extracted from (modulo only `export`/`import` additions), and the full `git diff` of `main.js` for this step was reviewed end to end — every removal matches a verified new-module file, and every other change is either an added import line or a single `export` keyword.

### Node version

Node **22** (bumped from 20 in step 3a — Node 20 reached end-of-life in April 2026). Set in `.github/workflows/deploy.yml` (`node-version`), `netlify.toml` (`NODE_VERSION`), and `package.json`'s `engines` field. `npm run test:unit` also needs 22 for `--experimental-test-module-mocks` (see Commands).

### What changed in step 3a (audio graph into `src/audio/engine.js`)

No behavior change — a move is a move, per the refactor rules above.

- Extracted the audio graph (`makeContext`, `buildGraph`, `satCurve`, `applyCharacter`, `routeSource`) and `ensureContext()` (the one function pulled out of the much larger "file loading" section) into `src/audio/engine.js`.
- `ensureContext()` calls `stop()` and `applyOutputRoute()`, which stay in `main.js` for now (rule 8 above) — imported back as a deliberate, temporary circular import, same shape as `location.js`'s and `sleep-timer.js`'s from step 2c. `applyVolume()` was already available from `location.js`.
- Added `tests/unit/engine.test.js`: `satCurve` (identity curve at 0, in-range/monotonic/trimmed-below-1 at 0.35 and 1 — with a small tolerance for a real, intentional overshoot the asymmetry term produces, not float noise) and the Pure/Vinyl chain-order promise (`buildGraph`'s wobble → sat → satTrim → dc → tone → comp → makeup → master wiring, and `routeSource`'s Pure-vs-Vinyl branch), using a fake `AudioContext` that just records `connect()` calls.
- `engine.js`'s circular import back to `main.js` means loading it for real needs a browser (`main.js` has DOM-dependent code at module top level, not just inside functions). The test uses Node 22's `mock.module()` (`node --experimental-test-module-mocks`) to replace `main.js`'s exports with no-ops first — not just the two `engine.js` imports directly, but every export any module in that import chain needs from `main.js` (`location.js`, loaded for `applyVolume`, also needs `drawSun`/`queueSave`), since `mock.module` replaces the whole module by resolved path, not per-importer.
- Upgraded Node 20 → 22 (separate commit) — see "Node version" above.

### What changed in step 3b (transport into `src/player/transport.js`)

No behavior change — a move is a move, per the refactor rules above. This is the step where the iOS audio-gesture rules (rule 9 above) mattered most: nothing about *when* anything runs changed, only *where it's defined*.

- Moved `load`, `startSource`, `play`, `stop`, `pause` and `seek` — sitting at the end of the "launch intro" section with no header of their own — into `src/player/transport.js`. Verified lossless: diffed the moved block against the exact original lines (modulo only the `export` keywords it already had, from step 2c/3a, plus the new ones rule 8's list needed) — identical.
- Moved `current()` (`S.tracks[S.index] || null`) into `src/state.js`, next to `S`. It's used ~47 times across the app, so this removes a `main.js` dependency from every module that calls it, present and future.
- `engine.js` imported `stop` from `main.js`; now imports it from `transport.js` instead. `sleep-timer.js` imported `pause` from `main.js`; now imports it from `transport.js` instead. Both still import their other `main.js` names (`applyOutputRoute`, `drawTime`/`setPathNote`) as before.
- `transport.js` itself imports ~20 functions back from `main.js` — see rule 8's list and its future-cleanup note. Confirmed no `await` was added, removed or moved, and no function's sync/async-ness changed, by diffing the six functions' bodies against the pristine originals.
- `tests/unit/engine.test.js` needed a second `mock.module()` call, for `transport.js` (replacing its one export, `stop`, with a no-op) — otherwise loading `engine.js` would transitively pull in `transport.js`'s whole ~20-function `main.js` dependency list too. Mocking `transport.js` directly, rather than also listing everything *it* needs from `main.js`, is simpler and keeps the test from having to track `transport.js`'s dependency list as it grows.

### What changed in step 3c (playback clock and spin-to-scrub)

No behavior change — a move is a move, per the refactor rules above. **Step 3 is now complete** — see the "Revised extraction order" note above for what's left in `main.js`.

- Moved the "render loop" section — `tick`, `settleTrackEnd`, `frame`, the hidden-page `setInterval`, the `last`/`lastUI`/`lastSky` variables, `fmt`, `drawTime`, `drawSun` — into `src/player/clock.js`. `sleep-timer.js`, `location.js` and `transport.js` now import `drawTime`/`drawSun` from there instead of `main.js`.
- Moved the "spin-to-scrub" section — `wireSpinToScrub` and its helpers/constants — into `src/player/scrub.js`. `setPathNote`, which happened to sit in that section but is a general on-screen note helper used across the app, got its own module instead: `src/ui/path-note.js`.
- The clock's behavior is unchanged: the `maxDt` caps (0.1s frames, 120s hidden-page timer), the order of work in `tick` (sleep deadline check, then rate, then position, then played ranges and completion), and the 90ms/220ms redraw throttles are all byte-for-byte identical. Verified lossless the same way as step 3b: diffed the moved blocks against the pristine original lines (modulo only `export` additions and the one deliberate `scrubbing`→`S.scrubbing` change below).
- `scrubbing` was a top-level `let` declared in the render loop and reassigned by the `#scrub` slider's wiring handlers — the exported-`let` rule (rule 7) meant it had to become `S.scrubbing` (default `false` in `state.js`) once it crossed a module boundary. Every read and write was updated. The gatefold/crate-rail view has its own function-local `scrubbing` that already shadowed the global one; that one is unrelated and was left alone.
- Added `tests/unit/clock.test.js`: `angleDelta` (wraparound across ±180°, both directions, plus a plain in-range case) and `tick` (advances `S.pos` by `dt × S.rate` while playing, doesn't while paused, never passes the track's duration) — `current()` isn't mocked directly; the tests just set `S.tracks`/`S.index` and let the real `current()` read them back, which is simpler than mocking `state.js` for the same effect.
- `clock.js`'s circular import back to `main.js`, and its real (non-circular) import of `sleepCheckDeadline` from `sleep-timer.js`, meant loading it for real in the test would transitively pull in `sleep-timer.js` → `location.js`/`transport.js` → `main.js`'s DOM-dependent top level. `main.js`, `sleep-timer.js` and `transport.js` are each mocked directly in `clock.test.js` to stop that chain at the door, same approach as `engine.test.js`.
- `clock.js`'s top-level `setInterval` (the hidden-page fallback clock) is a real OS timer the moment `clock.js` is imported directly — harmless in the browser (the page has other reasons to stay alive), but it kept `clock.test.js`'s Node process from exiting on its own, hanging the test run. Fixed in the test file only, with Node's `mock.timers.enable({ apis: ['setInterval'] })` before importing `clock.js`, so a real timer is never created; `clock.js` itself is untouched.
- `engine.test.js` needed a third `mock.module()` call, for `clock.js` (replacing its one export that `location.js` needs, `drawSun`, with a no-op) — same reasoning as the `transport.js` mock added in step 3b: otherwise loading `engine.js` would transitively reach `clock.js`'s own dependency chain (`sleep-timer.js`, more of `main.js`) through `location.js`.
