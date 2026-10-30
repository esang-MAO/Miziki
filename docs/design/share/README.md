# Share cards: design handoff

The mockups behind **`docs/18_SHARE.md`** (SH1–SH6). Put this folder in the repo at **`docs/design/share/`**, beside `docs/design/crate/`.

The `.dc.html` files are the design canvas's source ("Miziki Share Cards"). They need the canvas runtime and **won't render opened directly in a browser**. Read them as text; export PNGs from the canvas (Share › Export) into `docs/design/share/png/`. **Build with the canvas composers in `src/share/` (`styles.js` kits, `fillShareDisc`, `shareFitLines`), not by copying this markup.** The values below are the part to copy exactly.

| Artboard | File | Used by |
|---|---|---|
| Now Playing, Story | `Main.dc.html` | SH1, SH2 |
| Record, Square | `Record.dc.html` | SH3 |
| Pressings, Story | `Pressings.dc.html` | SH4 |
| Crate, Square | `Crate.dc.html` | SH5 |
| Season, Square | `Season.dc.html` | SH6 |

Boards are drawn at **half scale**: 540 × 960 for Story (export 1080 × 1920) and 540 × 540 for Square (1080 × 1080). **Every px value below is the half-scale value; double it in the composers.** Night style throughout; Cover and Paper swap the ink/sub/accent kit from `resolveShareStyle()` and change nothing else. Cover art is a flat placeholder colour; `[Album title]`-style brackets are placeholders.

---

## Tokens (Night kit, unchanged from `styles.js`)

- Background `linear-gradient(180deg, #1D2F38 0%, #101A20 55%, #07080C 100%)`.
- Ink `#EFE9DF`; secondary ink `#B9C2C6` (artist lines); sub `#94A0A6` (mono labels); accent `#FF9E2C`.
- Chip: height 23, padding 0 11, radius 12, border `rgba(239,233,223,.32)`, fill `rgba(255,255,255,.05)`, mono 11 / 600 / `.04em`. Filled chip: accent fill, `#171310` text.
- Type: Antonio 700 for display numbers and names; Archivo 700 titles, 400/600 body; IBM Plex Mono 500/600 labels, letter-spacing `.08em` (sub) / `.14em` (kickers).
- Kicker: mono 11–12 / 600 / `.14em` / accent, uppercase.
- Wordmark: Antonio 700 18, `Mi` ink · `zi` accent · `ki` ink, letter-spacing `.02em`. Footer line under it: mono 9 / 600 / `.12–.14em` / sub.
- Disc: radial gradient from the pressing's three colours (`VARIANT_DEFS[...].colors`), groove overlay `repeating-radial-gradient(… rgba(255,255,255,.055) 3px 4px)`, amber label `#FF9E2C` at 32 % of the diameter, shadow `0 8px 24px rgba(0,0,0,.55)`.
- Cover: radius 3, shadow `0 10px 30px rgba(0,0,0,.6)` (hero) / `0 6px 16px rgba(0,0,0,.5)` (small).
- Story safe band: content starts at 125 and the footer's baseline sits 118 above the bottom. Square padding 32 (36 top/bottom on Record and Season).

## Per-card defaults

| Card | Default format | Include toggles | Shared from |
|---|---|---|---|
| Now Playing | Story | Time of day | Player control row |
| Record | Square | Sleeve note, Friends | Record sheet / gatefold |
| Pressings | Story | — | Profile › Records › Pressings |
| Crate | Square | Name | Profile home |
| Season | Square | Name | Profile home (once unlocked) |

## Now Playing (SH1 board)

- Jacket 280 square, offset so the disc (280) peeks 60 to the left; group is 320 wide, centred; 36 below it.
- Title band, centred, 476 wide, gap 10: kicker `NOW PLAYING`; title Archivo 700 34, line-height 1.08, ≤ 2 lines (`shareFitLines`, shrinks before truncating); artist Archivo 17 `#B9C2C6`; `[ALBUM] · [YEAR]` mono 11 / 600 / `.08em` sub.
- Progress: 40 below the band; bar 3 high, radius 2, track `rgba(255,255,255,.08)`, fill accent, 9 px accent dot; clock mono 11 / 500 sub, left and right, 10 below the bar.
- Chips: 30 below the clock, gap 8, wrap to a second row; order spec · mode (filled) · spun-at.
- Footer: wordmark, 8, `LOCAL · LOSSLESS · NO STREAMING`.

