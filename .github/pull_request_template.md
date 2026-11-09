## Summary

<!-- What changed and why. -->

## Removes

<!-- CLAUDE.md's "one in, one out" rule: what this feature retires or
     simplifies, or why nothing goes. -->

## Checklist

- [ ] **Rule 9 (iOS audio gesture) untouched** — if this PR touches `play()`/`startSource()`/`transport.js`/`background.js`: no `await` added, removed or reordered; no synchronous function made `async` or the reverse; `S.gen` and `onended` logic unchanged; encoder delay/padding handling unchanged. (Check "N/A" in the box below if this PR doesn't touch that path.)
- [ ] **New saved keys** — any new `S.*` field this PR persists is in both `serializePrefs` and `parsePrefs`, has a default in `S`, has a round-trip test in `tests/unit/prefs.test.js`, and has a row in CLAUDE.md's backup key-inventory table (backed up / device-only / excluded).
- [ ] **No tag text into `innerHTML`** — any new DOM built from a track's own metadata (title/artist/album) uses `textContent`/`createElement`, never `innerHTML`/`outerHTML`/`insertAdjacentHTML` with anything but a static markup literal.
- [ ] **One in, one out** — the Removes section above says what this feature retires, or why nothing does.
- [ ] **After-sunset behavior checked** — if this PR adds anything visible on the gatefold/full player: confirmed it either already hides after sunset (GF11) the same way the wear/format lines do, or there's a reason it shouldn't.
- [ ] **Diff size** — under ~400 lines excluding tests, or the Summary above says why not.

## Test plan

<!-- lint / unit tests / builds / preview focus, as CLAUDE.md's "Plan docs" section describes. -->
