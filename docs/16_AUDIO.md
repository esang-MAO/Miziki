# 16 · Audio: a sound engine worth the record

> **Status:** Ready to build · **Area:** Audio engine / Player / Queue / Crate · **Written:** Oct 25, 2026 · **Design:** `docs/design/audio/` (canvas "Miziki Audio", PNGs in `docs/design/audio/png/`)

## Where this came from (Oct 25)

A review of the audio code after the design work of the last month, plus two reference texts:

- **McCarthy, *Sound Systems: Design and Optimization*** (3rd ed.): EQ design (Chapter 2.4), limiters (2.4.6), summation and comb filtering (4.2), loudness and tonal perception (5.1, 5.3), stereo perception (5.4), what gives processing away (5.5), and the calibration procedures in Chapter 14.
- ***Proceedings of the 6th Conference on Sound and Music Technology*** (CSMT 2018): music summary (hook) detection by chroma self-similarity, and audio declipping. The other papers need trained neural networks or lyrics and are out of scope for an on-device player.

The engine already has a good Vinyl chain (wobble, saturation, softening, compression), synthesized surface noise and Media Session controls. What it lacks is the plumbing a top player has: seamless track changes, clean edges, honest levels, an EQ, loudness normalization, resume, and a few queue tools. This doc also adds **45 RPM records**, which `15_SURFACE_NOISE.md` listed under "Later ideas."

## What the review found

1. **Tracks don't flow into each other.** The next track starts only after the current source's `onended` fires (`player/transport.js` → `queue.js advance()` → `load()` → `play()`), so there is always a small gap, even with the gapless delay/padding already parsed at import.
2. **The engine is rebuilt whenever the sample rate changes.** `ensureContext(rate)` closes and recreates the `AudioContext` for a track with a different rate (44.1 → 48 → 96 kHz), which adds a gap, can click, and resets every node.
3. **Hard cuts click.** Pause, seek, stop and the Pure/Vinyl toggle stop or reroute the source instantly. Skips already get the needle lift (15 §3); nothing else is faded.
4. **Vinyl plays louder than Pure.** The Web Audio `DynamicsCompressorNode` applies its own automatic makeup gain, and `applyCharacter()` adds `1 + 0.4 × comp` on top. There is no limiter at the end. Louder always sounds "better," so Vinyl vs Pure isn't a fair comparison, and hot masters can clip.
5. **The saturation stage can hard-clip.** A `WaveShaperNode` clamps its input to ±1, so a full-scale master (or a wow/flutter overshoot) hits a digital hard clip before the curve does anything musical.
6. **Hi-res can run out of memory.** Whole tracks are decoded at their native rate and three are kept (`buffers.js touchLRU`). A 4-minute 24/96 track is about 185 MB decoded; three is over half a gigabyte, enough for iOS to kill the app.
7. **Nothing resumes.** The queue, the current track and the position aren't saved. iOS often kills home-screen apps in the background, so you lose your place.
8. **No EQ, no loudness normalization, no mono or balance, no volume on desktop** (`applyVolume()` pins master gain at 1).
9. **The queue is basic.** ▲▼ arrows to reorder, no history, no save-as-playlist, no clear.
10. **Wow ignores Sundown.** `wowOsc` is fixed at 0.55 Hz (one wobble per turn at 33⅓), but the platter slows with Sundown. Surface noise already scales its rotation by `S.rate`; the wobble should too.
11. **Sides split by track count.** `splitSides()` halves the track list and skips albums under 4 tracks, so singles and EPs never get sides.

## Shared rules for every PR in this doc

- Read CLAUDE.md first. One PR at a time; each waits for Ken's go-ahead.
- **iOS gesture rule (rule 9):** `bgPrime()` stays the first call in `play()`, before any `await`. Nothing here adds an `await` before playback starts. AU4 is the one PR that deliberately changes the `onended`/`S.gen` path rule 9 protects; it does so alone, with its own tests and the device checklist.
- **Pure means untouched by Vinyl.** *Ken, Oct 25: EQ applies in Pure too.* The output stage in §1 (normalization, EQ, mono/balance, the safety limiter, desktop volume) applies in both modes. Nothing from the Vinyl chain, surface noise or ceremonies ever reaches Pure. Update CLAUDE.md's Audio rule to this wording in AU3, so a later session doesn't strip the EQ out of Pure.
- **Saved data survives.** No change deletes a saved value without a reason in the PR.
- **Every new or changed migration** is tested against `tests/supabase_stub.sql` and a staging project before production.
- **Audio PRs prove themselves with numbers.** Each one adds an offline render test (Playwright Chromium, `OfflineAudioContext`) for the property it claims: no gap, no click, level match, ceiling held, curve correct. See each PR's **Verify**.
- Lint and tests pass; both builds preview cleanly; NV1's perf numbers show no regression. Do not merge.

