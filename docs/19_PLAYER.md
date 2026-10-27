# 19 · Player: one clock, clean sound, no surprises, and a lighter repo

> **Status:** Ready to build · **Area:** Player / Audio engine / Lifecycle / Repo hygiene · **Written:** Oct 27, 2026 · **Follows:** `16_AUDIO.md` (AU1–AU12)

**Goal:** the player is the main draw, so it has to be boringly reliable in the app *and* with the screen locked. 16_AUDIO built the features (resume, clean edges, gapless, EQ, loudness, queue tools). This doc fixes what sits underneath them: one root timing bug that causes several symptoms, a silent-album bug Ken has hit on device, missing interruption handling, and an output stage that isn't quite transparent. Part B trims the repo and the startup bundle so every later session, and every launch, is lighter.

## Where this came from (Oct 27)

A read-only review of `src/audio/*`, `src/player/*`, `src/shell/*`, `src/wiring/transport.js` and `lifecycle.js` against the 16_AUDIO plan, plus a bloat sweep of the whole repo (import graph from `src/main.js`, comment ratios, dead exports, CSS selectors, asset sizes). `npm run build` was not run during the review, so bundle numbers in Part B are estimates from source; TR2 measures them for real.

## What the review found

### Player

1. **Position is counted from animation frames, not the audio clock.** `player/clock.js` advances `S.pos += dt * S.rate` each tick (capped `dt`), and the hidden-page `setInterval` (1 s) does the same. Everything downstream trusts `S.pos`:
   - **Gapless is approximate.** `maybeScheduleGaplessNext()` (`transport.js`) computes `remainingRealSec = (t.duration - S.pos) / S.rate`, so any drift becomes a tiny gap or overlap at the boundary.
   - **Lock-screen scrubber drifts** (`setPositionState` reads `S.pos`).
   - **Double playback after an interruption.** When iOS suspends the context (call, Siri), `S.playing` stays true and `S.pos` keeps counting. The app then believes the track is ending, arms the next source, and when audio resumes two tracks can play over each other.
2. **Gapless mostly misses when hidden.** `GAPLESS_ARM_LEAD_SEC = 0.25`, but hidden pages only tick once a second, so the arm window is usually skipped and playback falls back to `onended` → `advance()` (a small gap).
3. **Silent new album (confirmed on device by Ken).** `stopSourceCleanly()` (`transport.js:237`) fades `trackGain` to 0. `startSource()` skips its fade-in when there's a lead-in (`transport.js:421`: `if(leadInSec <= 0 && !opts.skipFadeIn) fadeMusicTo(1, …)`), on the assumption the needle-drop envelope covers it — but that envelope lives on the surface-noise path, not `trackGain`. Nothing ever brings `trackGain` back to 1, so picking a new album while one is playing or paused, with surface noise on, plays silence.
4. **No interruption handling.** No `ctx.onstatechange`, no handling of iOS's `'interrupted'` state, no `ctx.resume()` on return to foreground or next gesture, no headphone-unplug handling when the background toggle is off. `navigator.mediaSession.playbackState` is only set to `'paused'` on the background route.
5. **The output stage isn't transparent when idle.** Per 16_AUDIO, Pure means *untouched by Vinyl*; normalization, EQ and the safety limiter apply in both modes by design. But when they have nothing to do they should be invisible, and today they aren't:
   - Unused parametric slots are set to `'allpass'` (`engine.js`, `applyEQ`). Allpass is flat in level but shifts phase.
   - Turning the EQ **off** keeps the auto-preamp cut (`applyEQ` comment: preamp "always reflects the configured curve"). That's right for the audition hold (A/B on tone, not volume) but wrong when the EQ is switched off: the music stays quieter by the preamp amount.
   - The limiter worklet allocates a new array for every sample (`limiter-processor.js:72`, `const delayedSamples = []`) and rescans the whole lookahead ring per sample. Garbage collection on the audio thread is a dropout risk on iPhone. Its 1 ms attack also can't fully settle inside the 1.5 ms lookahead, so peaks can slip slightly past the ceiling.
   - The "4× true peak" estimate (`loudness.js`) interpolates linearly, which can never exceed the sample peak. It's a sample-peak scan, so normalization boosts can push inter-sample peaks into the limiter.
   - Mono files go through `createStereoPanner()` (`engine.js:189`), which pans mono input with equal-power law: about −3 dB at centre versus stereo. Needs a device check.
   - The Vinyl chain stays connected in Pure; its oscillators run and the 4× oversampled saturation stage processes silence. Wasted CPU.