## Record (SH2 board)

- Top row: sleeve group 300 × 232 (cover 232, disc 216 pulled out to the right by 96) and a facts column with gap 28.
- Facts: kicker `PRESSING`; pressing name Antonio 700 40, line-height .95; `TRANSLUCENT · SCARCE · 33⅓` mono 10 / 500 / `.08em` sub; five rating ticks 3 × 14, radius 1, gap 4, filled accent / empty `rgba(239,233,223,.22)`, 12 below.
- Record block: title Archivo 700 26 (one line, ellipsis); `[Artist] · [YEAR]` 15 `#B9C2C6`; sleeve note Archivo italic 15, line-height 1.4, `#D9D3C8`, two lines max, 10 above.
- Footer row: friends sticker (chip with a 7 px accent dot, `IN N FRIENDS' CRATES`) left; wordmark + `[NAME]'S CRATE` right-aligned.

## Pressings (SH3 board)

**Superseded by docs/24_QUIET_COUNTS.md:** pressings and metals are shown as found, never counted (no "N of M", blanks or missing lists).

- Header, gap 6: kicker `PRESSINGS`; `14 of 110` Antonio 700 38; family counts mono 10 / 500 / `.08em` sub. 26 below.
- Grid 3 columns, column gap 16, row gap 18; tile 148 wide. Tile art box 148 × 96: cover 80 at left, 8 down; disc 96 at left 52, in front. Pressing name mono 11 / 600 / `.06em` uppercase, ellipsis (rare names in accent); album title Archivo 11 sub, ellipsis; gap 6.
- Story: 4 rows (12 tiles); Square: 2 rows (6). Then `+ N MORE · NEWEST FIRST` mono 10 sub, 22 below, only when there are more.
- Footer: wordmark, `[NAME]'S CRATE · EARNED BY LISTENING`.

## Crate (SH4 board)

- Square padding 32, stack gap 22.
- Header: avatar 40 (initial Archivo 600 17 on the green swatch when there is no picture), gap 14; `[NAME]'S CRATE` Antonio 700 24, `212 RECORDS · 2,418 TRACKS` mono 10 sub.
- Albums: hero 222 square with `01` in its corner, gap 14, 2 × 2 grid of the next four at the hero's height.
- `01 · TOP ALBUM` kicker; title Archivo 700 20, ellipsis; `[Artist] · N sessions` 13 `#B9C2C6`.
- `TOP SONGS`: rows gap 7; rank mono 11 / 600 accent, title Archivo 600 15 ellipsis, `· Artist` 12 sub, max 40 % of the row, never wrapping. Three rows in Square, five in Story.
- Wordmark bottom-right, 32 / 28 from the edges.

## Season (SH5 board)

- Header gap 6: kicker `THIS SEASON · LAST 90 DAYS`; verdict Antonio 700 38, sentence case.
- Ring 200 square: seven conic wedges in `PHASE_COLOR` order (night `#8E7CC3`, dawn `#E7A7B8`, morning `#9FD8E8`, midday `#EFE9DF`, afternoon `#D9C7A0`, golden `#F2B35C`, twilight `#FF9E2C`), groove overlay `rgba(0,0,0,.12)`, 64 px centre hole in `#101A20` carrying the 90-day play count (mono 11 sub).
- Legend, gap 32 from the ring, rows gap 7: 8 px dot, phase label Archivo 12 `#B9C2C6`, share % mono 11 sub right-aligned; sorted by share descending.
- `METALS` kicker; discs 46, gap 12, brushed radial gradient at 35 % / 30 % from highlight → mid → shadow (`METAL_COLORS`), count Archivo 700 17 `#171310`; `N RECORDS PLAYED THROUGH` mono 10 sub after the discs.
- Wordmark + `[NAME]'S CRATE` bottom-right.
