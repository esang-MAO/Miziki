# 18 · Share cards: five cards, one sheet

**Goal:** stop fitting everything into one card. Today the crate card holds six sections in one square and the wording collides; the Now Playing card lives in the player's `···` overflow where nobody finds it. This doc splits sharing into five cards, each with one job, and puts a visible Share action back in the player. Every card is composed off-screen (never a screenshot), same as before.

**Mockups and exact values:** `docs/design/share/README.md` (SH1–SH6) and the canvas files beside it ("Miziki Share Cards"). Where this doc and that README disagree on a value, the README wins.

## Where this came from (Oct 26)

A read of `src/share/crate-card.js` and `now-playing-card.js` against the sheet markup in `miziki.html` (`#shareOverlay`, `#playerShareOverlay`) and RF10's "one good default" pass. The crate composer stacks hero, grid, top album, songs, metals, collection and the rhythm verdict down one 1080 px square; in Story it becomes one column and the right-hand sections are kept in sync with the left by hand (`rightY = leftY`), which is where the overlaps come from. The player card is fine as a composition but its chip row, clock and title clearance are all fixed-pixel and crowd each other on a long title.

## What the audit found

- **One card, six sections.** Albums, songs, metals, collection, name and rhythm all compete for the same square. Turning sections off with the Include toggles is the only way to make it readable.
- **Overlaps are structural, not a tuning bug.** Column syncing in Story and fixed `w*0.0xx` steps in Square mean any long title or a fourth song row pushes into the next section.
- **The Now Playing share is hidden.** `#playerShareBtn` is an overflow-menu row, `display:none` until a track loads.
- **The collection has no card.** Pressings are a row of six colour dots on the crate card; the record they belong to is never shown.
- **Metals and rhythm are decoration on the wrong card.** They are the profile's "Listening" story, not the crate's.

## Shared rules for every PR in this doc

- Read CLAUDE.md first, then `docs/design/share/README.md`. One PR at a time; each waits for Ken's go-ahead.
- **Composers stay pure.** Each takes `{style, format, data}` (or `sections`) and returns a canvas; no DOM reads inside a composer. The sheet gathers data and passes it in, as `renderPlayerShareCanvas()` already does.
- **Night is the default style; Cover and Paper keep working** through `resolveShareStyle()`. The README's values are Night; the other two kits swap ink/sub/accent only.
- **Story 9:16 and Square 1:1 only**, per RF10. Portrait stays in `SHARE_FORMATS` for saved choices but no sheet offers it.
- **Privacy rules from RF20 hold.** Metals and the rhythm verdict never leave the user's own cards; nothing on any card compares two people's counts. "Spun at dusk" stays behind the Time of day toggle. The friends sticker on the Record card counts friends only (mutual follows) and shows only when the owner's "count me in friends' stickers" switch allows it.
- **Rating is decoration.** The ticks on the Record card never sort, filter or rank anything (RF20 rule 2).
- **Text never overlaps.** Every text block is measured with `shareFitLines` / `shareFitText` and the next block's `y` is derived from the measured height, never from a fixed fraction of `h`. A card with three chips wraps them to a second row.
- Lint and tests pass; `tests/unit/share.test.js` gains a case per new composer for its pure selection logic (which records, which order), not for pixels.

Build after RF10 and RF20. SH1 (the sheet) first; SH2–SH6 in any order after it.

---

## SH1: one share sheet, five entry points

> Read CLAUDE.md and `docs/design/share/README.md` first. Replace the two share overlays with one.
>
> 1. **One `#shareOverlay`.** Delete `#playerShareOverlay` and its wiring. The sheet takes a `card` key on open — `openShareSheet({card, data})` — and renders through a `COMPOSERS[card]` table: `nowPlaying`, `record`, `pressings`, `crate`, `season`. Title in the head reads the card's name ("Share · Now Playing").
> 2. **Format segment** stays Story / Square. Each card has its own default (README table); `S.shareFormat` is remembered per card as `S.shareFormatByCard[card]`, replacing the single `shareFormat`.
> 3. **More options** keeps Style (Night / Cover / Paper) and Include, but the Include toggles are per card: Now Playing → Time of day; Record → Sleeve note, Friends; Crate → Name; Pressings → none; Season → Name. `S.shareSelection` becomes `S.shareSelectionByCard`, session-only as now.
> 4. **Entry points.** Player: a Share button beside the `···` button in the player's control row (icon button, `aria-label="Share"`), hidden until a track loads, same rule as the old overflow row — remove the overflow row. Record sheet / gatefold: a "Share record" row. Profile › Records › Pressings: a Share button in the screen header. Profile home: the existing Share button becomes two rows, "Share crate" and "Share season" (the second only once the rhythm card is unlocked, ≥ 20 plays in the 90-day window). Friends' crates never show a Share action.
> 5. **Filenames**: `miziki-<card>-<format>.png`.
> 6. **Tests**: the open/close path through `nav-stack.js` for each card; `shareSelectionByCard` defaults; a Playwright pass that opens each card from its entry point on the synthetic library.

## SH2: Now Playing, re-spaced

> Read the README's SH1 board. `composePlayerShareImage` keeps its signature and its disc-behind-jacket composition; only spacing changes.
>
> 1. The title band is laid out as a group: kicker, title (≤ 2 lines, `shareFitLines`), artist, `ALBUM · YEAR`, with the gaps in the README. The clearance under the title is the measured title height plus one gap, never `h*0.055`.
> 2. The progress line moves 40 (story) / 32 (square) below the band, and the clock sits under the line, not inside the chip row.
> 3. Chips are laid out with wrapping: measure all, fit as many as go on one row centred, carry the rest to a second row. Three chips in Square always wrap.
> 4. The brand footer is pinned to `safeBottom` minus the README's footer height; content never grows into it (if it would, the chip rows are dropped first, then `ALBUM · YEAR`).
> 5. Tests: a long-title case and a three-chip case through the pure layout helper (extract `layoutChips(ctx, chips, maxW)` into `styles.js` and test that).

