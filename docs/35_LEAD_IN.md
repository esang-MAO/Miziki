# 35 · Lead-in

Findings from a reading pass over seven books, checked against the repo as of `319b4c4` (Nov 8, after plan 34's CC1 merge). The title comes from the strongest listening finding: much of the pleasure of a musical high point is in the seconds leading up to it, and the crate's hook previews currently skip those seconds. Like a record's lead-in groove, this plan is mostly small preparation: a security fix, three small listening features, and groundwork that makes the next big pieces (Capacitor, the crate refactor) safer.

**Sources:**
- Hallam & Himonides, *The Power of Music* (2022): wellbeing, sleep, stress, collectors.
- Hallam, Cross & Thaut (eds.), *The Oxford Handbook of Music Psychology*, 2nd ed.: perception, emotion, everyday listening, identity, consumer behaviour.
- Dooley, *Software Development, Design and Coding*: requirements, design, debugging, testing, review.
- Kodeco Team, *Advanced Apple Debugging & Reverse Engineering*: LLDB, code signing, entitlements.
- Alvarez Perez, *Ghidra Software Reverse-Engineering*: how shipped code is inspected and patched.
- Miller, *Fashion and Music*: fan collecting, subcultural style.
- Vostokov, *Foundations of Linux Debugging, Disassembling, and Reversing*: nothing Miziki needs.

---

## What the reading confirms is already right (no work)

| Finding | Where Miziki already does it |
|---|---|
| The listener's own control is the strongest predictor of a good listening experience; own collection, chosen album by album, goes with contentment, unchosen music with lethargy (Oxford ch. 48; Power ch. 14, 17) | Owned files only, no autoplay, no "what's next" prompt; Pure/Off/format override/Focus always one gesture away |
| Tempo mainly sets energy; major/minor mode sets happy vs sad (Oxford ch. 14; Power ch. 11) | Sundown is plain varispeed: intervals and mode are kept, so a slowed record calms without turning sad. Keep it plain varispeed; never alter harmony |
| Therapists shift a listener's state gradually, starting from where they are (Oxford ch. 12) | Sundown's eased descent and recovery from solar midnight (`solar.js` `smooth()`, `arc.js`) |
| Fewer upper harmonics read as tender and low-energy (Oxford ch. 14) | The night "soft" tone drift (`DRIFT_SIZE.soft`); see listening check L1 |
| Listeners hear pitch differences of a few cents and many remember the pitch of familiar recordings (Oxford ch. 5–6) | Each night depth shows its semitone shift; that honesty is right, since even Gentle is audible |
| About 20 minutes of listening before stress drops (Power ch. 15) | Whole sides; "1–2 records a day" |
| Close, attentive listening goes with healthier coping than purely emotional immersion (Power ch. 14) | Gatefold, liner notes, credits, booklet, Focus |
| Strong experiences end with a hard return to ordinary reality (Oxford ch. 45) | "Endings are part of the music"; the screen holds the sleeve |
| Identity is fluid; genre stereotypes are widely held (Oxford ch. 46) | Five swappable "in rotation" pins; "Lately…" summaries; plan 34 bans genre/personality verdicts in the yearly book |
| Familiarity raises liking only up to a point; people pace their favourites (Oxford ch. 17) | No "play it again" or heavy-rotation shelf. Keep it that way |
| Writing down why you listen helps in itself (Oxford ch. 43) | Sleeve-note prompts (`SLEEVE_NOTE_PROMPTS`, `src/gatefold/view.js`) |
| Objects take on memory through use (Fashion & Music ch. 2) | `wearCopy()` "since Month Year · mostly spun at dusk" |
| Fans' homemade touches mean more than official merch (Fashion & Music ch. 5) | The own-image slipmat (free) |
| Whatever ships in the app is public (Ghidra ch. 5; Kodeco ch. 7, 14) | Only the publishable Supabase key ships; the service key lives in the edge function's env; no source maps; no secrets in git history (checked with `git log --all -p`) |
| "One right place" for each rule (Dooley p. 134) | `computeRate()`, `src/history/` as sole counter writer, `openCrateAlbum()` |

**Honest caveat:** the research doesn't show that listeners notice album order or a whole-side ending (Oxford ch. 14–15: scrambled sections didn't reduce enjoyment). Miziki's whole-record stance stands as a values choice, not a perceptual one.

