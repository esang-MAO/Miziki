# Miziki

A local-first music player for iPhone (installed from Safari to the home screen), served from GitHub Pages at
https://esang-mao.github.io/Miziki/miziki.html. It plays FLAC, WAV, ALAC and MP3 files the user picks from their device. Nothing is uploaded. An optional social layer (Supabase) sits on top, and the player must work fully without it.

Long-term plan: modularize the codebase, build out the Supabase social layer, then wrap the app with Capacitor for the App Store.

## Repo layout

- `miziki.html` holds almost the whole app (~12,900 lines): inline CSS, markup, a vendored copy of the social client, and the main player script. It is being split into modules. See "Refactor rules" below.
- `src/miziki-social.js` is the social client (Supabase). It exposes the `MizikiSocial` global. **This is the source of truth.** `miziki.html` currently carries a pasted copy that can drift. Change it here, not in the HTML.
- `supabase/migrations/` holds the schema, RPCs, digging list and follow counts. Apply them in numeric order. Never edit a migration that has already been applied. Add a new numbered file instead.
- `tests/client.test.js` holds Node tests for the social client against a real local Postgres (see `tests/supabase_stub.sql`). The player itself has no automated tests yet.

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

_Fill in once Vite is added:_ `npm install`, `npm run dev`, `npm run build`, `npm test`.

Social client tests need a local Postgres. See the header of `tests/client.test.js` for the connection defaults (`PGHOST=/var/tmp/pgmz`, `PGPORT=5544`, database `mz`).
