# Miziki — Surface Noise & Vinyl Ritual

> **Status:** Ready to build · **Area:** Player / Sound / Crate · **Settings live in:** Sundown sheet → Sound view

## Summary

A real record makes sound before the music starts and after it stops, and handling one involves small physical moments that streaming removed. This spec brings five of them into Miziki:

1. **Surface Noise:** needle drop, lead-in crackle and hiss before the first song, and run-out hiss after the last song on a side.
2. **Shrink-wrap peel:** opening a Sealed record for the first time.
3. **Needle-lift skipping:** skipping mid-side lifts and re-drops the needle instead of cutting silently.
4. **Auto-flip toggle:** when it's off, a finished side sits in the run-out until you flip it.
5. **Dead-wax etchings:** hand-scratched text in the run-out area, readable while the side winds down.

### Principles for all five
- **Never block the music.** Every moment is short, has a non-gesture path, and either has its own toggle or follows the Surface Noise toggle.
- **Reward attention; don't punish speed.** Rapid taps and background controls always work.
- **Pure mode turns all of it off.** Pure means untouched.
- **Respect Reduce Motion.** Animations shorten to crossfades; sounds and haptics remain.

---

## 1. Surface Noise

### What the listener hears

| Moment | Sound | Source on a real record |
|---|---|---|
| **Needle drop** | A soft, low *thump-pop* | Stylus landing in the lead-in |
| **Lead-in** (~2–4 s) | Crackle, light pops and steady hiss, fading as track 1 begins | **Lead-In Groove Wear** |
| **Between tracks** | Faint hiss filling existing gaps only, no crackle | Bands between tracks |
| **Run-out** | Hiss and an occasional tick, pulsing gently with each rotation | **Intrinsic Vinyl Surface Noise** in the run-out / locked groove |
| **Needle lift** | A short scuff, then the noise cuts out | Stylus leaving the groove |

### Rules
- The lead-in plays only at the **start of a side**: playing from stopped, or after a flip. It doesn't play on resume from pause, or when scrubbing back to 0:00.
- The run-out plays after the **last track of a side** and ends one of three ways:
  - **Flip:** needle lift, then a new needle drop and lead-in on side B.
  - **Queue ends:** needle lift, then the put-away animation.
  - **Timeout:** needle lift; the record stays on the platter (see §4).
- Surface noise isn't added under the music by default. The music itself is never altered.

### Settings (Sundown → Sound)
- **Surface Noise:** `Off` · `Subtle` · `Well-loved`. **Default: `Subtle`, on for new users.**
- **Run-out length:** `Short (8 s)` · `Normal (20 s, default)` · `Until I lift it`
- **Under the music:** off by default. When on, a very faint hiss bed at about −55 dBFS sits under playback.

### Ties to the rest of Miziki
- **Pressings and quality tiers:** higher audio-quality tiers get a quieter noise floor, as a better pressing would. Rare pressings can carry a distinct character, such as a slightly warmer hiss.
- **Sundown:** as the platter slows toward night, the noise slows and pitches down with it, then returns toward normal speed near sunrise.
- **Day-arc sound drift:** in `Subtle` drift, evening adds a touch more hiss.
- **Background playback:** lead-in and run-out still bracket each side.
- **Wear from plays (not built yet):** the visual wear-from-plays design was never implemented. For now, noise character comes only from the Surface Noise setting plus a per-release seed. Leave a hook (`wearLevel`, 0–1, currently always 0) in the noise generator so the planned wear system can scale crackle density later. Sealed→first play would be the cleanest a record ever sounds.

### Implementation
- **Generate the noise in Web Audio; don't use samples:**
  - **Hiss:** pink noise through a band-pass, about 1–8 kHz, with the top rolled off.
  - **Crackle:** sparse Poisson-timed impulses through a short high-pass, with randomized amplitude.
  - **Pops:** rarer, larger transients with a small low-frequency body.
  - **Rotation:** a slight amplitude wobble at platter rate (0.55 Hz at 33⅓), scaled by the Sundown speed.