6. **Main-thread work during playback.** Loudness measurement and hook detection run in plain JS on the main thread at import and in the boot repair passes (`main.js`), causing long tasks and platter stutter. The scratch gesture copies ±10 s of audio on the main thread (`scrub.js`).
7. **Album change in the background can stall.** The sleeve ceremony between albums waits on `sleep()` timers (`shell/start-sequence.js:208–323`) with no hidden-page check. Side flips and skips already check `document.hidden`; album changes don't.
8. **Media Session details.** Artwork is one entry, hardcoded `sizes:'512x512'`, no `type` (`background.js:198`). Position comes from the drifting `S.pos`.

Already in good shape, leave alone: encoder delay/padding trimming (LAME, iTunSMPB), 10–15 ms edge fades, the 80 ms skip fade, ReplayGain → BS.1770 fallback at −14 LUFS, queue tools, resume, sleep timer, the Media Session handler re-assert.

### Repo and bundle

9. **`CLAUDE.md` is 545 KB (~135k tokens).** Its "Repo layout" section alone is ~470 KB of per-file history ("Since step D2…", 808 step-ID references). It's loaded in full every Claude Code session. Its own Changelog section says history moved out "so it stays small enough to load in full" — it no longer is.
10. **Almost nothing is lazy.** 140 of 146 modules are static imports from `main.js`. supabase-js is awaited during startup on every launch: the comment at `main.js:213` says the keys are empty "for every real user today", but `state.js:12–13` now sets both.
11. **`src/miziki-social.js` (62 KB) ships unminified** as a classic script copied by `copySocialClient()` in `vite.config.js`, including a hand-rolled SHA-256.
12. **`miziki.html` is ~40% comments (38 KB)**, and Vite doesn't minify HTML, so they reach the phone. The hidden `.sdv1` block exists only so `drawSun()` has something to write into.
13. **Dead and duplicated code.** `sundown/drift.js` (replaced by `arc.js`, imported only by its test); unused exports `isHookPreviewActive`, `THIRD_OCTAVE_HZ`, `hasSavedSlipmat`, `isSundownSheetOpen`; ~9 unused CSS selectors; `data/pressings.json` duplicated verbatim as `VARIANT_DEFS` in `record-art/tiers.js`; `wordmarkWidth()` copied into three share cards; `eq.js` re-exports its own `clamp`.
14. **Comments are 41% of the JS** (state.js 82%, clock.js 57%, transport.js 55%). Minification strips them, so users don't pay; Claude does, every time it opens a file.
15. **Repo weight:** 3.5 MB of design PNGs, a 537 KB changelog.

Not bloat (checked): the `shell/` vs `wiring/` pairs are deliberate layering; `audio/runout.js` vs `shell/runout.js` are sound vs visuals; Car Mode is gone (3 stray comments); `social/demo.js` and the zoetrope SVGs are already split out; tests at ~0.6× source is healthy.

## Shared rules for every PR in this doc

- Read CLAUDE.md first. One PR at a time; each waits for Ken's go-ahead. Do not merge.
- **iOS gesture rule (rule 9) holds.** `bgPrime()` stays the first call in `play()`, before any `await`. PL2 and PL4 touch the `onended`/`S.gen` path; each does so alone, with tests and the device checklist.
- **Pure means untouched by Vinyl** (16_AUDIO wording). The output stage stays in both modes; PL5 makes it transparent when idle, it does not remove it.
- **Audio PRs prove themselves with numbers**, as in 16_AUDIO: each adds an offline render test (`OfflineAudioContext`) for the property it claims, run in Playwright **WebKit** as well as Chromium from this doc on, since iOS runs WebKit.
- **Part B PRs change no behaviour.** TR5 and TR6 must leave `npm run build` output functionally identical; TR6 (comments only) should leave the minified JS byte-identical — check with a hash of `dist/assets/*.js` before and after.
- Lint and tests pass; both builds preview cleanly; NV1's perf numbers show no regression.

