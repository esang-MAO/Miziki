# Day arc: design handoff

Put this folder in the repo at **`docs/design/day-arc/`**. The `.dc.html` files are the design canvas's source. They need the canvas runtime to display, so they **won't render opened directly in a browser**. Read them as text: layout, sizes, colours and copy are all in the markup. For pictures, export PNGs of each artboard from the design canvas (Share › Export) into `docs/design/day-arc/png/`. Build with Miziki's real CSS tokens and components (`src/styles/`), not by copying this markup.

| Artboard | File | Used by |
|---|---|---|
| Sundown tab · Twilight · Dark | `Main.dc.html` | DA1, DA3 |
| Sundown tab · Morning · Light | `MorningLight.dc.html` | DA3 |
| Sundown tab · previewing night · Dark | `NightPreview.dc.html` | DA3 |
| Sundown tab · Sound view (was the Character tab) | `Character.dc.html` | DA2, DA3 |
| Profile › Settings · Appearance with Nychthemeron | `ProfileSettings.dc.html` | DA3, DA4 |
| Sky across the day: tokens | `SkyPalette.dc.html` | DA3 |
| Desktop sidebar: Sundown card | `DesktopSidebar.dc.html` | DA3, DA4 |
| Profile: listening rhythm | `Rhythm.dc.html` | DA5 |
| Spun at dusk: now spinning + share cards | `SpunAt.dc.html` | DA6 |

Sample data: times are Columbia, MD on Oct 13 (dawn 6:49, sunrise 7:16, noon 12:54, sunset 6:33, dusk 7:00). Play counts and percentages are illustrative. `[Track title]`-style brackets are placeholders.

---

## Sky tokens (DA3)

`--sky1` → `--sky2` per anchor, blended with smoothstep between neighbouring anchors by `dayPosition`. Contrast is the lower of the two stops, for paper / muted / accent text. **All ≥ 4.5:1.**

| Anchor | When | Dark sky1 | Dark sky2 | Dark contrast | Light sky1 | Light sky2 | Light contrast |
|---|---|---|---|---|---|---|---|
| Night | dusk → dawn | `#120E19` | `#08070C` | 15.8 / 7.1 / 9.2 | `#E8E3EE` | `#E0DAE8` | 11.8 / 4.7 / 4.7 |
| Dawn | dawn → sunrise | `#382842` | `#18131F` | 11.2 / 5.1 / 6.6 | `#F5E5E0` | `#EDD8D1` | 11.7 / 4.7 / 4.7 |
| Morning | sunrise + 1.5 h | `#1C3843` | `#0F1F27` | 10.3 / 4.6 / 6.0 | `#EFF4F2` | `#E3ECEA` | 13.4 / 5.4 / 5.3 |
| Midday | solar noon | `#1D2F38` | `#101A20` | 11.5 / 5.2 / 6.7 | `#F6F1E7` | `#ECE5D8` | 12.8 / 5.2 / 5.1 |
| Afternoon | noon → golden | `#23353C` | `#11191E` | 10.6 / 4.8 / 6.2 | `#F5EFE3` | `#EBE3D3` | 12.6 / 5.1 / 5.0 |
| Golden | sunset − 1 h | `#3D2A1F` | `#1A1310` | 11.2 / 5.1 / 6.6 | `#F7E6CD` | `#F0D9B6` | 11.7 / 4.7 / 4.7 |
| Twilight | sunset → dusk | `#3B2130` | `#1A1018` | 12.0 / 5.4 / 7.0 | `#F3E6E7` | `#EBDDE0` | 12.2 / 4.9 / 4.9 |
| Dusk | dusk + 30 min | `#1E1828` | `#0D0B13` | 14.3 / 6.4 / 8.4 | `#ECE6EE` | `#E3DDE8` | 12.1 / 4.9 / 4.8 |

