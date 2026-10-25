# Audio: design handoff

The mockups behind **`docs/16_AUDIO.md`** (AU1–AU12). Put this folder in the repo at **`docs/design/audio/`**, beside `docs/design/crate/` and `docs/design/refine/`.

The `.dc.html` files are the design canvas's source ("Miziki Audio"). They need the canvas runtime and **won't render correctly opened directly in a browser**; read them as text. The PNGs in `png/` are 2× renders of each artboard. **Build with Miziki's real CSS and components (`src/styles/`, `src/player/`, `src/crate/`, `src/gatefold/`, `src/profile/`), not by copying this markup.** The tokens below are the part to copy exactly.

| Artboard | File | PNG | Used by |
|---|---|---|---|
| A 7″ single at 45 on the platter | `Main.dc.html` | `png/01-Main.png` | AU9, AU10 |
| Three formats; dead wax shows the length; sides by time | `Formats.dc.html` | `png/02-Formats.png` | AU9, AU10 |
| The speed change, 33⅓ to 45 | `SpeedChange.dc.html` | `png/03-SpeedChange.png` | AU10 |
| The 45s section in the crate | `Crate45.dc.html` | `png/04-Crate45.png` | AU10 |
| Liner notes: format, sides, the master | `LinerNotes.dc.html` | `png/05-LinerNotes.png` | AU5, AU9 |
| Speed override in the edit sheet | `EditSpeed.dc.html` | `png/06-EditSpeed.png` | AU9 |
| Hook preview from the hold card | `HoldPreview.dc.html` | `png/07-HoldPreview.png` | AU12 |
| EQ: tilt, 10 bands, true curve | `EQGraphic.dc.html` | `png/08-EQGraphic.png` | AU6 |
| EQ: parametric bands | `EQParametric.dc.html` | `png/09-EQParametric.png` | AU6 |
| Settings › Playback | `Playback.dc.html` | `png/10-Playback.png` | AU5, AU7 |
| Queue | `Queue.dc.html` | `png/11-Queue.png` | AU8 |
| Picking up where you left off | `Resume.dc.html` | `png/12-Resume.png` | AU1 |

Phone artboards are 390 × 844 on the golden-hour sky (`#352A24 → #1A1310 62% → #0D0B10`) with the three-tab bar from RF26; sheets sit on `#1E1714`. Cover art is a flat placeholder colour; `[Album title]`-style brackets are placeholders. Fonts are the bundled Antonio (display), Archivo (body) and IBM Plex Mono (labels).

---

## Records and the platter (AU9, AU10)

- **Sizes.** A 7″ is **58%** of the 12″ diameter (7/12). On the phone platter: slipmat 340 px, 7″ disc 198 px. In the formats board: 12″ at 300 px, 7″ at 175 px.
- **7″ label** is 50% of its disc. Center hole 21% of the disc (42 px at 198), filled `#0D0B10`, with a **three-spoke adapter**: ring and spokes `#C9C2B4`, spoke highlight `#E8E2D6`, hub `#B8B0A0`. The adapter turns with the record.
- **12″ label** is 33% of its disc, with a 6 px spindle hole.
- **Grooves:** `repeating-radial-gradient(circle, #121216 0 1px, #1C1D23 1px 2.4px)`, a rim `inset 0 0 0 3px #0E0E11`, and the existing turning light catch (two soft conic highlights).
- **Dead wax:** a smooth disc `#23242B → #1F2026` with a hairline `inset 0 0 0 1px rgba(255,235,200,.06)`, sized from the groove fill. Groove band inner radius = outer − fill × (outer − innermost), where fill = side length ÷ capacity (7 min for a 7″ at 45, 15 min for a 12″ at 45, 22 min for an LP) and innermost is 54% of the radius on a 7″ and 40% on a 12″. Worked examples: 7″ with a 3:58 side → dead wax 146 px of a 198 px disc; 12″ EP with 11:20 → 161 of 300; LP with 19:40 → 138 of 300. Etchings sit in the dead wax.
- **Label arc** (art-less label): mono 6 px, letter-spacing .14em, `45.0 RPM · SIDE A · STEREO`, on an arc of radius ~36% of the label.
- **Format chip** in the player: `7″ · 45`, cream `#EFE6D2` on ink `#2A1B38`, mono 9 px / 500 / .12em, radius 2, before the spec line.