## Design frames

The screens for this doc are in `docs/design/audio/` (see its README for tokens and notes). Build with Miziki's real CSS and components; the frames show layout, copy and states, not markup to copy.

| Frame | PNG | Used by |
|---|---|---|
| A 7″ single at 45 on the platter | `png/01-Main.png` | AU9, AU10 |
| Three formats; dead wax shows the length; sides by time | `png/02-Formats.png` | AU9, AU10 |
| The speed change, 33⅓ to 45 (storyboard and timing) | `png/03-SpeedChange.png` | AU10 |
| The 45s section in the crate | `png/04-Crate45.png` | AU10 |
| Liner notes: format, sides, the master | `png/05-LinerNotes.png` | AU5, AU9 |
| Speed override in the edit sheet | `png/06-EditSpeed.png` | AU9 |
| Hook preview from the hold card | `png/07-HoldPreview.png` | AU12 |
| EQ: tilt, 10 bands, true curve, auto preamp | `png/08-EQGraphic.png` | AU6 |
| EQ: parametric bands | `png/09-EQParametric.png` | AU6 |
| Settings › Playback: leveling, mono, balance | `png/10-Playback.png` | AU5, AU7 |
| Queue: recently played, drag, save, clear, undo | `png/11-Queue.png` | AU8 |
| Picking up where you left off | `png/12-Resume.png` | AU1 |

---

## 1. The output stage

Today the graph ends at `n.master`, which `applyOutputRoute()` connects to either `ctx.destination` or the background `MediaStreamDestination`. This doc adds one shared output stage after the point where the Pure and Vinyl paths rejoin:

```
source → trackGain ─┬─ Pure ──────────────────────────────────────────┐
                    └─ Vinyl: pad → wobble → sat → dc → tone → comp → makeup ─┤
                                     ↑ surface noise / scratch join here     │
                                                                              ▼
            master → norm (ReplayGain) → preamp → EQ bands → mono/balance → limiter → volume → out
                                                                                            │
                                                         ctx.destination  or  bgDest ◄──────┘
```

- `applyOutputRoute()` moves from `n.master` to `n.out`; everything else about background routing is unchanged.
- Surface noise and scratch audio still join at `n.wobble` (Vinyl only), as now.
- The **limiter** comes after everything that can add gain. **Desktop volume** comes after the limiter, so turning it down never changes how hard the limiter works.

---

## 2. Fixes

### 2.1 Resume where you left off

- Save the queue (`baseQueue`, `queue`, `qpos`), the current track and the position. Store **track ids, not indices**, since indices change when tracks are added or removed.
- Save the position about every 5 s while playing, and immediately on pause, `visibilitychange` (hidden) and `pagehide`.
- On launch, restore **paused** at the saved position: the mini player shows the record and Play continues from there. The launch intro and the crate already land on the last-played album; they should land on this same record.
- Missing tracks (deleted since) are dropped from the restored queue; if the current track is gone, restore the next one at 0:00.
- **Device-only**, not part of the backup doc (same posture as the Sundown view). Syncing "what I was playing" across devices can come later.
- **What it looks like** (`png/12-Resume.png`): the crate header reads `❚❚ PAUSED · [ALBUM]`, the catalog card shows where you were (`12″ LP · SIDE B · TRACK 7 OF 10`), and the mini player shows a progress hairline, `PAUSED AT 2:14 OF 4:31` and an orange play button. No toast or prompt.

### 2.2 Clean edges

