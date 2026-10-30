# 13 · The crate: a bin, not a stack

**Goal:** the library should look and handle like a record store. The crate gets a bin to sit in, dividers that poke up, one sticker per sleeve, a catalog card, bins for new arrivals and staff picks, and a way to pull a record out. Sealed records get a film that does the talking. The disc variants and metals become pressings and finishes rather than crayons and pie charts. The rest of the library (artists, playlists, songs, search) picks up sleeves.

**Mockups and exact values:** `docs/design/crate/README.md` (CR1–CR11) and the canvas files beside it ("Miziki Crate"). Where this doc and that README disagree on a value, the README wins.

## Where this came from (Oct 18)

A second pass after `12_REFINE.md`, with five colour references read against the code and against a swatch sheet rendered from Miziki's own `VARIANT_DEFS`, `METAL_COLORS` and sealed-record CSS: Sutton's *Pocket Complete Color Harmony*, St Clair's *The Secret Lives of Color*, Adams's *Designer's Dictionary of Color*, Eiseman and Recker's *Pantone: The Twentieth Century in Color*, and a Pantone solid chart. The three readers agreed on the big calls independently: warm the black, push every solid off its primary hue, make effects two-ink, brush the metals, keep the bin grey-brown, and take orange out of the "new" signal.

## What the audit found

- **The crate is a stack of cards on the sky, not a bin.** Three record tops show, then the stack fades out. Nothing holds the records.
- **Dividers are full-size cream cards.** They read as "a record with a letter on it", and they appear only from 20 records. There are no artist dividers.
- **The info line is a genre line.** `INDIE ROCK · 1990 · 10 TRACKS`, though the tag parser already has label and catalog number.
- **The crate opens on `#`.** No new-arrivals or staff-picks bin at the front, though `addedAt` and pins exist.
- **The sealed overlay is nearly invisible next to its badge.** A faint sheen and a thin perforation under a 20%-wide orange NEW dot: the accent used for a state.
- **Twelve variants for all the music there is.** Tier-2 solids are flat primaries (red, blue, yellow, green, purple), the yellow fights the amber label, and tier-3 effects are rainbow wheels or two-colour polka dots. With six solids, two different lossless albums share a colour one time in six; with forty, a crate of fifty lossless albums still has gaps on its chart to fill.
- **Metals are pie charts.** A 60° highlight wedge and a 45° shadow wedge; gold is chrome yellow, not a metal; amber on gold is 1.03:1, so the label disappears.
- **The rail is 8.5 px at 65% opacity**, under the floor RF13 set.
- **Desktop**: the panel says "Tap a record to see its track list" over 440 px of empty sky; the rail floats far from the stack; the play button duplicates the panel's.
- **Artists, playlists and songs** use generic icons; nothing in those views says "records".

## Shared rules for every PR in this doc

- Read CLAUDE.md first, then `docs/design/crate/README.md`. One PR at a time; each waits for Ken's go-ahead.
- **iOS gesture rule (rule 9):** `bgPrime()` stays the first call in `play()`, before any `await`. The pull gesture and the seal tear change what happens *before* `play()` is called, never what `play()` does.
- **Pure means untouched.** Nothing here changes audio.
- **The 95% rule, sessions and metals thresholds are untouched.** CR7 changes how a metal looks, never how it is earned.
- **Saved data survives.** A user's unlocked looks, `albumLookPref` and rare unlocks keep working; renamed variants map old ids to new ones in one place (`record-art/tiers.js`), with a test.
- **One sticker per sleeve**, by the README's priority list. No PR adds a second.
- Tokens from RF13 (`--fs-*`, `--sp-*`, `--sh-*`) are used throughout; no new literal sizes.
- Lint and tests pass; both builds preview cleanly; NV1's perf numbers show no regression (the crate is the one screen that scrolls 2,000 records).

Build after RF9 and RF26 (the three-tab bar) and alongside Phase C; CR1 before CR2–CR5; CR6 and CR7 are independent of the rest; CR11 waits for RF20.

---

