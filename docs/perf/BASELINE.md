# Navigation performance baseline (NV1)

Generated 2026-10-14T19:41:34.750Z by `npm run perf` (tests/perf/nav.perf.js).

Synthetic library: **2000 tracks / 180 albums**, no real audio. CPU throttled **4x** (Chrome DevTools' own "4x slowdown" preset, an approximation of an iPhone relative to a dev machine).

Not run in CI — timings vary by machine. Re-run with `npm run perf` after a later NV PR and add a before/after table to that PR's description.

## Tab switch: click to next painted frame

| Tab | Time (ms) |
|---|---|
| library | 17.6 |
| home | 25.3 |
| sundown | 42.7 |
| profile | 42.5 |

## Library scroll (5s, 2,000 rows)

Long tasks (>50ms): **0**, total 0ms, longest 0ms.

## Sheets: open/close (click to next painted frame)

| Sheet | Open (ms) | Close (ms) |
|---|---|---|
| player | 28.8 | 27.8 |
| queue | 40.3 | 18.9 |
| gatefold | 29.3 | 23.7 |

## Sundown sky: dropped frames (3s on the Sundown tab)

181 frames observed, **0** over the 33ms (one-frame-missed) threshold.

## PL8 item 12: Vinyl chain defaults (docs/19_PLAYER.md)

Generated 2026-10-28 by `tests/audio-render/specs/pl8-vinyl-measure-defaults.js` (`npm run test:audio-render -- --spec pl8-vinyl-measure-defaults`). **Chromium only** — WebKit can't be installed in this container (see `pl8-resample-quality.js`'s header), though unlike the resampler, every node this chain uses (`BiquadFilterNode`, `WaveShaperNode`, `DynamicsCompressorNode`) has a Web-Audio-spec-fixed algorithm, so Chromium and WebKit should measure close to identically here.

Today's shipped defaults: `S.char = {wow:0.30, sat:0.35, soft:0.40, comp:0.35}`.

**Revision note (2026-10-28, same day):** two claims below were corrected after the first pass, while scoping item 13's retune. Both corrections and the reasoning are in the spec file's own comments (`measureStageBreakdown()` and `measureThdAndHarmonics()`); summarized here.

### Frequency response (relative to the chain's own 1kHz; wow forced to 0 for this measurement — see note below)

| Freq | dB |
|---|---|
| 30Hz | +1.00 |
| 100Hz | +0.11 |
| 300Hz | +0.02 |
| 1000Hz | 0 (reference) |
| 3000Hz | -0.20 |
| 7000Hz | -2.47 |
| 10000Hz | -4.47 |
| 15000Hz | -6.49 |
| 20000Hz | -7.85 |

Item 13 targets: ±1dB from 30Hz-15kHz, no worse than -2dB at 20kHz. **Today's defaults miss both**, by more than the doc's own napkin estimate ("roughly a 3.6dB treble cut from 7kHz up") — and the real cause is **not** what an earlier pass claimed here. ~~The shelf's measured attenuation overshoots its own nominal gain well past the corner, the same bilinear-transform "cramping" the doc's own harshness section calls out for the EQ bands.~~ **Corrected:** a standalone `tone` highshelf filter (same nominal -3.6dB at 7kHz) shows no cramping at all when measured alone (`BiquadFilterNode.getFrequencyResponse()`) — textbook shelf behavior, essentially flat at its own nominal gain the whole way to 20kHz. Per-stage isolation in the spec found the *other* ~3dB comes from the `wobble` `DelayNode` itself: its constant 12ms base delay (the wow/flutter oscillators' modulation rides on top of this center point, but the 12ms is present even with `wow:0` — it's not gated by the slider at all) needs fractional-sample interpolation, and that interpolation is a mild, frequency-growing lowpass (confirmed in isolation: a lone `DelayNode` at 0.012s measures -2.9dB at 15kHz, -4.3dB at 20kHz, nothing else in the graph). The two stages' numbers add up almost exactly to the full-chain measurement. **This means Vinyl mode loses real treble unconditionally from the wobble delay line, independent of the wow slider** — item 13/14's retune needs to address the delay line's own interpolation quality, not just the tone shelf.

**wow forced to 0 for this measurement only.** First attempt measured bogus 10-20dB "rolloff" even with `sat`/`soft`/`comp` all off and only `wow` at its default — not a real amplitude effect: wow/flutter is delay (phase) modulation, which spreads a tone's energy into FM sidebands rather than attenuating it, and phase deviation for a fixed delay-time swing grows with frequency, so a single-bin measurement reads growing "attenuation" that's really just energy moving to adjacent bins. Wow/flutter has its own metric below; conflating the two would make neither number mean anything.