- **Pause, stop and seek fade out over 15 ms** on `trackGain` before the source stops. Schedule the stop at `ctx.currentTime + 0.015` with `src.stop(when)`; no timers, no `await`.
- **Every source start fades in over 10 ms**, except a lead-in or needle drop, which already has its own envelope.
- **The Pure/Vinyl toggle is a dip, never a crossfade:** fade out 15 ms, reroute, fade in 15 ms. The Vinyl path runs about 12 ms behind Pure (the wobble delay). Overlapping the two paths, even briefly, sums a signal with a delayed copy of itself at similar level, which is a comb filter with deep peaks and dips (McCarthy 4.2.1.3). The same rule applies to any future path change.
- Skips keep the needle lift from 15 §3 unchanged.

### 2.3 One engine, with headroom and honest levels

- **One fixed-rate context.** Create the `AudioContext` once, at the device's own rate (no `sampleRate` option), and never rebuild it for a track. `decodeAudioData` resamples to the context rate. The output device was resampling anyway, so nothing audible is lost. This removes the gap and click of a rebuild, keeps every node alive across tracks, and cuts decoded memory for hi-res files by half or more. The track spec line and the pressing tiers keep reading the file's own rate from `t.meta`, so nothing visible changes.
- **A −3 dB pad in front of the Vinyl chain**, made up after the compressor, so the saturation curve never sees input over full scale.
- **Fix the compressor's double makeup gain.** Remove the manual `1 + 0.4 × comp`, then set one makeup value per Character setting so that **Vinyl matches Pure within 0.5 dB** of integrated loudness. Derive the table offline: render pink noise and a few reference masters through every Character preset and drift intensity with `OfflineAudioContext`, measure BS.1770 loudness, and ship the resulting compensation table plus the script that made it.
- **A real safety limiter** at the end of the output stage, built as an `AudioWorklet` (the scratch processor already uses one). Use a peak limiter with a 1.5 ms lookahead and a −1 dBFS ceiling. Attack is about 1 ms and release 150 ms, inside McCarthy's onset under 20 ms and release over 100 ms. It sits at **exactly unity gain until the threshold is crossed**. Don't use `DynamicsCompressorNode` for this: it adds its own makeup gain (finding 4) and has no true lookahead.
- **Fix the wobble rate:** `wowOsc.frequency = (rpm / 60) × S.rate`, updated wherever `S.rate` changes. That's 0.556 Hz at 33⅓ and full speed, slowing with Sundown; §5 adds 45.
- The compressor should never be heard working ("breathing" is the classic giveaway, McCarthy 5.5.2). If the level-match renders show audible pumping at the strongest Character setting, lengthen the release before shipping.

### 2.4 Seamless track changes

- When the next track's buffer is preloaded (`preloadNextTrack()` already does this), **schedule its source to start at the exact context time the current one ends**, using `start(when, offset)` with the gapless delay applied. Within a side this is sample-accurate.
- The queue position, the UI update and session crediting still move when the old source ends; they just no longer *cause* the new one to start.
- If the next buffer isn't ready in time, fall back to today's behavior (start on `onended`).
- **Ceremonies keep their place.** A side flip, a record change between albums, or a needle lift/drop still runs exactly as now. Only track-to-track changes *inside a side* become seamless. Within-side lead-ins don't exist, so nothing is lost.
- `S.gen` still guards every stale source, and a pending scheduled source is cancelled by pause, seek, skip, stop and queue edits.

---

## 3. EQ (both modes)

### Layout

