# Miziki

A local-first music player for iPhone (installed from Safari to the home screen), served from GitHub Pages at
https://esang-mao.github.io/Miziki/miziki.html. It plays FLAC, WAV, ALAC and MP3 files the user picks from their device. Nothing is uploaded. An optional social layer (Supabase) sits on top, and the player must work fully without it.

Long-term plan: modularize the codebase, build out the Supabase social layer, then wrap the app with Capacitor for the App Store.

## Repo layout

- `miziki.html` holds the markup and the main player script (the one big inline `<script>` block, ~10,100 lines). It is being split into modules. See "Refactor rules" below.
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
  - IndexedDB is tied to the origin. Moving the app to a new domain (or a native shell) starts users with an empty library unless there is a migration or export path.
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

### Planned extraction order

1. Tooling: Vite, single source for the social client, CSS split into files.
2. Low-coupling modules: share images, metal and record-art tiers, solar and location, sleep timer, background playback.
3. Audio graph, render loop, spin-to-scrub.
4. Library, persistence, metadata edits and deletion, behind a storage interface (this layer will change for Capacitor).
5. UI: navigation shell, intro, crate and gatefold, profile and social screens, then the `wiring` section last.

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
- `npm run build` — builds to `dist/miziki.html` plus `dist/assets/` (bundled, hashed CSS) and `dist/src/miziki-social.js` (copied verbatim, see `vite.config.js`). `dist/` is gitignored.
- `npm run preview` — serves the built `dist/` at `http://localhost:4173/Miziki/`, closest to what GitHub Pages actually serves.
- `npm test` — runs `tests/client.test.js` (needs a local Postgres; see below).

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

### What changed in step 1 (tooling)

No behavior change — this step only adds build tooling and moves code, per the refactor rules above.

- Added Vite (`package.json`, `vite.config.js`) with a GitHub Actions workflow (`.github/workflows/deploy.yml`) that builds and deploys `dist/` to GitHub Pages on every push to `main`.
- The inline `<style>` block became 21 files under `src/styles/`, referenced via `<link rel="stylesheet">` tags in the same order, immediately after the Google Fonts links (unchanged).
- The vendored copy of the social client inside `miziki.html` is gone; it now loads `src/miziki-social.js` directly, as a classic script (not a module) so timing stays identical — the main script right after it still does a synchronous `typeof MizikiSocial` check.
- Verified (see the PR): confirmed the two social-client copies were byte-identical before removing the vendored one; diffed the built `dist/miziki.html` against the pre-step-1 original with the CSS and social-script regions normalized out — the only remaining difference was a stale comment folded into the new one above the script tag. Nothing in the ~10,100-line main script changed.