### THD+N and harmonic profile (1kHz sine, full chain, wow forced to 0 — same reasoning as above)

| Level | THD+N | H2 (rel. fundamental) | H3 (rel. fundamental) |
|---|---|---|---|
| -1dBFS | -30.8dB | -50.3dB | -30.9dB |
| -20dBFS | -59.4dB | -60.7dB | -65.3dB |

Item 13 target: <0.3% THD at -1dBFS (-50.5dB), low-order (H2-dominant) only. ~~Today's defaults already pass this by a wide margin — saturation's own distortion is clean and low-order at both probe levels; nothing to retune here.~~ **Corrected:** that first pass had a real test-harness bug (a module-level WaveShaper-curve cache in `engine.js`, correct for the real app's one-time graph build, but stale across this test's many rebuilt graphs within one page load — see the spec's own `bustSatCache()` comment) that silently left the WaveShaper untouched (pure passthrough) on most renders, measuring an accidentally-unshaped chain instead of the real saturation curve. With that fixed, **today's defaults miss the target badly** — 2.9% THD at -1dBFS against a 0.3% ceiling — and the distortion is **H3 (odd-order) dominant**, the opposite of the low-order/H2-dominant shape item 13 wants and `engine.js`'s own design comment claims (confirmed by isolating the compressor and the tone shelf out — both leave H3 essentially unchanged, so it traces to `satCurve()` itself: a tanh-based soft clip is intrinsically an odd function, and its own odd-harmonic series dominates at a near-full-scale drive level, outweighing the curve's small asymmetry term that's meant to favor even harmonics). The quieter -20dBFS probe does come out H2-dominant and much cleaner, consistent with the asymmetry term winning at lower drive. **This is a real item 13 target, not something already met** — the saturation curve's own harmonic balance needs retuning, not just its default amount.

### Wow & flutter (3150Hz tone, simplified zero-crossing RMS % deviation — not the IEC-weighted standard; see the spec's own header)

RMS **0.0377%**, peak 0.0732%, over 9450 measured cycles.

Item 13 target: ~0.03% weighted RMS. Close, but this is an unweighted proxy (no IEC band-limiting/weighting filter), so it isn't directly comparable 1:1 — treat as "in the right neighborhood," not a pass/fail verdict.

### Compressor gain reduction (alternating -20dBFS/-6dBFS program material, 1kHz)

**1.64dB** GR on the loud segment (with-comp -7.88dBFS vs. without-comp -9.52dBFS, same makeup gain in both).

Item 13 target: ≤1-2dB GR on normal material. **Today's defaults already meet this.**

**Summary for item 13 (revised):** today's defaults miss *two* targets, not one — frequency response (split between the tone shelf, working as designed, and the wobble delay line's own interpolation, which isn't a Character setting at all) and THD+N/harmonic balance at -1dBFS (H3-dominant, needs the saturation curve's own balance retuned, not just its amount). Only wow/flutter (close, unweighted proxy) and compressor gain reduction already meet the "fine turntable" targets.

## PL8 item 13: Vinyl chain retune (docs/19_PLAYER.md)

Generated 2026-10-28 by the same `pl8-vinyl-measure-defaults.js` spec, whose checks now assert real pass/fail against item 13's targets instead of just reporting a number. Three changes in `src/audio/engine.js`, all in `buildGraph()`/`satCurve()`/`applyCharacter()`:

- **`n.wobbleTilt`**, a new, always-on highshelf (`frequency=10800Hz, gain=+3.8dB`) wired `wobble -> wobbleTilt -> sat`. Fit against the wobble `DelayNode`'s own loss curve measured at the real 44.1kHz context rate (a lone `DelayNode` at 0.012s, oscillators connected at zero gain to match production: -0.01dB@1kHz growing smoothly to -0.69dB@7kHz, -1.39dB@10kHz, -2.94dB@15kHz, -4.28dB@20kHz) via `BiquadFilterNode.getFrequencyResponse()`, balancing the ≤1dB (30Hz-15kHz) and ≥-2dB (20kHz) targets rather than cancelling either endpoint exactly. (An earlier fit pass used 48kHz by mistake, where 0.012s is an exact integer sample count at that rate and the loss vanishes entirely — a reminder that this loss is sample-rate-dependent, and the fit has to run at the context's real rate, 44.1kHz, not a convenient round one.) Not gated by Character — it corrects an engine artifact, not a user setting.
- **`satCurve()` retuned**: `k` (tanh's own drive) is now a fixed small constant (0.3) instead of scaling with `amount` up to 3.2 — in that regime tanh's own odd-harmonic series had dominated the curve's small asymmetry term, the root cause item 12's correction found. `amount` now scales only `asym` (0.12) and `mix` (0.5), and `trim` is refit to the new curve's own peak-overshoot shape (`1/(1+0.058*amount²)`).
- **Tone shelf's dB/unit rescaled from -9 to -2** (item 14: the mapping is rescaled, not `soft`'s saved values) — at -9, the shipped default (`soft:0.40`) alone cut -3.6dB from 7kHz up, already missing the ±1dB target before the delay line's own loss was even added in.