- **Tilt:** one warm-to-bright control, ±6 dB, pivot near 1 kHz, built as a low shelf and a high shelf moving in opposite directions. This covers most of what people reach for, in one control. It is McCarthy's multi-band shelf idea (2.4.2.3) at its simplest.
- **10-band graphic** (31 Hz to 16 kHz, ±12 dB) on the main EQ screen.
- **Advanced → Parametric:** up to 6 bands, each with type (peak, low shelf, high shelf, low cut, high cut), frequency, gain and width (Q). McCarthy is clear that the parametric is the real tool and the graphic is for quick shaping (2.4.2.1–2).
- **Presets** as a chip row: `FLAT`, `CUSTOM` (whenever the bands don't match a preset), `WARM`, `BRIGHT`, `VOCALS`, `LESS BASS`, plus user-saved presets. The names are placeholders Ken may rename.
- **Layout** (`png/08-EQGraphic.png`, `png/09-EQParametric.png`): a sheet titled EQ with `PURE AND VINYL` under it and an on/off switch; a Graphic | Parametric tab row; the preset chips; the curve (±12 dB, `TRUE CURVE` label, the peak called out); the preamp line with an `AUTO ✓` toggle; then the tilt slider and the 10 band sliders (graphic), or the band list with the selected band expanded to type, frequency, gain and width plus `+ ADD BAND · 4 OF 6` (parametric). At the bottom: `HOLD TO HEAR FLAT` and `SAVE PRESET`.

### Rules

- **Draw the true curve, not the slider positions.** Neighboring graphic bands interact, so the combined response differs from the faders (McCarthy 2.4.2.2). Compute the real curve with `BiquadFilterNode.getFrequencyResponse()` across every active band plus preamp, and draw that line behind the sliders.
- **Auto preamp, on by default.** When the combined curve rises above 0 dB anywhere, lower the preamp by that peak, so the EQ never clips and never wins a comparison just by being louder. Ears latch onto peaks more than dips (McCarthy 5.3.1), so the built-in presets favor cuts over boosts.
- **Level-matched compare.** `HOLD TO HEAR FLAT` bypasses the bands only while held (the same press-and-hold shape as RF28's audition controls), and the on/off switch turns the EQ off outright. Both keep the auto-preamp offset, so the comparison is about tone, not volume.
- **No zipper noise:** every gain, frequency and Q change glides with `setTargetAtTime` (about 20 ms).
- **No loudness compensation.** Boosting lows and highs at low volume is an artistic effect, not a correction (McCarthy 5.1.2), and the web can't read system volume anyway. Not built.
- **Where it lives:** an EQ button in the full player's bottom row, beside Queue (`png/01-Main.png`), and an EQ row in Settings › Playback that shows the current preset and state (`CUSTOM · ON`). Not in the Sundown sheet's Sound view, which stays about the Vinyl character.
- **Saved** in prefs (synced, per-key merge like every other pref); custom presets sync too.

### Verify

- Rendered impulse response through the EQ matches `getFrequencyResponse()` within 0.1 dB at 1/3-octave points.
- With any preset and auto preamp on, a full-scale sine sweep never exceeds 0 dBFS before the limiter.

---

## 4. Loudness normalization

- **Read tags at import:** `REPLAYGAIN_TRACK_GAIN/PEAK` and `REPLAYGAIN_ALBUM_GAIN/PEAK` (Vorbis comments, ID3 `TXXX`, MP4 freeform `----:com.apple.iTunes:`), and `R128_TRACK_GAIN`/`R128_ALBUM_GAIN` (Opus).
- **Measure what isn't tagged.** Import already decodes every file, so compute BS.1770 integrated loudness and true peak there, in a worker, and store per-track values plus an album aggregate. Run an idle-time pass over the existing library once.
- **Modes:** `Off` · `Track` · `Album` · **`Auto` (default):** album gain when playing an album in order, track gain on shuffle or a mixed queue. Album gain keeps a record's own quiet and loud moments intact.
- **Never push into clipping:** limit the applied gain so that `peak × gain ≤ −1 dBFS`; the limiter catches anything left.
- Applies in **both modes** at `norm` in §1.

### Dynamics note (same pass)

- While measuring, also count **clipping events** (runs of 3 or more consecutive samples at |x| ≥ 0.999) and the **peak-to-loudness ratio**.
- Show it in the gatefold liner notes as a **THE MASTER** block under the sides (`png/05-LinerNotes.png`): one word (*Dynamic*, *Compressed* or *Clipped master*), a small meter, one plain sentence, and the applied gain on the right (`ALBUM GAIN −4.2 DB`). The sentences are "Plenty of room between the quiet and loud parts. No clipping found.", "Loud throughout, with less room between soft and loud." and "Peaks were cut flat in mastering; it can sound harsh turned up." It is informational only: it never ranks, sorts or changes a pressing tier. Crushed masters lose detail and tire the ear (McCarthy 5.1.1), and saying so plainly fits the record-store voice.
- Repairing clipping (declipping, CSMT) is too heavy for a phone; detecting it is cheap.

---

## 5. 45 RPM records

### Sides by time

- Replace the count-based split with a **duration-based** one: keep track order and pick the cut point that best balances the two sides.
- **One track: a single side, no flip.** *(Ken, Oct 25.)* Two tracks: A and B. Three or more: balanced by time.
- Multi-disc albums keep today's behavior (one side per disc) for now.
- The format below is computed whether or not the Sides setting is on. With Sides off, there are simply no flips.

### Format from the longest side

| Longest side | Record | Speed |
|---|---|---|
| up to 7:00 | 7″ single | 45 |
| 7:00 to 15:00 | 12″ single / EP | 45 |
| over 15:00 | 12″ LP | 33⅓ |

- **The same for everyone.** *(Ken, Oct 25.)* Like pressing variants, the format comes from the record itself (its track lengths, rounded to whole seconds), not from the user. Once MusicBrainz matching lands, use the release's canonical lengths so different rips can't land on opposite sides of a boundary.
- **Personal override** per album in the edit sheet: `Auto` · `33⅓` · `45`. With 45, the size follows the table (7″ if the longest side fits, otherwise 12″); 33⅓ is always 12″. The override is personal: it syncs in your backup, but friends see the automatic format.
- **Friends see the same format** because the owner's app publishes it with the record (a new column on the published record row; migration rules above).

### How it looks

- **7″ on the platter:** about 58% of the 12″ diameter, with the slipmat showing around it. A big center hole holds a three-spoke 45 adapter that turns with the record; the label fills about half the disc.
- **Dead wax shows the length.** The groove band ends at a radius set by how full the side is (side length ÷ capacity: about 7 min for a 7″ at 45, 15 min for a 12″ at 45, 22 min for an LP). Short sides leave a wide band of smooth dead wax near the label, where the etchings from 15 §5 already live. This applies to LPs too.
- **The label arc** reads `45.0 RPM · SIDE A · STEREO`, scaled by Sundown like 33⅓ is now.
- **Crate:** 7″ records get smaller sleeves in the bins, and a **45s** section (7″ and 12″ 45s) joins the A–Z section list, before Staff picks.
- **The speed change** (`png/03-SpeedChange.png`): when the next record's speed differs, the new record lands on the platter still at the old speed; at 0 ms a `33⅓ | 45` switch clicks over with a short mechanical tick and one haptic; from 0 to 600 ms the platter eases up to the new speed; at 600 ms the usual needle drop and lead-in follow (2 s on a 7″). Only with the player open (with it closed there's nothing to see, as now). Pure: instant, with no click, spin-up or lead-in. Reduce Motion: the click and haptic stay; the platter cuts straight to the new speed.
- **The format shows up in text too:** a `7″ · 45` chip before the spec line in the player, the format under the title in the liner notes (`12″ EP · 45 RPM`), stickers on sleeves in the crate (`7″ · 45`, `12″ · 45`), and `7″ SINGLE · 2 TRACKS` on the catalog card. The 45s bin's front label reads `45s · 7″ & 12″`, and its header line reads `[18] RECORDS · 45 RPM`.
- **The edit sheet** (`png/06-EditSpeed.png`) shows the result under the `AUTO · 33⅓ · 45` control: a small disc, `7″ SINGLE · 45 RPM`, and one line ("One track, 4:12. A single side, no flip."), then "Auto picks the speed from the side lengths, so it matches for everyone. A choice here is yours only; friends still see Auto."

### How it sounds

- **Rotation:** the platter turns at `rpm × 6`°/s × `S.rate` (270°/s at 45). Add one helper, `rotationHz() = (rpm / 60) × S.rate`, and use it for the wobble oscillator and for every surface-noise call that passes `0.55 * S.rate` today (`transport.js`, `queue.js`, `shell/runout.js`). At 45 that's 0.75 Hz.
- **Cleaner in Vinyl:** real 45s get more groove speed and more room on the disc. For 45s, scale softening ×0.7, saturation ×0.8 and the surface-noise floor ×0.8, and shorten the lead-in on a 7″ to about 2 s. These stay subtle. Pure is untouched either way.
- Sundown slows 45s by the same percentage as LPs.

### Verify

- Unit tests for the time-based split (1, 2, 3, odd, even, very uneven track lengths) and the format table at each boundary.
- Rendered wobble frequency is within 1% of `rotationHz()` at 33⅓ and 45, at full speed and at a Sundown rate.

---

## 6. Smaller player features

- **Mono and balance** (Settings → Playback): a Mono switch that sends (L+R)/2 to both sides, and a constant-power L/R balance. These help one-earbud listening and hearing in one ear; stereo only works for a centered listener anyway (McCarthy 5.4).
- **Volume slider on desktop only**, after the limiter, saved per device. Phones keep the system volume.
- **Queue:**
  - Drag to reorder with a handle. The ▲▼ moves stay as VoiceOver actions.
  - **Recently played** above the current track (from the existing session history).
  - **Save queue as playlist.**
  - **Clear upcoming**, with an undo toast (also used for removing a single track).
  - Layout (`png/11-Queue.png`): `SAVE AS PLAYLIST` top right; `RECENTLY PLAYED` dimmed with relative times; a highlighted `NOW SPINNING` row with a mini disc; `UP NEXT · 7` with `CLEAR UPCOMING` on the right. Each row shows its format and side (`[Artist] · 7″ · SIDE B`). A dragged row lifts and tilts slightly over a dashed drop slot. The undo toast is cream with an `UNDO` button.
- **Settings › Playback** (`png/10-Playback.png`): an EQ row; `VOLUME LEVELING` as `AUTO · ALBUM · TRACK · OFF` with one explaining sentence; a `LISTENING` group with Mono, Balance (L–R with a center tick) and the existing Background playback switch; and a note that computers get a volume slider in the player bar.

---

## 7. Hook previews (optional, last)

- **At import** (and in the same idle pass as §4), find each track's most-repeated section. Downmix and downsample to 11 kHz, take 12-bin chroma frames at 200 ms hops, extend each frame with its neighbors, build a self-similarity matrix, and pick the most repeated stretch of 8–30 s (CSMT, music summary detection). Store `hookStart`/`hookEnd` per track.
- **Use** (`png/07-HoldPreview.png`): a **Preview** button at the top of the crate's hold card plays the album's hook (while playing it reads "Previewing the hook", `FROM [TRACK] · 1:02–1:24`, with a stop button, a level meter and a progress bar), from its most-played track or track 1 if none has been played. It fades in and out, goes through the output stage, and stops when the card closes. It never counts as a play or a session.
- **iOS:** the preview starts from the button tap itself, which keeps it inside a user gesture. It never starts from the long-press timer.
- Later, the same data can suggest preview segments for artist pages.

---

## Build order

1. **AU1 · Resume** (§2.1). Independent and the biggest everyday win.
2. **AU2 · Clean edges** (§2.2). Verify: no sample-to-sample jump above −60 dBFS at pause, seek and mode switch in a render.
3. **AU3 · One engine and honest levels** (§1 skeleton, §2.3): fixed context, `n.out`, pad, makeup fix, level-match table, limiter, wobble rate. Updates CLAUDE.md's Pure wording. Verify: Vinyl within 0.5 dB of Pure at every preset; output never above −1 dBFS on a +6 dB-hot test file.
4. **AU4 · Seamless track changes** (§2.4). The rule 9 PR. Verify: rendered album with a continuous tone across a track boundary has no gap or discontinuity; run the device checklist on iPhone before review.
5. **AU5 · Loudness normalization and the dynamics note** (§4).
6. **AU6 · EQ** (§3).
7. **AU7 · Mono, balance and desktop volume** (§6).
8. **AU8 · Queue tools** (§6).
9. **AU9 · Sides by time and 45 RPM audio** (§5): split, format, override, rotation helper, cleaner 45 character.
10. **AU10 · 45 RPM visuals** (§5): 7″ disc and adapter, dead-wax radius, label arc, crate section, speed change.
11. **AU11 · Friends see the format** (§5): published column and migration.
12. **AU12 · Hook previews** (§7), optional.

## Later ideas (not in this build)

- Headphone-correction presets built from published headphone measurements (now possible, since the EQ applies in Pure).
- Separate EQ profiles per output (headphones vs speaker), if the platform ever exposes the output device reliably.
- Double albums as four sides (A–D) instead of one side per disc; 10″ records.
- A 7″ picture-sleeve view in place of the gatefold for singles.
- Syncing "what I was playing" across devices.
- **Not planned:** crossfade (records don't crossfade; seamless sides are the point), and automatic loudness compensation (§3).
