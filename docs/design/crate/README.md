# Crate: design handoff

The mockups behind **`docs/13_CRATE.md`** (CR1–CR11). Put this folder in the repo at **`docs/design/crate/`**, beside `docs/design/refine/` and `docs/design/day-arc/`.

The `.dc.html` files are the design canvas's source ("Miziki Crate"). They need the canvas runtime and **won't render opened directly in a browser**. Read them as text; export PNGs from the canvas (Share › Export) into `docs/design/crate/png/`. **Build with Miziki's real CSS and components (`src/styles/`, `src/crate/`, `src/record-art/`), not by copying this markup.** The tokens below are the part to copy exactly. Where this file and `docs/design/refine/README.md` overlap, this one is newer and wins.

| Artboard | File | Used by |
|---|---|---|
| Crate in a bin (phone, golden hour) | `Main.dc.html` | CR1 |
| New arrivals bin, artist divider | `CrateDividers.dc.html` | CR2 |
| Sleeve anatomy, stickers, catalog card, dividers | `CrateDetail.dc.html` | CR3, CR4 |
| Pull up to open, hold, flip | `CrateGestures.dc.html` | CR5 |
| Sealed records, redesigned | `Sealed.dc.html` | CR6 |
| Pressings: catalogue, metals, pressings between friends | `Variants.dc.html` | CR7, CR11 |
| Palette additions, stock, light theme, era tints | `Palette.dc.html` | CR8 |
| Artists as fanned stacks | `Artists.dc.html` | CR9 |
| Artist shelf | `ArtistPage.dc.html` | CR9 |
| Playlists as compilations | `Playlists.dc.html` | CR9 |
| Desktop crate with a following panel | `DesktopCrate.dc.html` | CR10 |

Phone artboards are 390 × 844 with the three-tab bar from RF26. The crate boards use the proposed golden-hour sky (`#352A24 → #1A1310`); the rest use midday. Cover art is a flat placeholder colour; `[Album title]`-style brackets are placeholders.

Sources behind the colour decisions: Sutton's *Pocket Complete Color Harmony*, St Clair's *The Secret Lives of Color*, Adams's *Designer's Dictionary of Color*, Eiseman & Recker's *Pantone: The Twentieth Century in Color*, and a Pantone solid chart. Where they disagreed, the choice and the reason are noted.

---

## The bin (CR1)

- **Stage** grows from 316 to **420 px** on phone. Six record tops show above the front record (today, three), each a `rotateX(54–62°)` slab 36–52 px tall, widening toward the front.
- **Front lip**: a 330 × 118 px slab across the bottom of the stage, radius 6 on top. Cardboard and walnut, never red-brown: `linear-gradient(180deg, #3A2B22, #2A1F19 18%, #1E1612)` on the golden sky; on midday `#8E7A60 → #6F5A45 14% → #4D3D2F`. Lit top edge `inset 0 2px 0 rgba(255,235,200,.16)`. It hides the lower records the way a crate does; the stack no longer fades out after three.
- **The front record** keeps `--crate-card-size` (278) and `flowPose()`; it gains the sleeve anatomy below and `--sh-3`. Neighbours use `--sh-2`.
- **Sky-lit highlight**: the top edges' highlight colour comes from the current sky anchor (warm white at golden hour, cool at night), written by `drawSun()` as `--crate-light` alongside `--sky1/2`.
- **Rail**: docked 8 px from the right edge of the stage, 10 px mono (up from 8.5 px at 65%), current letter `--accent` 500, others `--muted-2`. Two entries above `#`: **NEW** and **PICKS**.
- **Header line**: `212 RECORDS · A–Z` left; `● NOW PLAYING · [ALBUM]` right in the phase colour, replacing the bordered chip.
- **Empty library**: the empty bin with the lip and one cream card, "Fill the crate", and the add button.

## Bins and dividers (CR2)