- **Seed per release.** Seed the random generator from the release ID plus the side, so every copy of an album has the same lead-in, consistent with pressings being the same for everyone.
- **Lead-in is a separate source.** Schedule it *before* track 1, then crossfade it out over the first ~400 ms of the music. Never time-stretch or delay the audio file.
- **Gapless albums:** between-track hiss never inserts gaps. It only fills silence that's already there.
- **Levels:** crackle peaks around −38 to −32 dBFS and the hiss bed around −48 dBFS, normalized to album loudness.
- **Toggling off mid-noise** fades out over 150 ms. Haptic tick on the needle drop if haptics are enabled.

---

## 2. Shrink-Wrap Peel

The first play of a **Sealed** record becomes something you open.

### Flow
1. Pull a Sealed record. The sleeve has a shrink-wrap layer: a soft glare sheen and slight wrinkling at the corners, with the hype sticker sitting *on the shrink*.
2. A small tear tab sits at the sleeve's opening edge. Drag along the opening edge, and the tear follows your finger with a crinkle sound and light haptics.
3. Past ~60% of the edge, the shrink pulls away and falls off-screen, taking the hype sticker with it.
4. The sleeve is now permanently unsealed. The record leaves the Sealed section and the sleeve-pull continues as normal, including the pressing peek.

### Rules
- **It never blocks play.** Pressing play on a Sealed record from anywhere else (track list, search, lock screen) auto-peels with a quick 400 ms version of the animation, or a crinkle sound only in the background.
- **Accessibility:** long-press the sleeve, or use an **Open** action in the record menu, to peel without the drag. With Reduce Motion on, the shrink fades away.
- **It happens once per copy.** Unsealed state syncs with the account backup, so it carries over from browser to app.
- Releases with no Sealed status (already played, or imported before Sealed existed) never show shrink.

### Implementation
- The shrink is a separate layer over the sleeve: a gradient sheen, a wrinkle mask at the corners, and the sticker as a child of that layer.
- The tear is a masked path driven by drag progress along the top edge. On completion, the layer transforms off-screen with slight rotation and gravity.
- The crinkle is synthesized: short, high-passed noise bursts triggered by drag velocity. There are no assets.
- **Hype sticker content:** derive it from release data (for example "Includes [single]" or the year), or use a generic "NEW" sticker. Keep it short.

---

## 3. Needle-Lift Skipping

Skipping mid-side lifts and re-drops the needle instead of cutting silently. You still skip instantly; you just *feel* it.

### Sequence (total ≤ ~900 ms)
1. **Lift (~120 ms):** a scuff sound and a quick 80 ms music fade. A visual nudge: the stylus/tonearm indicator, if shown, lifts; otherwise the platter dips slightly.
2. **Air (~250 ms):** silence; the platter keeps spinning.
3. **Drop:** a soft pop and ~400 ms of band hiss.
4. The next track begins.

### Rules
- **Rapid skips collapse.** Several taps during a lift produce one lift, then a drop on the final target track.
- **Previous** within the first 3 s goes to the previous track; otherwise it restarts the current track. Both use the lift/drop.
- **Natural track transitions** (song ends, the next begins) are unchanged. There's no lift, and gapless and crossfade are untouched.
- **Skipping past the last track of a side** behaves like the side ending: run-out, then auto-flip or wait (see §4).
- **Lock screen / headphone / car controls** use the same audio sequence but shortened (~500 ms total), with no visuals needed.
- **Surface Noise `Off`:** the skip is a plain 80 ms fade-out and fade-in with no lift or drop sounds. Pure mode is the same.
- **Track-band needle drop** (tapping a band on the disc), if added later, uses the same drop sound.

---

## 4. Auto-Flip Toggle

### Setting (Sundown → Sound)
- **Auto-flip sides:** `On` (default) · `Off`

On keeps today's behavior: side A's run-out plays (if Surface Noise is on), then the record flips itself and side B begins with a fresh lead-in.

### When Auto-flip is Off
1. The last track on side A ends, and the run-out plays.
2. The record stays on the platter, spinning in the run-out, until one of these:
   - **You flip it** with the existing side A/B flip gesture. Side B then gets a needle drop and lead-in.
   - **The run-out timeout passes** (per Run-out length). The needle lifts, the platter spins down, and the player waits, showing a small **"Flip to Side B"** prompt on the platter.
   - **You pull a different record.** The current one is put away first.
