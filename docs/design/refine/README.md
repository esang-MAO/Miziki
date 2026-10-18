# Refine: design handoff

The mockups behind **`docs/12_REFINE.md`** (RF6–RF15, and RF26). Put this folder in the repo at **`docs/design/refine/`**, beside `docs/design/day-arc/`.

The `.dc.html` files are the design canvas's source ("Miziki Refine"). Like the day-arc files, they need the canvas runtime and **won't render opened directly in a browser**. Read them as text: layout, sizes, colours and copy are all in the markup. For pictures, export PNGs of each artboard from the canvas (Share › Export) into `docs/design/refine/png/`. **Build with Miziki's real CSS and components (`src/styles/`), not by copying this markup.** The tokens below are the part to copy exactly.

| Artboard | File | Used by |
|---|---|---|
| Tokens and rules | `Main.dc.html` | RF12, RF13, RF14 |
| Player, quiet | `Player.dc.html` | RF8, RF13, RF15 |
| Library, one header row (dark) | `Library.dc.html` | RF8, RF13 |
| Sundown · Day content (shown as a tab; RF26 hosts it in the sheet) | `SundownDay.dc.html` | RF9, RF14 |
| Sundown · Sound content (shown as a tab; RF26 hosts it in the sheet) | `Sound.dc.html` | RF9 |
| Profile, a new crate | `Profile.dc.html` | RF11, RF15 |
| Settings, one line each | `Settings.dc.html` | RF6, RF11 |
| Library, light theme | `LibraryLight.dc.html` | RF12 |
| Home, signed out | `HomeSignedOut.dc.html` | RF7 |
| Background playback offer | `ReturnCard.dc.html` | RF7 |
| Share sheet | `ShareSheet.dc.html` | RF10 |
| Desktop player at golden hour | `DesktopPlayer.dc.html` | RF8, RF14 |
| Three tabs, sun on the mini-player | `SheetLibrary.dc.html` | RF26 |
| Sun knob on the platter | `SheetPlayer.dc.html` | RF26 |
| Sundown sheet, half open · Day | `SheetDay.dc.html` | RF26 |
| Sundown sheet, full · Sound | `SheetSound.dc.html` | RF26 |

Phone artboards are 390 × 844. The desktop artboard is a fluid page drawn at 1440 × 900. Dark artboards use the midday sky (`#1D2F38 → #101A20 → #07080C`) except the desktop one and the four sheet artboards, which use the **proposed** golden-hour sky at 7:32 PM. Sample data: Columbia, MD stand-in times (sunset 8:10 PM, dusk 8:36 PM), now 6:44 PM. Cover art is a flat placeholder colour. `[Track title]`-style brackets are placeholders.

---

## Type (RF13)

| Token | Size / line-height | Face | Role | Replaces today |
|---|---|---|---|---|
| `--fs-micro` | 10 / 1.3 | Plex Mono 400, `.10em`, caps | annotations: times, kHz, stat labels, counts | 6.5, 8, 8.5, 9, 9.5, 10, 10.5 (annotation uses) |
| `--fs-label` | 11 / 1.3 | Plex Mono 500 (active) / 400, `.08em`, caps | tabs, tab bar, segments, section eyebrows, text buttons | 10.5, 11, 11.5 (control uses) |
| `--fs-caption` | 12 / 1.45 | Archivo 400 | helper text, sub-lines | 12, 12.5, 13 |
| `--fs-body` | 14 / 1.5 | Archivo 400 | list second line, paragraphs | 13.5, 14, 14.5 |
| `--fs-row` | 16 / 1.35 | Archivo 600 | list titles, setting names, inputs | 15, 16, 17 |
| `--fs-title` | 20 / 1.2 | Antonio 700 (Archivo 600 in dialogs) | card values, dialog titles | 18, 19, 20, 21 |
| `--fs-head` | 24 / 1.15 | Antonio 400 caps (section) / 700 (screen title) | STAFF PICKS, SETTINGS, crate album name | 22, 23, 24, 26 |
| `--fs-hero` | 28 / 1.1 | Antonio 700 | player title (phone), profile stats | 28, 30 |
| `--fs-display` | 36 / 1.0 | Antonio 700 | phase name, desktop player title, empty-state headline | 34, 36, 40 |
| `--fs-giant` | 44 / 1.0 | Antonio 700 | profile name | 44, 46 |

- Nothing below 10 px. The platter-label arc (7.5–8 px, SVG) is the one exception: it's decoration printed on an object, not UI text.
- Antonio at no more than **two sizes per screen**.
- Letter-spacing: `.10em` at 10 px, `.08em` at 11 px, `.02em` on Antonio ≥ 24 px, `0` elsewhere. Retire `.12/.14/.16/.18/.22/.32em`.

