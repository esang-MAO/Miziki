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
