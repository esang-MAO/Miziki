# 33 · The wall, paper labels, and share-card text fixes

Three things, one plan:

1. **The wall** gets real shelving that matches the cube unit (docs/32): the **in rotation** covers lean on a **floating picture ledge**, and the last three pressings and metals stand on clear stands in a **wall cubby** — the same wood and finish as the shelf below.
2. **Paper labels.** Every pressing shown as a disc — on the wall and on **every share card** — gets the paper centre label Miziki already uses for Jet (cream paper, olive ring, printed ink, spindle hole). The Pressings card's square chips become small labelled discs.
3. **Share-card text fixes.** An audit rendered all five share cards in every style and format with typical and stress data (339 renders) and found overlapping or clipped text in four of them — two with ordinary data. Fixes are written and verified.

Builds on docs/30 (GS8, the wall and "in rotation") and docs/32 (ST2–ST3, the shelf unit and finishes). **Do 32's ST3 before WS1** (the wall reads `S.shelfFinish`). WS4 depends on nothing and can go first.

**Decisions (Ken, Nov 7):**
- **In rotation → floating picture ledge.** Pins 1–3, covers leaning back slightly against the wall, standing behind the ledge's front lip; "must hear" sticker stays on pin 1. Cover text sits clear of the lip.
- **Pressings → wall cubby.** One long, three-section cubby built like the shelf unit (posts, rails, grained back panels, inner shadow); one disc per section on a clear stand; name and `PHASE · DATE` captions beneath, unchanged from plan 30; "All found ›" beside the hand-lettered caption.
- **Same finish as the shelf unit**, everywhere it shows; friends see it in your finish (docs/32 ST6 carries `shelf_finish` already — no new column).
- **Paper label** on every pressing/metal disc on the wall and in share cards. At share-card size it's printed with the record: `MIZIKI · 33⅓` (or 45 / 78), the album title, the artist below the spindle hole, the side. At small sizes it's simplified to two printed lines and the hole.
- **Share-card text**: fix all six issues below.

**Designs:** `docs/design/wall/` — canvas "Miziki Wall Shelving": `WallCombo` (the wall; prop `finish`), `Main` (the profile, interactive play/pause, Tweak `finish`), `PaperLabels` (share-card disc, Pressings grid, wall), `WallFinishes`; plus `ShelfUnit`/`Turntable` copied from docs/32 so `Main` renders. PNGs in `png/`. `share-audit/` holds `fixes.diff` and before/after renders of every flagged case. Names on the frames are invented.

**Order:** WS0 → WS4, one PR each, the usual routine. WS4 any time; WS1 after 32-ST3; WS2 after WS1; WS3 after WS4 (both touch `src/share/styles.js`).

---

## WS0: docs only

> Read CLAUDE.md first. Docs-only PR: add this plan and `docs/design/wall/`. In docs/30_GROOVES_AND_SHELF.md GS8, add one line at the top of point 2 ("On the wall"): "**Wall shelving superseded by docs/33_WALL_AND_LABELS.md** (ledge for in rotation, cubby for pressings)". No code. Open the PR. Do not merge.

---

## WS1: the wall shelving

