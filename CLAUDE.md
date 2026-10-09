# Miziki

A local-first music player for iPhone (installed from Safari to the home screen), served from GitHub Pages at
https://esang-mao.github.io/Miziki/miziki.html. It plays FLAC, WAV, ALAC and MP3 files the user picks from their device. Nothing is uploaded. An optional social layer (Supabase) sits on top, and the player must work fully without it.

Long-term plan: modularize the codebase, build out the Supabase social layer, then wrap the app with Capacitor for the App Store.

## Repo layout

- `miziki.html` holds the markup. The main player script used to be one big inline `<script>` block at the end of `<body>`; it now lives in `src/main.js` (step 2a), loaded via `<script type="module" src="src/main.js">` in that same position. It is still one big ~10,100-line file — splitting *that* up is the rest of step 2 and beyond. See "Refactor rules" below.
- `src/main.js` is the main player script — the audio graph, the library, every route and overlay, all ~536 top-level functions, importing `S` and the small shared helpers below rather than defining them inline (step 2b onward). A module now, not a classic script: nothing it declares at the top level is a property of `window` (confirmed nothing relies on that — see the step 2a PR). `src/miziki-social.js` stays a classic script loaded just before it, so `MizikiSocial` is already a real global by the time this runs.
- `src/state.js` exports `S` (the one app-state object — audio context, tracks, queue, mode, character settings, sessions, etc.) plus `SOCIAL_SUPABASE_URL` and `SOCIAL_SUPABASE_ANON_KEY`. The foundation every later extraction imports from.
- `src/util/dom.js` exports `$()` (a `document.querySelector` shorthand) and `el()`, the tiny `createElement` helper used ~450 times across the app.
- `src/util/async.js` exports `sleep()`.
- `src/util/text.js` exports `normKey()`, the normalization helper (lowercase, NFKD, strip diacritics/punctuation) used ~40 times app-wide for matching artist/album/title.
- `src/util/math.js` exports `clamp()`.
- `src/record-art/tiers.js` — quality tiers (`trackTier`) and variant selection (`albumKey`, `trackIdentityKey`, `VARIANT_DEFS`, `selectVariant`, `variantBackground`) for record-art rendering.
- `src/sundown/solar.js` — sun position math (`computeSun`, `solarEvent`, `nowClock`, `sunProgress`, `easedProgress`, `computeRate`) behind Sundown's auto playback rate.
- `src/sundown/location.js` — geolocation and Car Mode motion handling (`askLocation`, `fallbackSun`, `toggleSleevePull`, `toggleMotion`, `applyVolume`). Imports `drawSun`/`queueSave` back from `main.js` (a deliberate circular import — see "Refactor rules" below).
- `src/crate/constants.js` — the small block of crate-view layout constants (`CRATE_ORIGIN_Y`, `CRATE_PALETTE`, `CRATE_VISIBLE_A`, `CRATE_DPR`, `CRATE_ALPHABET`).
- `src/player/sleep-timer.js` — the sleep timer (SLEEP spec §5): `updateSleepUI`, `stopSleepState`, `sleepStopPlayback`, `sleepCheckDeadline`, `openSleepSheet`, `closeSleepSheet`. Imports `pause`/`drawTime`/`setPathNote` back from `main.js` (also circular, same reason).
- `src/audio/engine.js` — the audio graph (`makeContext`, `buildGraph`, `satCurve`, `applyCharacter`, `routeSource`) and `ensureContext()` (from the "file loading" section — rebuilds the context when a file's sample rate differs). Imports `applyVolume` from `location.js` and `stop`/`applyOutputRoute` back from `main.js` (circular, same reason as above; step 3a).
- `tests/unit/` holds `node:test` unit tests for pure functions extracted out of `main.js` (`tiers.test.js`, `solar.test.js`, `engine.test.js`), run via `npm run test:unit`. Separate from `tests/client.test.js`, which needs Postgres. `engine.test.js` uses Node's module-mocking (`node --experimental-test-module-mocks`, see Commands) to replace `main.js`'s exports with no-ops before loading `engine.js`, since `main.js` has DOM-dependent top-level code that would otherwise need a real browser to load at all.
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
   - `src/sundown/location.js` imports `drawSun`, `queueSave`.
   - `src/player/sleep-timer.js` imports `pause`, `drawTime`, `setPathNote`.
   - `src/audio/engine.js` imports `stop`, `applyOutputRoute` (step 3a).

### Revised extraction order

1. Audio graph (out 1), then render loop and spin-to-scrub.
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