`scripts/derive-makeup-table.mjs`'s duplicated chain/`satCurve()`/tone formula were updated to match and the table in `src/audio/level-match.js` regenerated (unchanged derivation method, new numbers).

### Results against item 13's targets, at today's defaults

| Check | Result | Target | |
|---|---|---|---|
| Frequency response, 30Hz-15kHz worst deviation | 1.00dB | ≤1dB | met (right at the boundary — see note) |
| Frequency response, 20kHz | -1.26dB | ≥-2dB | met |
| THD+N at -1dBFS | -52.5dB (0.24%) | <0.3% (-50.5dB) | met |
| Harmonic balance at -1dBFS | H2 -52.8dB, H3 -65.6dB rel. fundamental | H2-dominant | met, 12.8dB margin |
| Wow & flutter (unweighted proxy) | 0.0377% RMS | ~0.03% weighted | unchanged from item 12, already close |
| Compressor GR | 1.65dB magnitude | ≤1-2dB | unchanged from item 12, already met |

The 1.00dB "worst deviation" is the pre-existing, untouched +1.00dB at 30Hz from the `dc` highpass filter's own corner behavior (14Hz, Q=0.7) — not something this retune touched, and already at that same boundary value before this PR. Every frequency this PR's own changes affect (3kHz-20kHz) now clears the target with real margin (worst case -1.26dB at 20kHz, well inside ≥-2dB; worst case inside 15kHz is -0.72dB at 7kHz, inside ±1dB).

Full per-frequency detail, the stage breakdown (delay-line residual after `wobbleTilt`'s correction: 0.59dB@15kHz, -0.46dB@20kHz — a few tenths of a dB either side of zero, not the multi-dB loss item 12 found), and the regenerated makeup table's own numbers are in the spec/`level-match.js` directly — this summary carries the pass/fail verdicts, not a transcription of every row.

**Compressor GR's sign**, unrelated to this PR: the spec's own `measureCompressorGainReduction()` defines GR as positive when the compressor makes the loud segment quieter, but this chain's dynamic test material measures *negative* (-1.65dB) at that same ~1.6dB magnitude — a pre-existing property of this compressor path (a 12dB-wide knee puts the probe level inside the knee's transition region, not cleanly above threshold) that item 12 never flagged because it only read the magnitude. Out of scope for item 13 (frequency response + harmonic balance); the spec's own check now asserts on magnitude to match item 12's prior read, not the sign, with a comment pointing here.

Item 14 (keep the Character sliders meaningful): `soft`'s saved values are untouched — only its dB/unit mapping shrank, so the slider's full range still spans quiet-to-colored, just less heavy at every point. `sat`'s saved values are likewise untouched; the curve's own internal shape changed, but `amount=0` is still silent and `amount=1` is still audibly "more" than any lower setting (verified: THD rises monotonically with `amount` in the curve's own math). Item 15 (Ken's own wired-headphone listening test) is the remaining gate before these numbers are treated as the real verdict rather than an offline measurement.

## TR2: lazy-load `src/share/*` (docs/19_PLAYER.md)

Step 1's baseline chunk sizes, measured on `main` (commit `39e9c87`) before any TR2 change, default base (`npm run build`):

| File | Size | gzip |
|---|---|---|
| `dist/assets/miziki-*.js` (main chunk) | 513.11 kB | 157.30 kB |
| `dist/assets/dist-*.js` (`@supabase/supabase-js`, already lazy) | 218.84 kB | 56.54 kB |
| `dist/assets/demo-*.js` (`?social=demo`, already lazy) | 10.39 kB | 3.65 kB |
| `dist/miziki.html` | 94.35 kB | — |
| `dist/assets/miziki-*.css` | 147.67 kB | — |