## CR1: the bin

> Read CLAUDE.md and `docs/design/crate/README.md` first. The crate gets a bin to sit in; nothing about flipping changes.
>
> 1. **Stage** height 316 → 420 px on phone (`--crate-stage-h`); `CRATE_VISIBLE_A` so that six record tops show above the front record. Adjust `flowPose()`'s `opts.spread` for the extra depth rather than changing the pose math; the launch intro shares it and must look the same.
> 2. **Front lip**: a new `.crate-lip` element at the bottom of `.crate-stage`, 330 × 118, cardboard tones per the README, lit top edge, drawn above the lower records and below the front record. It carries the current divider's name (`B · 14 RECORDS`) as a small cream tag.
> 3. **Sky-lit highlight**: `drawSun()` writes `--crate-light` from the current anchor (warm white at Golden, cool at Night); sleeve top edges and the lip's top edge read it. Only written on change, per NV1.
> 4. **Rail**: 10 px mono, `--muted-2`, current letter `--accent` 500; docked 8 px from the stage edge; the bubble unchanged.
> 5. **Header line**: `212 RECORDS · A–Z` left; now-playing as text in the phase colour, right. Remove `.crate-topbar`'s border.
> 6. **Sleeve anatomy** on every `.crate-card`: radius 4, lit top edge, spine shadow, bottom band, `--sh-3` for the current card and `--sh-2` for the rest (replacing the single 14/32 shadow and the amber ring).
> 7. **Empty state**: the empty bin with the lip, one cream card "Fill the crate", and the add button.
> 8. **Tests**: `crate-geometry.test.js` for the spread change; `crate-model.test.js` unchanged; a Playwright pass on the synthetic library for the lip and six tops.

**Preview focus (Ken, iPhone):** the records sit in something. Flipping feels the same.

---

## CR2: bins and dividers

> Read CLAUDE.md and the README first.
>
> 1. **New arrivals** and **Staff picks** bins in `crate/model.js`'s `buildCrateModel()`: two virtual groups before `#`, each with its own divider item and rail entry (`NEW`, `PICKS`); records inside keep their place in the alphabet too (they appear twice, once in the bin and once under their letter; `byAlbumId` points at the alphabetical one). New arrivals = `addedAt` within 14 days, newest first; Staff picks = pins in `pin_rank` order. Either bin hides when empty.
> 2. **Artist dividers**: inside a letter, an artist with three or more records gets a `type:'div'` item with `kind:'artist'` ahead of their records.
> 3. **Divider geometry and stock**: 12% taller than a sleeve with a tab at the left; cream stock, manila for genre; lettering aubergine; the count and year span on the card.
> 4. **Divider catalog card**: title, one line, count, PLAY ALL (outlined aubergine on cream): plays the bin or the artist in order.
> 5. **Crate anchor**: `S.crateAnchor` still restores to the last record; a fresh library opens on New arrivals when that bin exists, otherwise `#`.
> 6. **Tests**: model tests for both bins (membership, order, hidden when empty), artist-divider thresholds, and the double-listing of a new record.

**Preview focus:** import an album; it is at the front of the crate, in its own bin, and under its letter.

---

## CR3: one sticker, and the catalog card

> Read CLAUDE.md and the README first.
>
> 1. **Stickers**: a single `stickerFor(record)` in `crate/model.js` returning at most one of `sealed`, `new`, `friends`, `hires`, `metal`, or none, by the README's priority. Rendered by one `.crate-sticker` element per card, top right, 8 px mono 500, −4°. The stock and ink colours are tokens (`--sticker-cream`, `--sticker-butter`, `--sticker-pink`, `--sticker-blue`, `--sticker-ink`).
> 2. The `friends` sticker reads `S.social` data when signed in and is otherwise skipped; it ships here as a renderer only, fed by RF20's work later.
> 3. **Catalog card** replaces `.crate-info`: cream stock, aubergine head rule, title / artist / `[LABEL] · [CAT. NO.] · [YEAR] · N TRACKS · M:SS`, the played line once played, the solid play disc. Falls back to genre when label and catalog are empty. The SEALED chip becomes the cream tag at 60%.
> 4. **Tests**: `stickerFor` priority (a sealed hi-res new record shows only SEALED; a played hi-res record shows 24/96; a plain lossless record shows nothing); the catalog line's fallback.