Text tokens checked against them: dark `--paper #EFE9DF`, `--muted #94A0A6`, `--accent-text #FF9E2C`; light `--paper #15232B`, `--muted #4F616A`, `--accent-text #9A4700`. Midday matches today's tokens. The Light row replaces the static light sky kept on purpose in PR #87. Blended values between anchors also stay above 4.5:1: verify that in the unit test by sampling every 10 minutes.

## Phase colours (DA5 ring, legend and phase accents)

| Phase | Colour | | Phase | Colour |
|---|---|---|---|---|
| Night | `#8E7CC3` | | Afternoon | `#D9C7A0` |
| Dawn | `#E7A7B8` | | Golden | `#FFB85E` |
| Morning | `#9FD8E8` (`--cool`) | | Twilight | `#FF9E2C` (`--amber`) |
| Midday | `#EFE9DF` (`--paper`) | | | |

These are for the dark theme. In light, darken them until each is ≥ 3:1 against the card, and always pair a colour with its text label: never colour alone.

## Moving palette rules (RF14)

RF14 (`docs/12_REFINE.md`) adds four fixed rules the moving sky palette above must obey, so a future change to the anchor table can't silently break legibility or let a cooled/warmed token drift onto the wrong side of the accent color. See `docs/design/refine/README.md`'s own "Colour (RF12, RF14)" section for the literal hex values and measured contrast table these rules are drawn from; this section states the rules themselves, for this file's own day-arc-specific audience.

