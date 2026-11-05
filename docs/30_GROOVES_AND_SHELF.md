# 30 · Grooves and the home shelf

The platter starts showing the record itself: each side's grooves are drawn from its real tracks, the needle is where you are, and the run-out is a place the record rests until you turn it over. The profile moves out of the shop and into your home: a hand-lettered sign, a wall, cube shelving. Listening becomes a record of seasons, kept for a year, and gains a log of what you played through.

Grounded in a reading of *In the Groove*, *Practical Musicology*, *Retromania*, *Futuromania* and Bartmanski & Woodward's *Vinyl*. The reasons stay off screen (CLAUDE.md, **How Miziki behaves**): copy is plain and standard and never explains itself.

**Decisions (Ken, Nov 4):**
- **Grooves from the audio:** track bands and gaps drawn from each side's real tracks; louder tracks pack tighter grooves. Position is the needle on the grooves. **The elapsed/remaining time readout goes.** A numberless side map plus the current track's name replaces it.
- **Rim vs grooves:** hold the rim to stop the record and slide inward to choose a groove (snaps to track gaps, hand-lettered track tag). Spinning the grooves keeps scrub/scratch exactly as today.
- **Run-out:** with auto-flip off, the record keeps turning in the run-out until "Turn to side B" or "Put away". The dead-wax etching gains one line: format, and when the pressing was found ("FLAC 24/96 · PRESSED AT DUSK · 14 NOV").
- **Night pitch:** night depth stays as is. A new choice beside it — **Slowed** (today's behavior) or **Keep pitch** (the platter slows on screen; the music plays at true speed and pitch). No time-stretching: it would blur the sound. A small "slowed" chip shows on the phase button whenever the music itself is slowed.
- **The sign:** the striped awning is replaced by a taped paper sign reading "[username]’s crate", the username in large Caveat.
- **Home, not a shop:** cube shelving, mostly spines out. **In rotation** (was Staff picks) drops from **8 pins to 5**: three framed on the wall, two face-out on the shelves. Nothing else on the shelves is face-out. No one but Ken has pins yet, so no migration of existing picks is needed.
- **Pressings and metals live on the wall:** only the last three found, each with where and when it turned up; "All found ›" opens the full Records view (quiet-counts rules unchanged).
- **Listening:** past seasons can be browsed (‹ ›). Season-scoped: the ring and its line, Most spun, Played through. Not season-scoped: a record for each part of the day, Kept for a time of day. **Out:** the Achievements grid (metals are on the wall) and the Top Album/Top Song tiles (now rows).
- **Keep a year:** daily listening tallies keep **400 days**, are **backed up** (they were device-only), and anything older is **rolled into one small summary per season** so past seasons stay browsable for good. This also feeds a possible year-end wrap.
- **Played through:** a new log, one entry per finished side.
- **Friends:** "Held for you" (a friend sets aside a small stack in your crate) and sleeve notes pinned to a place on a record ("Side B · 4").

**Designs:** `docs/design/grooves-shelf/` — canvas "Miziki Grooves & Home Shelf" (frames `Main`, `DropNeedle`, `RunOut`, `NightDepth`, `HomeShelf`, `FriendShelf`, `Listening`, plus README). Names on the frames are made up.

**Order:** GS0 → GS12, one PR each, the usual routine (preview, merge, after-merge check). **GS1 and GS2 (data) go first**; GS9 (Listening) needs both. GS3–GS6 (platter) and GS7–GS8 (profile) don't touch each other and can run alongside. GS11–GS12 need the social layer and a migration each; they can wait for Supabase without blocking anything else.

**Every new saved key** goes into `serializePrefs`/`parsePrefs` with a default in `S` and a round-trip test, and into CLAUDE.md's backup table (CLAUDE.md, Persistence).

---

## GS0: docs only

> Read CLAUDE.md first. Docs-only PR. Add this plan and the `docs/design/grooves-shelf/` folder. Mark superseded spots with a one-line note at the top of each affected section — "**Superseded by docs/30_GROOVES_AND_SHELF.md**" — where an older doc specifies: the awning/"Crate of [name]" header (docs/12_REFINE.md RF11, docs/22_TYPE.md TY4, docs/25_FROM_SCRATCH.md FS7), 8 staff picks (anything stating the limit), the profile's pressing card placement (docs/24_QUIET_COUNTS.md QC1 keeps its owned-only rules), the Listening screen's contents (RF11 point 1), and the player's elapsed/remaining readout. Don't rewrite history; just mark it.
>
> No code. Open the PR. Do not merge.

**Preview focus:** none.

---

## GS1: keep a year of listening

> Read CLAUDE.md, this plan and `src/sundown/rhythm.js` first.
>
> 1. `RHYTHM_PRUNE_KEEP_DAYS` 120 → **400**. `RHYTHM_WINDOW_DAYS` stays 90 (the current season).
> 2. **Season roll-ups:** before `pruneDayBuckets()` drops a day, fold it into a new `S.seasonSummaries` (`{ '2026-autumn': { phases: {phase: n}, albums: {albumId: n} } }`). Pure helper in `rhythm.js` (`foldIntoSeasons(byDay, now, keepDays, summaries)`), unit-tested. Seasons are the meteorological ones `seasonLabelFor()` already names (`SEASON_NAMES` in `rhythm.js`: Dec–Feb Winter, Mar–May Spring, Jun–Aug Summer, Sep–Nov Autumn); Winter is keyed by the year of its December (`2026-winter` = Dec 2026–Feb 2027).
> 3. **Backed up:** `phasePlayCountsByDay`, `albumPlayCountsByDay` and `seasonSummaries` move from device-only to **backed up**, merged by **sum per day bucket** (per season for summaries) — `src/sync/merge.js`, `backup-doc.js`. Update CLAUDE.md's table rows. A clear on one device still clears everywhere (existing `ownReset` path also zeroes `seasonSummaries`).
> 4. `clear.js`: "Clear listening history" resets `seasonSummaries` too.
> 5. **Tests:** fold-then-prune keeps totals equal; 400-day prune; season keys; merge sums; reset; prefs/backup round-trip.
>
> Note the backup-doc size change in the PR (`npm run perf --out` on a scratch path): expect well under 200 KB for a year of heavy listening.
>
> Lint and unit tests pass; both builds preview with no console errors. Open the PR with the preview link at the top. Do not merge.

**Preview focus:** none visible; Listening's ring is unchanged.

**After-merge check:** after a sync, a second device's ring matches the first.

---

## GS2: the played-through log

> Read CLAUDE.md and `src/history/sessions.js` first. `src/history/` stays the only writer.
>
> 1. When a side completes (the same point `sessionTrackComplete()` already decides a play-through for sessions/metals), append `{ id, albumId, side, whole, phase, at }` to a new `S.playedThrough` (meta key `playedThrough`). `side` is the letter (or `''` for a one-sided release); `whole` is true when this completion finishes the record; `phase` from `realDayPosition()` (never Preview the day). If a pressing was found during that session, add `found: variantId`. If the record came from a held stack (GS11), `from: handle` — leave the field unused until then.
> 2. Same 400-day prune as GS1. Backed up; merge = **union by `id`**. Clear listening history empties it.
> 3. Add a CLAUDE.md backup-table row.
> 4. **Tests:** one entry per completed side; whole-record flag; phase from the real clock; prune; union merge; clear.
>
> Lint/tests/previews as usual. Open the PR. Do not merge.

**Preview focus:** none visible yet (GS9 shows it).

---

## GS3: grooves drawn from the audio

> Read CLAUDE.md, this plan and the README (frame `Main`) first. Platter: `miziki.html` `#disc`, `src/styles/02-stage-platter.css`, `src/player/clock.js`; side split from `src/record-art/format.js`.
>
> 1. Draw each side's groove area as one band per track, width proportional to the track's duration on that side, with a smooth, slightly lighter ring between tracks. Groove pitch per band from the track's measured loudness (`t.details.loudness`): louder → tighter. Unmeasured tracks use the middle pitch. Lead-in and run-out stay as today.
> 2. A thin cream ring plus a small dot marks the needle's current radius; it moves inward with playback. Pressings, metals, zoetropes and wear draw exactly as today on top — the bands only change groove texture.
> 3. One soft band of reflected light across the grooves, tinted from the current sky (`--sky1`), static (no spin), crossfading with the sky.
> 4. **Removes:** `.times` (`#tElapsed`/`#tTotal`). In its place: a side map (one segment per track on this side, the current one filling, no numbers) and the current track as "2 · Night Ferry". The lock screen's position/scrubber (mediaSession) is unchanged.
> 5. Desktop side panel: same side map.
> 6. **Tests:** band geometry from durations (pure helper in `format.js` or a new `record-art/grooves.js`); loudness → pitch mapping; side-map segment widths.
>
> Lint/tests/previews as usual. Open the PR. Do not merge.

**Preview focus (Ken, iPhone):** a few records with very different track lengths: the gaps line up with track changes. No time numbers on the player. Lock-screen scrubber still moves.

---

## GS4: drop the needle

> Read CLAUDE.md, the README (frame `DropNeedle`) and `src/player/scrub.js` first. **Rule 9 applies** — no change to `play()`'s gesture path.
>
> 1. A touch that starts on the outer rim (outermost ~8% of the radius) **holds** the record: the platter stops, the track gaps brighten, playback pauses.
> 2. Sliding inward/outward while holding moves the needle across the grooves, snapping to the nearest track start within a small threshold; a Caveat tag ("4 · Lanterns") follows the needle. Releasing drops the needle there and plays.
> 3. A touch that starts on the grooves behaves exactly as today (scrub; scratch in Vinyl with Scratch on).
> 4. Haptic tick on each snap (`ui/haptic.js`).
> 5. **One in, one out:** nothing removed — say so in the description: this replaces the time readout GS3 removed as the way to find a place on a side.
>
> Lint/tests/previews as usual. Open the PR. Do not merge.

**Preview focus:** hold the rim, slide to track 4, let go: track 4 starts from its beginning. Spinning the grooves still scratches.

---

## GS5: the run-out and its etching

> Read CLAUDE.md, the README (frame `RunOut`), `src/shell/runout.js` and `src/record-art/etchings.js` first.
>
> 1. With auto-flip off, at the end of a side the record keeps turning in the run-out (existing run-out hiss if Surface Noise is on) and the screen offers **Turn to side B** (outlined pill) and **Put away** (text). No timeout. On the last side, only Put away.
> 2. Etching: keep the matrix line and the hand message. Add a third line in the run-out band and the long-press loupe: the album's format (`FLAC 24/96`, from the tier/spec helpers) and, once a pressing has been found, `PRESSED AT [PHASE] · [D MON]` from `S.collection[albumId].discoveredAt` plus a new `phase` field stamped at discovery (`upsertCollectionEntry()`; existing entries without `phase` show the date only).
> 3. **Tests:** etching third line with/without a found pressing; collection `phase` stamped from the real clock; old entries render.
>
> Lint/tests/previews as usual. Open the PR. Do not merge.

**Preview focus:** auto-flip off, let a side end: the record keeps turning; Turn to side B flips. Long-press the dead wax.

---

## GS6: night pitch — Slowed or Keep pitch

> Read CLAUDE.md, the README (frame `NightDepth`), `src/sundown/solar.js` and `src/wiring/sundown.js` first. **Rule 11 applies** (offline-render test).
>
> 1. New saved pref `S.nightPitch`: `'slowed'` (default, today's behavior) or `'true'`.
> 2. `'true'`: the audio rate is 1.0 at all times; the platter's on-screen rotation (and wow rate, `engine.js`'s `wowHzFor`) still follows the Sundown curve. Keep one place for the rule: split `computeRate()` into the audio rate and a `computePlatterRate()`; Pure still returns 1 for both.
> 3. Sundown › Day: under "How deep the night goes", add "At night, the music: Slowed | Keep pitch" with its one-line caption and a mono line ("0.80× by midnight · 3.9 semitones lower" / "pitch unchanged").
> 4. Phase button: a small `slowed` chip while the audio rate is below 1.
> 5. **One in, one out:** the chip absorbs the need to open the sheet to know whether the music is slowed.
> 6. **Tests:** rate split, pref round-trip; render test: `'true'` produces rate-1 audio during a night window.
>
> Lint/tests/previews as usual. Open the PR. Do not merge.

**Preview focus:** at night, flip between Slowed and Keep pitch: the platter keeps slowing either way; only Slowed changes the music.

---

## GS7: the sign

> Read CLAUDE.md and the README (frame `HomeShelf`) first. `src/profile/storefront.js`, `src/styles/18-storefront.css`.
>
> 1. Replace the awning (`.store-awning*`, `awningColorway()`) with a paper sign on `--stock-card`, two tape strips, reading `[username]` in `var(--hand)` 700 (~56px, the one hand-tuned size on this screen — comment why) and `’s crate` in `var(--hand)` 500 (~30px). Long usernames step down in size the way `--md`/`--sm` do today.
> 2. A friend's crate gets the same sign with their handle.
> 3. **Removes:** the awning, its colourway hash, and the "Crate of" kicker.
>
> Lint/tests/previews as usual. Open the PR. Do not merge.

**Preview focus:** your profile and a friend's (`?social=demo`): the sign reads naturally at the longest usernames.

---

## GS8: the wall and the shelves

> Read CLAUDE.md, the README (frames `HomeShelf`, `FriendShelf`) and `docs/24_QUIET_COUNTS.md` first.
>
> 1. **In rotation, 5 pins:** rename Staff picks → "in rotation" everywhere it's shown (sticker text "must hear" stays). New migration: `pin_rank between 1 and 5` (never edit `001_schema.sql`). Client limit 5.
> 2. **On the wall:** pins 1–3 as framed covers (black frame, paper mat), with "in rotation" hand-lettered under the heading. Below, **the last three pressings or metals found** (newest first) as small discs with name and a mono line (`DUSK · 14 NOV`, `METAL · OCT`), then "All found ›" → the existing Records screen (owned-only, no counts, per QC1).
> 3. **On the turntable:** the existing now-spinning/last-spun row, restyled as a console shelf; under it a **Listening ›** row.
> 4. **The shelves:** a cube-shelving view of your crate (2 columns), records spines-out by the crate's current order; pins 4–5 face-out. Tapping a cube opens the library crate at that spot. An unfilled last cube reads "room to grow" (hand).
> 5. A friend's crate: same layout; friend-count stickers on face-out records you don't own, as today.
> 6. **Removes:** the profile stats row (if still present), the Staff picks horizontal row, and the Recently found row.
>
> Lint/tests/previews as usual. Open the PR. Do not merge.

**Preview focus:** pin a 6th record: refused gently. The wall shows the newest three finds.

---

## GS9: Listening

> Read CLAUDE.md, the README (frame `Listening`) and `src/profile/screens.js`'s `renderListeningScreen()` first. Needs GS1 and GS2.
>
> 1. **Season header** with ‹ › (44px circle buttons): the current season stays the rolling 90-day window (as today, matching the Season card); earlier seasons are calendar seasons built from in-range day buckets plus `seasonSummaries`. The later button is disabled on the current season. Range line ("Sep – Nov · this season").
> 2. Season-scoped: the phase ring + verdict line (existing `renderRhythmCard()` primitives); **Most spun** (top 3 sleeves, same as the Season card) with **Top records ›** and **Top songs ›** rows; **Played through** (from GS2, newest first, 4 shown, "All of [season] ›" for the rest) — each row shows the record, a mono line (`WHOLE RECORD · DUSK · TUE 3 NOV` / `SIDE B · NIGHT · …` / `7″ · BOTH SIDES · …`), a "found [pressing]" paper sticker or "from [handle]" when present.
> 3. Below a divider, not season-scoped: **A record for each part of the day** (existing `bestAlbumPerPhase`, phases with plays only), **Kept for a time of day** (GS10), then Share season / Share crate.
> 4. **Removes:** the Achievements grid (metals are on the wall) and the Top Album/Top Song tiles.
> 5. The rhythm section stays hidden until it's ready (QC rule) — a season with too few plays shows its Most spun and Played through only.
>
> Lint/tests/previews as usual. Open the PR. Do not merge.

**Preview focus:** step back a season and forward again; the current season can't go further forward.

---

## GS10: kept for a time of day

> Read CLAUDE.md first. Local, no server.
>
> 1. From a record's sleeve (the gatefold's ··· menu), "Keep for…" → First light / Morning / Golden hour / Sundown / Night. Saved per album in `S.albumKeptFor` (backed up, last write wins per key).
> 2. Home's once-a-day sunrise refresh lists today's kept records with their time ("Tidewater · sundown"). **Nothing new appears after sunset** (CLAUDE.md, Less after dark) — an evening record is offered in the morning's refresh, never pushed later.
> 3. Listening shows the kept list (GS9).
>
> Lint/tests/previews as usual. Open the PR. Do not merge.

