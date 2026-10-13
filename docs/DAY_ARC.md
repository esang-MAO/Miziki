# 10 · The day arc: Sundown gets a counterpart

Sundown stops being a one-off evening effect and becomes one point on a curve that runs through the whole day. Mornings are brighter and crisper, nights warmer and softer, the platter rises back to speed at dawn, the sky follows the real sun, and the theme can follow it too. Your profile learns when you listen, and friends see the hour a record was spun.

**Decisions (Ken, Oct 13):**
- **Six parts:** platter speed, sound character, the sky across the full day, a theme that follows the sun (**Nychthemeron**), a per-phase listening stat on the profile, and "spun at dusk" for now spinning and share cards.
- **Naming:** the tab stays **Sundown** (the signature). The morning half is **Sunrise**. The whole system is the **day arc**.
- **Character drift** defaults to **Subtle** (adjustable: Off / Subtle / Full).
- **Sundown and Character become one tab** (decided Oct 13): **Sundown**, with a **Day / Sound** switch at the top. The tab bar goes from five tabs to **four bigger ones: Library, Home, Sundown, Profile**. The theme picker (Auto / Light / Dark / Nychthemeron) moves to **Profile › Settings**; the desktop sidebar keeps its own appearance control. Built in DA3.
- **Pure stays untouched:** no speed change and no character drift in Pure (rule F1). The sky and theme are part of the app's look, not the sound, so they follow the sun in both modes.

**Designs:** put the `day-arc-design` folder in the repo at `docs/design/day-arc/` first (a small docs-only PR, no preview needed). Every prompt below can then point Claude Code at it: the artboards, the checked sky tokens and the component specs are in its README.

Six PRs, in order, with the usual routine (preview, merge, after-merge check). The **Preview the day** slider (built in DA3) is how you test without waiting for real dawn. Until then, each PR's preview focus says how to check it.

---

## The day model

Each day is anchored on real solar events at the user's location, computed **on the device**:

| Event | Sun altitude | Used for |
|---|---|---|
| **Dawn** | −6° (civil twilight begins) | start of Sunrise (platter starts rising) |
| **Sunrise** | −0.833° | platter back to full speed; theme turns light (Nychthemeron theme) |
| **Solar noon** | highest point | brightest sky; the middle of the character curve |
| **Sunset** | −0.833° | start of Sundown (as today) |
| **Dusk** | −6° (civil twilight ends) | platter settled at the night rate (as today) |

**Phases** (used for readouts, sky and character): Night (dusk → dawn) · Dawn (dawn → sunrise) · Morning (sunrise → ~3 h after) · Midday · Afternoon · Golden hour (~1 h before sunset) · Twilight (sunset → dusk).

**Gaps in today's code that this fixes:**
- **Night ends at midnight.** Sun times are only computed at launch and when location arrives, always for the current date. Reopen the app at 1 a.m. and it sees today's sunset as still ahead, so it plays at full speed in the middle of the night.
- **Stale times.** If the app stays open past midnight, it keeps yesterday's sunset.
- **No morning at all.** The fallback (no location) only knows a fixed 8:10 pm sunset.

**Rules:** the night window spans midnight (yesterday's dusk to today's dawn). Recompute events at local midnight, when the app returns to the foreground, and when location arrives. Polar day (sun never sets) means day all day; polar night (sun never rises) means night all day. Without location, use fixed fallback times: dawn 6:20, sunrise 6:50, noon 1:00 pm, sunset 8:10 pm (as today), dusk 8:36 pm.

---

## DA1: day model and Sunrise (platter speed)