### Device checklist additions (iPhone, home-screen app)

Add these to CLAUDE.md's device checklist in PL1/PL4:

1. Album A playing, surface noise on → pick album B from the crate. Music audible after the lead-in. Repeat with A paused.
2. Receive a phone call mid-track (or trigger Siri). After hanging up: one track playing, position correct, no overlap. Play resumes from the lock screen.
3. Lock the screen with the background toggle on, across a track boundary inside an album: no gap. Across an album boundary: next album starts within a second or two.
4. AirPods out mid-track: playback pauses.
5. Leave the app for 10 minutes while playing, come back: scrubber, platter and lock screen all agree.

---

# Part A · Player

## PL1: the silent new album (small, first)

> Read CLAUDE.md and §"What the review found" item 3.
>
> 1. **Fix.** In `startSource()` (`player/transport.js`), when `leadInSec > 0` (or `opts.startAt` is in the future), schedule `trackGain` back to full at the moment the music starts: `cancelScheduledValues(when)` (not `now`, so a fade-out already ramping stays intact), `setValueAtTime(0, when)`, `linearRampToValueAtTime(1, when + START_FADE_MS/1000)`. Put this in a small helper beside `fadeMusicTo()` — `fadeMusicInAt(when, ms)` — and use it for every start that skips the immediate fade-in.
> 2. **Invariant.** Every path that starts a source must leave `trackGain` reaching 1 by `start + START_FADE_MS`. Audit the other callers that touch `trackGain`: `seek()` (already correct), `mode.js` dip, `queue.js` skip fade, side flip / `performPendingFlip()`, run-out, sleep-timer fade-out followed by a later Play. Fix any that can leave it at 0.
> 3. **Tests.** Offline render: play album A with surface noise on, call the album-change path for B mid-track and while paused; assert the music RMS 0.5 s after the lead-in ends is above −40 dBFS. Same for sleep timer → Play.
> 4. Add checklist item 1.

## PL2: one clock (the root fix)

