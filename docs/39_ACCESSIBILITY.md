# 39 · Accessibility

Findings from an accessibility read of the repo as of `00b28e0` (Nov 24, after PR #498), measured against WCAG 2.2 AA, the bar App Store review and most audits use. This plan comes after plan 38's BD15, which gave every icon-only button a label and checked the gesture routes. It covers what BD15 left: how sheets, the player and form fields are named and announced, plus colour and focus.

The feature freeze holds. Sighted touch users see no change except slightly deeper muted text in light theme and switches that are easier to read when off. Everything else is for VoiceOver, keyboard and reduced-motion users.

The steps are a sequence, not a schedule. Each is finished before the next starts.

---

## What the read confirmed is already right (no work)

| Finding | Where Miziki already does it |
|---|---|
| Pinch-zoom is not blocked; the page language is set | `miziki.html:2, 5` |
| Opening a sheet makes the background inert, moves focus in, restores it on close, and handles Escape | `src/shell/nav-stack.js` |
| Icon-only buttons are labelled and a test keeps them that way | BD15; `tests/unit/icon-button-labels.test.js` |
| On/off controls are real switches (`role="switch"`, `aria-checked`) | `src/ui/switch.js`, `miziki.html` |
| The 24-hour dial is a keyboard-usable slider with a spoken value | `src/sundown/dial-view.js`, `src/sundown/dial-gesture.js` |
| Spin-to-scrub has a plain alternative | `#scrub` and `#barScrub` range inputs |
| Reduced motion is respected across ~40 files, including the platter spin | `src/util/motion.js` `REDUCED`; `src/player/clock.js:169` |
| Body text contrast is well above the minimum | `--paper` is 11–16:1 on every sky in both themes |
| The crate announces section changes | `#crateLive`, `src/crate/view.js:676` |

---

## What the read found (the reasons for each step)

| # | Finding | Evidence | Step |
|---|---|---|---|
| 1 | 23 of 26 sheets/overlays are not marked as dialogs, so VoiceOver doesn't know a sheet opened or what it is | `id="…Overlay"` elements in `miziki.html` with no `role="dialog"` | AC1 |
| 2 | The gatefold, sealed front and picture sleeve are dialogs with `aria-label=""` that nothing ever fills | `miziki.html:1720, 1946, 1969`; no setter in `src/gatefold/` | AC1 |
| 3 | Both seek sliders announce a number out of 1000, not a time | `#scrub` (`miziki.html:1149`), `#barScrub` (`:511`); no `aria-valuetext` outside `src/sundown/` | AC2 |
| 4 | A new track starting is silent to VoiceOver | Only `pull-refresh.js` and `crate/view.js` have live regions | AC2 |
| 5 | The edit sheet's seven fields and the liner-notes box have visible labels that aren't attached to them | `miziki.html:1259–1283` (`<span>` beside `<input>`), `:1858` | AC3 |
| 6 | Some secondary text is just under 4.5:1 | Light theme on `--sky3` `#E0D8C7`: `--muted` 4.22, `--muted-2` 3.93, `--accent-text` 4.52. Dark theme on `--sky1` `#1D2F38`: `--muted-2` 4.47 | AC4 |
| 7 | Switch tracks in the off state and focus rings are under the 3:1 that control edges need | `--switch-off-track` 1.58:1 dark, 1.31:1 light; `--ring` 2.52:1 dark, 2.16:1 light | AC4 |
| 8 | The crate stage takes arrow keys but its focus outline is removed with nothing in its place | `src/styles/10-crate.css:120` (`outline:none`), `src/crate/view.js:1612` | AC5 |
| 9 | Reduced motion is read once at load, so changing the iOS setting needs a relaunch | `src/util/motion.js:5` | AC5 |
| 10 | Text at 4–8px (dead wax, label arc, seal strip) needs to be hidden from screen readers or say something available elsewhere | `src/styles/02-stage-platter.css:216, 313–317`; `12-sealed-records.css:52`; `10-crate.css:350` | AC6 |

---

## Decisions (Ken, answered 2026-11-24)

1. **Colour nudges.** Change the four tokens to the nearest shade that passes (AC4): light `--muted` `#6B6258 → #655C53`, light `--muted-2` `#5E6A70 → #555F65`, light `--accent-text`/`--amber-shade` `#9A4700 → #984600`, dark `--muted-2` `#9A9187 → #9D948B`. Each keeps its hue; the change is under 3% lightness. **Yes.**
2. **Off switches.** Either give the off track a 1px edge at 3:1 (the fill stays as it is) or deepen the fill itself (alpha .39 dark, .52 light). **The edge**, since it leaves the look nearly untouched.
3. **"Now playing" announcement.** Announce once per new track, politely, as "[track] by [artist]". Never announce seeks, Sundown rate changes or side flips. VoiceOver only; nothing changes with VoiceOver off. **Yes.**
4. **Sundown after dark.** The announcement still happens after sunset. "Less after dark" is about what's shown, and an announcement shows nothing. **Yes.**

---

## Order

AC1 → AC2 → AC3 → AC4 → AC5 → AC6 → Ken check K1.

---

## AC1: every sheet is a named dialog (UI: none)

> Read `miziki.html` (every `…Overlay`, `…SheetBox`, `#gatefold`, `#sealedFront`, `#pictureSleeve`), `src/shell/nav-stack.js`, and `src/gatefold/view.js`, `sealed-front.js`, `picture-sleeve.js` first.
>
> 1. Every sheet's box (the element focus moves into, not the scrim) gets `role="dialog"`, `aria-modal="true"`, and a name: `aria-labelledby` pointing at its existing heading where one exists, otherwise a plain `aria-label` ("Queue", "Equalizer", "Sleep timer", …). Scrims stay unnamed and `aria-hidden`.
> 2. The gatefold, sealed front and picture sleeve set `aria-label` to "[album] by [artist]" each time they open, and clear it on close.
> 3. Extend `tests/unit/icon-button-labels.test.js` (or a sibling test) so it fails on any element with `role="dialog"` that has neither a non-empty `aria-label` nor an `aria-labelledby` resolving to an element with text. The three dynamic dialogs are exempt only through a named allow-list that also checks their setter exists.
>
> Lint/tests/previews as usual. Open the PR. Do not merge.

**Preview focus (iPhone, VoiceOver on):** open the queue, EQ and a record's gatefold. Each should be announced by name when it opens.

**Removes:** nothing.

---

## AC2: the player speaks (UI: none)

> Read `src/player/clock.js` (where the scrub values are mirrored), `src/player/transport.js` (`load`), `src/shell/mini-player.js`, and `src/util/text.js` (time formatting) first. Rule 9 applies: nothing here may sit on the iOS gesture path or delay `startSource`.
>
> 1. `#scrub` and `#barScrub` get `aria-valuetext` of "1:23 of 4:05", updated at most once a second, not every frame.
> 2. Add one visually hidden `aria-live="polite"` region (reuse the `sr-only` class `#crateLive` uses). When a different track starts, it says "[track] by [artist]" once. It says nothing for seeks, pause/resume, Sundown rate changes, side flips or run-out.
> 3. A unit test for the pure formatter and for the "same track → no announcement" rule.
>
> Lint/tests/previews as usual. Open the PR. Do not merge.

**Preview focus (iPhone, VoiceOver on):** play a record through a track change. Swipe to the seek bar and hear the time.

**Removes:** nothing.

---

## AC3: edit fields are labelled (UI: none)

> Read `miziki.html:1250–1290` and `:1850–1862` first.
>
> 1. Turn each `<div class="slider-head"><span>Title</span></div>` + `<input>` pair into a real label: either make the `<span>` a `<label for="editTitle">` or give the input `aria-labelledby` pointing at a span id. Keep the markup that `16-edit-sheet.css` targets working; no visual change.
> 2. `#linerEditText` gets `aria-label="Liner notes"`. The placeholder is not a label.
> 3. The test from AC1 also fails on any visible `<input>`, `<select>` or `<textarea>` with no accessible name (hidden and file inputs excepted).
>
> Lint/tests/previews as usual. Open the PR. Do not merge.

**Removes:** nothing.

---

## AC4: colour clears the minimums (UI: muted text and off switches only)

> Read `src/styles/00-base.css` (tokens), `src/styles/22-theme.css` (light and Nychthemeron overrides, both copies), `src/styles/31-switch.css` and `docs/37_COLOUR.md` first. Plan 37's rules stand; this only moves four tokens to the nearest passing shade.
>
> 1. Apply decision 1's four values everywhere each token is defined (base, light, the media-query copy, Nychthemeron).
> 2. Apply decision 2: a 1px off-state edge on the switch track at ≥3:1 against `--sky1`/`--sky3` in both themes. The on state is unchanged.
> 3. Raise `--ring` alpha so focus rings reach 3:1 on the lightest dark sky and the darkest light sky.
> 4. Add `scripts/contrast.mjs` (or a unit test) that computes WCAG ratios for every text token against `--sky1`, `--sky3` and `--popover` in both themes, plus switch-off and ring at 3:1, and fails under the minimum. Report Nychthemeron's darkest and lightest phase too.
>
> Lint/tests/previews as usual. Before/after screenshots, light and dark, of the library, gatefold and Settings. Open the PR. Do not merge.

**Removes:** nothing.

---

## AC5: focus you can see; motion that follows the setting (UI: keyboard only)

> Read `src/styles/10-crate.css:115–125`, `src/crate/view.js` around the stage `keydown`, and `src/util/motion.js` with its importers first.
>
> 1. `.crate-stage:focus-visible` gets the same ring the rest of the app uses. Keep `outline:none` for non-keyboard focus.
> 2. `REDUCED` becomes live: keep the export name, back it with the media query's current `.matches`, and add a `change` listener so the platter spin, intro and ceremonies follow the setting without a relaunch. Modules that read it only once at start-up are listed in the PR; change only those that matter after start-up.
>
> Lint/tests/previews as usual. Open the PR. Do not merge.

**Removes:** nothing.

---

## AC6: tiny text is decoration or it is said elsewhere (UI: none)

> For each of `.label-arc`, `.dead-wax` (all three texts), `.seal-strip-text` and the 8px crate text at `10-crate.css:350`: if it is decorative or repeats something already announced, mark its container `aria-hidden="true"`. If it carries something only it says (the seal strip, for example), give the nearest control or the dialog name that information instead. List each element and the choice made in the PR. Sizes stay as they are; these are art.
>
> Lint/tests/previews as usual. Open the PR. Do not merge.

**Removes:** nothing.

---

## Ken check K1: a VoiceOver pass on the iPhone

After AC6 merges, with VoiceOver on (Settings › Accessibility › VoiceOver, or triple-click the side button if the shortcut is set):

1. Add a folder of music.
2. Open a sealed record, peel it, open the gatefold, turn it over, close it.
3. Play, pause, move the seek bar, and let a track change.
4. Open the queue, EQ, Sundown and Settings, and close each.
5. Turn a switch on and off.

Note anything that is silent, mislabelled or unreachable. Whatever turns up becomes its own small plan. A code read can't catch everything a real pass will.