- **New arrivals**: records with `addedAt` in the last 14 days, newest first; the bin sits before `#`. Its divider says NEW ARRIVALS with the count and how many are still sealed. Hidden when empty.
- **Staff picks**: the pinned records, in `pin_rank` order. Hidden when empty.
- **Letter dividers** show from 20 records, as today. **Artist dividers** show from an artist's third record, inside the letter, ahead of their albums by year.
- **Divider geometry**: 12% taller than a sleeve (312 for a 278 card) with a 54 × 22 tab at the left of the top edge, so dividers show above the records. Radius 3.
- **Divider stock**: `linear-gradient(160deg, #E6DCC4, #CFC2A3)`, lip `#B5A684` 1 px at the bottom, inset highlight `rgba(255,255,255,.5)` on top. Lettering aubergine `#2A1B38` (9.1:1 on the darkest stop). Genre grouping uses **manila** `#E8D9A8` (11.4:1). A thin inner rule `rgba(42,27,56,.18)` 14 px in.
- **Divider catalog card** (below the stage when a divider is at the front): title, one-line description ("Added in the last two weeks"), count line, and PLAY ALL as an outlined aubergine button on the cream.

## Sleeve anatomy and stickers (CR3)

Every sleeve, crate and elsewhere:

| Part | Value |
|---|---|
| Radius | 4 (was 6) |
| Lit top edge | `inset 0 1px 0 rgba(255,235,200,.22)` |
| Spine shadow | left 6 px, `linear-gradient(90deg, rgba(0,0,0,.28), transparent)` |
| Bottom band | `inset 0 -3px 0 rgba(0,0,0,.25)` |
| Shadow | front record `--sh-3`; others `--sh-2` |

**One sticker per sleeve, top right, 8 px mono 500 at `.12em`, tilted −4°, `0 1px 2px rgba(0,0,0,.35)`.** Priority, highest first; the first that applies wins, the rest never show:

| Sticker | Stock | Ink | Ratio | When |
|---|---|---|---|---|
| SEALED · [date] | cream `#F2E8D2`, 2 px amber left rule | aubergine `#2A1B38` | 13.1 | the seal is unbroken (sits on the film, lower left; see CR6) |
| NEW | butter `#F3DC86` | aubergine | 11.7 | seal broken, `addedAt` within 14 days |
| 3 FRIENDS | highlighter pink `#F7B6C8`, pill | aubergine | 9.5 | friends own it (RF20 era); tap for who |
| 24 / 96 | process blue `#0077B6` | white | 4.9 | hi-res tier; shows the real rate and depth |
| metal dot | matte gold `#C9A227` / silver `#B9B29E` / bronze `#B07440` / platinum `#C9CFD3`, 14 px, radial highlight | none | | an earned metal |
| none | | | | most records |

Why this kit: two of the three colour references put NEW on cream or butter, not on the accent; the third's fluorescent yellow is kept out because amber then has a yellow neighbour. Process blue is the one saturated printer's ink in the set and amber's opposite. Pink is "someone marked this". Gold foil on uncoated stock reads brown, so the dot is matte, not `#FFC30B`.

## The catalog card (CR4)

Cream stock `#EFE6D2`, radius 2, a 4 px aubergine head rule, `--sh-1`. Lines: title (Antonio 20/700), artist (14), then mono 10 at `.10em` in `#5A4A52` (6.7:1): `[LABEL] · [CAT. NO.] · [YEAR] · 10 TRACKS · 41:12`. Label and catalog number come from `details.label` / `details.catalog` (already parsed by `library/tags/`); when both are empty the line falls back to `[GENRE] · [YEAR] · 10 TRACKS`. A second mono line, `PLAYED 12 TIMES · LAST SPUN TUE`, appears once the record has been played. Play is the solid 48 px accent disc at the right. The SEALED text chip is replaced by the cream tag at 60%.

## Gestures (CR5)

- **Tap**: gatefold, as today.
- **Pull**: dragging the front record upward past 40% of its height commits; the record slides out of the sleeve as it rises (the existing sleeve-pull art), then the gatefold opens with the disc already out. Released early it drops back with the existing spring. Under reduced motion the pull is a tap.
- **Hold** (450 ms): Play next · Add to queue · Pin to staff picks · Sleeve note. A small cream card above the record.
- **Flip**: unchanged (momentum, rail, wheel, keyboard).
- The pull never fights the vertical flip: a drag that starts on the front record and moves up more than 24 px before it moves 12 px in either flip direction is a pull; otherwise it is a flip. State machine in `crate/view.js`'s existing pointer handlers.