---

## Decisions (Ken, before LI1)

These are open. Write the answers here before LI1 starts; this section must be empty of questions before any step runs.

1. **Sleep timer "End of side".** Add it (LI3). One in, one out: retire the 90-minute option? *(Recommended: yes.)*
2. **Night volume.** The two music-psychology readers disagreed. Quiet music reads as calmer (both books), but a level dip fights loudness normalization and takes volume out of the listener's hands. *(Recommended: don't build it. Revisit only if L1/L2 listening says the night still feels too present.)*
3. **"[Friend] is spinning this too"** on a gatefold when a friend's `now_spinning` matches the release. Listening "with" someone lowers stress more and moving in time together bonds people (Power ch. 15–16). It's found on the record, never pushed, but it is new content. Build it? If yes, does it hide after sunset (like Share/Pin under GF11) or stay as company? *(Recommended: build it later, after the friends sticker ships; hide after sunset.)*
4. **Gatefold memory line** (LI4): show it after sunset too, or day only? *(Recommended: day only, consistent with GF11.)*

---

## Order

LI0 → LI7, one PR each, the usual routine (preview, merge, after-merge check). LI1 first: it's a live security gap. None needs a migration.

**UI changes:**
- **LI2:** crate hook previews start a few seconds earlier.
- **LI3:** the sleep timer gains "End of side" (and loses 90 min, if decision 1 says so).
- **LI4:** one quiet line on the gatefold, and a fifth sleeve-note prompt.

LI0, LI1, LI5, LI6 and LI7 change nothing on screen.

---

## LI0: docs only (no UI)

