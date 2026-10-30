# 23 · Rhythm and wear

Seven changes that make Miziki quieter and more lived-in without adding noise: the platter's return starts at midnight, Home updates once a day, a record can be played on its own (automatically around sunset and midnight if you want), a finished record holds its sleeve, an idle player sheds its controls after dark, the sky shifts with the seasons, and records wear with play.

They follow CLAUDE.md's **How Miziki behaves** rules (PR #269). The thinking behind them stays underneath: every label and line of copy is plain and standard, and the app never explains itself.

**Decisions (Ken, Oct 30):**
- **Platter:** the return to full speed starts at **solar midnight** (not two hours before sunrise), inaudibly at first, clearly rising in the last two hours. The sunset descent is unchanged.
- **Home:** updates **once a day, at sunrise**; after sunset nothing new arrives. Now spinning stays live.
- **Stop between records at sunset and midnight:** built, **off by default**. The same behaviour is available any time as **This record only** on the player.
- **Seasonal sky tint:** colour only, **on by default**.
- **Wear:** sits **alongside** metals and can be switched off (**on by default**).
- **No new names** for times of day on screen, and no Chinese terms anywhere.

**Designs:** `docs/design/rhythm-wear/` (frames plus README). Every prompt below points Claude Code there.

**Order:** RW1 → RW7, one PR each, with the usual routine (preview, merge, after-merge check). The Sundown dial's preview is how to test anything time-of-day without waiting for the real hour.

**One in, one out (CLAUDE.md):** each PR's description names what it removes, absorbs or simplifies. Where a step has an obvious candidate it's listed.

---

## RW1: the platter's return starts at midnight

> Read CLAUDE.md and `docs/design/rhythm-wear/README.md` first (frames `Main`, `Stirring`). This is a feature PR: **the platter's return to full speed starts at solar midnight.** Pure stays untouched (its rate is always 1).
>
> 1. In `src/sundown/arc.js`, `rateInfoAt()`'s recovery leg currently runs over the fixed `RECOVERY_WINDOW_MS` (2 h) before sunrise. Replace it: the leg starts at **solar midnight** (`sun.noon` + 12 h; for a pre-dawn `now` use the solar midnight that precedes the coming sunrise) and ends at sunrise, eased with `p⁴` (`p` = 0 → 1 across that span). At Medium depth in Columbia that's 0.800× until ~2:30 AM, ~0.83× at 5 AM, full speed at sunrise. Keep the sunset → dusk descent and its pacing exactly as they are. If solar midnight would fall after sunrise or the span is under 2 h (far north in summer), fall back to the old 2 h window. Polar day/night and the no-location fallback keep today's behaviour.
> 2. `trendAt()` reports `'rising'` from solar midnight on. The reading card copy follows `Stirring`: "Rising slowly since midnight. Back to full speed at sunrise, 7:34." Before midnight at night: "Settled for the night. After midnight the platter starts rising, slowly enough that you won't notice until near sunrise."
> 3. Dial: while rising, draw a thin amber arc on the ring from solar midnight to the current position (frame `Stirring`). Nothing else on the dial changes: no new ticks or labels.
> 4. Remove `RECOVERY_WINDOW_MS` if nothing else reads it.
> 5. **Tests** (`tests/unit/arc.test.js`): rate is continuous every minute across 48 h (no step at midnight, solar midnight, sunrise, sunset or dusk); exactly the floor before solar midnight; full speed at sunrise; the `p⁴` value at a fixed time; the short-night fallback; Pure returns 1 at every sample.
>
> Lint and unit tests pass; both builds preview with no console errors. Open the PR with the preview link at the top. Do not merge.

**Preview focus (Ken, iPhone, Vinyl):** in Sundown, spin the dial to 11 PM (Slowest, 0.80×), then 3:30 AM (Rising, a hair above 0.80×, arc visible), 6:30 AM (clearly rising), and sunrise (full speed). Switch to Pure: 1.0× at every hour.

