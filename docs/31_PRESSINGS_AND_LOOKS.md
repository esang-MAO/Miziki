# 31 — Pressings and looks

**Reconstructed after the fact (plan 35, LI0); both PRs below are merged.** This file was never committed when the work happened — the two PRs landed straight from their CHANGELOG entries with no plan doc checked in. Written back from `docs/CHANGELOG.md`'s PRESSING_DRAW PR A/B entries and the merged code (`src/record-art/tiers.js`, `src/record-art/looks.js`, `src/gatefold/view.js`, `src/history/sessions.js`, `src/sync/merge.js`). If Ken has his own original copy of this doc, that supersedes this reconstruction.

Two small PRs: PR A fixed a bug in the pressing draw itself (a hash flaw meant over half the chart could never be drawn); PR B added a way to choose among a record's already-earned looks from the gatefold, not just the full player.

---

## PR A — fix the pressing draw so every pressing can turn up

**Bug:** `frac32()`'s salt (`src/record-art/tiers.js`) was appended to the *end* of the hash key before hashing. FNV-1a's final step barely moves when only the last character changes, so the tier-mix, band, colour, rare, and zoetrope draws — each its own salted call into the same key — came out nearly identical to one another. Measured before the fix: only 20/40 solids and 21/54 effects were ever reachable; the rest of the chart could never be drawn no matter how many files were imported.

**Fix:**
- Move the salt to the *front* of the hash key, and run the result through murmur3's `fmix32` avalanche before reducing it, so each salted call is a genuinely independent draw.
- Verified after the fix: 40/40 solids and 54/54 effects reachable; tier splits and band splits land within tolerance of the spec's 85/15 (lossless tier mix), 70/25/5 (hi-res tier-3 mix, pre-CC6), and 60/30/10 (`pickBand()`, pre-CC6) targets.
- `CHART_VERSION` bumped 2 → 3 (`src/record-art/tiers.js`).
- `migrateChartVersion()` (`src/history/sessions.js`) re-draws tier 2 as well as tier 3 on upgrade (previously only tier 3; tier 1/Jet is never re-drawn since it has nothing to draw). Writes `rec.tier` alongside `rec.variant`/`.pattern`, and carries over any played-through "found" sticker for the album to its newly-drawn variant.
- `unionEarliest()` (`src/sync/merge.js`) breaks a `discoveredAt` tie by the higher `chartVersion`, so a stale pulled-down collection row can never beat an already-migrated local one.
- Every album in the collection gets a fresh pressing once, on upgrade — accepted on purpose, since no one but Ken had the app yet.

**Tests:** `tests/unit/pressing-draw.test.js` proves every pressing in every pool is reachable over a fixed 50,000-name sample — the test that would have caught the original bug.

**Note:** CC6 (docs/34_CARE_AND_CONTROL.md) later changed the hash *input* (`pressingKey()`, artist+album instead of title alone) and rebalanced the tier-3/band odds again, bumping `CHART_VERSION` to 4. That's a separate, later change — see docs/34_CARE_AND_CONTROL.md for the current odds.

---

## PR B — choose a record's look from the gatefold

Before this PR, an album that had earned more than one look (a pressing plus any rare/zoetrope/metal variants) could only have its look changed from the full player's `#lookBtn` — and only for whatever track happened to be loaded on the platter. There was no way to change a different album's look without first loading it.

**Changes:**
- A **"Record look…"** row added to the gatefold's "···" menu, after "Keep for…" and before "Track order" — shown only when `hasLookChoice(t)` (`src/record-art/looks.js`) says the album has earned more than one look.
- It opens the same `#lookOverlay` sheet the full player's `#lookBtn` already used. `openLookPicker(t, { onPicked })` now takes an explicit track and an optional callback, instead of always reading `current()` — so the gatefold can open it for its own album rather than whatever is on the platter.
- Each option in the sheet shows a small disc swatch painted with that look's actual art: `discLook()` gained an optional `forceLook` argument that resolves a preview without saving anything (`lookPreview(t, kind)`). The menu row itself carries a small preview of the album's current look.
- `#lookOverlay` dims the screen behind it less than every other sheet (`.35` instead of `.72`), so the record stays visible while choosing.
- Picking a look crossfades the gatefold's pocket disc (and the platter, if that album is loaded) to the new look.
- Metal lookups (`availableLooks()`, `buildLookOptionContent()`, `discLook()`) now check the *album's* own metal before a specific track's, so the gatefold (which always opens on the album's first track) and the full player (whichever track is actually playing) agree on which metal to show.
- **Caught live:** opening the picker right after closing the "···" menu in the same tick raced `closeLayer()`'s own history navigation and silently closed the whole gatefold moments later. Fixed by using `closeLayerThen()` instead — the same mechanism the player's own overflow menu already used for the identical "close this, open that" shape.

**Where this plugs in today:** GF12 (docs/29_GATEFOLD.md) folded this row into the gatefold's "···" menu alongside Track order/Remove album/Select, and ST5 (docs/32_SHELF_AND_TURNTABLES.md) built on `discLook()`'s album-first metal lookup. See those docs for the current full picture.
