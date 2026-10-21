# 14 — Crate sections: one-line header, sort chip, side-by-side bins

Approved by Ken on Oct 21, 2026 from the interactive frames in `14_CRATE_SECTIONS_frames.html` (open it in a browser — both frames are live). Two PRs, in order. Each stops for Ken's go-ahead before the next starts, same as the D/DA/RF series.

---

## PR 1 — Header row and the sort chip (amends open PR #162)

PR #162 (`crate/sort-cycle-chip`) already replaces the A–Z/Genre/Decade pill row with one tap-to-cycle chip ("Sort · A–Z" → Genre → Decade → A–Z; Genre skipped when the library has no genre tags). It's pushed but not merged. Add the layout below to that same PR so it merges as one change.

### What changes

1. **All four library tabs on one line** (Songs / Crate / Artists / Playlists), on the left of the header row. They never wrap.
2. **Search, add and more stay top right.** The sort chip sits **directly under them**, right-aligned, only while the Crate tab is active.
3. **Nothing overlaps, at any width.**

### How

- `miziki.html`, inside `#libNav`: wrap `#hdrActions` and `#crateGroupToggleTab` in a new `<div class="lib-tabs-right">`, chip second. Keep every existing id.
- `src/styles/01-header.css`:
  - `.lib-tabs`: `align-items:flex-start` (was `center`).
  - `.lib-tabs-group`: `flex-wrap:nowrap; gap:10px; min-width:0; min-height:32px; overflow-x:auto; scrollbar-width:none` (hide the WebKit scrollbar too). The tab column ends where the icons begin; on the narrowest phones (iPhone SE, 320px) the tabs scroll sideways instead of running under the icons.
  - `.lib-tabs-group button`: letter-spacing `.06em` (was `.1em`), `flex:0 0 auto`.
  - New `.lib-tabs-right{display:flex;flex-direction:column;align-items:flex-end;gap:var(--sp-2);flex:0 0 auto;margin-left:auto}`. Use flex, not a two-column grid: when `#libNavTabs` is hidden (empty library) a grid would pull the icons into the left column.
  - `.hdr-icon-btn`: 32px (was 40px); its svg 20px (was 22px).
  - `.crate-group-cycle`: drop the `margin-left`/`margin-right:auto` from PR #162 — the new column places it.
- Width budget at 390px (358px usable): tabs ≈ 225px + 10px gap + icons 96px = 331px.
- The `+` menu and `···` overflow popovers anchor off the icon's own rect, so they follow the icons automatically. Check both still open fully on screen.
- `src/styles/23-desktop.css`'s comment at line ~15 describes the old row; update the wording, no rule change expected.

### Check

- iPhone SE (320px) and iPhone 14/15 (390px), light and dark: tabs on one line, chip under the icons, no overlap, underline on the active tab not clipped.
- Empty library: icons still top right, no chip.
- Songs/Artists/Playlists tabs: no chip.
- `+` and `···` menus open fully on screen.

---

## PR 2 — Crate sections side by side

### The behavior