> Read CLAUDE.md, §"What the review found" items 1–2, and 16_AUDIO §2.4. This PR changes the position model; keep it to that.
>
> 1. **Anchor.** When a source starts, record `S.anchor = { ctxTime: when, offset: playOffset, rate: S.rate }` (in `startSource()`, the gapless adoption branch in `play()`, and `seek()`'s replacement path). Position is derived, never accumulated: `pos = anchor.offset + max(0, ctx.currentTime - anchor.ctxTime) * anchor.rate`, clamped to `[0, duration]`.
> 2. **Rate changes re-anchor.** Wherever `S.rate` changes (`clock.js` is "the one place it ever is", per AU3), set the new anchor to `{ ctxTime: ctx.currentTime, offset: currentPos(), rate: newRate }` and set the source's `playbackRate` at the same time. Sundown changes are gradual; re-anchoring on each change is cheap and exact.
> 3. **Lead-in** uses the anchor too: before `anchor.ctxTime`, position reads 0. This replaces `S.openUntil`'s wall-clock deadline.
> 4. **Context not running = frozen.** If `ctx.state !== 'running'`, position doesn't move.
> 5. `tick()` reads `currentPos()` into `S.pos` (keep the field so the rest of the app is untouched) and credits played ranges from the previous value. The hidden `setInterval` keeps calling `tick()`; it no longer has to guess elapsed time.
> 6. `setPositionState` uses `currentPos()`.
> 7. **Tests.** Unit: anchor maths through a rate change, a lead-in, a seek. Render: 3-minute track with Sundown rate ramping 1.0 → 0.8; reported position at the end within 5 ms of the true sample position.

## PL3: gapless that always lands

> Read PL2 first; this depends on its anchor.
>
> 1. **Exact boundary.** The current source ends at `anchor.ctxTime + (duration - anchor.offset) / anchor.rate`. Arm the next source at that exact context time.
> 2. **Arm early.** Arm as soon as the next buffer is decoded and remaining time is under 8 s (comfortably more than the 1 s hidden tick). Raise `GAPLESS_ARM_LEAD_SEC` accordingly.
> 3. **Re-arm on change.** A rate change (re-anchor), seek, queue edit, mode switch or pause cancels and re-arms. `cancelPendingGapless()` already exists; call it from the re-anchor path.
> 4. **Decode away from the boundary.** Start decoding the next track ~2 s after the current one starts rather than in the same tick as the track change, so the change itself does no decode work.
> 5. **Album change while hidden.** In `shell/start-sequence.js`, when `document.hidden`, skip the sleeve ceremony's `sleep()` waits and start the next album directly (side flips and skips already do this).
> 6. **Tests.** Render: two tracks of one continuous sine across the boundary, at rate 1.0 and 0.85 — no sample-to-sample jump above −60 dBFS. Unit: arm/re-arm on rate change and queue edit.
> 7. Add checklist item 3.

## PL4: interruptions and coming back

> Read PL2 first. Touches `onended`/`S.gen`; run the full device checklist.
>
> 1. **Watch the context.** `S.ctx.onstatechange`: when it leaves `'running'` while `S.playing` (iOS reports `'interrupted'` or `'suspended'`), treat it as a system pause — `S.playing = false`, `S.pausedBySystem = true`, cancel any armed gapless source, stop the current source cleanly at the frozen position, set `mediaSession.playbackState = 'paused'`, re-render.
> 2. **Resume paths.** Lock-screen Play, in-app Play, and returning to the foreground with `S.pausedBySystem` → `await ctx.resume()` *after* `bgPrime()` (rule 9 order unchanged), then `startSource(S.pos)`. Don't auto-resume on foreground return; restore the paused state honestly and let the user tap.
> 3. **Unplug.** With the background toggle off, listen for `navigator.mediaDevices` `devicechange` and pause if playing (iOS fires it when AirPods disconnect). With the toggle on, the hidden element's `pause` event already handles it — keep that.
> 4. **Playback state everywhere.** Set `mediaSession.playbackState` to `'playing'`/`'paused'` on both routes, not only the background one.
> 5. **Foreground re-sync.** On `visibilitychange` → visible: check `ctx.state`, update `S.pos` from the anchor, re-render the scrubber and platter.
> 6. **Tests.** Unit with a fake context: state change to `'interrupted'` mid-track → no second source started, position frozen, resume restarts from it.
> 7. Add checklist items 2, 4 and 5.

## PL5: a transparent output stage

> Read §"What the review found" item 5 and 16_AUDIO §1. Goal: with EQ off and normalization set to Off, Pure output equals the decoded file.
>
> 1. **Neutral EQ slots.** Unused parametric slots become `'peaking'` at 0 dB gain (exact identity), not `'allpass'`.
> 2. **EQ off means off.** Keep the preamp during the audition hold (A/B stays about tone), but when `eq.enabled` is false the preamp goes to 0 dB. *Ken, Oct 27: confirmed.* Update the `applyEQ()` comment and CLAUDE.md's EQ wording to match.
> 3. **Limiter rewrite** (`limiter-processor.js`): no allocation inside `process()` (preallocate per-channel scratch in the constructor); track the lookahead window max with a monotonic deque or per-block max instead of rescanning the ring every sample; make attack fit inside the lookahead (attack ≤ lookahead, or lookahead ≈ 2× attack) so the ceiling actually holds.
> 4. **Real true-peak.** Replace the linear-interpolation estimate in `loudness.js` with 4× oversampling through a short polyphase FIR (BS.1770 Annex 2 style). Re-measure on the next boot repair pass (use the existing repair mechanism; no migration of saved values beyond recomputing the peak).
> 5. **Mono files.** Upmix to stereo before the balance stage (set the node before it to `channelCount = 2`, `channelCountMode = 'explicit'`, `channelInterpretation = 'speakers'`), or replace the panner with two gains for balance. Verify a mono file at centre plays at the same level as the same audio duplicated to stereo.
> 6. **Vinyl chain idle in Pure.** On switch to Pure, disconnect the Vinyl chain and stop its oscillators after the existing mode dip; rebuild them on switch to Vinyl inside the same dip.
> 7. **Remove headphone correction.** *Ken, Oct 27.* Delete `HEADPHONE_PRESETS`, `HEADPHONE_PRESET_KEYS` and `matchHeadphonePreset()` from `audio/eq.js`; delete `renderHeadphoneCorrection()` and its call from `player/eq-sheet.js`; `eqStateLabel()` reads `CUSTOM · ON` for any non-preset parametric curve. Remove the matching cases in `tests/unit/eq.test.js` and any now-unused CSS. **Saved data survives:** a user whose parametric bands came from a headphone preset keeps those bands exactly; they just show as Custom. No migration, no reset.
> 8. **Verify (null test).** Render a 30 s stereo test file through Pure with EQ off and normalization Off; subtract the decoded source; residual below −100 dBFS. Repeat with the EQ on but every band at 0 (graphic and parametric). A +6 dB-hot file with normalization on: output never above −1 dBTP.

## PL6: keep the main thread free while music plays

> 1. Move loudness measurement and hook detection into a Web Worker (transfer the channel `Float32Array`s; return numbers only). Import and the boot repair passes post work to it.
> 2. Run boot repair passes from `requestIdleCallback` (with a `setTimeout` fallback), one track per idle slot, never during a gesture.
> 3. `scrub.js`: preallocate the scratch window once per track instead of copying ±10 s on each gesture start.
> 4. **Verify.** NV1 perf script: no long task over 50 ms during playback while a 10-album import runs.

## PL7: lock screen polish

> Small, after PL2.
>
> 1. Artwork: provide 256, 512 and 1024 entries generated from the cover (reuse `library/thumbs.js`), with `type`. Prefer data/blob URLs that survive backgrounding.
> 2. Position comes from `currentPos()`; call `setPositionState` on play, pause, seek, rate re-anchor and track change only (not every tick).
> 3. Device check: scrubber stays in step with the music through a Sundown slowdown.

## PL8: clean at every tier (no harshness, every file at its best)

> *Ken, Oct 27:* EQ changes must never make the sound harsher, and each file type (MP3 / AAC 320 / 16-bit 44.1 FLAC / 24-bit 44.1–96 FLAC / 24-bit 176.4–192 FLAC) should play at its full quality. After PL5. Measure first, change only what the measurements fail.
>
> **Where harshness comes from in this engine, and the guardrails:**
>
> 1. **Clipping into the limiter.** A boost that isn't paid for with headroom drives the limiter, which audibly squashes and grits the top end. Auto-preamp already prevents this; manual preamp can currently go to **+12 dB** (`PREAMP_MAX_DB`), which can only ever push into the limiter. Cap manual preamp at **0 dB**. Saved values above 0 clamp to 0 on load (no reset of anything else).
> 2. **Narrow, big boosts.** Parametric Q goes to 18 at +12 dB; a narrow, tall boost rings and sounds whistly. Keep narrow Q for **cuts**; for **boosts**, cap Q so a band can't be both tall and narrow (for example Q ≤ 3 above +6 dB). The sheet shows the capped value rather than silently ignoring the slider.
> 3. **Treble boosts near the top of the band.** At a 44.1/48 kHz engine rate, Web Audio's biquads squeeze ("cramp") the shape of bands above ~10 kHz, and lossy files (MP3/AAC) hide their artifacts up there. Limit boosts at or above 10 kHz (the 16 kHz graphic band, high-shelf and peak bands up there) to **+6 dB**; cuts unchanged.
> 4. **Verify:** render pink noise and a 20 Hz–20 kHz sweep through every taste preset and through a worst-case custom curve (all bands at their new caps, auto-preamp on). The limiter applies **no** gain reduction; a 1 kHz sine at −1 dBFS through the full chain measures THD+N below −100 dB; each band's rendered response matches `getFrequencyResponse()` within 0.5 dB up to 16 kHz. If the top bands miss by more than 1 dB from the intended shape, note it in the PR for a follow-up (matched-response coefficients via `IIRFilterNode`); don't build that here.
>
> **Every file type at its best:**
>
> 5. **Resampling is the one real quality step.** Every file is converted to the engine's rate on decode (44.1 kHz files to 48 kHz on iPhone; 96 and 192 kHz down to 48 kHz). Measure WebKit's converter on device: a 44.1→48 and a 192→48 sweep should stay flat to 20 kHz within 0.1 dB with images/aliasing below −90 dB. If it passes, keep it. If it fails, decode at the file's own rate (`OfflineAudioContext` at the source rate) and convert in the PL6 worker with a high-quality polyphase sinc resampler (a small WASM build of soxr or libsamplerate) before handing the buffer to playback.
> 6. **Keep the whole path in 32-bit float** (it already is). No intermediate 16-bit step anywhere: not in decode, analysis, scratch windows or the limiter. A 24-bit file's quiet detail stays intact end to end.
> 7. **Unity gain by default.** With normalization Off, EQ off and the volume slider at full, the output is the file (PL5's null test). Normalization only ever boosts as far as the file's true peak allows (−1 dBTP, PL5).
> 8. **Lossy files get no special treatment** beyond item 3. Encoder delay/padding is already trimmed (MP3 LAME, AAC iTunSMPB); keep that. Settle the open AAC question from the review: render an AAC file in WebKit and check whether the decoder already removed the priming samples before our iTunSMPB trim cuts again; fix whichever side double-trims.
> 9. **Sundown slowdown quality (Vinyl only).** Changing speed uses the buffer source's `playbackRate`, which browsers resample with simple interpolation; that can dull or slightly grit the top end at slowed speeds. Measure a sweep at rate 0.8: if images exceed −70 dB, move rate changes into a worklet varispeed with a windowed-sinc interpolator (the scratch worklet is the model). Pure is never affected (always exactly 1.0).
> 10. **Honest readout.** The track spec line shows what's actually happening: source format, and the engine rate when it differs, e.g. `FLAC · 24/192 → 48 kHz`. No upsampling claims, ever. Tapping it adds one plain-text state: **Untouched** (lossless, Pure, EQ and normalization off, rates match), **Converted** (only the sample rate changed), or **Shaped** (names what's changing it: EQ, normalization, Vinyl). Unit-test the state function.
> 11. **Measure in WebKit, not just Chromium.** Every render test in this PR runs in Playwright WebKit too (the engine iOS uses); record the resampler and Sundown numbers in `docs/perf/BASELINE.md`.
>
> Device note for Ken: over AirPods or any Bluetooth headphones, iOS re-encodes everything to roughly AAC 256 kbps before it leaves the phone, so the hi-res tiers sound the same there as 16/44.1. They only pay off on a wired path (a USB-C DAC). The native build can go further: ask iOS for the file's own sample rate (`AVAudioSession.setPreferredSampleRate`) so a DAC gets 96 or 192 kHz untouched.


---

# Part B · Trim

Behaviour-neutral. Can interleave with Part A, except where noted.

## TR1: CLAUDE.md under 30 KB (do this early)

> 1. Keep: what the app is, how it's put together (one short paragraph per folder, current state only), the rules (refactor rules, rule 9, Pure wording, security, design rules, CSS token scale), the device checklist, commands, deploy previews.
> 2. Cut: per-file history in "Repo layout" (step IDs, "since …", what changed when). Git and `docs/CHANGELOG.md` already hold it. Where a fact is still needed to avoid a mistake, keep it as one present-tense line.
> 3. Target under 30 KB. Show Ken the before/after section list in the PR description.

## TR2: lazy-load what launch doesn't need

> 1. Run `npm run build` first and record chunk sizes in `docs/perf/BASELINE.md`.
> 2. Load supabase-js after first paint, not inside `restoreLibrary()`; nothing in startup awaits it. Fix the stale comment at `main.js:213`.
> 3. Dynamic `import()` on first use: `src/share/*`, social screens and storefront, `profile/legal.js` and `privacy.js`, the EQ sheet, `src/sync/*` (start the backup pull after first paint).
> 4. Keep the launch intro static (it runs on every launch).
> 5. Record new chunk sizes and the cold-start time from the NV1 script. Device check: first tap on each lazy screen opens without a visible delay.

## TR3: social client into the bundle

> Turn `src/miziki-social.js` into an ES module, bundled and minified with the lazy social chunk; remove `copySocialClient()` from `vite.config.js`. Replace the hand-rolled SHA-256 with `crypto.subtle.digest` (async — update callers). Social tests pass unchanged.

## TR4: miziki.html diet

> Move the HTML comments' useful content into `docs/` (or delete where it's history), keeping short structural markers only. Remove the `.sdv1` block, `drawSun()`'s writes into it, and the matching rules in `24-sundown-arc.css` and `25-day-arc-v2.css`. Expect ~40 KB off the shipped HTML.

