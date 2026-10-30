# Miziki Ceremony: Launch, End of Queue, Record Change, Slipmat

Oct 14, 2026 · @Ken Ndiang · design frames: https://claude.ai/artifact/D9AhvQ7oYjDBLWhtkxX1pY

All frames below are approved. This file is the spec; build it as the separate PRs listed at the end.

## Shared rules

- `S.sleeveSeq` stays the one cancellation token for every sequence here. Every await is followed by a token check.
- **iOS audio path.** `bgPrime()` stays the first call in `play()`, before any `await`. Do not add, remove or reorder an `await`, or change sync/async status, anywhere on that path.
- Any tap cancels a ceremony and snaps to its end state, never eased.
- **Pure mode** skips every ceremony below: instant cut, no added sound.
- `prefers-reduced-motion` and a hidden tab skip ceremonies, as today.
- Any new saved setting goes into `serializePrefs`, `parsePrefs`, the `S` defaults and `prefs.test.js`, plus a row in the CLAUDE.md backup key inventory.

## 1. Vinyl/Pure toggle

**Superseded by docs/25_FROM_SCRATCH.md:** the toggle moves into the Sundown sheet (FS5).

One toggle replaces `#modePure` / `#modeVinyl`, and the bar mirrors `#barModePure` / `#barModeVinyl`. It sets the same mode through `setMode`. Label reads the current mode ("Vinyl" / "Pure"). Keyboard focusable, `aria-pressed`. No audio change.

## 2. End of queue (Vinyl)

1. Run-out groove, about 2.5 s: soft hiss and one thump per revolution (every 1.8 s at 33⅓), 150 ms fade-in. Synthesised, injected at `S.nodes.wobble`, the same join point scratch audio uses.
2. Spin-down 400 ms, hiss fades out.
3. Existing put-away (~2.0 s): disc slides into the sleeve, sleeve exits.
4. Rest.

- **Desktop:** the overlay stays on an empty slipmat reading "Miziki". Up next says "Nothing queued". Play is replaced by a pick-a-record hint. The player bar clears.
- **Mobile:** the full player slides closed and the mini-player clears.
- **Pure:** instant cut, no groove, same final state.
- Clearing happens only after a record ends or is put away. App start shows the same slipmat but still primes the last-played album into the mini-player (silent `setQueue`, no ceremony).

## 3. Side flip (Vinyl, `S.albumSides` on, side B exists)

2 s groove, about 700 ms lift and turn, label A to B, side B plays. Pure stays gapless, no flip.

## 4. Change records (Vinyl)

| ms | Step |
|---|---|
| 0 to 400 | spin-down with pitch glide |
| 250 to 450 | disc lift |
| 450 to 1050 | disc slides into its sleeve |
| 1050 to 1500 | sleeve exits (left on desktop, down on mobile) |
| from 1200 | new sleeve arrives, **700 ms**, lands at about 1.9 s, then the existing hold and emerge |

The overlap lives in `runStartSequence`'s swap branch (the `returning` await).

## 5. Launch

Replaces the real-art intro (`src/launch/intro.js`).

- About 18 plain records, **fixed count**, flick past with the existing timing: fade 250, accel 650, cruise 800, decel 800, catch 300, pull 600, hand-off crossfade.
- A sleeve reading "Miziki" rises in four from the end, catches with an amber outline, pulls to camera, and cross-fades into the app.
- **No title line.** "ARTIST / LAST PLAYED" is removed.
- Hand-off lands on the empty slipmat with the last-played album primed in the mini-player.
- Record colour follows the resolved appearance: near-black in dark, warm cream in light. Auto follows the device, Nychthemeron follows the time of day, both through the same resolver the rest of the app uses, so the stage never flashes the wrong palette.
- Tap to skip (150 ms fade), reduced-motion and hidden-tab skips, and the `S.launchIntro` toggle are unchanged.
- No album art is loaded, so there is nothing to wait for beyond the existing ready race.

## 6. Custom slipmat

- Settings, Appearance: a Slipmat row with Felt (default) and Custom.
- Pick from the device (file picker or drop). PNG, JPG, WebP, SVG. Circular crop with drag and zoom, an optional "Miziki" wordmark over the image, and a "Dim for legibility" option. Save and Remove.
- **Stays on device.** Stored in IndexedDB, resized to 1024 px, never uploaded and never included in the backup file.
- Saved prefs hold a small flag and the wordmark and dim switches only, not the image.
- **One image for both themes.**
- Shows on the empty platter, and as the ring around a playing record on desktop and in the mobile full player. Spindle and grooves stay on top.
- If the stored image is missing or fails to decode, fall back to felt silently.

## PR plan (one feature per PR)

1. This spec.
2. Vinyl/Pure toggle.
3. Empty platter, run-out groove, change records, side flip, with unit tests for the new pure timing logic.
4. Launch replacement.
5. Custom slipmat.
