# 12 · Refine: fix, cut, then polish

**Goal:** make what's already in Miziki trustworthy and calm before adding anything new. First fix the things that quietly lose or leak data. Then remove the features and controls that cost more attention than they give. Then put the visual design on a real system, so every later PR has a scale to pick from instead of a guess.

## Where this came from (Oct 17)

A read of five books against the code and against 34 screenshots of the app (phone and desktop, dark and light, synthetic 240-track library, social off):

- **Kleppmann, *Designing Data-Intensive Applications*** (1st ed. complete, 2nd ed. ch. 1–3): the backup merge, the feed, migrations, clocks.
- **Seaver, *Computing Taste*** (an ethnography of the people who build music recommenders): the social layer's rules, ratings, metals in public, overload language.
- **Greher & Heines, *Computational Thinking in Sound***: a cautionary story about a class *ranking* feature, sleeve-note prompts, showing the number next to the sound.
- **Wathan & Schoger, *Refactoring UI*** and **Beaird, *The Principles of Beautiful Web Design*** (4th ed.): hierarchy, type and spacing scales, color, contrast, empty states, texture.

The two design books, read separately, reached the same three conclusions. That agreement is the strongest signal in the review, and it drives Phase C.

**Mockups and exact tokens:** `docs/design/refine/README.md` and the canvas files beside it ("Miziki Refine"). Phase B and C PRs build to those artboards; where this doc and the README disagree on a value, the README wins.

## What the audit found

**Superseded by docs/24_QUIET_COUNTS.md:** pressings and metals are shown as found, never counted (no "N of M", blanks or missing lists).

**Things that are wrong today (all confirmed in code or on screen):**