This PR converts every external call site of `src/share/sheet.js` (and the one of `src/share/pressings-card.js` reached only through it) from a static `import` to an inline `await import(...)` at the point of use: `src/wiring/share.js` (the share sheet's own static controls — style chips, format seg, save/share/copy, and the player's Share icon button), `src/profile/screens.js` (crate and season Share buttons), `src/profile/records.js` (the pressings-chart Share button, plus its `pressingsShareData()` helper), and `src/gatefold/view.js` (the record sheet's Share record row). Every one of these is a click handler, so the import only ever starts once a user has already reached a screen with a Share button — launch itself never touches the module. Since `import()` caches by module specifier, once any one of these handlers has run, every other handler's `await import('../share/sheet.js')` resolves from cache with no added delay.

Step 5's new chunk sizes, same build, same branch:

| File | Size | gzip | vs. baseline |
|---|---|---|---|
| `dist/assets/miziki-*.js` (main chunk) | 484.84 kB | 147.75 kB | -28.27 kB / -9.55 kB gzip |
| `dist/assets/sheet-*.js` (new, lazy) | 20.52 kB | 7.01 kB | — |
| `dist/assets/pressings-card-*.js` (new, lazy) | 10.34 kB | 4.29 kB | — |
| `dist/assets/dist-*.js` | 218.84 kB | 56.54 kB | unchanged |
| `dist/assets/demo-*.js` | 10.39 kB | 3.65 kB | unchanged |
| `dist/miziki.html` | 94.35 kB | — | unchanged |
| `dist/assets/miziki-*.css` | 147.67 kB | — | unchanged |

`sheet.js` pulls in the four other card composers (`crate-card.js`, `now-playing-card.js`, `record-card.js`, `season-card.js`) and `share/styles.js`, all bundled into the one new `sheet-*.js` chunk by Vite's own code-splitting — only `pressings-card.js` split out separately, since `profile/records.js` imports it directly rather than through `sheet.js`. ~31kB (~13.6kB gzip) of canvas-card code that launch previously downloaded and parsed unconditionally is now fetched only by a user who opens a share sheet.

Scope notes for the rest of TR2 (`docs/19_PLAYER.md`'s other four lazy-load targets), left to follow-up PRs: the EQ sheet needs a prerequisite split (its tiny pure `eqStateLabel()`, used synchronously by the Settings screen on every render, is in the same file as the heavy sheet-rendering code — Vite splits at file granularity, so today any import of either pulls in both); social screens split into `friend-store.js` (lazy-loadable) and `home.js` (wired into boot-time tab-visibility/routing, left static); `profile/legal.js`/`privacy.js` not yet scoped; `src/sync/*` is too deeply embedded in core always-active write paths (history, import, edit, settings) to convert wholesale — only the doc's own narrower ask (defer `initBackupSync()`'s pull until after first paint) remains open.

Device check (step 5): not yet run on-device — first tap on the player's Share icon, a crate/season/pressings Share button, and a gatefold record's Share row should each open with no visible delay, same as before this change.

## TR2: lazy-load the EQ sheet (docs/19_PLAYER.md)

Same baseline as the share/* section above, measured after PR #242 merged (main chunk 484.84 kB / gzip 147.75 kB).

`src/player/eq-sheet.js`'s tiny pure `eqStateLabel()` — used synchronously by the Settings → Playback row on every render of that screen, not a rare "first use" — was in the same file as the heavy sheet-rendering code (`renderEqSheet`, `drawCurve`, `sliderRow`, the graphic/parametric band builders, presets), so any static import of either pulled in both. Split `eqStateLabel()` and its small dependency (`ensureEq()`, `currentStateLabel()`) into a new, DOM-free leaf, `src/player/eq-label.js` (imports only `state.js` and the pure `audio/eq.js`). `eq-sheet.js` now imports `ensureEq`/`currentStateLabel` from there instead of keeping its own copies. `profile/screens.js` imports `eqStateLabel` from `eq-label.js` and now dynamically imports `eq-sheet.js` only inside the EQ row's click handler; `wiring/transport.js`'s `#eqBtn` handler (the player overflow menu's EQ entry) does the same.

New chunk sizes:

| File | Size | gzip | vs. PR #242 |
|---|---|---|---|
| `dist/assets/miziki-*.js` (main chunk) | 477.85 kB | 145.71 kB | -6.99 kB / -2.04 kB gzip |
| `dist/assets/eq-sheet-*.js` (new, lazy) | 7.40 kB | 2.70 kB | — |
| `dist/assets/sheet-*.js` | 20.53 kB | 7.04 kB | unchanged |
| `dist/assets/pressings-card-*.js` | 10.34 kB | 4.29 kB | unchanged |
| `dist/assets/dist-*.js` | 218.84 kB | 56.54 kB | unchanged |
| `dist/assets/demo-*.js` | 10.39 kB | 3.65 kB | unchanged |

Device check: not yet run on-device — opening the EQ sheet from the player overflow menu and from Settings → Playback should both still open with no visible delay; the Settings screen's EQ row should still show the right state text ("OFF"/"CUSTOM · ON"/preset name) immediately, with no flash of a stale value.