## Sealed records (CR6)

The film carries the message; no orange.

| Layer | Value |
|---|---|
| milk | `rgba(255,255,255,.04)` over the whole cover (film lowers contrast) |
| specular band | `linear-gradient(118deg, …)` with `#DDEBF2` at 14% peak, a second band at 9%; tinted 30% with the current phase colour |
| film edge | 1 px `rgba(255,255,255,.18)` inset border, plus one crease line `rgba(255,255,255,.22)` at −0.6° near the top |
| tear strip | **top** 22 px (moved from the bottom edge, Ken, 2026-10-23 — the opening edge, matching the shrink-wrap's own tear tab), bone `rgba(244,241,233,.92)`, a dashed perforation below it `rgba(42,27,56,.45)`, `PULL TO OPEN ▸ ▸ ▸` in 8 px aubergine mono, a 44 × 30 pull tab at the right |
| tag | the SEALED · [date] sticker, lower left, on the film |

**Breaking the seal**: rest → tear (the strip peels leftward along the perforation, 380 ms, film staggered 60 ms behind) → lift (film slides up and off, 420 ms; contrast returns; the tag goes with it) → opened (full-contrast art, butter NEW tag for 14 days). Reduced motion: film fades out in 150 ms. The sealed sheet's header cover uses the same film at 64 px; its footer reads "Still sealed. Play breaks the seal." `sealedQuietPlay` and the play-breaks-seal rule are unchanged.

## Pressings and metals (CR7)

The catalogue grows from 12 to **40 solids in nine families, 32 two-ink effects and four rare**. Three stops are label ring / body / rim. **Opaque**: ring a touch lighter, rim darkest. **Translucent**: body is the lightest, most saturated stop; ring and rim darker; rim greyer. Each name carries a one-line sleeve note in the look picker (write them in the PR; under 20 words, Miziki's own voice).

**The draw.** `selectVariant()` keeps hashing the album name alone, so **a record presses the same in every crate that holds it**: two friends with the same album have the same Verdigris, and can say so. Variety between crates comes from the size of the catalogue (two different records rarely share a colour) and from the file: the tier decides the shelf.

| File | Shelf | Mix |
|---|---|---|
| Lossy (tier 1) | Jet only | 100% |
| Lossless (tier 2) | the 40 solids | 85% solid · 15% Jet |
| Hi-res (tier 3) | the 32 effects | 70% effect · 25% solid · 5% Jet |

That is the incentive: a better file is a more interesting record, and a friend's Jet copy of your Verdigris says "lossy" without a word. Rare pressings (Ultra clear, Picture disc, Glow, Liquid filled) still come from sessions through the existing rare unlock, never from the file.

**Rarity bands (light banding).** The album hash first picks a band, then a colour inside it, so a record still presses identically in every crate. Within a tier: **common 60%** of draws, **uncommon 30%**, **scarce 10%**. A scarce solid turns up in about 1 in 60 lossless albums, a scarce effect in about 1 in 50 hi-res albums. In a simulation, banding adds roughly 12% to the number of albums needed to see every colour (about 190 lossless albums for the solids, 145 hi-res for the effects), so a full chart stays a long collection rather than a closed door.

| Tier | Common | Uncommon | Scarce |
|---|---|---|---|
| Solids (40) | 20: Oxblood, Madder, Vermilion, Coral, Blush, Ochre, Sienna, Sepia, Puce, Isabelline, Chalk, Olive, Teal, Petrol, Prussian, Woad, Ultramarine, Indigo, Payne's grey, Graphite | 14: Rose, Turquoise, Viridian, Verdigris, Umber, Bone, Celadon, Powder blue, Heliotrope, Mauve, Grape, Terracotta, Pine, Smoke | 6: Fuchsia, Aquamarine, Emerald, Cobalt, Tyrian, Caramel |
| Effects (32) | 16: Woad & Madder, Prussian & Bone, Oxblood split, Jet & Bone, Mauve Measles, Soot, Verdigris on Jet, Payne's Smoke, Teal & Coral, Grape & Chalk, Olive & Terracotta, Ultramarine & Verdigris, Pine split, Rose split, Prussian & Ochre, Oxblood ring | 11: Tyrian split, Serpentine, Jasper, Sodalite, Heliotrope ring, Teal ring, Rose Smoke, Tobacco Smoke, Minium & Vermilion, Viridian & Ochre, Coral on Teal | 5: Lapis, Malachite, Rhodonite, Ember, Sea Smoke |

Jet is not banded (tier 1 is only Jet). Rare (session) pressings sit outside the bands. The draw is: band from the first 32 bits of the album hash, colour from the next 32 (`floor(frac * band.length)`), so adding a colour to a band never reshuffles another band.

**Tier 1.** Jet `#2B2622 · #1A1716 · #0C0B0A` (warm black; today's is cool). *Decided:* Jet can take a **paper label** `#EFE9DF` with an olive ring `#3E3D22` (9.2:1), behind Settings › Playback › "Paper label on lossy files", **off by default**; amber label otherwise.

**Tier 2, 40 solids.** T = translucent.

| Family | Name | Ring · Body · Rim |
|---|---|---|
| Reds | Oxblood | `#8A2E2A · #6B1F1C · #3E1210` |
| | Madder | `#B5433A · #9A3328 · #5C1A14` |
| | Vermilion | `#D94A32 · #C4302B · #6E1712` |
| | Terracotta | `#D3694A · #C05131 · #7E3119` |
| Pinks | Coral | `#E8806A · #D4674F · #8A3A2A` |
| | Rose T | `#C45C7A · #D97A96 · #7A2E48` |
| | Blush | `#F0D0C8 · #E3B8AE · #B48A80` |
| | Fuchsia | `#B03A78 · #9A2B66 · #5E1A3E` |
| Earths | Ochre | `#B8862E · #9A6E22 · #5E4212` |
| | Sienna | `#A0522D · #8B4426 · #4F2412` |
| | Caramel T | `#B07A45 · #C99458 · #6B4522` |
| | Umber ("root beer") T | `#6B4A2E · #8A6238 · #3E2A18` |
| | Sepia | `#6A4F3A · #4E3728 · #2A1D14` |
| | Puce | `#9C6E72 · #7E555A · #4F3337` |
| Whites | Isabelline | `#EDE3CF · #DCCDB0 · #B8A684` |
| | Bone T | `#F1EDE3 · #DED7C7 · #A9A69B` |
| | Chalk | `#F4F1EA · #E6E2DA · #B9B5AC` |
| | Celadon | `#9FB8A4 · #86A28C · #5D7564` |
| Greens | Olive | `#6E7A3A · #4A5527 · #2B3115` |
| | Pine | `#1E4D3A · #2A6A4F · #102A20` |
| | Verdigris ("sea glass") T | `#3F8C7E · #5BAA99 · #2A5E54` |
| | Viridian T | `#1F6B5A · #2E8A74 · #133F35` |
| | Emerald T | `#2E8B57 · #3FA873 · #1B5A38` |
| Teals | Teal | `#1F6F73 · #28868B · #123F42` |
| | Turquoise T | `#2F9BA8 · #49B8C4 · #1E6670` |
| | Aquamarine T | `#8FD3CF · #A9E0DC · #5E9D99` |
| | Petrol | `#204A52 · #2C5E68 · #13303A` |
| Blues | Prussian T | `#1F3F66 · #2B5586 · #122540` |
| | Cobalt T | `#2A4FA0 · #3660BE · #172B5C` |
| | Woad | `#2B4A7A · #3B6192 · #1A2E4A` |
| | Ultramarine | `#1E3A8A · #2949A6 · #101F4A` |
| | Indigo | `#2C2F5E · #3B4080 · #1A1C3A` |
| | Powder blue | `#CFE4F2 · #B9D9EB · #8FB0C4` |
| Purples | Heliotrope | `#8A63A8 · #6C4A8A · #44305A` |
| | Tyrian | `#6E2448 · #5B1A3C · #3A0F26` |
| | Mauve | `#9B6B9E · #7E5280 · #4E3250` |
| | Grape | `#6D4198 · #582C83 · #361A52` |
| Greys | Smoke T | `#A9A7A4 · #6E6C69 · #2E2D2C` |
| | Payne's grey | `#4A5565 · #3C4654 · #232A33` |
| | Graphite | `#55585C · #3F4245 · #222426` |

No yellow brighter than Ochre, and no orange: either fights the amber label. Blush and Aquamarine are the pale limits of their families, kept tinted enough to read apart from the Whites at crate size.

**Tier 3, 32 two-ink effects.** Swirls are two or three feathered streaks, never a wheel. Splatters are small, dense, one ink. Marbles carry veins of the second ink. Rings are one colour inside another.

| Name | Pattern | Inks | Rim |
|---|---|---|---|
| Woad & Madder | swirl | `#2B4A7A` / `#B5433A` | `#1A1A22` |
| Minium & Vermilion | swirl | `#E0552A` / `#C4302B` | `#5C1512` |
| Prussian & Bone | swirl | `#2B5586` / `#DED7C7` | `#122540` |
| Viridian & Ochre | swirl | `#2E8A74` / `#9A6E22` | `#133F35` |
| Oxblood split | split, 4 px soft seam | `#6B1F1C` / Isabelline `#DCCDB0` | each side's dark |
| Tyrian split | split | `#5B1A3C` / `#DCCDB0` | each side's dark |
| Jet & Bone | split | `#1A1716` / `#DED7C7` | each side's dark |
| Lapis | marble | `#1E3A8A` body, `#E9E4D6` veins, `#C9A24A` flecks | `#101F4A` |
| Malachite | marble, banded | `#2E8A74` / `#133F35` | `#0E2E27` |
| Serpentine | marble | `#4A5527` / `#9FB8A4` | `#2B3115` |
| Mauve Measles | splatter | `#9B6B9E` on Isabelline `#DCCDB0` | `#B8A684` |
| Soot | splatter | `#1A1716` on Chalk `#E6E2DA` | `#B9B5AC` |
| Verdigris on Jet | splatter | `#5BAA99` on `#1A1716` | `#0C0B0A` |
| Payne's Smoke | smoke (T) | `#2E333D · #5A6372 · #1E2229`, drifting `#8A93A0` | |
| Tobacco Smoke | smoke (T) | `#4E3728 · #8A6238 · #2A1D14`, drifting `#B8862E` | |
| Heliotrope ring | ring | `#6C4A8A` inside Ochre `#9A6E22` | `#5E4212` |
| Teal & Coral | swirl | `#28868B` / `#D4674F` | `#123F42` |
| Grape & Chalk | swirl | `#582C83` / `#E6E2DA` | `#361A52` |
| Olive & Terracotta | swirl | `#4A5527` / `#C05131` | `#2B3115` |
| Ultramarine & Verdigris | swirl | `#2949A6` / `#5BAA99` | `#101F4A` |
| Pine split | split | `#2A6A4F` / Bone `#DED7C7` | each side's dark |
| Rose split | split | `#D97A96` / Chalk `#E6E2DA` | each side's dark |
| Prussian & Ochre | split | `#2B5586` / `#9A6E22` | each side's dark |
| Rhodonite | marble | `#D97A96` body, `#3C4654` veins | `#7A2E48` |
| Jasper | marble | `#8B4426` body, `#B8862E` veins | `#4F2412` |
| Sodalite | marble | `#3B6192` body, `#E6E2DA` veins | `#1A2E4A` |
| Coral on Teal | splatter | `#E8806A` on `#28868B` | `#123F42` |
| Ember | splatter | Ochre `#B8862E` on Oxblood `#6B1F1C` | `#3E1210` |
| Rose Smoke | smoke (T) | `#8A4A60 · #B8678A · #5A2E40`, drifting `#E3B8AE` | |
| Sea Smoke | smoke (T) | `#1F5A62 · #3A8A94 · #123F42`, drifting `#A9E0DC` | |
| Teal ring | ring | `#28868B` inside Coral `#D4674F` | `#8A3A2A` |
| Oxblood ring | ring | `#6B1F1C` inside Bone `#DED7C7` | `#A9A69B` |

**Rare** (sessions, as today): **Ultra clear** `rgba(244,241,234,.9) · rgba(230,226,218,.55) · rgba(169,164,154,.9)` over the sleeve art; **Picture disc**, the cover art printed on the disc with a Jet rim and grooves at 50%; **Glow** `#D6F2D0 · #B8E8B0 · #7FAE78`, a phosphor green-white with a soft outer glow (`0 0 18px rgba(170,240,160,.55)`) that reads brightest in the dark theme; **Liquid filled**, Ultra clear with a band of Verdigris (`rgba(63,140,126,.85)` → `rgba(91,170,153,.9)`) that slides across the disc as it spins, its angle following the platter rather than the light.

`variantBackground()` gains `marble`, `smoke` and `ring`; `swirl` changes from a conic wheel to feathered streaks; `splatter` becomes small, dense spots in one ink. Old ids map to new ones in one table so saved looks keep working.

**Metals.** A metal is a *finish* laid over the pressing (a gold Verdigris keeps a verdigris rim). Replace the conic wedge with a brushed finish: one narrow specular band (6–10% of the diameter, feathered) fixed to the light while the disc spins, a broad mid-tone, a deep shadow opposite, fine concentric lines at 6%, and a 3 px rim ring of the underglow.

| Metal | Base | Highlight | Shadow | Rim underglow | Label |
|---|---|---|---|---|---|
| Bronze | `#B07A3C` | `#E3B77A` | `#5A3516` | `#8A3A1E` | amber |
| Silver | `#A9ADB4` | `#EDEFF2` | `#4D5259` | `#2E3238` | amber, 3 px aubergine ring |
| Gold | `#D6AD3F` | `#F7E7A8` | `#7A4E12` | `#8A3A1E` | **inverted**: aubergine disc, amber mark, 2 px `#7A4E12` ring |
| Platinum | `#D3D7DC` | `#F8F9FA` | `#8A9199` | `#B9C4D0` | inverted, 2 px `#8A9199` ring |

Rule: a metal lighter than amber inverts the label (amber on gold is 1.03:1). `METAL_COLORS` becomes a table of four values per metal; `metalBackground()` draws the band.

## Pressings between friends (CR11)

- **Records in common** shows each copy's pressing side by side under the sleeve: "Both Verdigris", or "Yours: Verdigris · Ken's: Jet". No judgement in the copy; the Jet speaks for itself.
- **The record sheet** names the pressing and its sleeve note: "Verdigris. The green that grows on copper." and, when a friend's copy differs by tier, one line: "Ken has a Jet copy."
- **The pressing chart**: a cream catalog card on your own profile, a paint-chip strip of the colours in your crate in family order, with owned chips at full strength and missing ones at 18%. Scarce pressings carry a small ink dot on their chip, owned or missing. Your own card shows `23 OF 40 · 6 OF 32` and names a few missing ones; a **friend's card shows their chips with no numbers**, so it is something to look at, never a score. Tapping a chip jumps the crate to the first record in that pressing.
- **The look picker** shows, for a lossy record, one quiet line: "A lossless copy would press in colour." Not a nag; it appears once per record and never on the player.
- Nothing here ranks people. Counts are first-person only (RF11's rule).

## Palette additions (CR8)

**Amber ramp.** `--amber-tint #F8E2C2` · `--amber #FF9E2C` · `--amber-shade #C47F1E` (dark) / `#9A4700` (light). The shade is 5.4:1 on `--sky2`, 4.2:1 on midday `--sky1`: for 14 px+ bold, icons and fills, not small text. Uses: pressed states, divider lettering on dark, the awning's deeper stripe, inactive accent glyphs.

**Secondaries** (shades only, never full saturation beside amber): Prussian `#2B5586`, Verdigris `#3F8C7E`, Puce `#7E555A`, Olive `#6B6A3A` (bridge; deep `#3E3D22`). Paper text on them: 6.3 / 3.3 / 5.2 / 4.6, so Verdigris carries only 14 px+ bold or icons. Warm grey `#8C8279` for rules and disabled (4.7:1 on sky).

**Stock.** Divider `#E6DCC4 → #CFC2A3`, lip `#B5A684`; manila `#E8D9A8`; catalog card `#EFE6D2`; bone `#F4F1E9`; bin `#8E7A60 / #6F5A45 / #4D3D2F`; plinth warm black `#1C1A1F` with a `#2A272C` top edge (darker than any record body, so Jet lifts off it).

**Light theme.** Ink `#26202C` (14.1:1; aubergine-black instead of the sky's blue-black). Muted `#6B6258` (4.8:1 on `#ECE5D8`, 5.3:1 on `#F6F1E7`). Phase anchors lean into their hue: Golden `#F8E2C2`, Dawn `#F7E1DE`, Night `#E4DFEE`, Twilight `#F2E2E5`. Light phase chips use the secondaries with cream text, not the dark-mode pastels.

**Sky.** Golden `#352A24` and Twilight `#33232E` confirmed (raw umber, puce). Golden's phase chip warms to `#F2B35C` so it is not amber's twin. Everything else unchanged.

**Era tints** (20–25% over divider stock plus a 6 px edge stripe; lettering stays aubergine). Pre-1950 shares the 1950s row. 2000s onward are extrapolated from the published colours of the year and are flagged as such.

| Decade | Three tints |
|---|---|
| 1950s | `#99C5C4` `#BF6464` `#4E6E68` |
| 1960s | `#5A77A8` `#702F3B` `#784384` |
| 1970s | `#676232` `#B68A3A` `#754734` |
| 1980s | `#384883` `#AD5E99` `#798EA4` |
| 1990s | `#807396` `#739072` `#40312F` |
| 2000s* | `#9BB7D4` `#5A5B9F` `#9B1B30` |
| 2010s* | `#009473` `#955251` `#5F4B8B` |
| 2020s* | `#0F4C81` `#6667AB` `#A47864` |

**Three rules.** Amber never signals state (not new, not error, not a selected fill): identity only. No second warm in the chrome: burnt orange, harvest gold and chrome-yellow gold stay inside era tints and pressings. No mauve as a neutral, and no amber in a three-colour stripe with white-and-green or white-and-blue.

## The rest of the library (CR9)

- **Artists**: 72 px rows; a fanned stack of up to three 44 px covers (rotations 0°, −3°, +8°) in place of the disc icon; name 16/600, `N records · years` 14 muted; sticky letter heads (Antonio 20, muted) and the crate's rail reused at the right.
- **Artist page**: name 36, count line; a **shelf** (a 10 px rail `#8E7A60 → #4D3D2F`) with 128 px sleeves by year, slight alternating tilt, swipeable; PLAY ALL solid, SHUFFLE and CREDITS as text buttons; then tracks grouped by album.
- **Playlists**: a 2 × 2 grid of compilation sleeves: four covers under a cream title strip (`#EFE6D2`, Antonio 16 + mono 8 meta); Favorites first with an amber heart. Empty: one sleeve with a dashed strip, "Make your first playlist."
- **Songs**: sticky letter heads and the rail, for libraries over 200 tracks.
- **Search** results show sleeves for album hits.

## Desktop crate (CR10)

- The detail panel **follows the front record**: catalog card, text actions (CREDITS · PIN · SLEEVE NOTE), the tracklist split by side. No "Tap a record" placeholder; no duplicate play under the stack.
- The rail docks 16 px from the stage's right edge; the stage uses the full height (six tops visible, a 150 px lip).
- Sidebar gains a **BINS** list (New arrivals, Staff picks, Sealed, with counts) above PLAYLISTS. The crate-order control gains **DECADE** (era dividers, CR8).
- The sidebar's Appearance control is gone (RF8).

---

## Decisions for Ken

1. **Variant names in the UI.** Pigment names (Oxblood, Prussian, Verdigris…) versus collector names where they differ (Sea glass, Root beer). The mockup shows pigment names with the collector name as the sub-line.
2. **Tear-strip copy.** `PULL TO OPEN ▸ ▸ ▸` or no words on the strip.
3. **Era dividers.** Only under the new DECADE grouping (default), or also as a tint on every record's catalog card.
4. **Shelf tilt on the artist page.** Alternating ±1.5° (drawn) or flat.
5. **Awning.** Keep the amber-and-cream scallop trim from RF11, or move to Verdigris-and-cream with an amber "open" sign. The references split; the plan keeps amber.

## Out of scope here

Grain texture (RF15), the gatefold itself, the platter label beyond the Jet decision, social stickers' data (RF20–23), and any change to `computeRate()` or playback.