## TR5: dead and duplicated code

> 1. Delete `src/sundown/drift.js` and `tests/unit/drift.test.js`.
> 2. Remove the unused exports `isHookPreviewActive`, `THIRD_OCTAVE_HZ`, `hasSavedSlipmat`, `isSundownSheetOpen` (or un-export if used internally).
> 3. Remove unused CSS: `collection-group*`, `crate-group-toggle`, `crate-info-row`, `lib-nav`, `mode-note`, `profile-count`, `store-gear`, `store-vis-link` (re-grep first; `crate-sticker-*` names are built at runtime in `crate/view.js` — keep those).
> 4. One pressing table: `tiers.js` imports `data/pressings.json` and drops its `VARIANT_DEFS` copy.
> 5. `wordmarkWidth()` moves to `share/styles.js`; `eq.js` uses `clamp` from `util/math.js`; the share cards' borrowed formatters (`fmtCount`, `fmt`) move to `util/text.js`.
> 6. Remove the three Car Mode comments.

## TR6: comment diet (last, folder by folder)

> One PR per folder, after any Part A PR touching that folder has merged. Keep comments that explain *why* or warn about a trap; cut narration of when and in which step something changed. A short tag like `(AU4)` pointing at a plan doc is fine. Minified `dist` JS must be byte-identical before and after.