- **Each section is its own crate.** The current one is centered and looks exactly like today's crate: stacked 3D records, cream dividers, flip up/down, letter rail, catalog card below.
- **The neighbouring sections peek in at the left and right edges**, smaller and dimmed, with a clear gap. They never overlap the centre crate (or anything else).
- **Swipe left/right slides the row over.** The next crate glides into the centre; the view never jumps down to it. Arrow buttons do the same.
- **Flip up/down stays inside one section.** It stops at the section's last record instead of running into the next. Each section remembers the record you left it on.
- **A section header above the crate**: previous arrow · section name + one dot per section · next arrow. Kept (Ken's call).

### Sections per sort order

| Sort | Sections, left to right |
|---|---|
| A–Z | **A–Z** (the whole alphabet, letter and artist dividers as today) → **New arrivals** → **Sealed** → **Staff picks** (always last) |
| Genre | one section per genre, in today's genre order (Unsorted last). No bins. |
| Decade | one section per decade, oldest first (Undated last). No bins. |

A bin with no records (no new arrivals, nothing sealed, no staff picks) is left out, same as today. A sort with only one section shows no arrows and no dots.

### Where it touches the code

- **`src/crate/model.js` — `buildCrateModel(group)`**
  - Today the virtual bins (`buildVirtualBins()`) are pushed **first**, in every sort. Change: only in `az`, and **after** the letter run, in the order `new`, `sealed`, `picks` (reorder inside `buildVirtualBins()` too).
  - Return a new `sections` array: `{key, label, start, end}` (end exclusive) over `items`. `az` section = the letter run; each bin = its divider through its last record; each genre/decade = its divider through its last record. Single-genre libraries (no genre dividers today) get one section with no divider.
  - `jumpIndex` keeps the `key:new`/`key:sealed`/`key:picks` entries (the desktop sidebar's BINS list and `S.crate.pendingJumpKey` still use them). `railEntries` drops the bin entries; the rail only lists letters.
  - `byAlbumId` still points at a record's A–Z position, not its bin copy — unchanged.
- **`src/crate/view.js` — `renderCrate(host)`**
  - Keep one stage and one card pool; add the active section's bounds (`secLo`, `secHi`). Every `clamp(…, 0, model.items.length - 1)` becomes `clamp(…, secLo, secHi)`: `snapTo`, the momentum `step`, the drag `pointermove`, `wheel`, the `End` key, and the rail scrub. `syncCards()`'s visible window clamps to the section too, so cards from the next section never show in the stack.
  - Horizontal gesture: on the stage's existing pointer handling, classify a drag as horizontal once `|dx| > 12` and `|dx| > 1.2·|dy|`. Then suppress the flip drag and the pull/hold gesture for that pointer, move the stage plus both peeks with the finger (rubber-band at the first/last section), and on release commit at `|dx| > 50` or a fast flick. Trackpad: a horizontal `wheel` delta over a threshold steps one section.
  - Section switch: save `S.crate.pos` into `S.crate.sectionPos[sectionKey]`, slide out, set the new bounds, restore that section's saved position (first visit: the A–Z section uses today's cold-start/anchor logic; any other section starts on its first record), clear the pool, redraw, slide in.
  - Peeks: two static mini-stacks (the neighbour's front record plus one or two behind it, using `makeCardEl()` and `flowPose()`), about 80% scale, ~55% opacity, positioned at the stage edges. Rebuild them on every section switch. Tapping a peek = swipe toward it.
  - The section header (arrows, name, dots) is new markup above `.crate-stage`; the existing `.crate-header` row (record count · sort, now-playing chip) stays. The count becomes the active section's count.
  - Now playing: `nowPlayingIdx` and the "● Now playing —" chip scroll to the playing album **in the A–Z section** (switching to it if needed).
  - `S.crate.pendingJumpKey` (desktop sidebar BINS): switch straight to that section instead of moving the position.
  - `applyCrateMiniInset()` must reserve the new section-header height.
- **Reduced motion** (`renderCrateFlat()`): no sliding. Show the section header with arrows; arrows swap the flat list to that section instantly.
- **Desktop** (`23-desktop.css`, ≥1024px): same behaviour; the wider stage simply shows more of each peek. The inline detail panel follows whichever record is centred in the active section.
- **`S.crate.sectionPos`** is session-only (like `S.crate.pos` today); `S.crateAnchor` keeps saving the A–Z anchor only.

### The letter rail moves to the left edge (decided)

On a 390px phone the centre card is 278px, leaving about 40px on each side of the stage. Today the letter rail sits on the right (`.crate-rail{right:8px;width:26px}`), which is exactly where the New arrivals peek needs to be in the A–Z section. Ken's call (Oct 21, 2026): **move the rail to the left edge.** A–Z is always the first section, so nothing ever peeks in on its left.

- `src/styles/10-crate.css`: `.crate-rail{left:8px;right:auto}`; `.crate-rail-item{left:0;right:auto}` (letters left-aligned). The record card stays at full size (278px phone, 340px desktop).
- **Plain letters, no boxes.** Each rail entry is just the letter as text — no border, background, pill or button chrome (reset any default button styling on `.crate-rail-item`). Size stays `--fs-micro` (10px), slightly smaller than the tab labels; the current letter keeps `--accent-text` at weight 500, absent letters keep their `.crate-rail-dim` opacity.
- The rail only exists in the A–Z section (genre/decade sections have no rail). While swiping away from A–Z it fades out with the slide and takes no taps; it fades back in when A–Z returns to the centre.
- The amber scrub bubble (`.crate-rail-bubble`) opens to the **right** of the finger now, so it never sits off the left edge of the screen.
- Clearance on a 390px phone: rail 8–34px, card starts at ~39px — no overlap. Check at 320px (iPhone SE), where the card is narrower than the stage the same way; confirm the rail never touches the card.
- Desktop (`23-desktop.css` has `.crate-rail{right:16px;…}`): change to `left:16px;right:auto` to match.
- Right-hand peek on a phone at full card size is a ~30px sliver — enough to show another crate is there. Accepted.

### Tests

- `tests/unit/crate-model.test.js`: bins now come after the letters, only in A–Z, in the order new/sealed/picks; `sections` covers every item exactly once with no gaps; genre/decade have no bin sections; single-genre libraries get one section; `jumpIndex` still resolves `key:new`.
- New pure helpers worth extracting and testing: `sectionIndexAt(sections, pos)`, `clampToSection(sections, idx, pos)`, and the horizontal-vs-vertical classifier (alongside `classifyCratePointerTrace`).
- Device checklist additions: swipe through every section in all three sorts; each section keeps its place; flip stops at a section's end; now-playing chip from another section; sidebar BINS on desktop; reduced motion; iPhone SE and 390px widths with nothing overlapping (rail included).
- Update CLAUDE.md's `crate/model.js` and `crate/view.js` entries and `docs/CHANGELOG.md`.