> Read CLAUDE.md first. This is a feature PR: the **day arc, part 1: the day model and Sunrise**. Sundown currently slows the platter from sunset to dusk and settles at the night rate. This PR makes the night last until dawn, and brings the platter back up to full speed across Sunrise. Behavior changes on purpose; Pure stays untouched (F1).
>
> 1. **New `src/sundown/day.js` (pure functions, no DOM).**
>    - `dayEvents(date, lat, lon)` returns dawn, sunrise, solar noon, sunset and dusk for that date. Extend `solarEvent` in `solar.js` to return the rising event too: the same equation, `Jt − w/360` instead of `+`. Keep `solarEvent`'s existing behavior and tests passing.
>    - `dayPosition(now, events)` returns `{ phase, phaseProgress, nightness, rateProgress }`. `nightness` (0 = full day, 1 = full night) is continuous across the whole 24 hours **and across midnight**: it uses yesterday's and tomorrow's events where needed. `rateProgress` is what `computeRate()` eases: 0 → 1 across sunset → dusk (as today), 1 all night, then 1 → 0 across dawn → sunrise.
>    - Handle polar day and night (`solarEvent` returns null) and the no-location fallback times above (replace `fallbackSun` in `location.js` so it fills all five events).
> 2. **Wire it in.** `S.sun` gains `dawn`, `rise`, `noon` alongside `set` and `dusk`. `computeSun()` fills them for yesterday, today and tomorrow as needed. `sunProgress()`/`easedProgress()` keep their names and meaning for existing callers but read from `dayPosition`. Recompute at local midnight (a timer), on `visibilitychange` back to visible, and when location arrives.
> 3. **Pacing applies to both halves.** "Window" spreads the change across the whole twilight (dusk side) or dawn (sunrise side); "Moment" concentrates it near the end of sunset and the start of sunrise, mirroring today's `moment` curve. `computeRate()` stays the single place speed is decided, and Pure still returns 1.
> 4. **Readout:** `#rateWhy` gains the morning cases: "Dawn — rising, 40% of the way up", and "Morning — full speed". Keep the other wording.
> 5. **Tests** (`tests/unit/day.test.js`):
>    - Sunrise and sunset for Columbia, MD (39.20, −76.86) on a fixed date, each within a few minutes of a published value. Do the same for a southern-hemisphere city.
>    - **Continuity:** `rateProgress` has no jump at midnight, dawn, sunrise, sunset or dusk (sample every minute across 48 h; adjacent samples differ by less than a small epsilon).
>    - At 1 a.m. it's night (`rateProgress` = 1); at noon it's day (0).
>    - Polar day and night; the fallback times; Pure returns 1 at any time.
>
> Lint (0/0) and unit tests pass; both builds preview with no console errors. Open the PR with the preview link at the top. Do not merge.

**Preview focus (Ken, iPhone):** in Sundown, the existing preview slider still shows the evening slowdown. Check the readout says "Daylight — full speed" now. If you're up late or early, open the preview after midnight (still night, slow) or around dawn (rising).

**After-merge check:** open the real app after midnight sometime. It should still be at the night speed, not full speed.

---

## DA2: character drift

