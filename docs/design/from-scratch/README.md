# From scratch — design frames

Frames for `docs/25_FROM_SCRATCH.md`. Rendered at 2× from the "Miziki From Scratch" design canvas (Oct 30, 2026), using the app's own bundled fonts (`src/fonts/`). Phone frames are 390×844 CSS px; share cards are drawn at half their export size (1080 → 540).

Placeholder text in square brackets (`[Album title]`) and the sample names (Harbor Lights, Ines Okafor, handles on Home) are stand-ins, not copy to ship.

## The rules, in one place

- **Four voices, one job each.** Archivo: what you read and tap. Antonio: what you look at, two sizes per screen at most. IBM Plex Mono: only on objects (labels, stickers, dead wax, spec lines). Caveat: only on cardboard, tape and paper slips.
- **Sizes:** 12 · 14 · 16 · 20 · 28 · 44 (+64 for hero numbers). Nothing under 12 except text printed on a physical object.
- **Hierarchy from grey, not size.** Sentence case by default; caps tracking 5–10%.
- **Palette:** the sky (the only large field of colour), warm black `#1C1A1F`, paper `#EFE6D2`, one amber ink `#E9A24A`, and the crate secondaries (oxblood, Prussian, verdigris, puce) for sleeves, pressings and awnings — never the chrome.
- **Amber is the label, the sun and the wordmark's rings.** It never marks an active, selected or on state; those are cream and weight.
- **Neutrals are warm:** muted `#ABA298` (dark), `#6B6258` (light).
- **Every on/off is a switch.**
- **Less after dark; nothing counted; plain wording** (docs/23, docs/24).

## Frames

| Frame | What it shows | PR |
|---|---|---|
| `01-now-playing.png` | Full player, dusk | FS5 |
| `01b-now-playing-current.png` | The build before, for comparison | — |
| `02-day-one-rules.png` | Wordmark, voices, sizes, palette, grey hierarchy | FS1, FS4 |
| `03-crate.png` | Crate: header with ···, sort chip, bin with hand-lettered divider, catalog card | FS6 |
| `03b-crate-current.png` | Before | — |
| `04-storefront.png` | Your crate/profile: oxblood awning, last spun, staff picks, recently found | FS7 |
| `04b-storefront-current.png` | Before | — |
| `05-share-now-playing.png` | Now Playing story card | FS8 |
| `05b-share-now-playing-current.png` | Before | — |
| `06-share-record.png` | Record square card | FS8 |
| `06b-share-record-current.png` | Before | — |
| `07-share-season.png` | Season square card: listening ring, verdict, top 3 | FS8 |
| `08-theme-light.png` | Player in the light theme, afternoon | FS1 |
| `09-theme-follow-sun-dawn.png` | Player following the sun, at dawn | FS1 |
| `10-theme-tokens.png` | Dark and light tokens side by side | FS1 |
| `11-after-dark-midnight.png` | Player at solar midnight (dimmed text, 24-hour knob) | FS5 |
| `12-after-dark-home.png` | Home after sunset: now spinning, this morning, caught up | FS9 |
| `13-focus-entry.png` | Player with the Focus pill, before entering | FS10 |
| `13b-focus-button-closeup.png` | Close-up of the bottom row (3×) | FS10 |
| `14-focus-on.png` | Focus on, after the controls fade | FS10 |
| `15-focus-between-sides.png` | Side A over, Flip to side B | FS10 |
| `16-focus-end.png` | Record ended: sleeve held, Play it again / Back to your queue | FS10 |
| `17-library-tools-menu.png` | The library's ··· menu with Library tools | FS11 |
| `18-library-tools-expanded.png` | Library tools grown from the menu, with switches and × | FS3, FS11 |
| `19-sundown-day.png` | Sundown sheet, Day view, at dusk: phase, 24-hour record dial, through the night | FS12 |
| `20-sundown-sound.png` | Sundown sheet, Sound view: Vinyl switch, starting point, through the day, surface noise, fine-tune, EQ | FS5, FS12 |

**Surfaces without a frame** (library lists, artist view, gatefold, edit sheet, records and pressings, friend's crate, settings, sign-in, queue, EQ sheet, share sheet, sleep timer, mini-player, launch intro, desktop, empty states) follow the rules above and the nearest frame; FS13–FS16 list them all.

## Notes for the build

- Frames show the default state; the controls in `14-focus-on` come back on touch (RW5's rule).
- `01` shows Vinyl/Pure absent from the player on purpose: it moves to the Sundown sheet's Sound view (FS5).
- Where a frame and the plan disagree, the plan wins; flag it in the PR.
