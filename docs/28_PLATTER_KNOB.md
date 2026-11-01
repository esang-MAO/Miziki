# 28 — Remove the sun knob from the platter

Read CLAUDE.md first. One small removal PR: take the Sundown sun knob (`#sunKnob`) off the full player's platter. The bottom row's phase pill (`#nowPhasePill`, bottom left) already opens the same Sundown sheet, so the knob is a duplicate way in. Independent of 27_DEEPEST; either can merge first.

**One in, one out:** this PR is the "out." It removes a control and adds nothing. It also fits "less after dark": the platter carries only the record.

## 1. Decision

- Remove `#sunKnob` entirely: markup, styles, paint code, listener. Not hidden, removed.
- The ways into the Sundown sheet become four: the full player's phase pill, the mini-player's sun button (`#miniSunBtn`), the desktop sidebar's Sundown card (`#sidebarSundown`), and Settings › Sundown.
- No other behavior changes. The Sundown sheet, the phase pill, and spin-to-scrub work exactly as before.

## 2. Changes

1. **`miziki.html`** — delete the `<!-- sun knob … -->` comment and the whole `<button class="sun-knob" id="sunKnob">` block (ring SVG, glyph SVG, `#sunKnobTime` span).
2. **`src/shell/sundown-sheet.js`**
   - `wireSundownSheetEntryPoints()`: delete the `#sunKnob` lookup and its click listener.
   - Header comment: "opened from any of five places" → four; drop the sun-knob item. The phase pill's comment ("a fifth way in alongside the four above") becomes a plain description.
3. **`src/player/clock.js`**
   - Stop painting the knob: remove `knob` from the `$('#sunKnob'), miniSun` lookup and its `dataset.phase` line. Keep the `#miniSunBtn` line.
   - Remove the `#sunKnobTime` clock readout block.
   - Update the comment above (it names the knob and "the knob's own time readout").
4. **`src/styles/26-sundown-sheet.css`**
   - The phase-color rules are shared, e.g. `.sun-knob[data-phase="night"], .mini-sun-btn[data-phase="night"]`. Remove only the `.sun-knob…` half of each selector; **keep every `.mini-sun-btn` rule working.**
   - Delete the `.sun-knob`, `.sun-knob-ring`, `.sun-knob-glyph`, `.sun-knob-time` rules and the "where a turntable's speed knob sits" comment.
5. **`src/styles/29-evening-glance.css`** — remove `.player-overlay .sun-knob` and `.player-overlay.eve-glance .sun-knob` from the three selector lists. Leave the remaining selectors and their trailing commas valid (no dangling comma before `{`).
6. **`src/player/scrub.js`** — **keep** the gesture bound to `#platterStage`. It's still needed for the sleeve/shrink-wrap exclusion and the full platter area. Only update the comment that explains the binding in terms of the knob.
7. **`tests/unit/amber-scope.test.js`** — update the header comment's allowlist list (drop `.sun-knob*`) and the phase-pill entry's comment ("a compact stand-in for the dial knob on a row that has no room for the platter's physical one"), since there is no platter knob anymore. No regex change needed; confirm there isn't a `.sun-knob` regex.
8. **Docs:** update `CLAUDE.md` wherever it lists Sundown's ways in, if it does. Add a short note at `docs/19_PLAYER_HTML_NOTES.md#sunknob-platter` saying the knob was removed in this PR, rather than deleting that section's history. Add a `docs/CHANGELOG.md` entry.

## 3. Things to check (the "be wary" list)

- **Nothing left behind.** After the change, `grep -rn "sunKnob\|sun-knob" src tests miziki.html` returns nothing (docs/CHANGELOG history excepted). `clock.js` must not throw on a missing element; the existing `if(knob)` guards make this safe, but remove the lookups anyway.
- **Mini-player sun button still tints by phase.** The shared CSS selectors are the easiest place to break it. Check it at night and at golden hour via the dial preview.
- **Focus mode has no Sundown way in on the full player.** Focus hides `#nowBottomRow` (`03-sleeve-pull.css`), so with the knob gone, nothing on the full player opens Sundown while Focus is on. **Accepted on purpose:** Focus is the minimal posture, and turning Focus off brings the pill back. Note it in the PR description so it reads as deliberate. Desktop still has the sidebar card.
- **Spin-to-scrub at the platter's lower right.** That's where a hand rests; it used to land on the knob. Now it lands on the bare platter. Spinning and scratching from there should feel the same as anywhere else on the disc, and a plain tap there should do nothing.
- **Evening glance.** With the glance view active after dark, controls still fade out as before and no layout jumps where the knob used to be.
- **Desktop layout.** The platter in the desktop full player and side panel looks right with the knob gone, no empty gap.
- **Phase pill** is still visible and tappable at iPhone width and opens the sheet in Day view.

## 4. Tests

- Unit: if any test seeds or asserts `#sunKnob` (fake DOM in `clock`/`sundown-sheet` tests), update it. Add a small test that `wireSundownSheetEntryPoints()` still wires `#nowPhasePill` and `#miniSunBtn` with no `#sunKnob` present.
- The amber-scope test still passes with the knob CSS gone.
- Playwright check (as in earlier PRs): open the full player, confirm no `#sunKnob` in the DOM, tap `#nowPhasePill`, the Sundown sheet opens. Spin from the platter's lower right, the record scrubs.

Lint (0/0) and unit tests pass; both builds preview with no console errors. Open the PR with the preview link at the top. Do not merge.

**Preview focus (Ken, iPhone):** open the full player, confirm the platter is clean, tap the sun/phase word at the bottom left to open Sundown, then spin the record from where the knob used to sit.
