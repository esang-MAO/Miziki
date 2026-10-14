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
