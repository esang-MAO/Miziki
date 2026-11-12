# 37 · Colour references: Wada and Adams

What two colour books suggest for Miziki:
- **Sanzo Wada, *A Dictionary of Color Combinations*** (配色事典, 1933–34): 159 colours and 348 combinations of two, three and four.
- **Sean Adams, *The Designer's Dictionary of Color*** (2017): 27 colours grouped warm, cool, neutral and specialty. Each has its meanings, other names, a colour range and five palette variations.

This plan also covers two things Ken asked about alongside the books:
- How FLAC files press today.
- Artist and album labels on shelf spines.

Same rules as 36:
- Each PR names what it removes.
- The usual routine: one PR each, preview, merge, after-merge check.

**This plan starts after UN6 (`src/ui/art-color.js`) and UN15 (spines) have merged.** It refines both of them and doesn't replace either one.

**Wada colour values:** as published at **sanzo-wada.dmbk.io** (`colors.json`), per Ken. Combination membership comes from the same file; the book is the reference for the text. The scan's colours are not used (an old printed book, so its colours may not reproduce accurately).

**Design:** Claude Design canvas **"Miziki Colour"** (https://claude.ai/artifact/RWSgZvuwHMRAHDYekG7AyB):

| Row | Frames |
|---|---|
| 1 | `Main` (Wada's six patterns) · `Palette` (tokens vs Wada) · `Adams` (what Adams adds) |
| 2 | `Pressings` (re-inked pale partners) · `Gatefold` (dark anchor) |
| 3 | `Spines` (colour toward the book: tested, dropped) · `Share` (grounds and triads) |
| 4 | `SpineLabels` (artist and album on the spine) · `Jet` (FLAC and Jet) · `SpineArt` (a sliver of the cover) |

---

## How the books are used

**The books inform the choices. They don't set the rules.**
- Every recommendation below says which reference informed it and which Miziki rule still decides.
- Where a book and a Miziki rule disagree, the Miziki rule wins. The book becomes a note in the PR, not a change.

**Miziki rules that stay in charge, untouched by this plan:**
- **Tiers and odds (CC6):**
  - Tier is read from the decoder, not the file extension.
  - Lossy presses 100% Jet.
  - Lossless presses 75% solid, 10% effect, 15% Jet. **Ken's decision, 2026-11-11** (was 85% solid, 15% Jet; see CO3). It doesn't come from the books.
  - Hi-res presses 55% effect, 40% solid, 5% Jet.
  - Bands are 50/35/15.
- **`CHART_VERSION`, variant keys and `pressingKey()`.** The same album always draws the same pressing. Nothing here moves a draw.
- **Contrast floors:**
  - TY1's text floors.
  - UN6's 7:1 for `--on-dark` and 4.5:1 for muted text on the gatefold tint.
- **UN15's spine rules:** height by format, the dark top band, light/dark spine type.
- **The house voice for pressing names and notes** (crate README).
- **The existing tokens.** No token is renamed or removed.

---

## What the books show

### Wada (frames `Main`, `Palette`)

All values below are the website's.

1. **No pure white.** White appears in 1 of 348 combinations. The light partner is a tinted pale. Examples:
   - Sulphur Yellow `#F5F5B8`
   - Pale Lemon Yellow `#FFF59E`
   - Ivory Buff `#EBD999`
   - Nile Blue `#BFFFE6`
   - Seashell Pink `#FFCFC4`
   - Turquoise Green `#B5FFC2`
   - Neutral Gray `#B5D1CC`
2. **A dark anchor.** More than half of the 3- and 4-colour combinations (130 of 228) hold a colour darker than L 35.
3. **More colours, wider value range.** The median lightness spread inside a combination (ΔL) is:
   - 31 for two colours
   - 43 for three
   - 52 for four
4. **A few connectors.** The most-used colours are:
   - Black (23 combinations)
   - Raw Sienna (19)
   - Pale Lemon Yellow (19)
   - Sulphur Yellow (18)
   - Turquoise Green (16)
   - Ivory Buff (16)
5. **Bright colours come one at a time.** 18 of the 159 colours are past chroma 90. Of the 108 combinations that use one, only 17 use two, and 71 set it against a dark or a quiet pale.
6. **Dark partners are a different hue.** The dark partner is usually a different, near-neutral colour, not the key colour darkened.

**Where Miziki already stands:**
- Theme tokens are mostly ΔE00 3–7 from a Wada colour:
  - `--sky1` ≈ Slate Color (3.3)
  - `--olive` ≈ Light Brownish Olive (2.6)
  - `--stock-manila` ≈ Ivory Buff (3.3)
  - `--danger` ≈ Vinaceous Cinnamon (4.2)
  - `--prussian` ≈ Helvetia Blue (5.8)
  - `--amber` ≈ Cream Yellow (6.1)
- The far ones are UI neutrals: `--warm-grey` 18.4, `--muted` 10.6, `--stock-card` 10.1.
- Solid pressings have a median ΔE00 of 6.4. None is past 13; the furthest are Smoke, Mauve and Graphite.
- Only 1 of 21 two-ink pressings (Olive & Terracotta) is a pairing Wada used.

### Adams (frame `Adams`)

1. **Five palette variations per colour:**
   - a monochrome ramp
   - polychrome
   - the key colour on a grey ladder
   - the key colour with pales
   - the key colour with deep earths

   Miziki's chrome is variation 3 (amber on warm greys). Share cards and the gatefold draw on variations 4 and 5.
2. **Black has a range.** His black is a family of tinted blacks: warm, slate, brown, violet and olive. "Too much black" reads as funeral. This is relevant to Jet (below).
3. **Mid grey is noncommittal.** Pair it with a warm yellow, a light blue or a pink rather than more grey. This applies to Smoke and the grey pressings' partners.
4. **Metallics need sheen.** Printed flat, gold reads brown. On screen, a metal reads as metal only when it's drawn like a photograph, with highlight and shadow.
5. **Fluorescent reads technical and cold on screen.** It belongs to a specific history: the Fillmore and blacklight posters of the 1960s and 70s.
6. **Names and reasons carry a colour.** Less expected colours with memorable names (butter, mint, fuchsia) are remembered longer. "Design is 90% persuasion": saying why a colour was chosen is half its effect.

---

## FLAC pressings (frame `Jet`)

How it works on `main`, and the one change Ken made:

- **A FLAC is lossless, so it presses in colour, with some chance of Jet.** The same album always gets the same pressing.
- Tier comes from `trackTier()` (`src/record-art/tiers.js` L63), reading `meta.lossless`, `bits` and `rate` from the decoder. FLAC, ALAC, WAV and AIFF all set `lossless: true`.

| What the file is | Tier | Pressing |
|---|---|---|
| MP3, AAC (lossy) | 1 | Jet, always. Metals by play count |
| FLAC at 16-bit / 44.1 kHz (CD quality) | 2 | **New:** 75% solid · 10% effect · 15% Jet (was 85% solid · 15% Jet) |
| FLAC over 16-bit **or** over 44.1 kHz (hi-res) | 3 | 55% effect · 40% solid · 5% Jet |

So:
- **About 1 in 7 CD-quality FLAC albums press Jet.** Unchanged.
- **1 in 10 CD-quality FLAC albums now press an effect** (the swirls, splits and pinwheels that CO2 re-inks), drawn from the same effect catalogue and bands as hi-res. Hi-res keeps the better odds, 55%.

**What the change resets.** Ken said a full reset would be fine; it isn't needed.
- The tier-2 mix draw takes the slice just above Jet: `mixFrac` 0.15–0.25 becomes an effect.
- The solid colour comes from its own salted draw (`drawFromCatalogue`), so every CD-quality album outside that slice keeps exactly the solid it has now.
- **Only about 10% of CD-quality albums change, solid → effect.** Jet, hi-res, lossy, rares and zoetropes don't move.
- A friend on an older build sees the old solid for those albums until they update.
- Rare and zoetrope pressings are separate (earned by listening).

**One real bug.** A lossless album that draws Jet shows Jet's note in Looks: "Plain and warm-black — a lossy file presses the same every time." That's wrong for a FLAC. The "A lossless copy would press in colour" hint is correctly limited to tier 1. CO3 fixes the note.

**One option, informed by Adams' black range, for Ken to accept or drop:**
- A lossless record that draws Jet takes a slight cast from its cover's dark anchor (CO4's lookup), so it never reads as lossy.
- Same odds, same name, same key. Lossy Jet stays the plain warm-black.

---

## Recommendations (for Ken to accept or drop)

Each one names what informed it and the rule that decides.

1. **No new palette, and no token changes.** With the website's values no theme token is far enough from the book to argue for a move, and the far ones are UI neutrals. *Informed by Wada; decides: the existing tokens.*
2. **Pressings: the white partner becomes a tinted pale.** Pattern, dark ink, rim, band and key stay; only the pale ink, `colors`, name and note change. *Informed by Wada 1, Adams 6. Decides: the house voice, variant keys, CC6 odds.*

   | Key | Pale ink: was → now | New name |
   |---|---|---|
   | `prussian-bone` | `#DED7C7` → `#F5F5B8` | Prussian & Sulphur |
   | `oxblood-split` | `#DCCDB0` → `#EBD999` | Oxblood & Ivory Buff |
   | `tyrian-split` | `#DCCDB0` → `#FFCFC4` | Tyrian & Shell |
   | `grape-chalk` | `#E6E2DA` → `#BFFFE6` | Grape & Nile |
   | `pine-split` | `#DED7C7` → `#EBD999` | Pine & Ivory Buff |
   | `rose-split` | `#E6E2DA` → `#B5D1CC` | Rose & Neutral Grey |
   | `madder-pinwheel` | `#DCCDB0` → `#EBD999` | Madder Pinwheel |
   | `teal-pinwheel` | `#E6E2DA` → `#FFF59E` | Teal Pinwheel |
   | `grape-pinwheel` | `#DED7C7` → `#BFFFE6` | Grape Pinwheel |
   | `sienna-pinwheel` | `#DCCDB0` → `#FFF59E` | Sienna Pinwheel |
   | `vermilion-chalk-pine` | middle `#E6E2DA` → `#BFFFE6` | Vermilion Nile Pine |
   | `cobalt-bone-madder` | middle `#DED7C7` → `#F5F5B8` | Cobalt Sulphur Madder |

   - **Kept as they are:** the chromatic pairs, and Jet & Bone (the one stark pressing).
   - **Soot** (chalk base → Sulphur) is optional.
   - **Mauve Measles** stays.
   - **The solids stay as they are**, Chalk included.
3. **Lossless odds and the Jet note.** CD-quality FLAC gets a 10% chance of an effect (Ken's decision; above). The Jet note also matches the tier. A tier 2/3 Jet gets its own note in the house voice, for example "Warm-black, drawn from a lossless file — about one record in seven." The rich-black option is above. *Decides: CC6 tier rules, with the odds as Ken changed them.*
4. **Gatefold inside: a dark anchor as a candidate for UN6's tint.**
   - The cover's colour picks a near-neutral dark partner from Wada's combinations.
   - It's used only when it clears UN6's contrast floors as is. Otherwise UN6's same-hue tint stands, as it does when no partner qualifies (3 of 12 test covers).
   - With the website's values only four colours qualify as a quiet dark ground: Slate Color `#1B3644`, Vandyke Brown `#362304`, Deep Slate Olive `#172713` and Deep Slate Green `#0F261F`. Black is pure `#000000` and is left to Miziki's own darks.
   - Type stays paper and the accent stays amber.
   - *Informed by Wada 2 and 6, Adams 2. Decides: UN6.*
5. **Spine colour: tested and dropped.** With the website's values the nearest Wada colour is usually *more* saturated than the cover (mean chroma: raw 34, halfway 39, full snap 44). Blending makes the shelf louder, so UN15's colour and bounds stand unchanged. *Informed by Wada 5; decides: UN15.*
6. **Spine labels: artist and album, abbreviated** (frame `SpineLabels`):
   - Spine colour is UN15's cover average (see 5).
   - **A sliver of the cover stays on the spine** (frame `SpineArt`). **Ken picked A, Art edge (2026-11-11).** B and C are kept here for the record only:
     - **A · Art edge (chosen):** a 4px slice of the cover down the spine's left edge. The cover is scaled to the spine's height (`background-size: auto 100%`, centred), so the slice is real pixels, never squeezed. The label keeps its full length.
     - **B · Art body:** the whole spine is the slice, and the label sits on a plate in the spine colour. The most art on show, but a long label hides most of it and busy covers get noisy.
     - **C · Art foot:** an 18px square crop at the base, like a real spine's art panel. The easiest to recognise, but it costs 21px of label (budgets 83/67/53px), so most names drop to initials and most albums get cut.
     - No art: no sliver. The pressing-colour fallback from UN15 stays.
   - Text is ARTIST · ALBUM in the spine face (Antonio 600, 12px caps, `--track` per TY1), running bottom to top. The artist is at 72% opacity.
   - A cube holds **7 spines instead of 10**, so each spine is about 18px wide, enough for a 12px line. At 10px wide, text would have to be about 7px, under TY1's 12px floor.
   - Three rows of two cubes now hold up to 42 spines before "Browse all", down from 60.
   - **Length is the limit:** about 104px on a 12″, 88px on a 10″ and 74px on a 7″ (roughly 18, 15 and 13 characters).
   - The rules, in order (reference implementation: `docs/design/colour/spine-label.js`):
     1. **Clean.** Drop bracketed edition tags (Remastered, Deluxe Edition, Expanded, Anniversary, Bonus, Mono/Stereo, Live, EP, Single), a leading "The" on the artist, and "feat." credits.
     2. **Self-titled** (or no album): show the name once.
     3. **Keep the album whole and shorten the artist** to a readable name. For a person, W. Okafor, then Okafor; a DJ/MC prefix stays (DJ Sola). For a band, standard abbreviations (Orchestra → Orch., Brothers → Bros.).
     4. **If the album is still too long:** drop a leading article, then the subtitle after a colon or dash ("Vol. II: Recordings Made in…" → "Vol. II").
     5. **Then** the surname plus the album cut at a word, if at least two words survive.
     6. **Otherwise** initials with the album whole (W.O., M&F, NLO). Last resort: the album cut with an ellipsis.
   - The full "Album, Artist" stays as the spine's accessible name (as today), and tapping still opens the record.
   - *Informed by Adams 6 (names carry it). Decides: TY1's type floor, UN15.*
   - Results on the large test library ("Aurora Sessions" is illustrative):

     | Artist | Album (tags) | 12″ | 10″ | 7″ |
     |---|---|---|---|---|
     | Anouk Vale | Vol. II: Recordings Made in Lagos, Accra and London, 1974–1979 (Remastered) | ANOUK VALE · VOL. II | A. VALE · VOL. II | A. VALE · VOL. II |
     | Desmond Ray | Night Garden | D. RAY · NIGHT GARDEN | D.R. · NIGHT… | D.R. · NIGHT… |
     | Wren Okafor | Tide Season | OKAFOR · TIDE SEASON | W.O. · TIDE SEASON | W.O. · TIDE… |
     | Hiroshi Tanaka | Paper Motion | H.T. · PAPER MOTION | H.T. · PAPER… | H.T. · PAPER… |
     | Theo Park | Tide Cedar | THEO PARK · TIDE CEDAR | PARK · TIDE CEDAR | T.P. · TIDE CEDAR |
     | Chidi Obi | Songs for the Long Drive Home After the Last Train Has Already Left | OBI · SONGS FOR THE… | OBI · SONGS FOR… | C.O. · SONGS… |
     | Marlow & Finch | Vol. II: Recordings Made in Lagos… (Remastered) | M&F · VOL. II | M&F · VOL. II | M&F · VOL. II |
     | Ivy Lomax | Glass Lane | I. LOMAX · GLASS LANE | I.L. · GLASS LANE | I.L. · GLASS LANE |
     | Dj Sola | Harbour Avenue | DJ SOLA · HARBOUR… | DJ SOLA · HARBOU… | DJ SOLA · HARB… |
     | The Northern Lights Orchestra | Aurora Sessions (Deluxe Edition) | NLO · AURORA SESSIONS | NLO · AURORA… | NLO · AURORA… |
     | The Velvet Unit | The Velvet Unit | VELVET UNIT | VELVET UNIT | VELVET UNIT |

7. **Share cards are a three-colour set** (ground, type, accent):
   - The ground and pale come from the same lookup as the gatefold.
   - The pale must be quiet: L ≥ 75, chroma under 45, never White. The website's pales include very bright ones (Lemon Yellow `#F2FF26`), which this filters out.
   - Amber stays the accent.
   - A triad that spreads less than ΔL 43 (the book's three-colour median) is **flagged for review**, not rejected.
   - On the canvas: warm cover → Slate Color · Ivory Buff · amber; blue-green → Vandyke Brown · Pale Lemon Yellow · amber; pink → Deep Slate Olive · Turquoise Green · amber.
   - *Informed by Wada 2, 3 and 5, Adams 1. Decides: TY1 contrast and today's card layout.*
8. **Metals drawn small always use their three stops.** Wherever a metal appears small (a spine, a chip, a share card), use shadow → mid → highlight, never `mid` alone. *Informed by Adams 4. Decides: `METAL_COLORS`.*
9. **No fluorescents** in the pressings or chrome. The book has bright colours (Wada 5) but never stacks them, and Adams reads them as cold on screen. *Decides: the existing palette.*
10. **Rights.**
    - Wada died in 1967, so the book is likely in copyright in Japan until the end of 2037. The Seigensha edition and Adams' book (2017) are both in copyright.
    - **Ship:** colour names (Ridgway's, public), these rules and Miziki's own pairings. The website's hex values are someone else's digitisation: check the site's licence before CO1 ships them in `src/`, and credit it either way. If it isn't clear, ship only the colours Miziki actually uses (the pales in CO2 and the four dark grounds), as Miziki's own tokens.
    - **Don't ship:** Wada's combination table or its numbers, or Adams' palettes or text.
    - The anchor lookup stores only **partner counts per colour** (derived data). Ken to confirm. The fallback is a hand-picked table of about 30 dark partners.

---

## Order

CO0 → CO7, one PR each. CO3 (lossless odds) can go first; it touches nothing else in this plan. CO4 needs CO1. CO6 needs CO4. CO3's optional rich black needs CO4.

---

## CO0: designs (docs only)

> Read CLAUDE.md, docs/36_UNIFORMITY.md and this plan.
>
> 1. Export the ten frames of "Miziki Colour" into `docs/design/colour/`:
>    - `colour-1-principles.png`
>    - `colour-2-palette.png`
>    - `colour-3-adams.png`
>    - `colour-4-pressings.png`
>    - `colour-5-gatefold.png`
>    - `colour-6-spines.png`
>    - `colour-7-share.png`
>    - `colour-8-spine-labels.png`
>    - `colour-9-jet.png`
>    - `colour-10-spine-art.png`
>
>    Add a README listing them, and note that `spine-label.js` in that folder is a reference, not shipped code.
> 2. Add "**See also: docs/37_COLOUR.md**" under UN6 and UN15 in `docs/36_UNIFORMITY.md`.
>
> Docs only, no code. Open the PR. Do not merge.

---

## CO1: the palette reference module

> Read CLAUDE.md and this plan. Depends on UN6.
>
> 1. **New `src/ui/palette-ref.js`**, pure and with no DOM:
>    - `WADA`: 159 entries `{name, hex}`, with hex as published at sanzo-wada.dmbk.io (after the licence check in recommendation 10) and names spelled as Ridgway spells them ("Sulphur", where the site has "Sulpher").
>    - `PARTNERS`: per colour, partner name → count. Built offline by `scripts/build-palette-ref.mjs`; the combination list never ships.
>    - `nearest(hex, n=1)`
>    - `deltaE(a, b)`: CIEDE2000.
>    - `toLab()` / `fromLab()`
> 2. **Tests:**
>    - `deltaE` against Sharma et al. reference pairs 1, 7 and 17
>    - `nearest('#1D2F38')` is Slate Color
>    - `nearest('#E8D9A8')` is Ivory Buff
>    - every `PARTNERS` key is in `WADA`
>    - the module is under 12 KB minified
>
> Lint and unit tests pass, and both builds preview with no console errors. Open the PR with the preview link at the top. Do not merge.

---

## CO2: re-ink the pressings (recommendation 2)

> Read CLAUDE.md, this plan and frame `colour-4-pressings`.
>
> 1. In `src/record-art/tiers.js`, for each row of the table:
>    - Change the pale entry of `inks` and the matching `colors` slot.
>    - Set `name` and rewrite `note` in the house voice. For example: "Deep blue streaked through a pale straw yellow."
>    - **Don't change the key, `band`, `pattern` or `rim`.**
> 2. Tri-splits: change the middle ink only.
> 3. Solids are not touched.
> 4. Mirror the changes in `data/pressings.json` (regenerate it if it's generated) and in `docs/design/crate/README.md`.
> 5. **Tests:**
>    - every old key still exists
>    - every re-inked pale equals its `WADA` hex in `palette-ref.js`
>    - a snapshot of the variant drawn for 20 fixed album ids is unchanged
>    - `CHART_VERSION` is unchanged
>
> Lint and unit tests pass, and both builds preview with no console errors. Open the PR with the preview link at the top. Do not merge.

**Preview focus:** the crate with the large library. No chalk-white halves; the same albums keep the same patterns.

---

## CO3: lossless odds and the Jet note (recommendation 3)

> Read CLAUDE.md, this plan and frame `colour-9-jet`.
>
> 1. **Tier-2 odds** (`selectVariantForTierKey()`, `src/record-art/tiers.js` L492):
>    - `mixFrac < 0.15` → Jet (unchanged).
>    - `mixFrac < 0.25` → `drawFromCatalogue(key, EFFECT_BY_BAND)`.
>    - Otherwise solid.
>
>    Bump `CHART_VERSION` 4 → 5, with a comment in the same style as the others: tier-2 odds 85/15 → 75/10/15. Only the 0.15–0.25 slice moves, because the solid draw has its own salt. `migrateChartVersion()` keeps its `rec.tier === 1` guard, so it re-draws tier 2 and tier 3 once. Tier 3 re-draws to the same result, since nothing about it changed.
>
>    Update:
>    - the odds tables in `docs/design/crate/README.md` (L106) and `data/pressings.json` if it carries them
>    - any copy that says only hi-res can press an effect
> 2. In `src/record-art/looks.js`, when the drawn variant is `jet` and `trackTier()` is 2 or 3, show a lossless Jet note in place of `jet.note`, written in the house voice. Tier 1 is unchanged, and so is its "A lossless copy would press in colour" hint.
> 3. **Only if Ken accepts the rich-black option:**
>    - Tier 2/3 Jet paints `colors` blended 45% toward the album's `artAnchor()` (CO4; 30% for the rim).
>    - The fallback is plain Jet.
>    - The key stays `jet`. Add no new variant.
> 4. **Tests:**
>    - Over 10,000 synthetic tier-2 keys: Jet 15% ± 1, effect 10% ± 1, solid 75% ± 1.
>    - A fixed set of 50 tier-2 keys: every key outside the new slice draws exactly the variant it drew under `CHART_VERSION` 4 (snapshot), and every key inside it now draws an effect.
>    - Tier 1 and tier 3 are unchanged.
>    - The chart-version migration re-draws a tier-2 record once.
>    - The note for tier 1, 2 and 3 Jet.
>    - With the rich-black option on, tier 1 Jet is byte-identical to today.
>
>    Update `tests/unit/tiers.test.js`, `pressing-draw.test.js`, `pressings.test.js` and `cc6-pressing-key.test.js` wherever they assert the old tier-2 split.
>
> Lint and unit tests pass, and both builds preview with no console errors. Open the PR with the preview link at the top. Do not merge.

**Preview focus:**
- The large test library at 16/44.1: a handful of effects now among the solids, and the same solids as before everywhere else.
- A CD-quality FLAC album that draws Jet, beside an MP3 album. Open Looks on both.

---

## CO4: gatefold anchor (recommendation 4)

> Read CLAUDE.md, this plan, UN6 in 36 and frame `colour-5-gatefold`. Depends on CO1 and UN6.
>
> 1. Add `artAnchor(rgb)` in `src/ui/art-color.js`:
>    - Take `nearest(rgb, 3)` and sum their `PARTNERS`, skipping those three.
>    - Keep partners with L 8–30 and chroma under 25.
>    - Pick the highest count, breaking ties by |L − 18|.
>    - Return `{hex, name}` or `null`.
> 2. `artTint(rgb)` uses the anchor for `from` **only if it already clears UN6's floors**. Otherwise UN6's same-hue result, unchanged.
> 3. **Tests:** the 12 test covers' averages:
>    - `#BF7651` → Slate Color
>    - `#4C6C68` → Vandyke Brown
>    - `#B16671` → Deep Slate Olive
>    - `#929E6B`, `#598F85`, `#67C64E` → null
>
>    Also UN6's floors for all 12.
>
> Lint and unit tests pass, and both builds preview with no console errors. Open the PR with the preview link at the top. Do not merge.

---

## CO5: spine labels (recommendation 6)

> Read CLAUDE.md, this plan, UN15 in 36, frame `colour-8-spine-labels` and `docs/design/colour/spine-label.js`. Depends on UN15.
>
> 1. **Seven spines a cube.**
>    - `CUBE_CAPACITY` (`src/profile/shelf-unit.js`) and `SHELF_CUBE_CAPACITY` (`src/profile/storefront.js`) go from 10 to 7.
>    - `.shelf-cell .sp` drops its 10px width and shares the cell's width.
>    - Update the shelf-unit tests for 1, 2 and 3 rows.
> 2. **New `src/profile/spine-label.js`:**
>    - Port the reference.
>    - `measure` is a cached canvas `measureText` with the spine font, created after `document.fonts.ready`.
>    - The budget is the spine's height minus the 7px top band and 6px padding.
>    - Cache per album and format.
> 3. **The art sliver** (option A, Art edge): `cubeSpine()` adds a `<span class="sp-art">` with the album's existing `thumbURL` (already loaded for the face-outs) as `background: url() center/auto 100% no-repeat`. No new image requests. A spine with no art gets no sliver.
> 4. **`cubeSpine()`** adds a `<span class="sp-label">` with the artist in a `<span class="sp-artist">` at 72% opacity, the " · " separator, then the album.
>    - `writing-mode: vertical-rl; transform: rotate(180deg)` (bottom to top).
>    - Ink follows UN15's light/dark spine type rule.
>    - The `aria-label` stays "Album, Artist" in full, and the label span is `aria-hidden`.
> 5. A friend's shelf uses the same labels, from the synced artist and title.
> 6. **Tests:** every row of the plan's table at all three budgets the sliver present when there's art and absent when there isn't,, plus:
>    - self-titled
>    - empty album
>    - an artist with "feat."
>    - an album with only an edition tag
>
> Lint and unit tests pass, and both builds preview with no console errors. Open the PR with the preview link at the top. Do not merge.

**Preview focus:**
- A phone shelf with the large library: every spine readable at arm's length.
- No label runs past its spine.
- 7″ spines still say something useful.

---

## CO6: share card triads (recommendation 7)

> Read CLAUDE.md, this plan and frame `colour-7-share`. Depends on CO4.
>
> 1. Add `shareTriad(rgb)` in `src/share/styles.js`:
>    - **Ground:** `artAnchor` or `artTint().from`.
>    - **Type:** the most-partnered pale (L ≥ 75, chroma under 45, not White), else `--paper`.
>    - **Accent:** `--amber`, unless it's within ΔE 10 of the ground or the type. Then use the next partner with L 45–70.
> 2. Fall back to today's card colours when the triad fails TY1 contrast. Log (dev only) a triad that spreads less than ΔL 43, for review.
> 3. Season, Record and Mixtape cards use it. Layout is unchanged.
> 4. **Tests:** contrast ≥ 7:1 for type; the fallback path.
>
> Lint and unit tests pass, and both builds preview with no console errors. Open the PR with the preview link at the top. Do not merge.

---

## CO7: small metals and an audit (recommendation 8)

> Read CLAUDE.md and this plan.
>
> 1. **Small metals:** find every place a metal renders at under 48px (spines, chips, the share card stamp, profile badges). Make each one use `METAL_COLORS`' three stops as a gradient, never `mid` alone.
> 2. **Audit, report only.** List in the PR description:
>    - every hardcoded hex in `src/` (outside `tiers.js`) more than ΔE 12 from `nearest()`
>    - every flat mid grey with no coloured partner
>
>    Look especially at the mandalas and `src/wiring/sundown.js`. Fix only what Ken picks.
>
> Lint and unit tests pass, and both builds preview with no console errors. Open the PR with the preview link at the top. Do not merge.

---

## Not in this plan

- **Changing the tier odds, the bands or which files count as lossless.** Those are CC6's.
- **An in-app colour book**, or any surface that shows Wada's combinations or Adams' palettes.
- **Re-colouring covers or label art.**
- **New tokens.**

---

## Test-setup notes (additions to 36's)

- **Wada colours come from the website** (`colors.json`: name, hex, combination ids), per Ken. The site's values are brighter than the printed swatches (Hermosa Pink `#FFB3F0` on the site; Black is pure `#000000` and White pure `#FFFFFF`). That's why CO4 and CO6 filter by lightness and chroma rather than taking the nearest colour as it is.
  - Earlier drafts used values sampled from the scan. Those are kept in the analysis folder for reference only, not used.
  - Copy `colors.json` (with its source and licence) into `docs/design/colour/`. Only names, hex and partner counts go into `src/`.
- **The Adams PDF is a scan** (no text layer). Findings come from reading the pages. Nothing from it is shipped.
- **ΔE is CIEDE2000 throughout.**
- **Test covers:** the 12 averages came from frame 0 of `big/a000t01.mp3` … `a035t01.mp3` and `fx/cover*.jpg`.
- **Spine budgets** were measured in Chrome with the real Antonio woff2 (600, 12px, .02em). Run `spine-label.js` the same way in the CO5 tests (canvas `measureText` after `document.fonts.ready`), never with an estimated character width.