> Read CLAUDE.md, this plan and the README (`WallCombo`, `Main`; `png/01–04`) first. Profile: `src/profile/storefront.js` (the plan-30 wall).
>
> 1. **Ledge:** replace the framed in-rotation covers with one floating picture ledge, full column width: grained top surface, a front lip (≈22px at phone scale) with a top highlight, a soft shadow on the wall beneath. Pins 1–3 stand behind the lip, tilted back (`perspective(500px) rotateX(7deg)`, origin bottom), each with a contact shadow. Cover titles/marks never sit in the lip's band. "must hear" sticker on pin 1 as now.
> 2. **Cubby:** below the hand-lettered "pressings, found while listening" + "All found ›" row, one wall cubby, three sections, built from the same wood custom properties as the shelf unit (`--wood-*`, docs/32 ST2): rails top/bottom, four posts, grained back panels, inner shadow. One disc per section (newest three found, as plan 30), standing on a clear stand. Captions under each section, single line (`white-space: nowrap`).
> 3. Both follow `S.shelfFinish` (and a friend's `shelf_finish`). No new setting.
> 4. Empty states: no pins → the ledge stays with nothing on it; fewer than three found → empty sections stay empty (no placeholders, per docs/24).
> 5. **Removes:** the framed covers and the loose pressing discs from plan 30.
>
> Lint/tests/previews as usual. Open the PR. Do not merge.

**Preview focus:** each finish; a long pressing name (`Ultramarine & Verdigris`) in its caption fits or ends in "…" — never wraps into the Listening row.

---

## WS2: paper labels on the wall

> Read CLAUDE.md and the README (`PaperLabels`, `png/05`) first.
>
> 1. One shared label style for small discs, matching `02-stage-platter.css`'s `.label.paper-label`: `radial-gradient(circle at 38% 32%, #F4EFE4, #DCD3BE)`, ring `#3E3D22` with a thin paper gap and a faint second ring, two printed ink lines (`#26202C`), a spindle hole (`#14110F`). Diameter ≈ 36% of the disc.
> 2. Use it on the wall cubby's discs (WS1) and anywhere else the profile shows a pressing or metal as a disc. Zoetropes keep their own artwork.
> 3. Keep it one CSS class (e.g. `.paper-label-sm`) so a later change happens in one place.
>
> Lint/tests/previews as usual. Open the PR. Do not merge.

---

## WS3: paper labels on share cards

> Read CLAUDE.md, the README (`PaperLabels`) and `src/share/styles.js` first. Needs WS4 merged (same file).
>
> 1. **`fillShareDisc()`** (styles.js, the `// label` block, `lr = r*0.32`, fill `#3A2007`): draw the paper label instead — radial paper gradient, olive ring, inner paper gap — at the same radius. Rare pressings keep their art label (existing branch).
> 2. **Printed text** when `lr ≥ 90px` (Record, Now Playing, Pressings hero at their sizes): `MIZIKI · 33⅓` (speed from the record's format) in Plex Mono, small, tracked, above; album title in Antonio, fitted with `shareFitText` to `lr*1.6`, above the hole; artist in Archivo below the hole, fitted to `lr*1.4`; `SIDE A` in Plex Mono near the bottom. **Nothing crosses the hole**: title baseline ≤ `cy - lr*0.18`, artist top ≥ `cy + lr*0.12`. Below 90px: two ink bars and the hole only.
> 3. **Pressings card grid:** the square chips (`fillVariantSwatch`) become discs of the same footprint: the variant fill clipped to a circle, faint groove rings, the small paper label. Keep the two-ink/split/swirl/splatter patterns.
> 4. **Tests:** a pure helper for the label text layout (positions from `cx, cy, lr`) unit-tested for the "nothing crosses the hole" rule and for fitting at `lr` 90/140/200.
> 5. Re-run the share audit's cases (WS4) with the new label: no new overlaps.
>
> Lint/tests/previews as usual. Open the PR. Do not merge.

**Preview focus:** share a Record card for a long-titled album: the label title shrinks or ends in "…", never touches the hole.

---

## WS4: share-card text fixes

> Read CLAUDE.md first, then `docs/design/wall/share-audit/` — `fixes.diff` (a verified starting point, apply with `git apply -p0`) and the `before/`/`after/` renders. Fixes only; no layout redesign.
>
> **A. Now Playing — title collides with the artist line** whenever the title has descenders (g, y, p, parentheses), every style/format. `now-playing-card.js` ~L124: `y += 20` → `y += 34`. (`before/nowPlaying__descenderTitle__night__square.png`)
>
> **B. Shared fitter — an unbreakable word is never shrunk or cut** (no-space or Japanese titles run off both edges). `styles.js` `shareFitLines()` ~L61: accept a size only if every line fits `maxWidth`; after the fallback, `shareFitText` every line, not just the last. Affects every caller, including the sleeve-note slip.
>
> **C. Crate, Story — Top Songs runs through the footer with ordinary data** (wordmark lands on row 3). `crate-card.js`: single-column hero 0.56w → 0.46w (~L296), the gap after the cover row 0.05h → 0.03h when single-column (~L370), and compute song rows from the space left above the footer (~L390) instead of a fixed 5. (`before/crate__typical__night__story.png`)
>
> **D. Pressings, Story/Square — the tile grid runs under and past the footer** once the chip block needs three or more rows (a 40-record collection is enough). `pressings-card.js`: fit tile rows to the space above the footer (~L153) and make "+N MORE" count what's actually shown; step long pressing names 22px → 16px before cutting (~L113–115). **Update the unit tests for `moreCountText` and `tileCountFor`.**
>
> **E. Record, Story (and long names in Square) — the facts column is clipped** ("Ultramar…", "OPAQUE · COM…") with every pressing. `record-card.js` ~L312: when the facts column would be under 220px, stack the facts under the sleeve at full width; pressing name up to 2 lines via `shareFitLines`; the finish line steps 20 → 15px before cutting.
>
> **F. Season — a 5-digit play total spills out of the ring's hole.** `season-card.js` ~L70: step the numeral down from `r*0.5` until it fits `r*0.95`.
>
> Also: the sheet only offers Story and Square, but `SHARE_FORMATS` and `prefs.js` (~L143) still accept `portrait`. Either remove it (map a saved `portrait` to `square` in `parsePrefs`, with a test) or say in the PR why it stays.
>
> **Tests:** keep the existing ones green (update D's two); add unit tests for B (a 40-char no-space word fits `maxWidth` after fitting). Render-check by hand the `before/` cases.
>
> Lint/tests/previews as usual. Open the PR. Do not merge.

**Preview focus (iPhone):** share each card in Story and Square with a long title and a big collection; nothing touches, nothing runs past the footer.
