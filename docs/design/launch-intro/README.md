# Launch intro: design handoff

The frames behind the launch-intro rework (see `docs/CHANGELOG.md`, "Launch intro: a dig through your crate"). Same format as `docs/design/crate/`: the `.dc.html` files are the design canvas's source ("Miziki Launch Intro") and won't render opened directly in a browser. Flat colour squares stand in for album covers.

| Artboard | File |
|---|---|
| 1 · Settle, 0–250 ms | `Main.dc.html` |
| 2 · Flick, 250–2500 ms | `Flick.dc.html` |
| 3 · Catch, 2500–2800 ms (lift, haptic tick) | `Catch.dc.html` |
| 4 · Pull, 2800–3400 ms (pressing peek) | `Pull.dc.html` |
| 5 · Hand-off, 3400–4000 ms | `Handoff.dc.html` |
| Today, for comparison | `Today.dc.html` |
| Catch, empty library, light theme | `CatchLight.dc.html` |
| Empty, small and full libraries; the peek per pressing | `LibraryStates.dc.html` |
| The same peek on the crate's pull-up | `CratePull.dc.html` |

Decided: the floating wordmark stays; no divider in the stack; clean sleeves (CR3 anatomy, no wear); the catch is a lift plus a haptic tick, never an amber outline; the stack lands on the last-played album; the sky follows the time of day from the first frame. Timing, tap-to-skip, reduced motion and the Off setting are unchanged from CEREMONY §5.