> Read CLAUDE.md first. Docs-only PR: add this plan. Then:
>
> 1. **Add docs/31_PRESSINGS_AND_LOOKS.md.** Both of its PRs are merged (`b832c83`, `2f7f6b8`), but the plan doc itself was never committed (no commit in history touches it), and 11 files cite it (8 in `src/`, plus CLAUDE.md, docs/CHANGELOG.md, docs/PRESSINGS_110.md, docs/29_GATEFOLD.md). If Ken attaches his original copy, commit it as is. Otherwise write it back from the two CHANGELOG entries (PRESSING_DRAW PR A and PR B) and the merged code, marked "Reconstructed after the fact; both PRs done." (`docs/history/CHANGELOG-2026-H1.md` is not missing: docs/perf/BASELINE.md explains it was deliberately never created.)
> 2. **CLAUDE.md › How Miziki behaves**, add:
>    - **No mood features and no health claims.** No mood tagging, "music for when you're down", or anything that responds to a listener's mood. App, App Store and share-card text never claim relaxation, sleep or health benefits; Sundown is described as a feel, not a treatment.
>    - **Earning never needs the screen.** Metals, turntables, rare pressings and zoetropes count plays made in the background or with the screen off. No rule may require "attentive" listening.
> 3. **CLAUDE.md**, new section **Plan docs**: every plan step has *Read first / Changes / Tests (Claude runs) / Preview focus (Ken runs) / Removes (one in, one out) / Not in this step*. A plan's **Decisions** section holds no open questions before its first step runs. A plan ends with a short **After** section, filled in once it's done: what reached the iPhone broken, and which rule went into CLAUDE.md because of it.
> 4. **CLAUDE.md › Refactor rules**, add:
>    - **12.** A bug-fix PR fixes one bug and, where the code is testable, adds the failing test first.
>    - **13.** No new function over ~80 lines and no file past ~1,000 lines without a comment saying why. Extract first, then extend. (`renderCrate()` is ~1,150 lines; that's what plan 36 is for, below.)
>
> No code. Open the PR. Do not merge.

---

## LI1: the Deluxe switch stays in dev (no UI)

> Read CLAUDE.md and `src/deluxe.js` first. `applyDeluxeUrlSwitch()` is documented as dev-only, but `src/main.js` runs it on every launch with no build check, so `?deluxe=1` on the live GitHub Pages URL grants Deluxe, and because `S.deluxe` rides in `prefs` it then syncs to every device on the account.
>
> 1. In `main.js`, call `applyDeluxeUrlSwitch()` only when `import.meta.env.DEV` is true, so the production bundle drops it. (If Ken wants it on the Netlify preview, gate on a Vite mode flag set only by the preview build, not on hostname.)
> 2. Same gate for `src/social/demo.js`'s `?social=demo` entry, so the fixture chunk isn't emitted into `dist/` at all.
> 3. Leave `S.deluxe`'s sync as is for now (Ken is the only user). The StoreKit change is in **Later**.
> 4. **Tests:** a unit test that the switch is a no-op when the DEV flag is false; a build check (`npm run build` then grep `dist/` for `deluxe=` and `installSocialDemo`) that both are absent.
>
> Lint/tests as usual. Open the PR. Do not merge.

**Preview focus:** none (nothing on screen). After merge: open the live URL with `?deluxe=1` and confirm Deluxe items stay locked.

---

## LI2: hook previews start before the hook (UI: previews start earlier)

> Read CLAUDE.md (rule 11), docs/16_AUDIO.md §7, `src/audio/hook.js` and `src/audio/hook-preview.js` first.
>
> Brain-imaging work on musical peaks (Oxford Handbook ch. 18) found a reward response at the peak itself and a separate anticipation response building up to ~15 s before it. `hook.js` puts `hookStart` at the start of the most-repeated stretch, usually the chorus, and `hook-preview.js` starts exactly there, so every preview skips the build-up.
>
> 1. `hook-preview.js`: start at `max(0, hookStart − LEAD_IN_SEC)` with `LEAD_IN_SEC = 5`; keep `hookEnd`; the span grows by the lead-in. Fade-in from 0.35 s to 1.0 s; keep the fade-out.
> 2. The "FROM [TRACK] · 1:02–1:24" readout shows the real start.
> 3. Don't change stored `hookStart`/`hookEnd` or the detector; this is playback only, so no re-measure and no data migration.
> 4. **Tests:** unit test for the start/span math (hook at 2 s → starts at 0; hook near the end); an offline-render spec (Chromium + WebKit) proving the preview's first audible sample lands at `hookStart − 5 s` and the fade-in reaches −1 dB of steady level by 1.0 s.
>
> Lint/tests/previews as usual. Open the PR. Do not merge.

**Preview focus (iPhone):** hold a few crate cards across genres. Does the lead-in feel like arriving at the hook rather than starting early? Try 4 s and 8 s too and write the chosen value into this doc.

---

## LI3: sleep timer, "End of side" (UI)

> Read CLAUDE.md, `src/player/sleep-timer.js` and `src/record-art/format.js` (`sideLengthsFromDurations`, `bestSideCut`) first. Needs decision 1.
>
> Bedtime-listening studies used 25–60 minutes a night (Power ch. 15); a side runs about 18–25. The timer already has end of track and end of album.
>
> 1. New mode `'side'`: stop at the end of the current side's last track, using the same side split the gatefold shows (45s and double LPs included). A one-track single (no flip) behaves like end of track.
> 2. Stops like the other end-of modes: no fade, the run-out plays out, the screen holds the record.
> 3. Button text "End of side"; label "Sleeping at end of side A" (the actual side letter).
> 4. **Removes:** the 90-minute option, if decision 1 says so. A saved `S.sleep` of 90 min still restores and runs; it just can't be picked again.
> 5. `S.sleep.mode` is runtime-only today. Confirm it isn't persisted; if it is, add the round-trip test (`prefs.test.js`).
> 6. **Tests:** side boundary for a 33⅓ LP, a 45, a double LP (side B → stops before C) and a one-track single; mid-side start; seeking across the boundary.
>
> Lint/tests/previews as usual. Open the PR. Do not merge.

**Preview focus (iPhone):** start a side, set "End of side", let it run out with the screen locked; background playback must stop cleanly at the run-out.

---

## LI4: a record remembers (UI: one gatefold line, one prompt)

> Read CLAUDE.md, docs/29_GATEFOLD.md (GF11) and docs/30_GROOVES_AND_SHELF.md (GS1) first. Needs decision 4.
>
> Reminiscence is one of the most common reasons people choose music, and memories of specific times are a main source of feeling in everyday listening (Oxford ch. 13, 43). The data is already kept (`S.albumPlayCountsByDay`, 400 days; `S.albumPhaseCounts`) but nothing reads it back on the record itself.
>
> 1. One muted line on the gatefold, under the wear line, picked by a pure function in a new `src/history/recall.js` (read-only over stats; `src/history/` still the only writer):
>    - "Spun a lot last [season]" when one past season (not the current one) holds ≥ 40% of this album's plays in the kept window;
>    - else "Mostly at [phase]" when one phase holds ≥ 50% of `albumPhaseCounts`;
>    - else nothing.
>    Only when the album has ≥ 5 plays in the window. Season/phase words only, never a date or "this time last year" (nothing announces a time of day). Uses merged stats (`S.mergedStats`) when signed in. Never on Home, never a suggestion, never a tap target.
> 2. If the wear line already says "mostly spun at dusk", don't repeat the phase: show the season line or nothing.
> 3. Add **"Reminds me of…"** to `SLEEVE_NOTE_PROMPTS`. The hash picks among five now, so some records' prompt changes once; acceptable, since a prompt is placeholder text.
> 4. **Removes:** nothing; the line uses the gatefold space GS1 left under the wear line. Say so in the PR.
> 5. **Tests:** thresholds; season boundaries (incl. southern-hemisphere seasons if `rhythm.js` handles them); no line under 5 plays; no duplicate of the wear line; hidden after sunset per decision 4.
>
> Lint/tests/previews as usual. Open the PR. Do not merge.

**Preview focus (iPhone):** open a much-played record and a new one; the line should read like a liner-note aside, not a stat.

---

## LI5: groundwork for finding bugs (no UI)

> Read CLAUDE.md (rule 9, rule 10) first.
>
> 1. **`src/util/debug-log.js`:** an in-memory ring buffer (~200 entries) of caught errors. Printed to the console only with `?debug=1`. Never stored, synced or uploaded (keeps "no engagement numbers"). Wire it into the 83 empty `catch {}` blocks where the error is unexpected; leave the ones that are expected (feature detection) with a short comment saying so. In `transport.js` and `background.js`, the log call is synchronous and adds no `await` (rule 9).
> 2. **`assert()`**, dev-only, stripped from production via `import.meta.env.DEV`.
> 3. **`scripts/cycles.mjs`** run in `pr-checks.yml`: fails if the largest import cycle grows past 54 modules or mutual-import pairs past 38 (today's counts), so the numbers can only go down. Print the current numbers in the PR.
> 4. **`npm run test:coverage`** using Node's built-in `--experimental-test-coverage`, no new dependency. Record the baseline in `docs/perf/BASELINE.md`; reference only, not a CI gate.
> 5. **Doc-link check** in `pr-checks.yml`: every `docs/*.md` path cited in `src/` or CLAUDE.md exists.
> 6. **`.github/pull_request_template.md`** with checkboxes Claude fills in: rule 9 untouched; new saved keys in `serializePrefs`/`parsePrefs` and the sync table; no tag text into `innerHTML`; one in, one out; after-sunset behaviour checked; diff under ~400 lines excluding tests (or why not).
>
> Open the PR. Do not merge.

---

## LI6: the queue has one writer (no UI)

> Read CLAUDE.md (refactor rules, rule 9) first. No behaviour change.
>
> `S.queue`/`S.qpos` are assigned from `library/delete.js`, `library/view.js`, `shell/runout.js`, `player/scrub.js`, `player/resume.js` and `player/queue.js`.
>
> 1. Add `setQueue(list, pos)` and `setQpos(pos)` in `player/queue.js`; route every assignment through them. Synchronous, same order of effects as today.
> 2. ESLint `no-restricted-syntax`: assignments to `S.queue`/`S.qpos` outside `player/queue.js` fail lint.
> 3. **Leave `S.pos` alone** (written in `transport.js`/`clock.js`, rule 9).
> 4. **Tests:** each former call site's behaviour pinned before the move.
>
> Open the PR. Do not merge.

---

## LI7: tag parsers survive bad files (no UI)

> Read `src/library/tags/` and `tests/unit/tags.test.js` first. The parsers read untrusted bytes; there's one 8-byte garbage test today.
>
> 1. A truncation sweep: take each valid FLAC/ID3/MP4/WAV fixture, cut it at every Nth byte offset; also feed oversized declared block/atom lengths and zero-length frames.
> 2. Assert nothing throws, nothing loops (a time bound per case), and defaults come back.
> 3. Fix only what the sweep finds, one bug per commit with its failing case first (rule 12).
>
> Open the PR. Do not merge.

---

## Listening checks (Ken, no code)

- **L1: Deepest + Full drift on bright records.** Slowing the platter already darkens the top end; the night drift adds up to +0.27 "soft" on top. Play two or three bright recordings at Deepest with drift on Full. If the top end goes dull, a follow-up scales `DRIFT_SIZE.soft` by the rate's distance from 1.0. Don't change anything until it's been heard.
- **L2: an already-slow record at Deepest.** A 60 bpm ballad at 0.70 plays at 42 bpm, the bottom of the tempos the Oxford studies used, and slow + low can tip from calm into boring. Keep Medium the default and Deepest opt-in (as plan 27 does); just listen.
- **L3: LI2's lead-in length** (above).

---

## Later (not in this plan)

- **Plan 36: split `renderCrate()`** (`src/crate/view.js`, ~1,150 lines, 49 nested functions, no unit test imports the file). One extraction per PR under the refactor rules, tests pinning behaviour first: `crate/physics.js` (`snapTo`, `momentumThenSnap`, `rubberBandX`, pure, testable), `crate/cards.js`, `crate/pull.js`, `crate/hold-card.js` (~155 lines), `crate/rail.js`. Then the next tier: `renderTracksBody` (342), `wireCharacter` (213), `wireTransport` (211), `buildGraph` (201). First easy cycle break: move `solarEvent`/`solarNoon`/`solarAltitudeAtNoon` into a pure `sundown/sun-math.js` so `day.js` stops cycling with `solar.js`; then the `profile/*` knot.
- **Capacitor checklist** (goes in the Capacitor plan when it's written):
  - Deluxe comes only from a verified StoreKit 2 `Transaction.currentEntitlements` for the Deluxe product. `S.deluxe` becomes a device-only cache (moved to the sync table's device-only row); Restore Purchases carries it to a new device. No server-side receipt check, no debugger blocking or obfuscation: both cost more than a cosmetic unlock is worth.
  - Before submitting: `codesign -d --entitlements :-` on the archived `.app` must show `get-task-allow` false, **no `aps-environment`** (Miziki never pushes; some plugins quietly add it), only In-App Purchase (+ Associated Domains if sign-in needs it). Info.plist: `UIBackgroundModes: audio`; a location usage string that says it's only for sun times.
  - `.gitignore` in advance: `*.p8`, `*.mobileprovision`, signing certificates; App Store Connect keys live only in CI secrets or the Mac's keychain.
  - Debugging the wrapped app: Safari Web Inspector attached to the WKWebView for the JS side (off in release builds). For native audio-session issues, a saved LLDB breakpoint set on `AVAudioSession` `setCategory`/`setActive` and the interruption/route-change notifications. Note that WebKit plays audio in its own process, so these catch only what the app or a plugin calls.
  - DTrace: not useful (Simulator only, needs SIP off; doesn't reproduce real audio routing).
- **Deluxe player customization as a kit of parts** (Fashion & Music ch. 5: fans' own combinations mean more than finished merch): platter mat material, tonearm/headshell finish, dust-cover tint, spindle/45-adapter colour, combined freely, generic names, no brand look-alikes. Any era set is named by material and period ("1960s teak", "1980s black ash"). Under the fair-trade rules.
- **Yearly pressing book layout:** mostly sleeves, discs and shelf shots; the only text is the listener's own sleeve notes (Fashion & Music ch. 1). Adds to plan 34's CC0 note.
- **Hook detection hypothesis:** chills tend to come at moments that break expectation (a sudden harmonic or rhythmic turn), not only at the loudest repeated stretch (Oxford ch. 45). Worth an experiment with the hook detector someday; the book gives no algorithm.
- **"[Friend] is spinning this too"**, per decision 3.

---

## After

*(Fill in when LI7 is merged: what reached the iPhone broken, and which rule went into CLAUDE.md because of it.)*