## Spacing, radii, elevation (RF13)

**Spacing:** `--sp-1` 4 · `--sp-2` 8 · `--sp-3` 12 · `--sp-4` 16 · `--sp-5` 24 · `--sp-6` 32 · `--sp-7` 48 · `--sp-8` 64.
Collapse: 2–5 → 4 · 6–9 → 8 · 10–13 → 12 · 14–18 → 16 · 20–26 → 24 · 28–32 → 32 · 40–44 → 48.
A section heading sits `--sp-6` below what's above it and `--sp-2` above what it heads. Phone gutter 16. Touch targets stay ≥ 44.

**Radii:** 4 (controls, covers, chips) · 12 (cards, sheets, mini-player) · full circle. Drop 2, 3, 6, 7, 8, 10, 14, 22.

**Elevation** (dark; light uses the same geometry through `--shadow`, at about half the alpha):

| Token | Value | Used on |
|---|---|---|
| `--sh-1` | `0 1px 2px rgba(0,0,0,.35), 0 2px 6px rgba(0,0,0,.25)` | mini-player, primary buttons, scrub thumb |
| `--sh-2` | `0 2px 4px rgba(0,0,0,.35), 0 10px 24px rgba(0,0,0,.35)` | cards, covers, crate neighbours, the dial |
| `--sh-3` | `0 4px 8px rgba(0,0,0,.25), 0 24px 48px rgba(0,0,0,.45)` | current crate card, platter, sheets, dialogs |
| lit edge | `inset 0 1px 0 rgba(255,255,255,.07)` | added to anything raised |

## Colour (RF12, RF14)

**Text tokens.** All contrasts are the lower of the two sky stops.

| Token | Dark | Light | Rule |
|---|---|---|---|
| `--paper` | `#EFE9DF` | `#15232B` | primary text |
| `--muted` | `#94A0A6` cool / `#A99C8F` warm | `#4F616A` | ≥ 4.5:1 on every anchor |
| `--muted-2` (new) | `#7A868C` cool / `#857A70` warm | `#6E7A80` | tertiary text only; ≥ 3:1 on every anchor |
| `--accent-text` | `#FF9E2C` | `#9A4700` | **every** orange text |
| `--accent` | `#FF9E2C` | `#FF9E2C` | fills, rings, underlines, slider fill, icons ≥ 24 px. Never text in light. |
| `--on-accent` | `#2A1B38` | `#2A1B38` | text on solid accent (7.8:1) |

In light, `#FF9E2C` text on cream is **1.65:1**; `#9A4700` is **5.1:1**. Today 57 rules use `--accent` for text and 5 use `--accent-text`.

**Muted follows the sky.** `drawSun()` writes `--muted`/`--muted-2` with `--sky1`/`--sky2`: the warm pair during Golden and Twilight, the cool pair otherwise; smoothstep between them like the sky. Light keeps one pair (`#4F616A` is 4.7:1 and `#6E7A80` 3.2:1 even on the light Golden sky `#F0D9B6`).

Measured (lower stop):

| Anchor | paper | muted (cool / warm) | muted-2 (cool / warm) | amber |
|---|---|---|---|---|
| Night | 15.8 | 7.1 / 7.1 | 5.1 / 4.6 | 9.2 |
| Dawn | 11.2 | 5.1 / 5.1 | 3.6 / 3.2 | 6.6 |
| Midday | 11.5 | 5.2 / 5.2 | 3.7 / 3.3 | 6.7 |
| Golden (proposed) | 11.5 | 5.2 / 5.2 | 3.7 / 3.3 | 6.8 |
| Twilight (proposed) | 12.2 | 5.5 / 5.5 | 4.0 / 3.5 | 7.2 |

**Sky anchors that change (dark only).** Amber must stay the most saturated thing on screen. Two warm anchors compete with it today; cool them toward neutral at the same lightness. Update `docs/design/day-arc/README.md`'s table in the same PR.

| Anchor | sky1 today | sky1 proposed | Saturation | sky2 |
|---|---|---|---|---|
| Golden | `#3D2A1F` | `#352A24` | 0.33 → 0.19 | `#1A1310` (unchanged) |
| Twilight | `#3B2130` | `#33232E` | 0.28 → 0.19 | `#1A1018` (unchanged) |

**Value steps (dark).** `--raised` `rgba(239,233,223,.04)` → `.07`; `--panel` `rgba(10,14,18,.42)` → `.55`. Sky, panel and raised then read as three levels.

**Dial ring.** Its stops come from the phase colours in `docs/design/day-arc/README.md`, about 15% less saturated, at the clock angles of today's events: Midday `#D8D3C9` · Afternoon `#CBBD9C` · Golden `#E8B67A` · Twilight `#D99A5A` · Night `#8578AE` · Dawn `#CFA0AD` · Morning `#98C2CE`. Hour labels move **outside** the ring, 11 px `--paper`.

