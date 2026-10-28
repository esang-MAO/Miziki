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

### Frequency response (relative to the chain's own 1kHz; wow forced to 0 for this measurement — see note below)

| Freq | dB |
|---|---|
| 30Hz | +1.49 |
| 100Hz | +0.11 |
| 300Hz | +0.02 |
| 1000Hz | 0 (reference) |
| 3000Hz | -0.20 |
| 7000Hz | -2.47 |
| 10000Hz | -4.47 |
| 15000Hz | -6.49 |
| 20000Hz | -7.86 |

Item 13 targets: ±1dB from 30Hz-15kHz, no worse than -2dB at 20kHz. **Today's defaults miss both** — and by more than the doc's own napkin estimate ("roughly a 3.6dB treble cut from 7kHz up"): isolating each stage found the entire shape traces to the `tone` highshelf alone (nominally -3.6dB at 7kHz, Q defaults to 1); `sat`/`comp` contribute negligibly at this quiet probe level. The shelf's *measured* attenuation (-6.49dB at 15kHz, -7.86dB at 20kHz) overshoots its own nominal -3.6dB target well past the corner frequency — the same bilinear-transform "cramping" near Nyquist the doc's own harshness section (item 3) already calls out for the EQ bands, here affecting the Vinyl tone shelf instead. Worth factoring into item 13's retune (a higher shelf frequency and/or a smaller nominal gain may be needed to land inside the target band, given the shelf itself runs hotter than its number suggests).

**wow forced to 0 for this measurement only.** First attempt measured bogus 10-20dB "rolloff" even with `sat`/`soft`/`comp` all off and only `wow` at its default — not a real amplitude effect: wow/flutter is delay (phase) modulation, which spreads a tone's energy into FM sidebands rather than attenuating it, and phase deviation for a fixed delay-time swing grows with frequency, so a single-bin measurement reads growing "attenuation" that's really just energy moving to adjacent bins. Wow/flutter has its own metric below; conflating the two would make neither number mean anything.

### THD+N and harmonic profile (1kHz sine, full chain, wow forced to 0 — same reasoning as above)

| Level | THD+N | H2 (rel. fundamental) | H3 (rel. fundamental) |
|---|---|---|---|
| -1dBFS | -68.0dB | -117.4dB | -110.6dB |
| -20dBFS | -73.5dB | -154.3dB | -163.9dB |

Item 13 target: <0.3% THD at -1dBFS (-50.5dB), low-order (H2-dominant) only. **Today's defaults already pass this by a wide margin** — saturation's own distortion is clean and low-order at both probe levels; nothing to retune here.

### Wow & flutter (3150Hz tone, simplified zero-crossing RMS % deviation — not the IEC-weighted standard; see the spec's own header)

RMS **0.0377%**, peak 0.0731%, over 9450 measured cycles.

Item 13 target: ~0.03% weighted RMS. Close, but this is an unweighted proxy (no IEC band-limiting/weighting filter), so it isn't directly comparable 1:1 — treat as "in the right neighborhood," not a pass/fail verdict.

### Compressor gain reduction (alternating -20dBFS/-6dBFS program material, 1kHz)

**1.64dB** GR on the loud segment (with-comp -8.05dBFS vs. without-comp -9.70dBFS, same makeup gain in both).

Item 13 target: ≤1-2dB GR on normal material. **Today's defaults already meet this.**

**Summary for item 13:** the frequency response is the one target today's defaults clearly miss, and by more than expected once biquad cramping near Nyquist is accounted for. THD+N, harmonic profile, and compressor behavior already meet or come close to the "fine turntable" targets at today's defaults — the retune's main job is the treble shelf.