1. **A "Clear listening history" on another device undoes itself.** `applyMerged()` (`src/sync/backup.js`) handles `ownReset` by zeroing 4 counters *in memory* and persisting only `historyClearedAt`. `clearListeningHistory()` (`src/history/clear.js`) zeroes 14 fields and persists all of them. After a reload, `restoreSessions()` reads the old counts back from `meta`, and the next push uploads them under the new clear stamp, on every device.
2. **Hiding a record doesn't hide it from the feed.** When a crate item becomes private, `crate_items_emit_events` (`002_rpc.sql`) deletes only `pinned` and `review` events; `added` and `unlock` stay. `feed_select` gates on the profile (`can_view(actor_id, null)`), not the record, so friends still see "Ken added X." Friends' `miziki-home-feed-cache` keeps a copy too.
3. **A note on one device can erase a rating from another.** `restoreFromServer()` (`src/miziki-social.js`) adopts server values only when the item is missing locally, i.e. once, on a fresh device. After that, `buildItems()` sends `rating: null` from local state, and `sync_crate`'s whole-row upsert writes it over the rating set elsewhere.
4. **One number, three answers.** An album's session count is the per-device `S.sessionCounts`; the cross-device sum `fromDocs().totals` (computed on every pull, shown only in the restore summary); and `verified_stats.full_album_sessions`, merged by `greatest()` (a max). Phone 3 + desktop 2 shows friends 3, each device 3 or 2, and 5 nowhere.
5. **Amber text on the light theme is 1.65:1.** 57 rules use `color: var(--accent)` for text; `--accent-text` (#9A4700, 5.1:1 on cream) exists and is used in 5. The active tab label is the worst case.
6. **"Refresh" sits on top of "Settings ›"** on Profile, phone and desktop, both themes (NV4's keyboard refresh button, `src/shell/pull-refresh.js`).
7. **The Playlists empty state says playlists last one session.** They've persisted by track id since F3 (`src/library/view.js`).

**Things that cost more than they give:**

- **Car Mode.** Unused, needs GPS speed, adds a second reason to ask for location. Ken: remove outright.
- **Location asked at boot** (`askLocation()` in `main.js`), before anything has played. Most people deny a cold ask, and iOS won't ask twice.
- **Every album sealed on the first import.** On day one the whole library is shrink-wrapped.
- **Sundown has seven controls for one effect** (Auto/Manual, manual rate, night depth, Window/Moment pacing, rise at dawn, character link, location), plus a second preview dial on the Sound view.
- **The player has four equal outlined buttons** (Edit info, Share, Queue, Sleep timer) between the title and the scrub bar, and a three-line Vinyl explanation under the toggle on every open.
- **Duplicated controls:** Appearance in Settings and the desktop sidebar; crate order in Library tools and the tab row; transport in the desktop player bar and on the stage.
- **The share sheets** offer 3 styles × 3 formats × several Include toggles.
- **Search shows 14 syntax chips** before you type.
- **Profile is three screens at once** (the public crate, a stats board, the way into Settings), with 8 identical "Slot N of 8" tiles and several "nothing yet" boxes when new.
- **33 font sizes** (6.5 px to 46 px, including 12/12.5/13/13.5), padding at nearly every pixel value from 2 to 22, and micro-labels at 8–9.5 px on the most-tapped control (the tab bar).

## Shared rules for every PR in this doc

- Read CLAUDE.md first. One PR at a time; each waits for Ken's go-ahead.
- **iOS gesture rule (rule 9):** `bgPrime()` stays the first call in `play()`, before any `await`. Nothing in this doc adds a prompt, dialog or `await` before playback starts.
- **Pure means untouched.** No cut or design change alters what Pure does.
- **Saved data survives.** Removing a control never deletes a user's saved value without a reason written in the PR. If a removed setting has a non-default saved value, keep honoring it (or fold it into the remaining choice) and say which.
- **Every new or changed migration** is tested against `tests/supabase_stub.sql` and applied to a staging project before production (RF5 sets this up).
- Lint and tests pass; both builds preview cleanly; NV1's perf numbers show no regression. Do not merge.

## The plan: seven phases

**Phase A** fixes data and privacy bugs. **Phase B** removes and simplifies. **Phase C** puts the visual design on a system. **Phase D** makes sync trustworthy. **Phase E** reworks the social layer around people you know. **Phase F** covers privacy and deletion. **Phase G** changes structure: Sundown as a sheet from the platter (approved; built after RF9), and showing what the sound is doing.

RF12 (light-theme contrast) is small and independent. It can jump the queue at any point.

**Sundown moves onto the platter.** RF26 (Phase G, approved) replaces the Sundown tab with a sheet opened from a knob on the platter. Build it straight after RF9; the order is RF1–RF9, RF26, then the rest.

---

## Phase A · Fix

### RF1: a clear on one device stays cleared everywhere

> Read CLAUDE.md first. This PR fixes `applyMerged()`'s `ownReset` branch (`src/sync/backup.js`), which zeroes four counters in memory, persists only `historyClearedAt`, and lets the next reload bring the old counts back.
>
> 1. Factor the full-scope reset out of `clearListeningHistory()` (`src/history/clear.js`) into an exported `resetLocalHistory()` that zeroes **and persists** every history field the full clear touches, including `S.phasePlayCounts`/`S.albumPhaseCounts` (DA5), `achievements`, `collection` and `sessions`. `clearListeningHistory()`'s full branch calls it, then stamps `historyClearedAt = Date.now()` as today.
> 2. `applyMerged()`'s `ownReset` branch calls `resetLocalHistory()`, then adopts `merged.historyClearedAt`. It must not stamp a new clear time of its own.
> 3. Do not import `history/clear.js` into `backup.js` if it reaches `library/view.js`'s import web (CLAUDE.md's `backup.js` import rules). If it does, emit an event (`'reset'`) the way `'applied'` already works and let `main.js` call `resetLocalHistory()`.
> 4. **Tests** (`tests/unit/backup-sync.test.js` or a new file, against `fake-indexeddb`): a pull with a newer remote `historyClearedAt`, then a reload from storage, then a push: the uploaded doc has empty counters. A second test: a play after the reset counts from zero.
>
> Document in CLAUDE.md's backup section: plays made offline on this device after another device's clear but before this device syncs are reset with the rest. Counters carry no time, so they can't be separated.

**Preview focus:** two browsers signed in to one account. Play on both, clear history on one, reload the other: its stats stay cleared after a reload.

---

### RF2: hiding a record hides it from the feed

> Read CLAUDE.md first. Migration `009_feed_privacy.sql`.
>
> 1. In `crate_items_emit_events`, when the effective visibility is private, delete **all** of that actor's events for the release (`added`, `unlock`, `pinned`, `review`), not only `pinned`/`review`. Do the same in `crate_items_after_delete`. Re-declare the functions with `create or replace`, keeping their bodies otherwise identical to `002_rpc.sql`'s versions.
> 2. Add `public.rebuild_feed_events(p_user uuid)`: deletes the caller's own events and regenerates them from `crate_items`/`verified_stats` under the current visibility rules. Caller can only rebuild their own (`p_user = auth.uid()`). It's the repair path for any future trigger bug. Add it to `docs/MODERATION.md`.
> 3. Client: when the Home feed refreshes, drop any cached row whose event id is no longer returned (`src/social/screens/home.js`, `miziki-home-feed-cache`), so a friend's cache doesn't keep a hidden record.
> 4. **Tests** (`tests/client.test.js`): add a record, make it private, a friend's `home_feed_rich()` no longer returns its `added` event; `rebuild_feed_events` reproduces the same visible feed as the triggers.

**Preview focus:** add a record, hide it, check a friend's Home.

---

### RF3: editing a note never erases a rating from another device

> Read CLAUDE.md first. `restoreFromServer()` (`src/miziki-social.js`) adopts server crate values only for items missing locally; after that, `buildItems()` pushes local `rating: null` and `sync_crate` overwrites the server row whole.
>
> 1. On every crate pull, merge server values into `X.state.items` field by field: rating, note and visibility each take the newer of local and server. Add an `updated_at` per field, or one per row stamped by the server, whichever is smaller; explain the choice in the PR.
> 2. Change `sync_crate` (new migration) so a `null` in the payload means "no change" for rating and sleeve note, and clearing a value is an explicit sentinel (e.g. `rating: 0`, `sleeve_note: ''`). Old clients that send `null` then can't wipe anything.
> 3. **Tests:** device A rates 4; device B (which already had the album) adds a note; the server row has both.

**Preview focus:** rate on the phone, write a note on desktop, reload both.

---

### RF4: one number for sessions

> Read CLAUDE.md first. Today an album's session count has three sources that disagree (see "What the audit found," item 4). This PR picks one.
>
> 1. **System of record, signed in:** the merged cross-device totals from `fromDocs()`. After every pull, store them as `S.mergedStats` (in memory plus `meta`), **never** written back into the per-device counters (CLAUDE.md's backup section already forbids that; keep it).
> 2. `topAlbums()`/`topTracks()` (`history/achievements.js`), `albumMetalFor()`/`trackMetalFor()` (`record-art/metals.js`) and the social adapter's `sessions:` field read `S.mergedStats` when present, otherwise local counts. Signed out, nothing changes.
> 3. `sync_stats` (new migration): the client now sends an authoritative total, so `full_album_sessions` is a plain overwrite instead of `greatest()`. `unlocked_variant` stays monotonic.
> 4. Achievements and Collection stay union-merged; add a test that a metal shown on a device is always justified by the counts that device displays.
> 5. Rename what friends see from "verified" to **spins** in UI copy only (no column rename). The schema itself says these are client-attested.
> 6. Update CLAUDE.md's "Backup: what gets synced" with the decision.

**Preview focus:** play an album through on two devices; both show the same count and metal, and so does a friend's view.

---

### RF5: guardrails for a one-person team

> Read CLAUDE.md first.
>
> 1. **Migrations ledger:** `010_migrations_log.sql` creates `private.schema_migrations(version int primary key, applied_at timestamptz default now())` and backfills 1–10. Every later migration starts with an assertion that the previous version is present and ends by inserting its own.
> 2. **Staging:** a second free Supabase project. Document in `docs/SUPABASE_SETUP.md`: every migration goes to staging first, through the Supabase CLI (`supabase db push`), then production.
> 3. **`onversionchange`** (`src/storage/idb.js`): when another tab upgrades the database, close this connection and show "Miziki updated in another tab. Reload." This was planned for version 5; do it now, because the current `onblocked` path shows an empty library and a user who then adds songs forks their data. The blocked path itself should say "Miziki is open in another tab" instead of continuing session-only.
> 4. **Perf harness** (`tests/perf/nav.perf.js`): run each action 15 times and report median and p95, not one sample. Add two rows: `restoreLibrary()` time at 2,000 tracks, and the backup doc's size in bytes.

**Preview focus:** open the app in two tabs; nothing looks empty.

---

## Phase B · Remove and simplify

### RF6: remove Car Mode

> Read CLAUDE.md first. Car Mode is removed outright. Its state (`S.motion`) is session-only and never saved, so there's no data to migrate.
>
> 1. Delete `toggleMotion` and the GPS speed watch from `src/sundown/location.js`. **Keep `applyVolume()`**: the sleep-timer fade (`player/sleep-timer.js`), the audio engine (`audio/engine.js`) and `applyPrefs()` (`storage/meta.js`) call it. It becomes the master gain at 1 (or the sleep fade).
> 2. Remove `S.motion` from `src/state.js`; the `#carmode` block from `miziki.html`; its wiring in `src/wiring/character.js`; its styles in `src/styles/16-edit-sheet.css`; and the mention in `src/player/background.js`'s header comment.
> 3. Update the mocks in `tests/unit/meta.test.js` and `tests/unit/engine.test.js`.
> 4. **Privacy text, both copies together:** `docs/PRIVACY_POLICY.md` and `src/profile/legal.js` drop "Car Mode's speed reading"; location is now used only for Sundown's sun times. Update `LAST_UPDATED`.
> 5. CLAUDE.md: remove Car Mode from "How the app is put together," the device checklist, and the "never leaves the device" sentences (location remains, for Sundown). Leave `docs/CHANGELOG.md` and `docs/DAY_ARC.md` as history.
>
> `grep -rni "car ?mode\|S.motion\|toggleMotion" src miziki.html` returns nothing afterwards.

**Preview focus:** Settings › Playback has no Car Mode row; the sleep timer still fades out.

---

### RF7: first run that doesn't fight you

> Read CLAUDE.md first. Four small changes to how a new user meets the app, none of which touch playback's start path.
>
> 1. **Location only on request.** Remove the boot-time `askLocation()` call from `main.js`; boot uses `fallbackSun()`. Sundown's existing "Location is off, so tonight is a stand-in… Use my location" line (on the Day view now, in the sheet after RF26) is the only place that asks. Once granted, remember it (`localStorage`, try/catch) and call `askLocation()` silently at later boots, since the permission is already given and no prompt appears.
> 2. **Background playback, offered when it matters.** Keep the default off (it routes through the browser's media player, which may resample, and that's Pure's business). Add: if playback stops because the page was hidden while Background playback is off, then on return show a one-time card: "Music stopped when you left Miziki. Keep it playing in the background? [Turn on] [Not now]." Never shown again after either answer. This happens after the fact, so no `await` lands before `bgPrime()`.
> 3. **No seals on the first import.** In `src/library/import.js`, an album is sealed only when the library already had tracks before this batch. A first-run library opens unwrapped; later additions arrive sealed, as SEALED spec §2 intended.
> 4. **Copy:** replace the Playlists empty state ("They live for this session only…", `src/library/view.js`) with "Make your first playlist." plus the existing field and button.
> 5. **Home tab is always present.** Signed out or social off, Home shows one card (what friends' crates are, and a sign-in button) instead of the tab disappearing. The tab bar never changes shape: Library · Home · Profile once RF26 lands (four tabs, with Sundown, until then).
>
> Tests: import into an empty library seals nothing; a second import seals new albums. The background card's once-only rule.

**Preview focus:** a fresh browser profile: no location prompt at launch; first import is unsealed; lock the phone with Background off, come back, see the card once.

---

### RF8: a quieter player and library

> Read CLAUDE.md first.
>
> 1. **Player:** title, transport, scrub, mode toggle. Move Edit info, Share, Queue and Sleep timer into one overflow (`···`) beside the title; Queue keeps its mini-player shortcut. Delete the three-line Vinyl paragraph under the toggle (`#modeNote`); the Sound view explains Vinyl. The mini-player drops its favourite button (the player has it) and keeps queue and play.
> 2. **Library header:** one row. Tabs on the left (Songs, Crate, Artists, **Playlists**, full word); search, `+` and a `···` overflow on the right. **Select** moves into that overflow (with Library tools). **Sort** moves into the line under the tabs: "BY ARTIST ▾ · 240 SONGS", where the first part is the sort button. Remove the hairlines between header rows.
> 3. **Search:** hide the syntax chips (`renderSearchChips`, `src/library/search.js`) until the field has text, then show three (`artist:`, `album:`, `year:`) and a "More" that reveals the rest.
> 4. **One home per control:** remove the desktop sidebar's Appearance control (`#sidebarAppearance`; Settings has it); remove the tab-row crate order copy (`#crateGroupToggleTab`) or Library tools' copy, whichever Ken prefers (default: keep the tab row's, since that's where you are when you want it); on the player route, the desktop player bar shows only the now-playing cell, not a second transport.
>
> Keep every element id the tests and mirrors rely on, or update those tests in the same PR.

**Preview focus:** the player shows the record, not a toolbar. Songs has one header row.

---

### RF9: Sundown, set once

> Read CLAUDE.md first. Sundown's appeal is that you set it once and feel it. This PR cuts the Day view's controls to what a listener would actually choose.
>
> 1. **Day view keeps:** the dial (it *is* the preview), the phase readout, one choice **How deep the night goes** (**Off / Gentle / Medium / Deep** — Off is Auto off; Gentle = 0.85, Medium = 0.80 and the default, Deep = 0.75, today's three full-night rates; the caption names the current one in rate and semitones), and the location line.
> 2. **Removed from UI:** Auto/Manual (Off covers it), the manual-rate slider, Window/Moment pacing (pinned to today's default), the separate "Rise at dawn" readout row (the next sunrise time joins the phase readout), the duplicate "Character now" link, the three stat cards under the dial (Platter / Sound / Sky), and the separate dawn-to-dusk arc strip (the dial already shows the day). These two came from DA3; drop them only once Ken has seen the mockup without them.
> 3. **Saved values:** every saved depth maps exactly onto a choice. Saved pacing other than the default stays in effect with no visible control. No pref is deleted.
> 4. **Sound view:** Vinyl drift (Off/Subtle/Full) and the three presets are the main controls. The four sliders and per-card fine-tune move behind **Advanced**. The "Tone today" chart shows only when drift isn't Off. Remove the second preview dial from Sound; Day has the dial.
> 5. **Copy:** one line per control; the long Character paragraph becomes one sentence plus an (i).
>
> `computeRate()` (`src/sundown/solar.js`) is not touched; the cut is UI only.

**Preview focus:** Sundown fits on one phone screen without scrolling past the dial's readouts.

---

### RF10: share cards, one good default

> Read CLAUDE.md first. Each share sheet opens on its best style with one choice: **Story / Square**. The other styles and the Include toggles move behind "More options." Saved choices (`S.shareSelection`, `S.playerShareSelection`) still apply when present. The composers in `src/share/` are unchanged.

**Preview focus:** sharing a card is two taps.

---

### RF11: Profile is your crate

**Superseded by docs/24_QUIET_COUNTS.md:** pressings and metals are shown as found, never counted (no "N of M", blanks or missing lists).

> Read CLAUDE.md first.
>
> 1. **Split Profile** into what a friend sees (the awning, staff picks, all records) and a **Listening** sub-screen (top album/song, metals, collection, achievements, listening rhythm), linked from one row. The settings gear stays.
> 2. **Empty states:** staff picks shows one empty slot and "0 of 8" in its heading; more slots appear as records are pinned. A new profile with no stats shows one card ("Play an album start to finish to earn your first metal") instead of several "nothing yet" boxes.
> 3. **Header:** remove the "YOUR PROFILE" eyebrow; the username in `--paper` even as a placeholder; the awning shrinks to a 12 px trim.
> 4. **Fix the Refresh/Settings overlap** (`src/shell/pull-refresh.js`, `src/styles/25-pull-refresh.css`): the gear becomes a menu button (`aria-haspopup="menu"`) with two items, **Refresh** and **Settings**. NV4's keyboard Refresh button moves into that menu; pull-to-refresh is unchanged. On Home, which has no gear, keep NV4's button but in the header's flow.
> 5. **Settings copy:** every helper is one line of caption text; anything longer sits behind an (i). In Appearance, keep "Turns dark at 8:10 PM today."
> 6. **Metals stay on your own disc and share card.** Milestone feed events already require the Privacy screen's "Share milestones" switch (default off; `verified_stats_emit_events` via `pushStats()`). Keep it that way, and make sure nothing on the Listening screen or a friend's crate compares two people's counts.

**Preview focus:** a new profile looks new, not broken.

---

## Phase C · A design system

### RF12: light-theme contrast (can go first)

> Read CLAUDE.md first.
>
> 1. Every **text** use of `--accent`, `--amber` or `--miziki-orange` becomes `--accent-text`. Fills, rings, underlines, slider tracks and icons 24 px and up keep `--accent`. Start with `.tabbar-btn[aria-selected="true"]` (`08-shell.css`), `.player-side-tab[aria-selected]` (`23-desktop.css`), `.cta`, the now-playing chip, eyebrows, the slipmat caption.
> 2. The active tab: label `--paper` weight 500, icon `--accent`, plus a 2 px accent bar, so the state never relies on color alone.
> 3. Dial hour labels (12P/6A/6P/12A): 11 px `--paper`, placed outside the ring, so they never sit on the pink or blue segment.
> 4. **Test:** a small script computes contrast for every `color:` declaration resolved against both themes' backgrounds and fails below 4.5:1 for text under 18 px.

**Preview focus:** light theme, every screen: no orange text you have to squint at.

---

### RF13: type, spacing and buttons

> Read CLAUDE.md first. Add tokens to `:root` in `00-base.css`, then replace values mechanically. No layout changes beyond what the new values cause.
>
> **Type** (px / line-height · face · role):
>
> | Token | Size | Face | Role | Replaces |
> |---|---|---|---|---|
> | `--fs-micro` | 10 / 1.3 | Plex Mono 400, .10em caps | annotations: times, kHz, stat labels | 6.5–10.5 (annotation uses) |
> | `--fs-label` | 11 / 1.3 | Plex Mono 500, .08em caps | tabs, tab bar, segments, eyebrows | 10.5–11.5 (control uses) |
> | `--fs-caption` | 12 / 1.45 | Archivo 400 | helper text, sub-lines | 12, 12.5, 13 |
> | `--fs-body` | 14 / 1.5 | Archivo 400 | secondary lines, paragraphs | 13.5–14.5 |
> | `--fs-row` | 16 / 1.35 | Archivo 600 | list titles, setting names, inputs | 15–17 |
> | `--fs-title` | 20 / 1.2 | Antonio 700 | card values, sheet titles | 18–21 |
> | `--fs-head` | 24 / 1.15 | Antonio 400 or 700 | section heads, crate album name | 22–26 |
> | `--fs-hero` | 28 / 1.1 | Antonio 700 | player title, dial word | 28, 30 |
> | `--fs-display` | 36 / 1 | Antonio 700 | phase name, big stats | 34–40 |
> | `--fs-giant` | 44 / 1 | Antonio 700 | profile name, dial time | 44, 46 |
>
> Antonio at no more than two sizes per screen. Letter-spacing: .10em at 10 px, .08em at 11 px, .02em on Antonio 24 px and up, 0 elsewhere.
>
> **Spacing:** `--sp-1` 4 · `--sp-2` 8 · `--sp-3` 12 · `--sp-4` 16 · `--sp-5` 24 · `--sp-6` 32 · `--sp-7` 48 · `--sp-8` 64. A heading sits closer to what it heads than to what's above it (`--sp-6` above, `--sp-2` below). **Radii:** 4 px controls, 12 px cards, circles.
>
> **Elevation:** `--sh-1` (mini-player, buttons), `--sh-2` (cards, crate neighbours, dial), `--sh-3` (current crate card, platter, sheets), each a tight contact shadow plus a soft cast shadow, routed through `--shadow` so light mode is lighter. Raised cards get a 1 px lit top edge.
>
> **Buttons:** solid accent for the one primary action per screen (play, Create); accent outline only for the selected option in a segmented control; real switches (the player's Vinyl switch component) for on/off settings; borderless mono text for everything else. Slider tracks fill at 45% accent.
>
> **Borders:** remove per-row hairlines in song and artist lists and the double rule between mini-player and tab bar; keep one hairline under sticky headers.
>
> Add the scale to CLAUDE.md as the rule for future CSS: no font size or spacing value outside the tokens without a comment saying why.

**Preview focus:** nothing moves much; everything lines up.

---

### RF14: a moving palette with fixed rules

> Read CLAUDE.md first. The day arc changes the sky; this PR adds rules the moving colors must obey (`docs/design/day-arc/README.md` gains a section for them).
>
> 1. **Muted follows the sky.** `drawSun()` (`player/clock.js`) writes `--muted` and a new `--muted-2` (tertiary text) per anchor, alongside `--sky1`/`--sky2`, warm in warm phases and cool at night, each ≥4.5:1 (muted) and ≥3:1 (muted-2) at every sampled minute. Only write when changed (NV1's rule).
> 2. **Accent stays the warmest, most saturated thing on screen.** Cool the Golden and Twilight dark anchors slightly (starting points: `#352A24`, `#33232E`) so amber still separates from the sky, and verify chroma against `--accent` in the existing contrast test.
> 3. **The dial ring takes its colors from the anchor table**, about 15% less saturated, instead of a palette of its own.
> 4. **Value steps in dark:** `--raised` to `.07`, `--panel` to `.55`, so sky, panel and raised read as three levels.
> 5. Extend the existing per-minute contrast test to cover `--muted`, `--muted-2` and the dial labels.

**Preview focus:** at golden hour, the play button and active tab still pop.

---

### RF15: the record store in the surfaces

> Read CLAUDE.md first. The vinyl idea is in the objects (platter, crate, dial) but not in the surfaces. Add a little, and stop there.
>
> 1. **Platter label carries the record:** album title across the label, and a small mono arc ("33⅓ · SIDE A · STEREO", or the real format and side). In Pure, the label flattens (no highlight, hairline ring) so the object itself says "untouched."
> 2. **Grain:** one small tiling noise image at 4–6% opacity on `.sky-bg` only, never over cover art or panels. Off under reduced transparency.
> 3. **Sleeve edges:** crate cards get a 1 px lighter top edge and a slightly darker bottom band.
> 4. **Empty slots as bin dividers:** dashed boxes become cream divider tabs with a mono letter, like the existing "#" sleeve.
>
> **Out of scope, on purpose:** wood grain, a tonearm, leather, animated film grain, anything more on the dial. Both design books are clear that texture should support the content, never become it.

**Preview focus:** it feels like paper and card stock; nothing feels like a costume.

---

## Phase D · Sync you can trust

From *DDIA* ch. 4, 5, 7, 8, 11 and 12. Start after RF1 and RF4, which touch the same merge code.

### RF16: edits that know what they've seen

> Read CLAUDE.md first. Every last-write-wins stamp today is the writing device's `Date.now()`. A device with a slow clock loses edits it made *after* seeing another device's, and `lastWriteWins` (`src/sync/merge.js`) breaks ties by row order, which contradicts `mergeRows`' own "any order, same answer" comment.
>
> 1. Add one Lamport counter, `S.backupSeq`, persisted in `meta` (device-only, like `deviceId`). On every pull, set it to the max of itself and every `seq` seen. `touchBackupField()` (`src/state.js`) increments it and records `{seq, at: Date.now(), deviceId}`.
> 2. `lastWriteWins` compares `seq`, then `at`, then `deviceId`. A stamp without `seq` (v2 docs) counts as `seq: 0`, so old rows lose to any new edit.
> 3. **Tests** (`tests/unit/backup-merge.test.js`): device A with a clock an hour behind edits after pulling B's newer edit, and A wins; equal stamps give the same winner in every row order.
> 4. No version vectors: one user and a few devices don't need them.

### RF17: merge per item, not per blob

> Read CLAUDE.md first. `SCHEMA_VERSION` 3, with one upconverter.
>
> 1. **Album-keyed maps** (`albumOrder`, `albumSort`, `albumDisplay`, `trackDisplay`, `albumEdge`, `albumLookPref`): `lastWrite.<field>` becomes `{key: {stamp, value}}`, merged per key the way `mergeOverlays` already works; a removed key is a `null` tombstone.
> 2. **Playlists:** membership becomes an add-wins set with a tombstone per `(playlist, identityKey)` — `{added: stamp, removed: stamp|null}` — so hearting different tracks on two offline devices keeps both. Order stays one LWW array per playlist, filtered against the merged membership on apply.
> 3. **`prefs`:** per-key LWW, like the maps.
> 4. **Forward compatibility:** `fetchRemoteRows` reads `schema_version`. Rows newer than this build understands are skipped (not misparsed), and the Account screen says "Another device has a newer Miziki." `serializePrefs` keeps unknown keys from the last-read remote prefs, so an older installed copy can't strip a newer device's settings.
> 5. **Tests:** two offline hearts both survive; an old-version client round-trips a new pref untouched; a v2 doc upgrades cleanly.

### RF18: pushes that can't go backwards

> Read CLAUDE.md first. Migration `0NN_backup_seq.sql`.
>
> 1. `library_backup.doc_seq bigint`; the upsert goes through a small RPC, `put_library_backup(p_device, p_seq, p_doc)`, that updates only `where library_backup.doc_seq < excluded.doc_seq`. A late, stale retry is then a no-op.
> 2. `runPull` takes the same `B.syncing` gate as `runPush`, so a pull's trailing push can't interleave with a debounced one.
> 3. Pull with an `updated_at` cursor per device (kept in `meta`): unchanged rows aren't re-downloaded; the merge runs over cached docs.

### RF19: verify, and keep a way back

> Read CLAUDE.md first.
>
> 1. Each pushed row carries `checksum` (SHA-256 of the canonical doc JSON, via `images.js`'s `sha256Hex`). On pull, a row that fails is skipped and reported through `getBackupStatus().lastError`.
> 2. `validateDoc()` before `mergeRows`: counters are non-negative integers, stamps are numbers, ids are strings. A bad row is skipped, never merged.
> 3. `library_backup_history`: a `before update` trigger copies the old row; keep the last 10 per device. Nothing reads it except a restore snippet in `docs/MODERATION.md`.
> 4. **A real restore test:** a fresh `fake-indexeddb` device signs in and reconstructs the merged library and stats.

---

## Phase E · Neighbors you know

From *Computing Taste* and *Computational Thinking in Sound*. The social layer stays word of mouth, not a recommender.

### RF20: fresh from pins and notes; the rating is decoration

> Read CLAUDE.md first. Ken's decision: **drive `fresh_for_you` from pinned records and records with a sleeve note, and keep the 1–5 rating as decoration.**
>
> 1. **Migration:** `fresh_for_you(p_other …)` returns the friend's crate items that are pinned **or** have a sleeve note, that the caller doesn't own, visible under the usual rules, ordered pins first (by `pin_rank`), then newest note. `p_min_rating` is still accepted but ignored; drop it in a later migration.
> 2. **The rating never sorts, filters or ranks anything**, anywhere: feed, friend crate, Home, share cards. It shows as small marks on the record sheet and gatefold only. Grep for every `rating` read in `src/social/` and `supabase/` and list each in the PR.
> 3. **Overlap first.** A friend's crate opens on what you have in common (`records_in_common`, "You both have 7"), then Fresh, then everything.
> 4. **Say the rule.** One caption line under every rule-chosen list: "Records Ken pinned or wrote about that you don't have, newest first." Where the RPC takes a parameter, the viewer can change it (e.g. oldest first).
> 5. Tests: an unpinned, un-noted 5-star record is not fresh; a pinned 2-star one is.

### RF21: a quieter broadcast

> Read CLAUDE.md first.
>
> 1. **Private spin:** a switch in the player's `···` menu, "Don't share this session." While on, `nowSpinning()` isn't called and no feed event is written. It turns itself off when the queue ends.
> 2. **Milestones leave the feed.** `verified_stats_emit_events` stops inserting `feed_events`, whatever "Share milestones" says (that switch keeps controlling whether stats sync for friends to see on your crate). Metals stay on your own disc and share card.
> 3. **Feed events expire after 45 days:** a scheduled `delete` (pg_cron if available, otherwise on every `home_feed_rich` call for the caller's own rows). Say so in the privacy policy and `legal.js`.

### RF22: words that invite

> Read CLAUDE.md first.
>
> 1. **Sleeve-note prompts:** the empty sleeve note rotates "First heard it…", "Best side and why", "Play it when…", "The sound that hooked me". Optional; never saved into the note.
> 2. **Copy audit** across `src/social/`, `src/profile/` and the share cards: "new arrivals", "staff picks", "a friend set this aside". Never "discover", "explore" or "you haven't heard".
> 3. **Listening rhythm as a season:** computed over a rolling 90 days; the ring comes first; the verdict reads "Lately, mostly after dark" rather than "NIGHT LISTENER". The shared `{verdict, shares}` payload is unchanged in shape.

### RF23: credits across friends

> Read CLAUDE.md first. Migration: `release_credits(release_id, person_name_norm, role)`, written by `sync_crate` from the credits already parsed locally (`library/credits.js`), readable under the same `can_view` rule as the crate item that supplied it.
>
> The person view (`renderPersonView`) gains one line when signed in: "3 friends have records [person] [role]", tappable to a list grouped by friend. No similarity scoring; credits only.

### RF24: data gardening

> Read CLAUDE.md first. Prerequisite: the MetaBrainz account Ken planned.
>
> 1. `release_aliases(alias text primary key, release_id uuid)`. `sync_crate` and `set_now_spinning` resolve `release_key` through it. A MusicBrainz release-group id becomes another alias of the same release; merging two variant or squatted rows means repointing aliases and deleting the loser.
> 2. Matching is a reversible suggestion: the social graph uses the release group, while each user's own copy keeps its pressing. Every pin shows who matched it ("matched by you", "by Ken", "unmatched").
> 3. "Report bad match" goes into the existing `reports` table with a new reason. The procedure goes into `docs/MODERATION.md`.

---

## Phase F · Privacy and deletion

### RF25: say what the data implies, and how it goes away

> Read CLAUDE.md first.
>
> 1. Privacy policy and `legal.js` (together): a shared "spun at golden hour" implies an approximate time zone, and listening rhythm implies daily habits.
> 2. `docs/MODERATION.md` deletion checklist: tombstones left in other devices' backup docs, orphaned Storage files, `feed_events` about a deleted account, `release_credits` rows.
> 3. Backup rows for a device unseen for 12 months are deleted after a notice on the Account screen ("[Device] hasn't synced since [date]. Remove it?"). The user can keep it.
> 4. Download my data covers every server column added since step 08 (`listening_rhythm`, `now_spinning.phase`, `release_credits`, aliases they matched).

---

## Phase G · Structure and sound

### RF26: Sundown becomes a sheet from the platter

> Read CLAUDE.md first. Mockups: `SheetLibrary`, `SheetPlayer`, `SheetDay`, `SheetSound` in `docs/design/refine/`. **Approved by Ken (Oct 17).** Build right after RF9, ahead of Phase C: the sheet hosts RF9's Day and Sound content unchanged, and RF7, RF8 and RF13 assume the three-tab bar.
>
> 1. **Tab bar: Library · Home · Profile.** `#route-sundown` stops being a route. `showRoute('sundown')` and `showRoute('character')` open the sheet instead, so old links and saved tabs still land somewhere.
> 2. **Ways in:**
>    - the **sun knob** on the platter's lower right (64 px, ringed in the current phase colour, showing the time);
>    - a **sun button** on the mini-player (44 px, between title and queue);
>    - the desktop sidebar's Sundown summary;
>    - **Settings › Sundown**, for when nothing has played yet.
> 3. **The sheet:** opens half-height on Day, drags to full height, and remembers Day or Sound per device (as `selectSundownView()` does today). Day shows a 168 px dial beside the phase readout, the depth control and the location line. Sound is RF9's Sound view. It is registered with NV2's layer stack, so Back closes it.
> 4. **Desktop:** the sidebar summary opens the same content as a right-side panel over the player's side panel. No sheet on desktop.
> 5. **The knob never moves the platter.** Spinning the record still scratches; the dial in the sheet is the only thing that previews hours.
> 6. RF7's "Home is always present" still holds; the bar simply has three tabs.
>
> **Preview focus:** play a record at dusk, tap the knob, spin the dial to midnight and back, close with Back.

### RF27: show the number next to the sound

> Read CLAUDE.md first. Wherever the rate is shown (the sheet's Day readout, the depth caption, the player's format line when it isn't 1.0), show it as a percentage and semitones: "−2.4% ≈ −¼ semitone". One helper in `sundown/solar.js`; Pure always shows full speed.

### RF28: what am I hearing

> Read CLAUDE.md first. In Sound › Advanced, each stage (wow & flutter, saturation, top end, squeeze) gets a press-and-hold "Hear it alone" control: while held, every other stage is bypassed. A "Compare with Pure" hold does the same for the whole chain. Implemented as gain/bypass changes on the existing graph (`audio/engine.js`), with no rebuild and nothing on the play path. Released, everything returns exactly as it was.
>
> **Preview focus:** each hold makes its own sound obvious on a familiar record.

## Keep, whatever else changes

The crate as the default view; the sleeve pull, put-away, run-out and side-flip ceremonies; the platter; the 24-hour record dial; the honest "stand-in sunset" line; the friends sticker working from plain ownership; sleeve notes over ratings; nothing leaving the device but what the user chooses; Forget library keeping stats; and `sealedQuietPlay`, so a seal never stands between a tap and music.