## The speed change (AU10)

- Switch: two 56 × 32 segments, `33⅓ | 45`, border `rgba(239,233,223,.18)`, radius 4; the active segment is orange `#FF9E2C` on `#170D04` with `inset 0 2px 3px rgba(0,0,0,.35)` (pressed in).
- Timing: click + haptic at 0; spin-up 0–600 ms (ease-out); needle drop at 600 ms; lead-in 2 s on a 7″, 3 s on a 12″; music after. Motion arcs during spin-up are `rgba(255,184,94,.6)` and `.3`.

## Crate (AU10)

- **45s section** sits between Sealed and Staff picks; the dots show 5 sections with the current one a 16 × 6 orange pill.
- A 7″ sleeve in the bin is 168 px (vs 278 for a 12″), standing in front of the 12″ records; its tops behind are 158–162 px wide.
- **Stickers:** 7″ uses the hi-res yellow `#FFE34D` sticker shape (`7″ · 45`, rotate −4°); 12″ 45s use a cream `#EFE6D2` sticker (`12″ · 45`, rotate −3°).
- Bin front label: `45s · 7″ & 12″` on `#E3D8C2`, rotate −1.5°.

## Liner notes: the master (AU5)

- Block under the sides, separated by a dashed `rgba(42,27,56,.3)` rule. Heading `THE MASTER` mono 10 px / 500; gain on the right in `#5A4A52`.
- Verdict in Antonio 18 px / 700. Meter: 6 px bar, three zones (`#B5433A` clipped, `#C9A24A` compressed, `#44605A` dynamic) at 85% opacity with a 2 × 14 px ink marker.
- Off the card, the legend colours are `#C9A24A` (Compressed) and `#E07A6E` (Clipped master), both passing 4.5:1 on the dark sky.

## EQ (AU6)

- Sheet `#1E1714`, curve panel `#15100E` with `inset 0 0 0 1px rgba(239,233,223,.08)`, 358 × 170, radius 8.
- Scale: log frequency across the width (20 Hz–20 kHz), ±12 dB, 6 px per dB, gridlines at ±6 and ±12 dB and at 125 Hz, 1 kHz and 8 kHz.
- Curve: 2.5 px `#FF9E2C`, area fill `rgba(255,158,44,.14)`; graphic band positions are 3.5 px dots so the gap between slider and true curve is visible.
- Parametric handles: 22 px numbered circles; the selected one is 28 px orange with a 6 px `rgba(255,158,44,.2)` halo, and its band row expands on `rgba(255,158,44,.07)`.
- Band sliders: 4 × 124 px tracks with a centre tick, 20 px cream thumbs.
- Tilt track: `linear-gradient(90deg, #B5433A, rgba(239,233,223,.2) 50%, #C9C2B4)`.
- Switches: 52 × 32, on = `#FF9E2C` with a `#1E1714` knob.

## Queue and resume (AU1, AU8)

- Now-spinning row: `rgba(255,158,44,.10)` with `inset 0 0 0 1px rgba(255,158,44,.35)`, radius 10.
- Dragged row: `#2A211D`, `0 12px 28px rgba(0,0,0,.55)`, orange hairline, rotate −1.2°, over a 56 px dashed drop slot `rgba(255,158,44,.4)`.
- Undo toast: cream `#EFE6D2`, ink text, `UNDO` in `#8A3A1E`, radius 12.
- Resume mini player: 2 px progress hairline across its top edge; subtitle `PAUSED AT 2:14 OF 4:31` in mono 10 px; play button orange.