**Preview focus:** most sleeves are quiet; the few stickers mean something.

---

## CR4: dividers by decade

> Read CLAUDE.md and the README first. A third crate order, **DECADE**, beside A–Z and GENRE: records sorted by year, with a divider per decade tinted by the README's era table (20–25% over divider stock plus a 6 px edge stripe; lettering stays aubergine). Pre-1950 shares the 1950s row; undated records sit last under "Undated" in plain cream. The rail shows decades. Saved as `S.crateGroup = 'decade'` through `prefs.js` with the usual default-and-test. The desktop crate-order control gains the third option.

**Preview focus:** the 1970s divider isn't orange.

---

## CR5: pull a record out

> Read CLAUDE.md and the README first. Three gestures on the front record, added to `crate/view.js`'s existing pointer handlers as one small state machine; the flip is untouched.
>
> 1. **Pull**: a drag that starts on the front record and moves up 24 px before moving 12 px in a flip direction is a pull. The record lifts with the pointer (transform only, no layout); past 40% of its height it commits: the record slides out of the sleeve using the existing sleeve-pull art, then the gatefold opens with the disc already out. Released early it springs back (the existing `snapTo` easing). Reduced motion: a pull is a tap.
> 2. **Hold** (450 ms, no movement): a cream card above the record with Play next · Add to queue · Pin to staff picks · Sleeve note. Dismisses on scrim tap or Back (NV2's layer stack).
> 3. **Tap**: unchanged.
> 4. **Desktop**: pull is available with a mouse; hold becomes right-click/context.
> 5. **Tests**: the state machine as a pure function over a pointer trace (flip vs pull vs hold), with the thresholds from the README.

**Preview focus:** pulling a record out feels like the sleeve pull in reverse; a flip never turns into a pull by accident.

---

## CR6: sealed records, redesigned

> Read CLAUDE.md and the README first. `src/styles/12-sealed-records.css` and `library/sealed.js`'s `buildSealOverlay()`.
>
> 1. **The film**: a 4% white milk over the cover, a cool specular band (`#DDEBF2` at 14%, a second at 9%) tinted 30% with the current phase colour (read `--phase-color`, written by `drawSun()`), a 1 px film edge and one crease line.
> 2. **The tear strip**: bottom 22 px, bone, a dashed perforation, `PULL TO OPEN ▸ ▸ ▸` (or no words; Ken's call), a 44 × 30 pull tab at the right.
> 3. **The tag**: the SEALED · [date] cream sticker, lower left, on the film; the orange NEW dot is gone.
> 4. **Breaking the seal**: tear (380 ms, film staggered 60 ms) → lift (420 ms) → opened (butter NEW tag for 14 days). Dragging the tab leftward past 50% of the width breaks it; so does Play, as today. Reduced motion: a 150 ms fade. `sealedQuietPlay` and `breakSeal` keep their contracts; only the choreography and the overlay change.
> 5. The sealed sheet's header cover uses the same film at 64 px; its footer copy becomes "Still sealed. Play breaks the seal."
> 6. **Tests**: `sealed.test.js` unchanged in behaviour; add a check that the overlay markup carries no accent colour.

**Preview focus:** a sealed record looks wrapped before you read anything.

---

## CR7: pressings and finishes

> Read CLAUDE.md and the README first. `src/record-art/tiers.js`, `metals.js`, `looks.js`.
>
> 1. **Catalogue**: replace `VARIANT_DEFS` with the README's 40 solids (nine families), 32 two-ink effects and four rare (Ultra clear, Picture disc, Glow, Liquid filled). Each def carries `family`, `finish: 'opaque' | 'translucent'`, its three stops, a `name`, a `sub` (collector name, where one exists) and a `note` (one sentence, under 20 words, Miziki's own voice).
> 2. **The draw is unchanged in kind**: `selectVariant()` still hashes the album name alone, so a record presses the same in every crate that holds it. Tier mixes become lossy = Jet; lossless = 85% solid, 15% Jet; hi-res = 70% effect, 25% solid, 5% Jet. Rare stays with the session unlock. **Light banding**: each def carries `band: 'common' | 'uncommon' | 'scarce'` (the README lists them). Inside a tier's shelf the hash picks a band first (60 / 30 / 10), then a colour inside it, from separate 32-bit slices of the hash so adding a colour to one band never reshuffles another. There is no pity timer, no unlock token and no per-collector salt; completing a chart is a long collection, by design.
> 3. **Patterns**: `variantBackground()` adds `marble`, `smoke` and `ring`; the two new rares add `glow` (a soft outer `box-shadow` on the disc, stronger in the dark theme) and `liquid` (an Ultra clear body with one tinted band whose angle follows the platter's rotation, not the light); `swirl` becomes two or three feathered streaks instead of a conic wheel; `splatter` becomes small, dense, one-ink spots. Translucent finishes render the body lightest and the rim greyest.
> 4. **Old ids map to new** in one table (`solid-red → oxblood`, `effect-split-ab → tyrian-split`, …) so saved `albumLookPref` and rare unlocks keep working. The hash is unchanged, so an album that was a solid stays a solid; it may change colour once, on upgrade, and the changelog says so.
> 5. **Metals**: `METAL_COLORS` becomes `{base, highlight, shadow, underglow}` per metal; `metalBackground()` draws one narrow feathered specular band, a broad mid-tone, a deep shadow opposite, 6% concentric lines and a 3 px underglow rim, over the pressing's own rim. Gold and platinum **invert the label**; silver gets a 3 px aubergine ring; bronze keeps the amber label. Thresholds untouched.
> 6. **Look picker**: grouped by family, then effects; shows name, sub and note. For a lossy record, one quiet line, "A lossless copy would press in colour", shown once per record.
> 7. **Share cards** and profile badges read the new tables through the same functions; `share.test.js`, `profile.test.js` and `metals.test.js` update their fixtures.
> 8. **Tests**: band shares converge to 60/30/10 over a large synthetic library; the same album always lands on the same variant; every def has a band and the README counts (20/14/6, 16/11/5) hold; every variant renders a background string; translucent bodies are lighter than their rims; the old-id map covers every former id; the gold label inverts; the tier mixes sum to 100.
>
> *Decided:* tier-1 Jet gets the paper label (`#EFE9DF`, olive ring `#3E3D22`) behind a Settings › Playback switch, "Paper label on lossy files", **off by default**; amber everywhere otherwise. The switch is a pref (`serializePrefs`/`parsePrefs`, a default in `S`, a `prefs.test.js` case) and can stay device-only.

**Preview focus:** the look picker reads like a pressing plant's chart; gold looks like gold; a lossless import lands in colour.

---

## CR11: pressings between friends

**Superseded by docs/24_QUIET_COUNTS.md:** pressings and metals are shown as found, never counted (no "N of M", blanks or missing lists).

> Read CLAUDE.md and the README first. Build after RF20 (records in common first) and CR7.
>
> 1. **Records in common** shows each copy's pressing under the sleeve: "Both Verdigris", or "Yours: Verdigris · Ken's: Jet". The friend's tier comes from `crate_items.quality_tier`, which `sync_crate` already stores; the pressing is derived locally from the shared album key, so no new column.
> 2. **The record sheet** names the pressing and its note, and adds one line when a friend's copy differs by tier.
> 3. **The pressing chart** on the profile (`profile/screens.js`, a new `renderPressingCard`): a cream catalog card with a paint-chip strip in family order; owned at full strength, missing at 18%, scarce pressings marked with a small ink dot; your own card carries `N OF 40 · M OF 32` and a few missing names; a friend's card (`friend-store.js`) shows chips only, no numbers. Tapping a chip jumps the crate to that pressing.
> 4. Counts are first-person only; nothing compares two people (RF11's rule, and `12_REFINE.md`'s Phase E).
> 5. **Tests**: the chart's owned/missing set from a synthetic library; the friend variant renders no numbers; the common-records line for same-tier and different-tier copies.

**Preview focus:** two friends with the same album see the same colour, and a third friend's Jet copy says lossy without saying it.

---

## CR8: palette additions

> Read CLAUDE.md and the README first. Tokens only, plus the few places that use them; no layout.
>
> 1. `--amber-tint`, `--amber-shade` (dark `#C47F1E`, light `#9A4700`); `--prussian`, `--verdigris`, `--puce`, `--olive`, `--olive-deep`, `--warm-grey`; the stock tokens (`--stock-divider-1/2`, `--stock-lip`, `--stock-manila`, `--stock-card`, `--stock-bone`, `--bin-1/2/3`, `--plinth`, `--plinth-edge`); the sticker tokens from CR3.
> 2. **Light theme**: ink `#26202C`, muted `#6B6258`, the four phase anchors that lean into their hue, phase chips using the secondaries with cream text.
> 3. **Sky**: Golden's phase colour `#F2B35C`; Golden and Twilight anchors as RF14 already set.
> 4. **Platter plinth** to warm black `#1C1A1F` / `#2A272C`.
> 5. Extend RF12's contrast test to the new tokens against both themes' backgrounds (muted ≥ 4.5 everywhere; secondaries ≥ 3 for paper text; the shade ≥ 4.5 on `--sky2`).
> 6. Record the three rules in CLAUDE.md's design section: amber never signals state; no second warm in the chrome; no mauve neutral and no amber tricolour.

**Preview focus:** nothing moves; the light theme feels like paper.

---

## CR9: sleeves in the rest of the library

> Read CLAUDE.md and the README first.
>
> 1. **Artists**: fanned stacks of up to three covers per row (reusing `thumbURL`); `N records · years`; sticky letter heads; the crate rail reused (`crate/view.js`'s rail becomes a shared `ui/letter-rail.js`).
> 2. **Artist page**: shelf of sleeves by year (swipeable, `scroll-snap`), PLAY ALL / SHUFFLE / CREDITS, tracks grouped by album.
> 3. **Playlists**: compilation sleeves in a 2 × 2 grid; Favorites first with the heart; the empty state from RF7 drawn as one dashed sleeve.
> 4. **Songs**: sticky letter heads and the rail above 200 tracks.
> 5. **Search**: album hits show their sleeve.
> 6. Perf: the fanned stacks are three `<img>` per row at 44 px, from the existing thumbnail tier; measure the artists list at 2,000 tracks in `tests/perf/nav.perf.js` before and after.

**Preview focus:** every library view has records in it.

---

## CR10: the desktop crate

> Read CLAUDE.md and the README first. `src/styles/23-desktop.css`, `crate/view.js`'s desktop branch.
>
> 1. **The panel follows the front record**: `renderCrateDetailPanel()` runs on `onSettled()` for whatever is at the front, with the catalog card, CREDITS · PIN · SLEEVE NOTE as text buttons, and the tracklist split by side (`gatefoldSideSplits`). The placeholder and the duplicate play under the stack are gone. Tap still opens the gatefold.
> 2. **Stage** uses the full height; six tops; a 150 px lip; the rail docked 16 px from the stage edge.
> 3. **Sidebar**: a BINS list (New arrivals, Staff picks, Sealed, with counts) above PLAYLISTS; each jumps the crate. The crate-order control gains DECADE.
> 4. **Hold** becomes right-click/context on desktop (CR5).

**Preview focus:** the right half of the screen is never empty.

---

## Keep, whatever else changes

`flowPose()` shared with the launch intro; momentum and the rail bubble; `sealedQuietPlay`; the 95% rule and metal thresholds; `selectVariant()`'s album-only hash, so a record presses the same in every crate that holds it; the crate's reduced-motion list; and one sticker per sleeve.