## Buttons (RF13)

| Kind | Look | Where |
|---|---|---|
| Primary | solid `--accent`, `--on-accent` text, `--sh-1` | one per screen: play, Create, Sign in, Share, Turn on |
| Selected option | 1 px `--accent` border, `rgba(255,158,44,.14)` fill, `--paper` label 500 | inside a segmented control only |
| Switch | 48 × 28 track, 22 px knob; on = `--accent` track | every on/off setting (the player's Vinyl switch already is one) |
| Text | no border, `--fs-label`, `--muted` | everything else: Save image, Not now, Refresh, More options |

The four outlined player buttons, the `On`/`Off` segmented toggles in Settings, and the solid-amber selected segment on the Sound view all go.

---

## Components

**Tab bar.** Library · Home · Profile (RF26). Until RF26 lands, Sundown keeps its tab. Home stays when signed out (RF7). The phone artboards in the first row still draw four tabs; the sheet row shows the final bar. Labels 11 px. Active: icon `--accent`, label `--paper` 500, a 2 px accent bar along the cell's top edge. Inactive: icon at 80% opacity, label `--muted`. Never colour alone.

**Mini-player.** One `--chrome` slab, 12 radius, `--sh-1`, inset 8 from the edges. Disc thumbnail (not the 6 px "MIZIKI" text when there's no art), title 14/600, artist `--muted-2`. Queue as a borderless icon; play/pause is a solid `--paper` disc with a `--sky2` glyph. No favourite here (it's on the player).

**Player (phone).** Close chevron · platter 300 px at `--sh-3` · title row · scrub · transport · mode switch. That's all.
- The label prints the album title (Antonio 14, caps) and an arc in Plex Mono: `33⅓ · SIDE A · STEREO`, using the real side and channel count. In Pure the label flattens: no highlight, a hairline ring, same text.
- Title 28 Antonio, then `[Artist] · [Album]` 14 `--muted`, then the format line in micro `--muted-2`.
- Favourite and `···` sit to the right of the title. `···` holds Edit info, Share, Queue, Sleep timer, Credits.
- Play is 72 px solid accent; prev/next 44 px `--paper`; shuffle/repeat 44 px `--muted`.
- `#modeNote` is gone. The switch reads PURE · [switch] · VINYL.

**Library header.** One row: tabs left (SONGS · CRATE · ARTISTS · PLAYLISTS), icons right (search, add, `···`), each 40 × 44. The overflow holds Select and Library tools. Then one micro line whose first part is the sort control: `BY ARTIST ▾ · 240 SONGS`. Rows 64 px: 48 px cover (4 radius, `--sh-2` lit edge), title 16/600, second line 14 `--muted`, duration micro `--muted-2`. **No row hairlines.**

**Sundown · Day.** Day/Sound tabs · the dial (264 px, labels outside) · "Spin the record to preview any hour" · phase name 36 + one line `Full speed · sunset 8:10 PM, in 1h 25m` (times in `--paper`) · **How deep the night goes: Off / Gentle / Medium / Deep** (0.85 / **0.80, default** / 0.75), with one caption naming the current depth in rate and semitones · the stand-in-sunset line with USE MY LOCATION. Removed: Auto/Manual, manual rate, full-night rate's three-way, pacing, the Rise-at-dawn row, the Character link, the three stat cards, the second `NOW ·` eyebrow, the separate day-arc strip.

**Sundown · Sound.** Readout (micro `VINYL · 6:44 PM`, phase-tone word 36, one line). **Starting point:** three preset cards (12 radius, 88 px tall, name 14/600 + a two-word caption), selected = accent outline. **Drift through the day:** Off / Subtle / Full, then "Tone today" (only when drift isn't Off). **Advanced** is one row showing the four values; tap to reveal today's four sliders and fine-tune. The (i) by Starting point holds the old paragraph. No second dial.

**Profile.** Awning as a 12 px scallop trim (amber `#F2A449` alternating `--cream`), not a header block. The gear in the top right is a menu button with two items, Refresh and Settings (no separate Refresh button). Disc avatar 64 · name 44 `--paper` even as placeholder · "Add your name ›" caption. Stats: 28 Antonio numbers over micro labels. **Staff picks** heading with `0 OF 8` at the right; **one** empty slot drawn as a cream bin divider (tab + card, `--sh-2`, "PIN A RECORD" in ink) plus a caption; more slots appear as picks are made. **In the crate:** four covers + "ALL 24 ›". **Listening** is one row linking to the stats screen; empty, its caption says how it fills. "YOUR PROFILE" eyebrow is gone.

**Settings.** Back + SETTINGS (24 Antonio). Appearance: 2 × 2 segmented (Auto / Light / Dark / Nychthemeron) and one caption with the turn time in `--paper`. Playback: Scratch, Sleeve pull, Launch intro, Background playback (with an (i) for the resampling note) as switch rows, 64 px, one caption line each; Slipmat as a link row showing the current choice. You: Account ›, Privacy ›. Legal links in micro at the bottom. **No Car Mode.**

**Home, signed out (RF7).** Stacked covers with a disc and a cream sticker (`3 FRIENDS HAVE THIS`) as the illustration · "Your friends' crates" 36 · one line of what you'd see · SIGN IN WITH EMAIL (primary) · one caption: six-digit code, friends-only default, music never leaves the phone.

**Background playback offer (RF7).** Shown once, on return, only if playback stopped because the page was hidden while Background playback was off. Scrim `rgba(7,8,12,.55)`, card `#16232A` at `--sh-3`. Title 20/600 "Music stopped when you left Miziki." · one sentence including the resampling trade-off · TURN ON (primary) · NOT NOW (text) · "Asked once. Change it any time in Settings › Playback." Never shown before audio starts.

**Share sheet (RF10).** Sheet at 12 radius. Live preview of the card · Story / Square · SHARE (primary) · SAVE IMAGE and MORE OPTIONS › as text buttons. Styles and Include toggles live behind More options.

**Desktop player (RF8, RF14).** Sidebar sits on the sky: no fill, no border; nav as plain text; playlists; a two-line Sundown summary at the bottom (`GOLDEN HOUR` in the phase colour, one caption). Main area: platter (360) and info column centred vertically together, wrapping on narrow windows; the side panel (Up next / Liner notes / Credits) runs full height on the right. On the player route the bottom bar shows only the now-playing cell; the transport is on the stage. No Appearance control in the sidebar.

---

## Decided (Oct 17)

1. **Library tabs:** keep PLAYLISTS; Sort moves into the BY ARTIST line; Select moves into the `···` overflow.
2. **Night depth:** Off plus all three of today's depths, 0.80 the default: Off / Gentle / Medium / Deep.
3. **Sound headline** shows the tone word now ("Warming"); with drift Off, the preset's name.
4. **Preset captions** stay as drawn.
5. **Refresh** moves into the gear's menu on Profile.

## Sundown as a sheet (RF26, approved Oct 17)

Four artboards on the golden-hour sky. The tab bar becomes **Library · Home · Profile**; Sundown opens over whatever you're doing.

**Ways in.**
- **Sun knob** (`SheetPlayer`): 64 px round control at the platter's lower right, where a turntable's speed knob sits. Dark plinth fill, a 2 px ring in the current phase colour (Golden `#E8B67A` here), sun glyph in `#FFB85E`, the time in 8 px mono. `--sh-2`. Tapping it opens the sheet. It never touches the platter: spinning the record still scratches.
- **Mini-player sun** (`SheetLibrary`): a 44 px sun icon between the title and the queue button, tinted the phase colour. Opens the sheet directly without opening the player.
- **Format line** on the player adds the phase: `FLAC · 44.1 kHz · GOLDEN HOUR · FULL SPEED`.
- Desktop: the sidebar's two-line Sundown summary opens the same content as a right-hand panel.
- Settings › Sundown, for before anything has played.

**The sheet** (`SheetDay`, `SheetSound`). Background `#1E1815` (a warm `--panel` over the golden sky), 12 radius top corners, `--sh-3`, grabber.
- **Half height** (top at about 300 px) opens on the last-used view. The header is SUNDOWN (24 Antonio) with a compact Day/Sound control (160 × 36) on the right.
- **Day:** a 168 px dial on the left, the readout on the right (NOW in phase colour · `GOLDEN HOUR` 24 · "Full speed. Sunset 8:10 PM, in 38m." · "Spin the dial to hear any hour."), then the depth control and the location line.
- **Full height** (drag up, or Sound): Sound's readout at 28, preset cards at 72 px, drift with an inline 44 px tone curve, and **Advanced** open showing the four sliders with 45% amber fills.
- Back, a downward swipe or the scrim closes it.

**Why the knob, not a tab.** The effect is heard on the record, so the control lives on the record. It also frees the bar for the three places you navigate between. The trade-off is discoverability: a first-time user has no tab saying "Sundown". The knob's coloured ring and the time on it are the hint; RF7's first-run work can add a one-time tooltip on the first evening.

## Out of scope here

The social-layer and sync ideas in `12_REFINE.md`'s Phase D; the crate view itself (unchanged apart from tokens, shadows and the sleeve edge in RF15); the gatefold; grain texture (RF15, needs a real tile to judge).