**After-merge check:** play something around 6–7 AM. It should sound nearly normal, and you shouldn't have noticed any change in the small hours.

---

## RW2: Home updates once a day

> Read CLAUDE.md and the README first (frames `HomeEvening`, `HomeMorning`). This is a feature PR: **Home's activity feed updates once a day, at sunrise.** One in, one out: pull-to-refresh on Home no longer fetches new activity outside the morning window. It still refreshes requests and now spinning.
>
> 1. In `src/social/screens/home.js`, `refreshHome()` fetches `homeFeed()` only when the cached feed was fetched **before today's sunrise** and **now is at or after today's sunrise** (real time, never the Sundown preview). Otherwise it paints the cached feed. The first-ever load (no cache) always fetches. Store the fetch time in the existing home-feed cache (already device-only in CLAUDE.md's table; keep it that way). Sunrise comes from `S.sun`, or the no-location fallback (6:50 AM).
> 2. Follow requests and **Now spinning** stay live at every hour, exactly as today.
> 3. Copy and layout per the frames: the section stays **Activity**, with a right-aligned "Today". Morning banner: "Updated this morning · 7:34" / "Everything your friends added since yesterday. Home updates once a day." After sunset, a closing card: "You're all caught up" / "New activity shows up tomorrow morning." Pull-to-refresh after sunset shows the same caught-up state.
> 4. **Tests** (`tests/unit/home.test.js`): fetch decision for cache-before-sunrise/now-after, cache-after-sunrise, no cache, after sunset, before sunrise, and a Sundown preview active (ignored); banner/caught-up selection by time.
>
> Lint and unit tests pass; both builds preview with no console errors. Open the PR with the preview link at the top. Do not merge.

**Preview focus (Ken, two test accounts):** after sunset, have account B add a record. Account A's Home shows the caught-up card and not B's add, even after pull-to-refresh. Now spinning from B still appears live. (To check the morning, ask Claude Code how to fake the clock in the preview, or check the next morning.)

**After-merge check:** open Home in the evening (caught up) and again the next morning (updated, with last night's adds).

---

## RW3: This record only, and stopping between records at sunset and midnight

**Superseded by docs/25_FROM_SCRATCH.md:** "This record only" becomes Focus (FS10).

> Read CLAUDE.md and the README first (frames `OneRecord`, `RestAtHinge`, `Main`). This is a feature PR. One in, one out: **reuse the sleep timer's existing "end of album" stop** in `advance()` (`src/player/queue.js`) rather than adding a second boundary check, by extracting it into one helper both use.
>
> 1. **This record only** (player): a switch card under the title, per `OneRecord`: "This record only" / "Your queue waits. When this side ends, playback stops." While on, the queue button hides and only the current side's tracks are listed. When the record ends (the next queued track is a different album, or the queue ends), playback stops as in RW4's resting state, keeping the queue intact. It's a per-session toggle that resets when the app relaunches (not saved).
> 2. **Stop between records at sunset and midnight** (Sundown › Day, a switch row under the depth control, per `Main`): `S.stopAtTurns`, **default off**, in `serializePrefs`/`parsePrefs` with a round-trip test. When on, an album boundary that falls within **60 minutes either side of sunset or solar midnight** (real time) stops exactly like This record only. It never stops mid-album, and never at a side flip.
> 3. Resting copy per `RestAtHinge`: kicker "Paused after this record" (current phase colour, never amber), "Around sunset, playback stops between records." (or "Around midnight, …"; for This record only: "Playback stops after this record."), then "Your queue is still there. Press play to continue." Play continues the queue. A borderless "FLIP TO B" appears when the record has another side.
> 4. Rule 9 (CLAUDE.md): don't add, remove or reorder any `await` on the play path; the stop is a decision inside `advance()`, made before `load()`.
> 5. **Tests:** the shared boundary helper (same album, different album, queue end, side flip); the time window at its edges (59/61 min) around sunset and solar midnight, in real time while a preview is active; prefs round-trip.
>
> Lint and unit tests pass; both builds preview with no console errors. Open the PR with the preview link at the top. Do not merge.

**Preview focus (Ken, iPhone):** queue two albums, turn on This record only, skip near the end of the first: it stops and rests, the queue is intact, Play starts album two. Turn it off: it rolls on as usual. Turn on the Sundown setting and check it does nothing at midday.

**After-merge check:** with the setting on, let a record end around sunset one evening.

---

## RW4: a finished record holds its sleeve

> Read CLAUDE.md ("Endings are part of the music") and the README (frame `RestAtHinge`). This is a behaviour change to CEREMONY §2. Today the end of the queue puts the record away and clears to the empty slipmat with "Nothing spinning" and Open Crate / Open Library buttons.
>
> 1. When the queue ends (and when RW3 stops), keep the run-out and put-away animation, but end on the **held sleeve**: the record resting half out of its sleeve in the current sky light, title and artist below, the side and the time it ended in the header, and Play to start it again. No Open Crate / Open Library suggestions on this screen.
> 2. The empty slipmat stays for the genuinely empty case (nothing has been played yet this launch, or the library is empty).
> 3. Pure, reduced motion and a closed player cut straight to the same final state, as today.
> 4. **Tests** for the final-state selection (queue end vs. RW3 stop vs. nothing played).
>
> Lint and unit tests pass; both builds preview with no console errors. Open the PR with the preview link at the top. Do not merge.

**Preview focus (Ken, iPhone):** let a short record finish with the player open: run-out, put-away, then the sleeve held, not the empty mat. Tap Play: it starts again from side A.

**After-merge check:** end a listening session normally one evening.

---

## RW5: evening glance on phones

> Read CLAUDE.md and the README (frames `GlanceFirst`, `GlanceDeep`). A reference draft exists on branch `feature/evening-glance`: unverified (lint, build and the full suite never ran on it). Use it as a starting point, then verify. One in, one out: it **reuses** the desktop glance's idle-timer approach in `src/shell/player-overlay.js` instead of adding a new system.
>
> 1. Phones only (`!isDesktopShell()`), full player open, a track **playing**, phase twilight or night (`currentDayPosition()`, so the Sundown preview can test it).
> 2. Idle 10 s → first layer: fade the dismiss button, title-row icons, spec lines, actions, times, transport, modes, sun knob and speed toggle; the progress line drops to 35%. Idle 25 s at night only → deep layer: the progress line and artist fade too, and the title drops to 70%. Fade out 1.6 s, then 2.4 s; return 0.25 s. Both layers land before a 30 s auto-lock.
> 3. Any touch or key wakes it, and the touch that wakes it must not press the control that was hidden under it (swallow that click). A drag on the disc still scrubs straight away.
> 4. Reduced motion: no transitions, same layers.
> 5. Don't touch the desktop glance.
> 6. **Tests:** the pure level function (phases, paused, both thresholds, the 30 s bound).
>
> Lint and unit tests pass; both builds preview with no console errors. Open the PR with the preview link at the top. Do not merge.

**Preview focus (Ken, iPhone):** set the Sundown preview to 11 PM, open the player with music playing and put the phone down: after ~10 s the controls drift away, after ~25 s only the record and title remain. Tap: everything returns and nothing else happened. At midday, nothing changes. Pause: nothing changes.

**After-merge check:** leave the player open one night and glance at it.

---

## RW6: the sky follows the seasons

> Read CLAUDE.md and the README (frame `Seasons`, the season anchor table). This is a feature PR: **a gentle seasonal tint on the sky**, colour only.
>
> 1. A pure `seasonTint(date, lat)` (new `src/sundown/season.js`) returns blend weights for the four seasons, peaking Apr 20 / Jul 20 / Oct 20 / Jan 20 and blending smoothly between them, with the seasons flipped for southern latitudes (no location: northern).
> 2. `skyGradientStops()` (`src/player/clock.js`) applies the tint on top of the existing day anchors: the README gives the midday and twilight values; the other anchors take their nearest drawn anchor's shift. Light theme gets an equivalent gentle shift. The dial ring and the desktop sidebar card follow the same tint.
> 3. Setting "Sky follows the seasons" in Profile › Settings › Appearance, a real switch, **on by default**: `S.seasonalSky` in `serializePrefs`/`parsePrefs` with a round-trip test (old prefs load as on). Off gives exactly today's sky.
> 4. Speed, depth and sound never read the season.
> 5. **Tests:** weights sum to 1 and are continuous across the year; hemisphere flip; off = today's stops exactly; and the existing contrast sweep run at all four season peaks, in both themes, every 10 minutes of a day (≥ 4.5:1 text, ≥ 3:1 muted-2 as today).
>
> Lint and unit tests pass; both builds preview with no console errors. Playwright screenshots of midday and twilight at the four season peaks go in the PR. Do not merge.

**Preview focus (Ken, iPhone):** compare the screenshots with the frame. Today (autumn) should look slightly greyer at midday and rust at dusk. Turn the setting off: today's sky exactly.

**After-merge check:** none needed day to day; glance at it again in January.

---

## RW7: records wear with play

> Read CLAUDE.md and the README (frames `WearStages`, `WearGatefold`, the wear table). This is a feature PR: **records and sleeves show their play history.** Wear sits alongside metals (it doesn't replace them).
>
> 1. **Data:** a pure `wearStage(albumSessions, firstPlayedAt, now)` (new `src/record-art/wear.js`) → `'new' | 'light' | 'worn' | 'loved'`, mostly from full plays (`S.sessionCounts`), with age since first play nudging it along (a record played steadily for years wears more than one played 200 times in a month). Suggested thresholds: light at ~20 plays, worn at ~100, loved at ~300, tunable constants. Add `S.albumFirstPlayed` (album key → first counted play time), written only from `src/history/`, persisted, **backed up with a min merge**, and added to CLAUDE.md's backup table. Albums played before this PR take their first-play time from `albumLastPlayed` or the earliest data available, or "now" if there is none.
> 2. **Visuals** per the README table, built as CSS layers on the existing sleeve and disc elements: crate cards, the gatefold, the player's sleeve and the pressing peek. Sleeves stay square. No circular ring wear. Label fade and vinyl hairlines on the disc. Sound is never affected. Sealed records never show wear. Metals, rare pressings and zoetropes render as today, with wear on top.
> 3. **Gatefold:** under the artist, "Worn · N plays since Month YYYY" / "Well loved · …" (nothing for new/light), and per-side mono rows "SIDE A · 260 PLAYS" with a thin bar, from `trackPlayCounts` summed per side (`splitSides`).
> 4. **Setting:** "Show wear" in Profile › Settings › Appearance, a real switch, **on by default**: `S.showWear` in prefs with a round-trip test. Off shows every record new; the data keeps counting. There is no per-record restore.
> 5. "Forget library" keeps wear (it's history); "Clear listening history" resets it.
> 6. **Tests:** stage thresholds and the age nudge; first-played migration; the min merge in `src/sync/merge.js`; Forget keeps / Clear resets; sealed shows none; per-side sums.
>
> Lint and unit tests pass; both builds preview with no console errors. Playwright screenshots of one record at each stage go in the PR. Do not merge.

**Preview focus (Ken, iPhone):** your most-played albums should already look worn in the crate and gatefold; something new should look crisp. Check the play-count line and side bars on a favourite. Turn Show wear off and on.

**After-merge check:** look through the crate after a week of normal listening.

---

### Later (not in this build)

- **A "Sitting with" shelf** at the top of a friend's crate: their pinned records with sleeve notes, ordered by how long they've been pinned. No new data sharing.
- **A Miziki audit** against the How Miziki behaves rules (metals and unlock framing, "N of 110" counts, and the rest), as its own doc.
