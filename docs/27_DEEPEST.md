# 27 — Deepest: a fifth night depth (0.70)

Read CLAUDE.md first. One small feature PR: add a fifth choice, **Deepest**, to Sundown's "How deep the night goes" control. Behavior for every existing choice stays exactly as it is. Pure stays untouched (rate 1.0 at all times).

## 1. Decision

| Choice | Target | Caption (via `formatRateChange`) |
|---|---|---|
| Off | — (Auto off) | Off — full speed, no change at night. |
| Gentle | 0.85 | Gentle — −15.0% ≈ −2¾ semitones |
| Medium (default) | 0.80 | Medium — −20.0% ≈ −3¾ semitones |
| Deep | 0.75 | Deep — −25.0% ≈ −5 semitones |
| **Deepest (new)** | **0.70** | **Deepest — −30.0% ≈ −6¼ semitones** |

- Opt-in only. Medium stays the default; no existing user's setting changes.
- Plain wording, no explanation in the UI beyond the existing caption. The dial preview is how people hear it before choosing.
- Same curve as the other depths: same down-leg, same hold, same recovery starting at solar midnight (RW1, `src/sundown/arc.js`). Only the floor is lower.

## 2. Changes

1. **`src/sundown/solar.js`**
   - `DEPTH_TARGETS` gains `deepest: 0.70`.
   - `DEPTH_LABELS` gains `deepest: 'Deepest'`.
   - **`depthKeyFor()` must recognize 0.70.** Today it checks only Gentle and Deep and treats every other value as Medium. Without a new check, a saved 0.70 would light the **Medium** button and show the Medium caption after a reload while the platter actually runs at 0.70. Add an explicit `deepest` check (same ±0.005 tolerance). Keep the existing fallback: anything unrecognized still reads as Medium.
   - Better: replace the hand-written checks with a loop over `DEPTH_TARGETS` (match within 0.005, else `'medium'`), so a future sixth depth can't hit this same bug. Update the comment above it, which currently names only 0.85/0.75.
2. **`miziki.html`** — add `<button data-depth="deepest" aria-pressed="false">Deepest</button>` after Deep in `.sd-depth-seg`.
3. **`src/styles/25-day-arc-v2.css`** — `.sd-depth-seg` grid goes from `repeat(4, …)` to `repeat(5, …)`.
4. **Comments/docs that say "four buttons" or "three values"** — update `src/wiring/sundown.js` header comment, `src/storage/meta.js` restore-sync comment, and the "Off/Gentle/Medium/Deep" mentions in `docs/12_REFINE.md` / `docs/25_FROM_SCRATCH.md` (add a one-line note pointing here rather than rewriting history).
5. No change needed to the click handler in `src/wiring/sundown.js` or the restore sync in `src/storage/meta.js`; both go through `DEPTH_TARGETS` / `depthKeyFor()` / `depthCaptionFor()`. Confirm that's still true in the current code.

## 3. Things to check (the "be wary" list)

- **Reload round-trip.** Choose Deepest → reload → Deepest is the pressed button and the caption reads Deepest. This is the bug §2.1 exists to prevent.
- **Recovery from a lower floor.** The recovery leg (solar midnight → sunrise, p⁴ easing) now has 0.30 to climb instead of 0.25 at most. Confirm by ear and on the dial that the rise still starts imperceptibly and reaches exactly 1.0 at sunrise, with no audible steps.
- **Any rate floor or clamp elsewhere.** Search for a minimum playback rate (engine, varispeed, scratch/scrub, dial readout) that assumes nothing goes below 0.75. If one exists, lower it to 0.70 rather than silently clamping Deepest.
- **Things tied to the rate:** the dial readout (`formatRate`, trend label "Slowest"), `#trackSpecPhase` in `src/player/clock.js`, the "· 0.80× at its slowest" heading line on the Day view, and surface noise / wow that scale with rate. Each should show or follow 0.70 correctly.
- **Five buttons at phone width.** At about 375 px wide, all five labels fit on one line with ≥44 px tap targets and no truncation. Check desktop too.
- **Pure and Off** still return 1.0 at every hour.

## 4. Tests (`tests/unit/solar.test.js`)

- `depthKeyFor(true, 0.70)` → `'deepest'`.
- The existing "three auto targets" test covers all four: 0.85 gentle, 0.80 medium, 0.75 deep, 0.70 deepest.
- Fallback unchanged: `depthKeyFor(true, 0.9)` → `'medium'`; add `depthKeyFor(true, 0.72)` → `'medium'` (between two depths, not snapped).
- `depthKeyFor(false, 0.70)` → `'off'`.
- `depthCaptionFor('deepest', 0.70)` → `'Deepest — −30.0% ≈ −6¼ semitones'`.
- **Every key in `DEPTH_TARGETS` round-trips:** for each `[key, target]`, `depthKeyFor(true, target) === key`. This is the guard against the next depth being added without a matching check.
- In `tests/unit/arc.test.js`: with `target: 0.70`, the rate holds at 0.70 through the night, recovery begins at solar midnight, reaches 1.0 at sunrise, and adjacent per-minute samples never jump (same continuity epsilon as the existing tests).
- If `tests/unit/meta.test.js` exercises the restore sync, add a saved `target: 0.70, auto: true` case that restores as Deepest.

Lint (0/0) and unit tests pass; both builds preview with no console errors. Open the PR with the preview link at the top. Do not merge.

**Preview focus (Ken, iPhone):** open Sundown → Day, tap Deepest, check the caption, drag the dial through the night and listen to the midnight-to-sunrise rise, then reload and confirm Deepest is still selected.