## TR7: repo weight

> Losslessly compress `docs/design/**/png` (oxipng) and, if still large, move the originals to a GitHub release and link them. Archive `docs/CHANGELOG.md` entries before October into `docs/history/CHANGELOG-2026-H1.md` (or similar), keeping the live file short.

---

## Build order

1. **PL1 · Silent new album.** Small, and Ken hits it.
2. **TR1 · CLAUDE.md.** Makes every session after it cheaper and faster.
3. **PL2 · One clock.**
4. **PL3 · Gapless that always lands.**
5. **PL4 · Interruptions.**
6. **PL5 · Transparent output stage.**
7. **TR2 · Lazy loading**, then **TR3**, **TR4**, **TR5** in any order.
8. **PL6 · Main thread**, **PL7 · Lock screen**, then **PL8 · Clean at every tier** (after PL5 and PL6).
9. **TR6 · Comment diet**, folder by folder. **TR7** any time.

## Later ideas (not in this build)

- **Album-aware shuffle** (shuffle albums, play each in order) and not reshuffling on a repeat-all wrap.
- **"Bit-perfect" switch:** Pure with the output stage bypassed entirely, for people who want it literal.
- **ManagedMediaSource background path** (iOS 17.1+) as an alternative to the MediaStream → hidden `<audio>` route, if the toggle path proves to drop out under load.
- **Per-output EQ profiles, switched automatically** (native build only). A web app can't see what's connected: iOS Safari doesn't expose the output device to web pages. Native iOS can read the current route (`AVAudioSession.currentRoute`: headphones, Bluetooth, built-in speaker, plus the device's name, e.g. "Ken's AirPods Pro"). That's enough to remember *your own* EQ per output and switch it when that output connects. It isn't enough for automatic measured correction: the name is user-renamable and doesn't reliably give the model, and AirPods already get Apple's own Adaptive EQ, so a second correction on top would double-correct.
- **Native-rate output to a USB DAC** (native build only): AVAudioEngine can ask iOS for the file's own sample rate when an external DAC supports it, which is the one way a 24/96 or 24/192 file is heard at its full rate on iPhone.
- **Native iOS engine** (AVAudioEngine + background audio mode) behind the same player interface when the App Store build starts; PL2's anchor model maps directly onto it.