> Read CLAUDE.md and `docs/design/day-arc/README.md` first. This is a feature PR: the **day arc, part 2: the Vinyl sound drifts with the day**: brighter and more open in the morning, warmer and softer at night, centred on the user's own Character settings. **Vinyl only; Pure untouched.**
>
> 1. **New `src/sundown/drift.js` (pure):** `driftOffsets(dayPos, intensity)` returns offsets for `{ wow, sat, soft, comp }`. The user's Character sliders stay the **midday baseline**. Anchors at **Full** intensity (Subtle = half; Off = zero):
>
>    | Phase | soft (top-end softening) | sat | comp | wow |
>    |---|---|---|---|---|
>    | Morning (peak ~1–2 h after sunrise) | −0.20 (brighter) | −0.10 | −0.10 (more open) | −0.05 |
>    | Midday | 0 | 0 | 0 | 0 |
>    | Golden hour | +0.08 | +0.05 | +0.03 | 0 |
>    | Night | +0.20 (warmer) | +0.10 | +0.10 | +0.05 |
>
>    Blend smoothly between anchors (smoothstep), driven by the same `dayPosition` as DA1, so there are no steps. The **effective** value is `clamp(user + offset, 0, 1)`.
> 2. **Engine:** `applyCharacter()` uses effective values. Recompute about every 30 s (and immediately when the user moves a slider or changes intensity), ramping with a longer time constant (~2 s), so the drift is never audible as a change. `satCurve` builds a new WaveShaper curve, so only rebuild it when the effective `sat` moves by more than 0.005. Scratch audio already runs through the chain, so it drifts too. Car Mode and the sleep-timer fade are untouched.
> 3. **Setting:** `S.charDrift` = `'off' | 'subtle' | 'full'`, default **`'subtle'`**. Add it to `serializePrefs`/`parsePrefs` with a test that old saved prefs without it load as `'subtle'`, and to the backup key-inventory table in CLAUDE.md (prefs are backed up). UI: a small segmented control in the Character tab (DA3 moves it into Sundown's **Sound** view, beside the sliders it changes), "Day drift: Off / Subtle / Full", with the copy *"Your settings are midday. Mornings drift brighter, nights warmer."* (DA3 adds the live indicator.)
> 4. **Tests** (`tests/unit/drift.test.js`): offsets are zero at midday and at intensity Off; Subtle is exactly half of Full; no offset pushes an effective value outside 0–1; offsets are continuous across the 24 h (no jumps); `applyCharacter` in Pure doesn't use drift (fake nodes).
>
> Lint and unit tests pass; both builds preview with no console errors. Open the PR with the preview link at the top. Do not merge.

**Preview focus (Ken, iPhone, headphones):** set Day drift to **Full**, and use the Sundown preview slider to jump to night, then back to daylight. Night should sound warmer and softer. Then set **Subtle** and confirm it's gentler; set **Off** and confirm nothing changes. Switch to Pure: no change at any time.

**After-merge check:** listen in the evening on the real app (Subtle). It should feel natural, never like an effect switching on.

---

## DA3: the day on screen: arc, sky and full-day preview

> Read CLAUDE.md, `docs/DESKTOP_LAYOUT.md` and `docs/design/day-arc/README.md` first (artboards: `Main`, `MorningLight`, `NightPreview`, `SkyPalette`, `DesktopSidebar`). Use the sky token table there as-is: it's already contrast-checked. This is a feature PR: the **day arc, part 3: the Sundown tab shows the whole day**, and the sky follows it. Use the frontend-design guidance and the existing type and colour tokens; keep it in the vinyl aesthetic.
>
> 0. **Merge Sundown and Character into one tab** (Ken's decision; artboards `Main`, `Character`, `ProfileSettings`).
>    - The **Sundown** tab gets a **Day / Sound** switch under its header (`role="tablist"`, two tabs).
>    - **Day** is everything below in this PR.
>    - **Sound** is today's Character content: the four sliders (with DA2's "now" markers and the Day drift control), and Scratch.
>    - Remember the last view per device (`localStorage`, wrapped in try/catch, device-only, not in prefs or backup). Default: Day.
>    - **The tab bar becomes four equal tabs:** Library, Home, Sundown, Profile. Remove the Character tab and its route button. Anything that opened the Character tab (links, the saved last-tab value, desktop sidebar navigation) now opens Sundown › Sound, so old saved state can't land on a missing tab. Add a test for that.
>    - **Move the Appearance control** (Auto / Light / Dark) from the Character tab to a new **Settings** screen under Profile (a Settings button on the profile header; artboard `ProfileSettings`), next to links for Account, Privacy, Library tools and the legal pages. The desktop sidebar's appearance control stays where it is.
>    - Update `docs/DESKTOP_LAYOUT.md` and CLAUDE.md for the new tab structure.
> 1. **Sundown tab, Day view:**
>    - Replace the sunset→dusk bar with a **day arc**: a low arc (the sun's path) with markers for Dawn, Sunrise, Noon, Sunset and Dusk (their times underneath), and a sun or moon dot at the current position.
>    - Keep "Now playing at" (rate and semitones) and add a **phase line**: "Morning — bright, full speed", "Twilight — 60% of the way down", "Night — settled at 0.80×".
>    - Group the controls under two headings: **Sundown** (night rate, pacing; as today) and **Sunrise** (shares the pacing, with copy explaining that the platter rises back across dawn).
>    - Add a **Day drift** indicator: "Character now: a touch warmer (Subtle)".
> 2. **Preview the day:** the existing preview slider becomes a 24-hour scrubber starting from now. While scrubbing, everything follows the previewed time: platter speed, readouts, character drift, the sky, and (in DA4) the Nychthemeron theme. Release back to Live as today. This is also how Ken tests the whole feature.
> 3. **Sky across the full day:** generalize `skyGradientStops(p)` in `clock.js` to `skyGradientStops(dayPos, theme)`, with anchors for night, dawn, morning, noon, afternoon, golden hour, sunset and dusk.
>    - **Dark theme:** extend today's palette (the teal→dusk→near-black descent stays as the evening portion).
>    - **Light theme:** currently keeps static tokens on purpose (PR #87). Add a **gentle light-palette arc** instead (soft dawn rose, clear morning, warm golden hour, then dusky). It must stay readable.
>    - **Run a contrast check on both palettes at every anchor:** all text and background pairs ≥ 4.5:1, as the desktop work did. Keep `skyGradientStops` pure and unit-tested.
> 4. **Desktop:** the sidebar's Sundown card mirrors the new phase line and arc (same "mirror what `drawSun()` writes" pattern as D3), and the player bar is unchanged.
> 5. **Reduced motion:** the sky and arc still update, without animated transitions.
>
> Lint and unit tests pass; both builds preview with no console errors; Playwright screenshots of the Sundown tab at 5 phases × 2 themes × mobile/desktop go in the PR. Do not merge.

**Preview focus (Ken, iPhone and desktop):** check the tab bar shows four tabs, the Day / Sound switch works, and the Sound view has all the old Character settings (they still save). The theme picker is in Profile › Settings. Then drag Preview the day through a full 24 h. The sun moves along the arc, the times are right for Columbia, the sky changes smoothly with no jumps, the readouts change phase, and the platter speed follows. Do it in Light and Dark. Check that everything stays readable at golden hour and dusk.

**After-merge check:** glance at the real app at a few times of day over the next day or two.

---

## DA4: theme follows the sun ("Nychthemeron")

> Read CLAUDE.md and `docs/design/day-arc/README.md` first (artboards `Character`, `DesktopSidebar`). This is a feature PR: the **day arc, part 4: a theme called "Nychthemeron"** (the full day-and-night cycle): light from sunrise to sunset, dark from sunset to sunrise.
>
> 1. **Theme choice:** add **Nychthemeron** to the Auto / Light / Dark control (on mobile in **Profile › Settings**, where DA3 moved it; on desktop in the sidebar appearance control): `S.theme = 'nychthemeron'`. It's a long word: check that the segmented control still fits at 320 px wide, and wrap the label or tighten its letter-spacing rather than truncating it. Give the button an `aria-label` of "Nychthemeron: follows sunrise and sunset" and a one-line explanation under the control. `effectiveTheme()` resolves it from the current (or previewed) `dayPosition`: light between sunrise and sunset, dark otherwise. Switch with a ~1.5 s colour transition (none under reduced motion). Add it to `serializePrefs`/`parsePrefs` (old saved values load unchanged) with tests.
> 2. **No flash on launch, without saving location.** Location is never stored (CLAUDE.md, privacy policy), so `theme-boot.js` can't compute the sun. Instead, keep a **device-only cache of today's sunrise and sunset *times*** (`localStorage` key `miziki-sun-times`: `{ date, rise, set }`, **no coordinates**), written whenever events are computed. `theme-boot.js` reads it to choose the first-paint theme when the saved theme is Nychthemeron. With no cache, it falls back to 6:50 am / 8:10 pm, then corrects once location resolves.
>    - **The cache is device-only:** never in prefs, never in the backup, not in Download my data, never sent. Add it to the backup key-inventory table as **device-only**.
>    - Update the privacy policy's location line: location is used only on the device, and the only thing kept is today's sunrise and sunset times, to pick the theme before the page appears.
> 3. **Tests:** `effectiveTheme()` for Nychthemeron at times either side of sunrise and sunset, with previewed time, and in polar day and night; prefs round-trip; the theme-boot logic as a pure function (cache present / missing / from a previous day).
>
> Lint and unit tests pass; both builds preview with no console errors. Open the PR with the preview link at the top. Do not merge.

**Preview focus (Ken, iPhone):** choose **Nychthemeron**. Drag Preview the day past sunset: the app turns dark, smoothly. Past sunrise: it turns light. Close and reopen the preview tab; it opens in the right theme with no flash. Check Light, Dark and Auto still behave as before.

**After-merge check:** set Nychthemeron on the real app, and look at it once after sunset and once after sunrise.

---

## DA5: your listening rhythm on the profile

> Read CLAUDE.md and `docs/design/day-arc/README.md` first (artboard `Rhythm`). This is a feature PR: the **day arc, part 5: Miziki learns when you listen**, and the profile shows it ("Mostly a night listener").
>
> 1. **Record the phase of each counted play.** Where a play is counted (`checkTrackCompletion` → `incrementTrackPlay` in `src/history/played.js`, the 95% rule), also increment `phasePlayCounts[phase]` and `albumPhaseCounts[albumKey][phase]`, using DA1's `dayPosition`. **Use the real clock, never the previewed time:** Preview the day must never create or change stats. Phases: night, dawn, morning, midday, afternoon, golden, twilight.
>    - It's history, so it follows the existing rules: saved in `meta`; reset by Clear listening history; **kept** by Forget library (F3); `src/history/` is the only writer.
>    - **Backup:** add both keys to the key-inventory table as **per-device counters** (summed across devices), and extend `src/sync/merge.js` and its tests the same way as `trackPlayCounts`, including `historyClearedAt`.
>    - Plays from before this PR have no phase. Counting starts now, and the stat says "since <date>" until there's enough data.
> 2. **On your own profile (always visible to you):** a **Listening rhythm** card.
>    - A small 24-hour ring or bar showing the share of plays in each phase, coloured from DA3's sky palette, in both themes.
>    - A one-line verdict from the largest share: "Mostly a night listener", "A morning listener", "Golden-hour leaning", or "Around the clock" when no phase is above about 30%.
>    - Optionally, a **record per phase**: the most-played album in each phase ("Your dusk record: …"), using the existing album art and thumbnails.
>    - Show it only after at least 20 counted plays; before that: "Listen a little more and your rhythm will show here."
> 3. **Sharing with friends is opt-in.** Add a Privacy-screen switch, "Show my listening rhythm on my crate", **default off** (like the other sharing switches). When on, sync only the **aggregate percentages and the verdict**, never individual plays or times:
>    - migration **`007_rhythm.sql`**: `profiles.listening_rhythm jsonb` (size-checked, owner-update only via the existing column grants), readable under the same `can_view` rules as the rest of the crate;
>    - updated at most daily.
>
>    Friends' crate pages show the verdict and ring when shared. Turning it off clears the column. Add it to the Privacy Policy's list of what can be shared, and to Download my data.
> 4. **Tests:** phase counting uses real time even while a preview is active; Clear history resets it and Forget keeps it; merge sums across devices; verdict thresholds; the 20-play gate; RLS: a friend sees the rhythm only when it's shared and their visibility allows, and a stranger never does.
>
> Lint and both test suites pass; both builds preview with no console errors. Open the PR with the preview link at the top. Do not merge until I've applied 007 in Supabase.

**Preview focus (Ken, iPhone, test email):** play a few songs all the way through (20 to unlock the card, or ask Claude Code to note how to check it with fewer). The card appears with the right phase for the current time. Drag Preview the day: the counts must **not** change. Turn on sharing and look at your crate from a second test account; turn it off and it disappears.

**After-merge check:** on the real app the card shows "since today", and fills in over the next few days.

---

## DA6: "spun at dusk": the hour a record was played

> Read CLAUDE.md and `docs/design/day-arc/README.md` first (artboard `SpunAt`). This is a feature PR: the **day arc, part 6: the phase a record is played in travels with it**: in "now spinning" for friends, and on share cards.
>
> 1. **Now spinning.** Migration **`008_spin_phase.sql`**: add `now_spinning.phase text` with a check constraint listing the seven phase names (nullable for older clients), and add a `p_phase text default null` parameter to `set_now_spinning`. **Build on its latest definition** (005 re-created several functions to use `private.` helpers; check 005 first). **Drop the old signature** in the same migration, so there aren't two overloaded versions. The client (`MizikiSocial.nowSpinning`) sends the current real phase. Friends see it on the home feed's now-spinning row and on the friend's crate page, using this wording:
>
>    | Phase | Wording |
>    |---|---|
>    | night | "late at night" |
>    | dawn | "at dawn" |
>    | morning | "this morning" |
>    | midday | "at midday" |
>    | afternoon | "this afternoon" |
>    | golden | "at golden hour" |
>    | twilight | "at dusk" |
>
>    For example: "Spinning *Album* at dusk". It's only sent when "Share what you're spinning" is on, which is already opt-in. The phase is the spinner's own local phase. **No clock time and no location is ever sent.** Note in the privacy policy that now spinning includes the time of day as a phase.
> 2. **Share cards.**
>    - The **Now Playing** card gets a small line in the card's existing type style: "Spun at dusk" (the phase when the card is made; the previewed phase if Preview the day is active, since the card is a picture of what's on screen).
>    - The **My Crate** card shows the rhythm verdict ("Night listener") when the DA5 card is unlocked.
>    - Both lines can be switched off in the share sheet's Include options, on by default for Now Playing.
> 3. **Tests:** wording for every phase; `set_now_spinning` accepts and rejects phases per the check constraint and works without `p_phase` (older client); no stray overload remains; existing now-spinning tests still pass; share-card text selection, a pure function, for each phase and for the include switch.
>
> Lint and both test suites pass; both builds preview with no console errors. Open the PR with the preview link at the top. Do not merge until I've applied 008 in Supabase.

**Preview focus (Ken, two test accounts):** with sharing on, play on account A, and account B sees "Spinning *Album* at …" with the right phase. Make a Now Playing card and check the phase line; switch it off in Include. Make a My Crate card with the rhythm line.

**After-merge check:** make a Now Playing share card on the real app in the evening. It should say "Spun at dusk" or "late at night".

---

### Later ideas (not in this build)

- **Shared dusk:** friends' records slowing at their own local sunsets, from the original idea list.