**Preview focus:** keep a record for Sundown; tomorrow's Home lists it in the morning.

---

## GS11: held for you (social)

> Read CLAUDE.md and `supabase/migrations/` first. New migration (logs itself per `012_migrations_log.sql`).
>
> 1. Table `held_records (id, from_user, to_user, release_ids text[] max 3, note text ≤ 140, created_at, handed_back text[])`. RLS: insert only by `from_user` when the two are mutual follows and not blocked; select by either party; update `handed_back` only by `to_user`. Expires 30 days after creation.
> 2. A friend's crate: "Set aside for [name]" from up to three of your records + a short note. Your crate: the **Held for you** stack (frame `FriendShelf`), "Look through" opens the three sleeves; "hand back" per record.
> 3. Feed: none (no notification, no badge — CLAUDE.md). It's found on the crate.
> 4. Update CLAUDE.md's server-side table and the privacy policy.
>
> Lint/tests/previews as usual. Open the PR. Do not merge.

---

## GS12: a note pinned to a place on the record (social)

> Read CLAUDE.md first. New migration: `crate_items.note_anchor` (`{side, track}` or null).
>
> 1. When writing a sleeve note, optionally pin it to a side and track. It shows as a small paper note on the face-out cover with a mono `SIDE B · 4` line (frame `FriendShelf`), and on the gatefold beside that track.
> 2. No anchor → today's behavior.
>
> Lint/tests/previews as usual. Open the PR. Do not merge.

---

### Later (not in this build)

- Format rules: double LP (sides C/D, gatefold) for long albums, 12″ singles at 45 for long single tracks, 10″ 78s for pre-1955 recordings.
- A spectral check that catches lossy files saved as FLAC, so pressings stay tied to real quality.
- Label and sleeve-designer credit crates.
- A friend's weekly pick from your own crate; a "dollar bin" shelf for unloved records.
- Inner-groove top-end roll-off in Vinyl mode (only if it never costs clarity).
- The year-end wrap, built on GS1/GS2.
