# docs/design/colour

Frames exported from the Claude Design canvas "Miziki Colour"
(https://claude.ai/artifact/RWSgZvuwHMRAHDYekG7AyB), referenced by
`docs/37_COLOUR.md`.

| File | Frame |
|---|---|
| `colour-1-principles.png` | Main — Wada's six patterns |
| `colour-2-palette.png` | Palette — tokens vs Wada |
| `colour-3-adams.png` | Adams — what Adams adds |
| `colour-4-pressings.png` | Pressings — re-inked pale partners |
| `colour-5-gatefold.png` | Gatefold — dark anchor |
| `colour-6-spines.png` | Spines — colour toward the book: tested, dropped |
| `colour-7-share.png` | Share — grounds and triads |
| `colour-8-spine-labels.png` | SpineLabels — artist and album on the spine |
| `colour-9-jet.png` | Jet — FLAC and Jet |
| `colour-10-spine-art.png` | SpineArt — a sliver of the cover |

`spine-label.js` in this folder is a **reference implementation** of the
spine-abbreviation rules in `docs/37_COLOUR.md`'s recommendation 6 — not
shipped code. CO5 ports its logic into `src/profile/spine-label.js`, measured
against the real spine budget (canvas `measureText` with the Antonio woff2,
after `document.fonts.ready`), never this file's plain character-count
stand-in.