1. **Muted follows the sky.** Alongside `--sky1`/`--sky2`, `drawSun()` (`src/player/clock.js`) also writes `--muted` (secondary text) and `--muted-2` (tertiary text, new) per anchor — warm in the two warm phases (Golden, Twilight), cool in the other six. Each pair clears **≥4.5:1** (muted) and **≥3:1** (muted-2) against the sky at every sampled minute of a real day, in both themes; light theme keeps one pair regardless of phase (no warm/cool split needed there — see the dark-vs-light table below). The write is skipped when nothing changed, the same "only write when changed" rule `--sky1`/`--sky2` already follow (NV1).
2. **Accent stays the warmest, most saturated thing on screen.** The dark Golden and Twilight sky anchors were cooled slightly from their DA3-era values (Golden `#3D2A1F` → `#352A24`; Twilight `#3B2130` → `#33232E` — sky2 unchanged for both) so `--accent`/`--accent-text` (`#FF9E2C`) keeps separating from the sky behind it even during the two phases closest to it in hue. Verified by the same per-minute contrast sweep as point 1, plus the existing accent-family contrast test (`tests/unit/contrast.test.js`).
3. **The dial ring borrows this file's own anchor colors, not a palette of its own.** The Day view's dial ring (`src/sundown/arc.js`'s `skyRingStops()`) used to carry its own eight hand-picked EMBER/INDIGO/ROSE/AZURE-family hexes. It now reads the same seven phase names this file's own "Phase colours" table already names, each resolved to a dedicated, already-desaturated (~15% less saturated than the sky anchors) hex — see the table below — placed "at the clock angles of today's events" (today's own dawn/rise/noon/set/dusk), not at fixed angles. Only the ring changes: the sky background gradient and the Sundown reading-card's own palette name (AZURE/EMBER/ROSE/INDIGO) are untouched.
4. **Three readable levels, not two.** In dark, `--raised` moved from `.04` to `.07` opacity and `--panel` from `.42` to `.55`, so sky, panel and raised card each read as their own distinct level rather than two of the three blurring together.

**Dial ring colors (point 3), dark theme only — the ring doesn't change by theme:**

| Phase | Colour |
|---|---|
| Night | `#8578AE` |
| Dawn | `#CFA0AD` |
| Morning | `#98C2CE` |
| Midday | `#D8D3C9` |
| Afternoon | `#CBBD9C` |
| Golden | `#E8B67A` |
| Twilight | `#D99A5A` |

**Muted/muted-2 pairs (point 1):**

| | Dark cool | Dark warm | Light (one pair) |
|---|---|---|---|
| `--muted` | `#94A0A6` | `#A99C8F` | `#4F616A` |
| `--muted-2` | `#7A868C` | `#857A70` | `#6E7A80` |

## Components

**Day arc (Sundown tab, DA3).**
- Horizon line across, with the sun's path as an ellipse from sunrise to sunset.
- Dawn and dusk are drawn as short bands at each end: cool at dawn, amber at dusk.
- The arc is **schematic**: twilight bands are widened (about 48 px of 342) so the five labels fit; they're not to scale.
- At night, a dotted under-horizon arc from dusk back to dawn carries the moon.
- The sun is an amber dot with a soft glow; it sits just below the horizon during twilight.
- Labels below the arc, in a five-column mono grid: DAWN · SUNRISE · NOON · SUNSET · DUSK, with times. The current phase's label takes the accent colour.

**Phase block.** Mono eyebrow ("NOW · 6:49 PM", or "PREVIEWING · 11:40 PM" in accent), a 38 px Antonio uppercase phase name with a muted 13 px sub-line, then the existing "Now playing at" row.

**Controls.** Two sections, "SUNDOWN · EVENING" (night rate, pacing) and "SUNRISE · MORNING" (rise at dawn plus the next-event time), using today's `.row` / `.seg` styles. A **Day drift** row links to Character.

**Preview the day.** A 24 h range starting from now, with mono tick labels (NOW · MIDNIGHT · DAWN · NOON · NOW) and the value shown at right ("LIVE" or the previewed time). While previewing, the header chip turns solid amber ("PREVIEW · 11:40 PM"), with a note that plays never count during a preview, and a Back to live button.

**Character (DA2).** Each slider keeps its thumb at the user's value, and adds a thin `--cool` tick for the drifted "now" value, labelled "YOU 40% · NOW 47%". The Day drift segmented control is Off / Subtle / Full. A small 24 h sparkline shows today's drift curve with a "now" dot.

**Tabs (DA3).** Four equal tabs: Library, Home, Sundown, Profile. The Character tab is gone. Sundown has a two-tab **Day / Sound** switch under its header (mono 11 px, the selected tab with an accent tint and a 2 px amber underline, 44 px tall). Day drift's intensity control lives in **Sound**, next to the sliders it moves; the Day view shows the current setting as a shortcut row that opens Sound.

**Appearance (DA4).** It lives in **Profile › Settings** on mobile (the desktop sidebar keeps its own control). A 2×2 grid: Auto / Light / Dark / **Nychthemeron**. The grid gives the long word room at 320–390 px. In the narrow desktop sidebar the label tightens letter-spacing to 0.02em at 9 px. Use the `aria-label` "Nychthemeron: follows sunrise and sunset", with a caption line explaining it and today's switch time.

**Listening rhythm (DA5).**
- A 24-hour radial bar clock (midnight at top, noon at bottom; one bar per hour, length ∝ plays, coloured by phase) with the total in the centre.
- A legend with percentages, and the verdict in 28 px Antonio uppercase.
- "A record for each hour" rows.
- The sharing switch, off by default.
- A dashed locked-state card ("12 of 20 plays").

**Spun at dusk (DA6).**
- Now-spinning rows add the phase phrase in the accent colour, after the album title.
- On the friend's crate header, the line becomes "Now spinning [Album] at golden hour", plus the shared rhythm verdict.
- The Now Playing card gets a pill: a small horizon-and-sun glyph plus "SPUN AT DUSK".
- The My Crate card gets a "NIGHT LISTENER" pill in the night phase colour.
- The share sheet's Include section gets two switches: Time of day and Listening rhythm.
- Phrases: night "late at night", dawn "at dawn", morning "this morning", midday "at midday", afternoon "this afternoon", golden "at golden hour", twilight "at dusk".
