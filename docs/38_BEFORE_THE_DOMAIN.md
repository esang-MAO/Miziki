# 38 · Before the domain

Findings from a full read of the repo as of `84ff2c0` (Nov 12, after plan 37's CO7 merge), worked through with Ken on Nov 13. The features are done and frozen. This plan is everything that can be tightened behind the scenes before the three things Miziki is waiting on: the domain, the Capacitor build, and MusicBrainz access. It is the last plan before the domain.

Every step either carries straight into the native app (it is the same JavaScript) or protects what exists today. Nothing here is throwaway web-only work except BD14 (offline launch), which Ken chose to have regardless.

The steps are a sequence, not a schedule. Each is finished before the next starts.

---

## What the read confirmed is already right (no work)

| Finding | Where Miziki already does it |
|---|---|
| Account backup converges across devices without server logic | Per-class merge rules in `src/sync/merge.js`, the table in CLAUDE.md, `tests/unit/backup-*.test.js` |
| The iOS audio path is protected from accidental change | Refactor rules 9 and 11; `tests/audio-render/specs/` |
| The server is optional | Empty social config strips the Supabase import; storage unavailable degrades to session-only |
| Every table has row-level security, column-level update grants, helpers outside the exposed schema | `supabase/migrations/001_schema.sql`, CLAUDE.md › Security |
| Trust basics exist before launch | `delete_my_account()`, Download my data, privacy policy, terms, block/report, `docs/MODERATION.md` |
| Untrusted tag text cannot reach `innerHTML` | The `no-restricted-syntax` rule in `eslint.config.js` |
| Font licences ship with the fonts | `src/fonts/OFL-*.txt` |
| A staging project is already described for rehearsing migrations | `docs/SUPABASE_SETUP.md`, "One-time setup" under staging |

---

## What the read found (the reasons for each step)

| # | Finding | Evidence | Step |
|---|---|---|---|
| 1 | Any signed-in account can insert rows into the shared catalogue with any title and artist, and the first writer for a key wins for good | `releases_insert … with check (true)`, `001_schema.sql:413`; `on conflict (release_key) do nothing`, `002_rpc.sql:156, 236` | BD1 |
| 2 | The first screen says files are not copied; import stores a full copy in IndexedDB | `miziki.html:154`; `src/library/import.js:131, 356` | BD2 |
| 3 | A track is decoded whole into memory with no length check; the file's own comment puts four minutes at ~85 MB, and three tracks stay cached | `src/player/buffers.js:1-15` | BD3 |
| 4 | Import analyses every file (loudness, hook) before the next file starts, so nothing new is playable until analysis is done | `src/library/import.js:117-175` | BD4 |
| 5 | `navigator.storage.persist()` is called and its answer thrown away; nothing shows how much space the library uses or whether an import will fit | `src/main.js:170` | BD5 |
| 6 | Vinyl is the boot default and Sundown slows it after dark; nothing in the app says so the first time it happens | `src/main.js:107`; `src/sundown/solar.js` `computeRate()` | BD6 |
| 7 | Features Ken has released: the live "now spinning" socket, held records, the booklet viewer, three of the five share cards | Decisions 2–5 | BD7–BD9, BD11 |
| 8 | Downloads that include a back-cover image do not get it picked up | `src/gatefold/back-cover.js:42` has the setter; nothing calls it at import | BD10 |
| 9 | No CI job imports a file, plays it, reloads and checks the library survived; the Postgres-backed social tests are not in CI | `.github/workflows/pr-checks.yml`; `package.json` `test` | BD12 |
| 10 | Caught errors live in an in-memory buffer nothing can read without the console | `src/util/debug-log.js` | BD13 |
| 11 | No service worker, no manifest, no home-screen icon | `miziki.html:1-20` | BD14 |
| 12 | 97 `aria-label`s for 204 buttons; the signature interactions are gestures | `miziki.html`; `src/player/scrub.js`, `src/gatefold/sealed-front.js` | BD15 |
| 13 | 62 remaining uses of type tokens CLAUDE.md lists as retired | `src/styles/00-base.css:95-108` | BD16 |
| 14 | No README and no licence notice in a public repo | repo root | BD17 |
| 15 | Audio bytes are read straight off the track record in several places, which is what makes the native storage swap wide | `rec.blob` in `src/player/buffers.js`, `src/library/thumbs.js:246, 276` | BD18 |
| 16 | The largest import cycle is 63 modules, exactly at the CI ceiling | `node scripts/cycles.mjs` | BD19 |
| 17 | Every merge to `main` deploys to the live URL with no pause | `.github/workflows/deploy.yml` | Ken check K2 |

---

## Decisions (Ken, answered 2026-11-13)

1. **Feature freeze.** Nothing new for pressings, turntables, shelves, share cards, colour or the friends layer. Frozen means it stays in the app exactly as it is; nothing frozen is hidden. **Yes.**
2. **Realtime "now spinning".** Remove the live socket; friends' discs refresh when Home is opened or pulled. **Remove.** This supersedes plan 25's "now spinning stays live after sunset": after sunset it is as fresh as the last time Home was opened.
3. **Held records.** **Remove**, and with it the **Suitcase turntable** (its planned earning rule depended on held records, and it has never been earnable). The lineup becomes 11.
4. **Booklet viewer.** **Remove for now**; booklets rarely come with digital downloads. Pages already stored on a device stay in storage untouched, unread.
5. **Share cards.** Keep **Now Playing** and **Pressings**. Remove Record, Crate and Season.
6. **Hook previews.** **Keep.** Only the analysis moves out of the import wait (BD4).
7. **Back cover.** **Keep**, and auto-detect one from the folder at import (BD10). Auto-detected back covers are device-only, not synced; one chosen by hand still syncs as today.
8. **Desktop layout.** **Keep**, frozen. Decided after before-and-after screenshots at 1440×900.
9. **Offline launch on the web.** **Build it now**, whatever the Capacitor date (BD14).
10. **Licence.** The repo stays **public, all rights reserved** (BD17).
11. **Legal entity and a named operator on the policy.** Set aside; revisit before launch or paid features. Not in this plan.
12. **Deluxe.** Left dormant as it is. Built out after Capacitor.
13. **Sign-up.** Turned off in the Supabase dashboard until the domain is live (K1).
14. **The first-night Sundown line** (BD6) is the one stated exception to "Less after dark": it appears once, ever, where the phase already shows.

---

## Order

BD0 → BD19, one PR each, the usual routine (preview, merge, after-merge check). BD1 first: it is a live gap. Ken's no-code checks K1 and K2 can be done today, before any PR.

Migrations: BD1 (029) and BD8 (030). Both are rehearsed on the staging project first and ship with an undo file (the rule BD0 adds).

**UI changes:**
- **BD2:** the empty-crate sentence changes.
- **BD3:** a plain note when a track is too long to play on the web version.
- **BD4:** during an import, finished tracks can be played before the batch ends.
- **BD5:** a storage line in Library tools; a note before an import that will not fit.
- **BD6:** one line, once, the first time Sundown slows a record.
- **BD7:** Home no longer updates by itself while open.
- **BD8:** held records disappear from a friend's crate; Suitcase leaves the turntable lineup.
- **BD9:** no booklet entry on the gatefold.
- **BD10:** a back cover appears by itself for folders that include one.
- **BD11:** the gatefold's "Share record" row, the crate share and the season share are gone.
- **BD13:** a "Copy error log" row in Settings.
- **BD14:** the app opens with no connection; a real home-screen icon.
- **BD15:** labels and tap routes; nothing changes for a sighted touch user.

BD0, BD1, BD12, BD16, BD17, BD18 and BD19 change nothing on screen.

---

## BD0: docs only (no UI)

> Read CLAUDE.md first. Docs-only PR: add this plan as `docs/38_BEFORE_THE_DOMAIN.md`. Then:
>
> 1. **CLAUDE.md › Repo layout, `supabase/migrations/`**, add: **Every new migration is applied to the staging project first** (docs/SUPABASE_SETUP.md's staging section) **and ships with an undo file**, `supabase/migrations/undo/NNN_name.undo.sql`, holding the statements that reverse it. An undo file is never applied by routine; it exists so a bad migration can be backed out by hand.
> 2. **CLAUDE.md › How Miziki behaves › Less after dark**, add one sentence: the single first-night Sundown line (BD6, docs/38_BEFORE_THE_DOMAIN.md) is the one exception, shown once per account.
> 3. **CLAUDE.md › Device checklist**, add a heading line above the list: "Run on iPhone, and on an Android phone in Chrome (docs/38_BEFORE_THE_DOMAIN.md, K3), and once at desktop width." Do not duplicate the list.
> 4. **docs/CHANGELOG.md**: the usual entry.
>
> No code. Open the PR. Do not merge.

---

## BD1: close the shared catalogue write (no UI, migration 029)

> Read CLAUDE.md (Security; the migrations rule), `supabase/migrations/001_schema.sql` (the `releases` table and its policies), and the **latest** definition of every function that runs `insert into public.releases`. Find them with `grep -rn "insert into public.releases" supabase/migrations` (hits today: 002, 005, 008, 010, 017, 021, 026) and take the newest `create or replace` of each function name. They are `security invoker`, so they insert as the caller, which is why the open policy exists.
>
> 1. New `supabase/migrations/029_catalogue_write.sql`, in the 012+ style (assert 028 is logged, log 029):
>    - Add `releases.created_by uuid` (nullable, no backfill).
>    - A helper `private.ensure_release(p_key text, p_title text, p_artist text, p_year smallint)` returning the release id: `security definer`, `set search_path = public`, execute revoked from `public`/`anon`, granted to `authenticated`, like the other `private` helpers. It trims the title and artist, strips control characters, inserts with `created_by = auth.uid()` `on conflict (release_key) do nothing`, and returns the row's id.
>    - A daily cap inside the helper: an account that has created more than **2,000** release rows in the last 24 hours gets a clear exception. (One `sync_crate` call carries at most 500 items; 2,000 covers a large first import.)
>    - `create or replace` each function found above so it calls the helper where it used to insert. Change nothing else in them.
>    - `drop policy releases_insert on public.releases;` and `revoke insert on public.releases from authenticated;`.
>    - Daily caps by trigger: **200** new follows and **20** new reports per account per 24 hours.
> 2. `supabase/migrations/undo/029_catalogue_write.undo.sql`.
> 3. No client change: every client path already goes through the RPCs. Confirm with `grep -n "from('releases')" src/miziki-social.js` that the client only ever selects.
> 4. **Tests (`tests/client.test.js`, local Postgres):** a direct `insert into releases` as an authenticated user is refused; `sync_crate` and `set_now_spinning` still create a missing release; the helper leaves an existing row's title alone; the 2,001st new release in a day raises; the follow and report caps raise.
>
> Lint/tests as usual. Apply to staging, then production, in that order. Open the PR. Do not merge.

**Preview focus:** none. After merge and after applying 029: add an album that is new to the server, pin it, and confirm it shows on your crate from a second device.

**Removes:** a client grant and a policy.

**Not in this step:** MusicBrainz matching (after the domain); cleaning rows already in `releases`.

---

## BD2: the first sentence is true (UI: one line of copy)

> Read `miziki.html` around line 154 and `restoreLibrary()` in `src/main.js` first.
>
> 1. `#empty`'s sub line becomes: **"Choose songs or a folder on this device. Miziki keeps its own copy here, and nothing is uploaded."**
> 2. `grep -rn -i "copied" miziki.html src docs/PRIVACY_POLICY.md docs/TERMS_OF_USE.md src/profile/legal.js` and bring any other "not copied" wording into line. `legal.js` and the two docs stay in sync with each other as CLAUDE.md requires.
> 3. No test beyond lint; this is copy.
>
> Open the PR. Do not merge.

**Preview focus (iPhone):** forget the library on a preview and read the empty state.

**Removes:** a false statement.

---

## BD3: long tracks cannot take the app down (UI: one note)

> Read CLAUDE.md (rule 9, rule 11) and `src/player/buffers.js` first. Do not touch `transport.js`.
>
> 1. A pure `decodedBytesFor(durationSec, channels, sampleRate)` (duration × rate × channels × 4), in `buffers.js` or a small leaf beside it.
> 2. In `ensureBuffer()`, before decoding: estimate from `t.duration`, `t.meta.ch` and the context's rate.
>    - Above `DECODE_SOLO_BYTES` (**300 MB**, about 13 minutes of stereo at 48 kHz): drop every other decoded buffer first and keep only this one while it plays (`touchLRU` keeps 1, not 3, while such a track is current).
>    - Above `DECODE_MAX_BYTES` (**1.2 GB**, about 52 minutes): do not decode. `setPathNote("This track is too long to play in the web version of Miziki.", true)` and return `false`, the same path a missing file takes.
> 3. Same check in `import.js` before `decodeAudioFile()`: a file over `DECODE_MAX_BYTES` is still stored with its tags (duration from the header where the format gives one; otherwise it is listed among the files that could not be measured), so it is waiting when the native build can stream it.
> 4. **Tests:** unit tests for the estimate and both thresholds; `touchLRU` keeps one buffer while a solo-size track is current and goes back to three after.
>
> Lint/tests/previews as usual. Open the PR. Do not merge.

**Preview focus (iPhone, the oldest one to hand):** a 15-minute, a 30-minute and a 60-minute file. The first two play and the app survives a track change after each; the third shows the note. If 30 minutes crashes, lower `DECODE_MAX_BYTES` and write the number that held here.

**Removes:** nothing; this adds a limit where there was none.

**Not in this step:** streaming playback (Later).

---

## BD4: play before the analysis is done (UI: tracks playable mid-import)

> Read CLAUDE.md (rule 9; `src/history/` rule), `src/library/import.js` (the per-file loop, lines ~117–225), `src/audio/analysis-client.js`, and `healLoudness()`/`healHooks()` in `src/library/thumbs.js` first. Decision 6: hook previews stay.
>
> 1. **Measure first.** Time the four phases per file (read, decode, analyse, store) for one 12-track FLAC album and one 12-track MP3 album in Chromium, and write the numbers into this doc. **If analysis is under 20% of the per-file time, stop here and report**; the fix would then be elsewhere and needs a new decision.
>
>    **Measured 2026-11-13** (Chromium, synthetic 12-track albums, ~3.5 min/track, 44.1kHz stereo; `performance.now()` around each of the four `addFiles()` phases, averaged over the 12 tracks):
>
>    | | read | decode | analyse | store | total/file | analyse % |
>    |---|---|---|---|---|---|---|
>    | FLAC | 20.9ms | 354.7ms | 3305.0ms | 6.0ms | 3686.7ms | **89.6%** |
>    | MP3 | 17.3ms | 577.2ms | 3421.2ms | 5.4ms | 4021.1ms | **85.1%** |
>
>    Analysis is 85-90% of per-file time in both formats, far over the 20% floor — continuing with step 2.
>
>    **Verified live** (Chromium, same 12-track FLAC album, temporary timing instrumentation, reverted before the PR): every track lands in `S.tracks` (playable) within ~6s of the batch starting; the first loudness heal doesn't land until ~11s, and they continue to arrive roughly one every 4-5s after that — well after the track is already playable, confirming the import loop itself no longer waits on analysis.
> 2. Otherwise: the import loop no longer awaits `analyzeTrack()`. It stores the track with `details.loudness` and the hook fields unset ("absent means unknown", the posture those fields already have) and moves to the next file.
> 3. When the batch ends, call the existing `healLoudness()` and `healHooks()` passes, which already fill these in from the stored file in the background. Do not write a second queue.
> 4. A track played before its loudness arrives plays un-normalised, exactly as a track imported before loudness existed does today.
> 5. Duplicate detection, sealing, gapless trim, overlays and `reconcileImportedTrack()` are unchanged and stay in the loop.
> 6. **Tests:** `tests/unit/import-duplicates.test.js` still passes unchanged; a new test that a track is in `S.tracks` and stored before any analysis result exists, and that the heal pass then fills `details.loudness`.
>
> Lint/tests/previews as usual. Open the PR. Do not merge.

**Preview focus (iPhone):** add a 12-track album. Time from choosing the folder to first sound, before and after; write both here. Play track 1 while the rest import. Confirm level matching arrives by itself a little later, with no jump mid-track.

**Removes:** the analysis wait inside the import loop.

**Not in this step:** skipping the decode itself (needs duration and gapless data from headers for every format; Later).

---

## BD5: storage you can see (UI: a line in Library tools, a note before import)

> Read `restoreLibrary()` in `src/main.js`, `storeTrack()` in `src/library/import.js`, and the Library tools panel in `src/profile/screens.js` first.
>
> 1. `main.js`: await `navigator.storage.persist()` and keep the answer in a runtime-only `S.storagePersisted` (not saved, so no prefs entry).
> 2. A small `src/storage/usage.js`: `readUsage()` wrapping `navigator.storage.estimate()` (returns `null` where unsupported), and a pure `formatUsage(usage, quota)`.
> 3. Library tools shows one line: "Using 3.2 GB of about 60 GB Miziki can use on this device." and, only when the browser said no, "This browser may clear Miziki's library if the device runs low on space." Both use `--fs-body`; no new control.
> 4. `addFiles()`: before the loop, add up the picked files' sizes. If they exceed quota minus usage, do not start; path note: "These files need 4.1 GB and Miziki has 2.3 GB free on this device."
> 5. `storeTrack()` returning `false` is no longer silent: the file's name goes into the batch's end-of-import summary as "not saved".
> 6. **Tests:** `formatUsage` cases; the fit check; a failed `tracks.put` reaches the summary.
>
> Lint/tests/previews as usual. Open the PR. Do not merge.

**Preview focus (iPhone):** the line roughly matches iOS Settings › iPhone Storage for the home-screen app.

**Removes:** a silent failure.

---

## BD6: one line the first time Sundown slows a record (UI)

> Read CLAUDE.md (How Miziki behaves; the prefs rule), `src/sundown/solar.js` (`computeRate`), `src/player/clock.js` (the phase/label mirrors) and `src/shell/sundown-sheet.js` first. Decision 14.
>
> 1. New saved flag `S.sundownExplained` (default `false`): into `serializePrefs` and `parsePrefs`, a default in `S`, a round-trip test in `tests/unit/prefs.test.js`. It rides in `prefs` with no carve-out, so no new row in the backup table.
> 2. The first time a track is playing in Vinyl and `computeRate()` returns less than 1, show one line beside the player's phase button: **"After dark, Sundown plays records a little slower. Tap here to change it."** Tapping it, or the phase button, opens the Sundown sheet. It clears when the track ends or the player closes, sets the flag, and never shows again on any device on the account.
> 3. Not a toast, popup or sheet. `var(--body)`, `--fs-body`, `--muted` tone; crossfades in and out; honours `REDUCED`.
> 4. Never shown in Pure (the rate is 1 there).
> 5. **Tests:** the trigger function is pure (mode, rate, flag → show or not); the prefs round trip.
>
> Lint/tests/previews as usual. Open the PR. Do not merge.

**Preview focus (iPhone, after sunset or with the Sundown preview slider):** it appears once, reads cleanly over the sky, and does not come back after a relaunch.

**Removes:** nothing on screen. It retires the need for a help page (the store listing and landing page carry the rest).

---

## BD7: no live socket (UI: Home stops updating by itself)

> Read `subscribeNowSpinning()` in `src/miziki-social.js` (~line 1227), `homeNowSpinningRow()` in `src/social/screens/home.js`, `src/social/demo.js:241`, and CLAUDE.md › Security first. Decision 2.
>
> 1. Remove `subscribeNowSpinning()` and its export. Home fetches friends' current discs when the tab opens and on pull-to-refresh, through the read path it already uses for its first paint.
> 2. `miziki.html`'s CSP: drop the `wss://…supabase.co` entry from `connect-src`.
> 3. CLAUDE.md › Security: remove the realtime clause from the CSP paragraph. `docs/PRIVACY_POLICY.md`/`legal.js`: fix any sentence that describes a live update.
> 4. `demo.js`: remove the matching fixture hook.
> 5. **Tests:** `tests/unit/home.test.js` updated; a build check that `dist/` contains no `.channel(` call from the app's own code.
>
> Lint/tests/previews as usual. Open the PR. Do not merge.

**Preview focus (two devices, signed in as friends):** start a record on one; the other shows it after opening Home or pulling down.

**Removes:** the realtime subscription, a CSP origin, a fixture.

---

## BD8: held records and the Suitcase go (UI, migration 030)

> Read `supabase/migrations/025_held_for_you.sql`, every hit of `grep -rn -i "held" src tests`, `src/profile/turntable.js`, and the turntable allow-lists at `src/storage/prefs.js:274` and `src/storage/meta.js:196` first. Decision 3.
>
> 1. `supabase/migrations/030_remove_held_records.sql`: drop `held_records`, its policies and any function that only served it. Undo file alongside. Rehearse on staging.
> 2. Client: remove the held-for-you calls from `src/miziki-social.js`, the UI in `src/social/screens/friend-store.js`, the fixtures in `src/social/demo.js`.
> 3. **Suitcase:** remove it from `TURNTABLE_LINEUP` and its parts table in `turntable.js`, the `.tt-suitcase` rules in `src/styles/18-storefront.css`, and both allow-lists (a saved `'suitcase'` then falls back to Standard, as any unknown value does). Update `tests/unit/prefs.test.js:639`, `KNOWN_UNEARNABLE` in `tests/unit/earning-thresholds.test.js`, and the comment at `src/history/sessions.js:355`.
> 4. Leave migration 027's check constraint as it is. It still allows the value `'suitcase'`; that is harmless, and applied migrations are never edited.
> 5. CLAUDE.md: remove the `held_records` row from the server-side table; "all 12 turntable models" becomes 11. `docs/PRIVACY_POLICY.md`/`legal.js`: remove any mention.
> 6. **Tests:** social client tests pass without the table; the turntable sheet lists no Suitcase; the snapshot in `earning-thresholds.snap.json` is regenerated on purpose and the diff shows only this.
>
> Lint/tests/previews as usual. Open the PR. Do not merge.

**Preview focus:** a friend's crate opens cleanly with nothing where held records were; the turntable sheet shows what you have.

**Removes:** a table, a turntable, their code.

---

## BD9: no booklet viewer for now (UI)

> Read `src/gatefold/booklet.js`, `src/library/booklet.js`, the booklet lines in `src/library/import.js`, `src/wiring/gatefold.js`, `src/gatefold/view.js`, `src/history/sessions.js:120-123, 589-590`, `src/styles/32-booklet.css` and `miziki.html:1937` first. Decision 4.
>
> 1. **Keep, and move:** the folder-walking parts BD10 needs: `isPageImageName()` and the per-folder grouping. Move them to a new `src/library/sidecar.js` (a move, no behaviour change), with their tests.
> 2. **Remove:** the viewer, "Add booklet pages…", the gatefold's booklet entry and page count, booklet detection at import, `32-booklet.css` and its `<link>`, `#bookletAddFile`, `S.albumBookletPages` and its `meta` read/write, `tests/unit/booklet.test.js` (minus what moved).
> 3. **Do not delete stored pages.** Rows keyed `booklet:<albumId>:NNNN` in the `artwork` store stay where they are, unread, so a later return finds them. No IndexedDB version bump.
> 4. CLAUDE.md: remove the booklet row from the backup table and the `booklet.js` entries from Repo layout; note in one line that stored pages are left in place.
> 5. **Tests:** gatefold tests updated; an `idb` test that an `artwork` store holding booklet rows opens and reads custom covers exactly as before.
>
> Lint/tests/previews as usual. Open the PR. Do not merge.

**Preview focus (iPhone):** an album that had booklet pages opens its gatefold with no booklet entry and no gap where it was.

**Removes:** the viewer, a stylesheet, a saved key.

---

## BD10: the back cover finds itself (UI)

> Read `src/gatefold/back-cover.js` (`getAlbumBackCoverBlob`, `setAlbumBackCoverImage`), `src/library/sidecar.js` (from BD9), and the `folderAlbumIds` handling in `src/library/import.js` first. Decision 7.
>
> 1. Pure `isBackCoverName(name)` in `sidecar.js`. Case-insensitive, extension ignored, an optional leading number and separator allowed (`02 - back.jpg`). Matches the whole stem against: `back`, `back cover`, `backcover`, `back_cover`, `back-cover`, `rear`, `rear cover`, `tray`, `inlay`. `backstage.jpg` and `feedback.png` must not match.
> 2. After a **folder** import maps each folder to its album: for each album with no back cover set (no image, and no "Use Miziki default" tombstone), take the matching image in that folder; if several match, the largest file. Store it with `setAlbumBackCoverImage()`.
> 3. Mark it auto-detected so it is **not** uploaded or claimed in the sync doc. A back cover the user picks by hand still syncs exactly as today, and replaces an auto-detected one.
> 4. Never overwrite a user's choice, including the tombstone.
> 5. Picking individual files (no folder) gives the app no sibling images; nothing to do there.
> 6. **Tests:** the name table, both ways; several matches; an album that already has one; the tombstone; the not-synced flag stays out of `toDoc()`.
>
> Lint/tests/previews as usual. Open the PR. Do not merge.

**Preview focus (iPhone):** add a download folder that includes a `back.jpg`. Turn the record over. Then "Use Miziki default", re-add the folder, and confirm the default stays.

**Removes:** a manual step.

**Not in this step:** back covers embedded in the audio file's own tags (FLAC picture type 4, ID3 APIC type 4): Later.

---

## BD11: two share cards (UI)

> Read `src/share/sheet.js`, `src/wiring/share.js`, and the three call sites: `src/gatefold/view.js:661-670` ("Share record"), `src/profile/screens.js:683-689` (season), and the crate share entry point. Decision 5.
>
> 1. Remove `record-card.js`, `crate-card.js`, `season-card.js`, their imports in `sheet.js`, and their three entry points (the gatefold's "Share record" row, the crate share, the Listening screen's season share).
> 2. Keep `now-playing-card.js`, `pressings-card.js`, `styles.js`, and whatever in `styles.js` those two still use. Delete what only the removed cards used.
> 3. `shareFormatByCard`: `parsePrefs` keeps ignoring unknown card keys; do not migrate saved values.
> 4. GF11's after-sunset rule hid "Share record"; that branch goes with the row.
> 5. **Tests:** `tests/unit/share.test.js` and `season.test.js` trimmed to what remains; `gatefold-track-menu.test.js` updated.
>
> Lint/tests/previews as usual. Open the PR. Do not merge.

**Preview focus (iPhone):** both cards still save in every style and format (the device checklist's share line).

**Removes:** three cards and their entry points.

---

## BD12: a test that plays a record (no UI)

> Read `tests/perf/nav.perf.js` (how it attaches in-memory files with `setInputFiles`, switches to Songs, and gets real playback running), `tests/perf/lib/static-server.js`, the header of `tests/client.test.js`, and `.github/workflows/pr-checks.yml` first.
>
> 1. `tests/e2e/smoke.spec.js` (Playwright, Chromium, against built `dist/`): attach two small generated WAV files through `#file`; wait for their rows; play one; assert the position advances; reload; assert both rows are still there and the last-played track is restored. No network: social config is irrelevant to this path.
> 2. `npm run test:e2e`; a job in `pr-checks.yml` that installs Chromium (`npx playwright install --with-deps chromium`) and runs it after the build.
> 3. A second job with a `postgres` service container running `npm test` (`tests/client.test.js`), using the connection defaults in that file's header and `tests/supabase_stub.sql`.
> 4. Both jobs required for merge.
>
> Lint/tests as usual. Open the PR. Do not merge.

**Preview focus:** none. After merge: break the import on a throwaway branch and confirm the check goes red.

**Removes:** two manual checks from every PR's routine (the checklist lines stay for the iPhone).

---

## BD13: an error log a tester can send (UI: one Settings row)

> Read `src/util/debug-log.js` and the Settings screen in `src/profile/screens.js` first. CLAUDE.md's "Miziki keeps no engagement numbers" stands: nothing is sent anywhere by the app.
>
> 1. A "Copy error log" row at the foot of Settings. It opens a small sheet showing exactly the text that will be copied (app build id, browser, and each entry's time, call site and message), with one Copy button.
> 2. A pure `formatDebugLog(entries, env)`. Error messages can contain a file name; that is why the text is shown before it is copied.
> 3. `navigator.clipboard.writeText` from the tap; on refusal, select the text so it can be copied by hand.
> 4. **Tests:** `formatDebugLog` (empty, one entry, the 200-entry cap).
>
> Lint/tests/previews as usual. Open the PR. Do not merge.

**Preview focus (iPhone):** import a deliberately broken file, copy the log, paste it into Notes.

**Removes:** the need for `?debug=1` and a console to see an error.

---

## BD14: opens without a connection (UI: offline launch, a home-screen icon)

> Read CLAUDE.md (refactor rule 3: the deployed URL; Security: the CSP), `vite.config.js` (the `copyThemeBoot` plugin is the model), `netlify.toml`, and `miziki.html`'s head first. Decision 9.
>
> 1. A build plugin in `vite.config.js` that, at `closeBundle`, lists everything in `dist/` and writes `dist/sw.js` with that list and a build id.
> 2. The worker: on install, cache the list under a cache named for the build id; on activate, delete older caches; on fetch, answer same-origin GETs for listed files from the cache and let **everything else** through untouched (Supabase, `blob:`, range requests).
> 3. Register it from `main.js` only when `!import.meta.env.DEV` and `'serviceWorker' in navigator`, after the launch sequence starts. Scope is the build's own base, so GitHub Pages (`/Miziki/`) and Netlify previews (`/`) both work.
> 4. **Never reload a running app.** A new worker waits and takes over at the next cold start, so an update shows on the second launch after a deploy. Playback is never interrupted.
> 5. `manifest.webmanifest`: name, `start_url` exactly the saved URL (`miziki.html` under the base), `display: standalone`, theme colours from the existing `theme-color`. Icons at 180, 192 and 512 px rendered from `data/wordmark.svg` on the app's dark ground, plus an `apple-touch-icon` link. `miziki.html` has neither today.
> 6. The CSP already allows `worker-src 'self'`; add `manifest-src 'self'`.
> 7. CLAUDE.md: Repo layout entry; a Security line (the worker caches only the app's own files); two checklist lines: "Aeroplane mode, cold start: the app opens and a record plays" and "After a deploy, the new version shows on the second launch."
> 8. **Tests:** a unit test for the fetch decision (listed file → cache; Supabase URL → network; non-GET → network); an e2e test that loads once, goes offline, reloads, and sees the library.
>
> Lint/tests/previews as usual. Open the PR. Do not merge.

**Preview focus (iPhone, the existing home-screen app, not a fresh install):** the library is still there after the update; aeroplane mode cold start plays a record; background playback and the lock screen behave as before. Then check the icon on a fresh Add to Home Screen.

**Removes:** the dependency on a connection at launch.

**Not in this step:** anything for the native build, which bundles its own files.

---

## BD15: labels and tap routes (UI: none for touch users)

> Read `miziki.html` (every `<button>`), `src/player/scrub.js`, `src/shell/player-overlay.js` (sleeve pull), `src/gatefold/sealed-front.js` (peel), and `src/styles/31-switch.css` first.
>
> 1. Every button whose content is only an icon gets an `aria-label` in plain words. A unit test parses `miziki.html` and fails on an unlabelled icon-only button.
> 2. For each of spin-to-scrub, sleeve pull, shrink-wrap peel and the 24-hour dial: confirm a tap or keyboard route reaches the same result. Where one is missing, add the smallest one that fits (a labelled button that already exists nearby is preferred to a new control; one in, one out still applies, so say in the PR what it stands in for).
> 3. Focus rings: every focusable control shows `:focus-visible`.
> 4. List what is still gesture-only at the end of the PR description. Fix only what blocks import, playback and the gatefold in this step.
>
> Lint/tests/previews as usual. Open the PR. Do not merge.

**Preview focus (iPhone, VoiceOver on):** add a folder, open a record, play, pause, turn it over, close.

**Removes:** nothing.

---

## BD16: the retired type tokens go (no UI)

> Read CLAUDE.md › CSS token scale and `src/styles/00-base.css:95-108` first.
>
> 1. Replace every use of `--fs-micro`, `--fs-label`, `--fs-head`, `--fs-display` (and their `--lh-*` pairs) with the token each aliases (62 uses today). Then delete the aliases.
> 2. Pixel comparison at 390×844 and 1440×900 on Library, the full player, a gatefold and Profile, before and after: identical.
> 3. CLAUDE.md: drop the sentence about one-release aliases.
>
> Lint/tests as usual. Open the PR. Do not merge.

**Removes:** four aliases.

---

## BD17: a README and a licence notice (no UI)

> Docs-only. Decision 10.
>
> 1. `README.md`: what Miziki is in three sentences, the live URL, that the music never leaves the device, and a pointer to CLAUDE.md for layout and commands. No feature list.
> 2. `LICENSE`: "Copyright © 2026 Ken Ndiang. All rights reserved. The source is published for reference; no licence to use, copy, modify or distribute it is granted." One further line: the fonts in `src/fonts/` are under the SIL Open Font License, texts alongside.
> 3. `package.json`: `"license": "UNLICENSED"`.
>
> Open the PR. Do not merge.

**Removes:** an ambiguity.

---

## BD18: one door to a track's audio (no UI, refactor)

> Read CLAUDE.md (refactor rules 1, 2, 7, 9), the note at the foot of `src/storage/repo.js`, and every hit of `grep -rn "tracks.get(" src` first. A move is a move: no behaviour change.
>
> 1. `tracks.audio(id)` in `repo.js`: resolves to the stored audio `Blob` or `null`. It is the only function outside `src/storage/` that hands out a track's bytes.
> 2. Route the readers through it: `ensureBuffer()` in `src/player/buffers.js`, `healDetails()`/`healLoudness()`/`healHooks()` in `src/library/thumbs.js`, and any other `rec.blob` read on a **tracks** record. Artwork and slipmat blobs are a different store and stay as they are.
> 3. A unit test that greps `src/` (outside `src/storage/`) and fails on `tracks.get(` followed by a `.blob` read, so the door stays the only one.
> 4. Update the note in `repo.js` and CLAUDE.md's `src/storage/` entry: the native build swaps what is behind `tracks.audio()`.
>
> Lint/tests as usual; run the device checklist's playback lines. Open the PR. Do not merge.

**Removes:** direct reads of stored audio.

---

## BD19: the import cycle shrinks (no UI, refactor)

> Read CLAUDE.md (refactor rules), `scripts/cycles.mjs`, and plan 35's Later note first. One extraction per PR; this step is a short series, each its own PR, each lowering both `--check` ceilings to the new numbers.
>
> 1. Move `solarEvent`/`solarNoon`/`solarAltitudeAtNoon` into a pure `src/sundown/sun-math.js` so `day.js` stops cycling with `solar.js` (plan 35 named this as the first easy break).
> 2. Then the `src/profile/*` knot: run `node scripts/cycles.mjs`, take the smallest mutual-import pair inside `profile/`, and break it by moving the shared piece to a leaf.
> 3. Stop after five PRs or when the largest cycle is under 50 modules, whichever comes first, and write the final numbers here.
>
> Lint/tests as usual. Open each PR. Do not merge.

**Removes:** import edges.

---

## Ken's checks (no code)

- **K1: sign-up off.** In the Supabase dashboard's auth settings, turn off new sign-ups until the domain is live. Confirm the `MB_ENABLED` secret is unset. Check with a fresh email address that no account is created.
- **K2: a pause before the live site.** GitHub › repo Settings › Environments › `github-pages` › add yourself as a required reviewer. A merge then builds and waits for your approval before it deploys. (GitHub's wording may differ; the aim is that a merge alone no longer changes the live app.)
- **K3: Android pass.** Run the whole device checklist on an Android phone in Chrome. Write down what fails. Only import, playback and background audio failures become fix PRs before the domain; the rest go to Later.
- **K4: one question, five people.** Ask five people who keep music on a separate phone why it lives there, and whether they would move it to their main phone. Write the answers down. It decides how the landing page is worded.
- **K5: long tracks** (BD3's preview focus).

---

## Not in this plan

- New features of any kind (decision 1).
- Rhythm sharing and the friends layer: kept, frozen.
- Deluxe (decision 12) and the legal entity (decision 11).
- Moving `docs/design/` out of the repo. The 68 MB stays in git history either way unless history is rewritten, which is not worth the risk.
- Translation.
- Moderation tooling beyond `docs/MODERATION.md`: nothing to moderate yet.

---

## Later (after the domain)

- **The move.** Rehearse on a Netlify preview first: it is already a different address with an empty library, so sign in there and confirm stats, playlists, edits and custom covers return from account backup. Audio does not; it is added again. Then build for the new address, update the CSP and refactor rule 3, and leave a notice at the old URL.
- **Landing page and a real contact address** (`docs/PRIVACY_POLICY.md:132`, `src/profile/legal.js`); the page explains Vinyl, Pure and Sundown, worded from K4's answers.
- **Sign-up reopened, tightened:** a bot check, an age confirmation matching the policy's 16+, sign-in email sent from the domain.
- **MusicBrainz:** release matching into `releases.mbid`; the connected crate switched on. BD1's closure stays in place. Read the access terms against a paid Deluxe first.
- **Capacitor:** audio files on the phone's filesystem behind `tracks.audio()` (BD18); streaming for tracks over BD3's limit; duration and gapless data from headers so import need not decode; Deluxe by StoreKit as plan 35's checklist says. iPhone testers come through TestFlight; Android testers can install a build directly.
- **Testers.** Optional: two or three people on the web version at the new address while the native build is in progress, so the domain's problems and the native build's problems do not arrive together. Then the native build to ten people; ask them again at day 14.
- **Back covers embedded in tags** (BD10).
- **Keeping the server awake and backed up:** a paid tier or a scheduled export once testers arrive (`docs/SUPABASE_SETUP.md`'s pause note).

---

## Test-setup notes (how this was checked)

- Counts (62 token uses, 97 labels for 204 buttons, the 63-module cycle) were taken on a fresh clone at `84ff2c0` with `grep`, `wc` and `node scripts/cycles.mjs`.
- The desktop comparison for decision 8 served the repo unbuilt, seeded 36 synthetic albums into IndexedDB, and screenshotted Chromium at 1440×900 twice: as is, and with every `min-width:1024px`/`1280px` rule neutralised and `matchMedia` answering false for them. The full player and gatefold were not compared (the synthetic library has no audio).
- Not read line by line: most of `src/styles/`, the large view modules (`gatefold/view.js`, `library/view.js`, `crate/view.js`), `docs/design/`. Line numbers in this plan are from `84ff2c0`; re-find them before editing.
- BD3's two thresholds are estimates, not measurements. BD3's preview focus is what settles them.

---

## After

*(Filled in once BD0–BD19 are merged: what reached the iPhone broken, and which rule went into CLAUDE.md because of it.)*