## SH3: Record card (new)

> Read the README's SH2 board. New `src/share/record-card.js`, `composeRecordShareImage({style, format, data})`.
>
> 1. `data` is gathered by the gatefold: `{album, artist, year, art, variant, metal, look, speed (33 | 45), rating, note, friendsCount, ownerName}`. The composer reads nothing else.
> 2. Left: the sleeve (cover) with the record pulled part-way out to the right in its real pressing — reuse `fillShareDisc()` from `now-playing-card.js` (move it to `styles.js`; both cards import it). Rare and metal looks resolve exactly as on the platter.
> 3. Right column: `PRESSING` kicker, the pressing name in Antonio, `FINISH · BAND · SPEED` in mono, five rating ticks (filled count = rating, none drawn when unrated).
> 4. Below: album title (one line, ellipsis), `Artist · Year`, the sleeve note in italic, clipped at two lines with `shareFitLines`. No note → the block is omitted and the footer rises.
> 5. Footer: friends sticker left (`IN N FRIENDS' CRATES`, omitted when 0 or not permitted), wordmark + `[NAME]'S CRATE` right.
> 6. Square is the default format; Story centres the same layout in the safe band with the sleeve scaled up.
> 7. Tests: tick count from rating, note omission, sticker gating.

## SH4: Pressings card (new)

**Superseded by docs/24_QUIET_COUNTS.md:** pressings and metals are shown as found, never counted (no "N of M", blanks or missing lists).

> Read the README's SH3 board. New `src/share/pressings-card.js`, `composePressingsShareImage({style, format, data})`.
>
> 1. `data.records` = `Object.values(S.collection)` sorted by `discoveredAt` descending, **newest first**, gathered by the Records screen; `data.counts` = per-family counts (solids / effects / rare / zoetropes) from `collectionGroups()` extended for the 110 chart; `data.total` = the chart size from `tiers.js`.
> 2. Header: `PRESSINGS` kicker, `N of 110` in Antonio, the family counts in mono.
> 3. Grid: 3 columns × 4 rows (Story) / 3 × 2 (Square). Each tile is the pressing disc in front and its record's cover tucked behind to the left, then the pressing name (mono, uppercase, ellipsis) and the album title (sub colour, ellipsis). Discs are drawn with `fillShareDisc()` so zoetropes, metals and rares look as they do in the app. A rare pressing's name is drawn in the accent colour.
> 4. Below the grid: `+ N MORE · NEWEST FIRST` when the collection exceeds the tile count; nothing when it fits.
> 5. Footer: wordmark + `[NAME]'S CRATE · EARNED BY LISTENING`.
> 6. Empty collection: the sheet's Share button is disabled and the Records screen's Share button is hidden until the first pressing is discovered.
> 7. Tests: ordering, tile count per format, the "+ N more" line, family counts.

## SH5: Crate card, slimmed

> Read the README's SH4 board. `composeShareImage` in `crate-card.js` loses metals, collection and rhythm.
>
> 1. Header unchanged (avatar, `[NAME]'S CRATE` or `MY CRATE`, `N RECORDS · N TRACKS` — "records", not "albums", matching the crate's header line from CR1).
> 2. Hero + 2 × 2 grid of the next four top albums in Square; hero + a row of four in Story.
> 3. `01 · TOP ALBUM` block, then `TOP SONGS` as three full-width rows (Square) / five (Story). Rank in the accent colour; artist in sub, right of the title, never wrapping.
> 4. Delete the metals, collection and rhythm sections and their Include toggles. `sections` keeps only `name`.
> 5. The wordmark sits bottom-right, not centred, so the songs list can run to the bottom padding.
> 6. Tests: update `share.test.js` for the removed sections.

## SH6: Season card (new)

> Read the README's SH5 board. New `src/share/season-card.js`, `composeSeasonShareImage({style, format, data})`.
>
> 1. `data` from the profile's Listening screen: `{verdict, shares, total}` from `computeRhythmShares(windowedPhaseCounts(...))` and `rhythmVerdictLabel`, plus `metals` = per-tier counts from `achievementsList()`, `playedThrough` = achievements count, `ownerName`.
> 2. Header: `THIS SEASON · LAST 90 DAYS` kicker; the verdict sentence in Antonio as the headline (sentence case, RF22 wording, never uppercased).
> 3. Ring: a seven-wedge conic ring in `PHASE_COLOR` order from `rhythm-card.js` (export the table), faint groove rings over it, the 90-day play count in the centre. Legend to the right: dot, phase label, share %, sorted by share descending.
> 4. `METALS` row: one disc per tier with the count inside, brushed gradient from `METAL_COLORS` (highlight / mid / shadow), then `N RECORDS PLAYED THROUGH`. Tiers with 0 are omitted; no metals at all → the row is omitted.
> 5. Footer: wordmark + `[NAME]'S CRATE` bottom-right. Square default; Story stacks the ring above the legend.
> 6. Locked (< 20 plays in the window): the entry point is hidden (SH1 item 4); the composer is never called locked.
> 7. Tests: legend order, zero-tier omission, the lock threshold shared with `rhythm.js`.