3. If `Until I lift it` is chosen, the run-out continues until you flip, lift (tap the platter → **Lift needle**), or pull another record.

### Background and lock screen
- Now Playing shows **"Side A finished · Flip to continue."**
- The lock-screen **Next** control performs the flip.
- **Play** on a waiting record performs the flip too, since side A has nothing left.

### Edge cases
- **Single-sided records, or albums with one defined side:** after the run-out, the queue continues or the put-away plays, as today.
- **Last side of the record:** the flip setting doesn't apply; the run-out, then put-away, as today.
- **Surface Noise Off with Auto-flip Off:** the record still waits to be flipped. The run-out is just silent, with the platter visually spinning in the dead wax until the timeout.

---

## 5. Dead-Wax Etchings

Tiny hand-scratched text in the run-out area, between the last groove and the label. On real records these are matrix numbers, mastering marks and sometimes hidden messages.

### What's etched
Each side gets its own etching, the same for every copy of the release:
- **Matrix line** in a Miziki catalog style, for example `MZK-7F3A2-A1` for side A and `…-B1` for side B, derived from the release ID.
- **A short mark or message**, picked deterministically per release from a small, hand-written set. Examples: a stamped initial, "cut at night", "more bass please", a tiny drawn star, "≈ side two".
- **Later:** artist-written etchings for Miziki pressings (ties to artist pages), replacing the generated message.

### When it's visible
- **During the run-out:** the platter view eases in slightly toward the dead wax and the etching fades up, rotating with the disc. This is the moment it's meant to be found.
- **At any time:** long-press the disc to bring up a loupe over the dead wax, showing the current side's etching.
- It's never shown in lists, the crate or share cards. You only see it on the record itself.

### Visual treatment
- Thin, slightly irregular strokes with low contrast against the vinyl. It's lighter on dark pressings and darker on clear or light pressings.
- Text follows the circular path of the run-out at a slight angle and doesn't quite form a circle, as hand-scratched etching would.
- On the tier-1 Jet pressing with the optional paper label, the etching sits just outside the label's olive ring.

### Implementation
- Render with SVG `textPath` on an arc in the run-out band, using a handwriting/scratch-style font or stroked glyphs with per-glyph jitter seeded from the release ID.
- Mask it with the disc's rotation so it turns with the platter.
- Store generated etchings client-side from the seed. Only future artist etchings need server data.

---

## Settings summary (Sundown → Sound)

| Setting | Options | Default |
|---|---|---|
| Surface Noise | Off · Subtle · Well-loved | **Subtle** |
| Run-out length | Short · Normal · Until I lift it | Normal |
| Under the music | On · Off | Off |
| Auto-flip sides | On · Off | On |

Shrink-wrap peel, needle-lift skips and etchings have no separate toggles:
- Peel is a one-time moment per record.
- Needle-lift sounds follow Surface Noise.
- Etchings are passive visuals.

Pure mode turns off Surface Noise and needle-lift sounds; peel and etchings remain as visuals.

---

## Build order

1. **Surface Noise engine:** generator, lead-in, run-out, needle drop and lift, settings, and the Sundown pitch tie-in. Everything else reuses its sounds.
2. **Needle-lift skipping:** depends on 1.
3. **Auto-flip toggle:** depends on 1's run-out and timeout.
4. **Dead-wax etchings:** visual only; uses 3's run-out moment and the platter view.
5. **Shrink-wrap peel:** independent; touches the Sealed state, the sleeve-pull and sync.

## Later ideas (not in this build)
- Brush the platter before play for a cleaner lead-in.
- Drop the needle yourself onto visible track bands.
- Spin-up / spin-down with a pitch slide on play and pause.
- Liner-notes pull from the inner sleeve.
- 33/45 speed switch as a playful option.
- Cosmetic stylus-hours counter.
- **Wear from plays:** connect it to the `wearLevel` hook once the visual wear system is built.
