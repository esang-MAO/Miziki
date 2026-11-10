# 36A · Library and launch (addendum to 36)

Two passes that plan 36 didn't cover:
- **The library with a real-sized collection.** 36 was checked against about 15 albums.
- **The launch sequence.**

Same rules as 36:
- Every screen is built from 36's shared parts (UN2). Nothing new is styled one-off.
- Each PR names what it removes.
- The usual routine: one PR each, preview, merge, after-merge check.

**This addendum starts after UN2 and UN5 have merged.** UN18 (36's sweep) runs last, after this addendum too.

**Checked against `main` at `dcc2fdc`** in a browser at 390×844 (dark and light) and 1440×900, with the same test setup as 36 (its last section). Added for this pass:

- **Large library:** 141 records and 402 songs across 31 artists and 12 genres, spanning 1962–2025.
  - A few very long titles, such as "Vol. II: Recordings Made in Lagos, Accra and London, 1974–1979 (Remastered)".
  - Three 12-track albums.
  - Six files with no tags.
  - Four playlists (5, 12, 24 and 60 songs), one with a long name.
- **Launch:** filmed at 150 ms a frame. First open (empty library) and returning, at 2:30 PM and 11:30 PM, on phone (dark and light) and desktop.

**Design:** Claude Design canvas **"Miziki Library and Launch"** (https://claude.ai/artifact/5vWyrCWqJLWub6ToeMETEb). It has seven rows:

| Row | Frames |
|---|---|
| Library, row 1 | `ImportDupes`, `CrateCard`, `SongsList`, `PlaylistsGrid`, `PlaylistDetail`, `NameSheet`, `ArtistLong` |
| Library, row 2 | `ArtistsList`, `CrateGenre`, `Search`, `AddToPlaylist`, `DesktopLibrary` |
| Library today | screenshots of today's build with the large library |
| Launch | `Main` (launch timings by occasion) |
| Returning launch | `R1` sky and mark · `R2` the dig · `R3` the catch · `R4` the landing · `R5` the room fills in |
| First open | `F1` the dig · `F2` the catch · `F3` the empty crate |
| Desktop launch | `Desktop` |
| Launch today | filmstrips of today's build |

---

## Decisions (as drawn on the canvas, 2026-11-10)

**Library:**
1. **Duplicates during an import are one decision, not one per file.**
   - The import never stops to ask. Every song that isn't a possible duplicate goes in straight away.
   - At the end, one sheet lists the possible duplicates ("12 possible duplicates") with three choices: Keep both for all, Review one by one, Skip all.
   - "Replace" stays available inside Review, one by one.
   - Today the import waits on a separate Keep Both / Replace / Skip Import sheet for every match. With a big first import the library stays empty until each one is answered.
2. **Naming a playlist is a sheet, never the browser's `window.prompt()`.**
   - It's the same sheet whether the playlist comes from "New playlist", from "Save queue as playlist" or from "Add to playlist › New playlist…".
   - The text box under the playlist grid goes.
3. **Playlists show as a mosaic of four different records' covers**, not one cover repeated four times.
   - Fewer than four different records: tile the ones there are.
   - None at all: the empty-note card from UN5.
   - The caption is "{n} songs · {length}". The current "24 TRACKS" in mono caps goes.
4. **A playlist page has a real header:**
   - "‹ Playlists" back header with a ⋯ menu: Rename…, Edit order, Share, and Delete playlist… (danger).
   - The mosaic and the title, which wraps.
   - Play (primary), Shuffle and Add songs (secondary).
   - Rows reorder by **drag handle**, which replaces the ▲▼ buttons on every row.
   - "Add or remove tracks" becomes "Add songs"; removing a song is in the row's ⋯ menu.
5. **"Songs", not "tracks", in everything the library says about songs:** counts, captions and buttons. Album track lists in the gatefold keep "tracks", since those are a record's tracks.
6. **The letter rail always shows A–Z and #.**
   - Letters with nothing under them are dimmed, not removed. Today F and G simply aren't there, so the rail's letters move around between libraries.
   - The rail sits in its own 18px column. Rows end before it, so the row ⋯ never sits under a letter.
7. **Sticky letter headers never cover a row.** Each header takes its own 34px and pushes the list down, instead of floating over the first row (today "52 Golden Moons 2" is cut in half under the "C" header). The header shows the letter and, when grouped by artist, the artist ("C · Chidi Obi").
8. **Song rows** are title, then artist; no "· MP3 · lossy" (as UN5 already says). Long titles end with "…" on one line, never two or three lines.
9. **Songs without an artist tag** are listed in Artists as one row at the end under "#": "Songs without an artist", "6 songs · tag them in Edit info". It replaces the "Unknown Artist, 1 record" row with a grey dot. In the crate, untagged files never make up a pretend record; they only appear in Songs.
10. **Artists are round photos** (cover art cropped round), in the same row style as other lists. "6 records · 12 songs" replaces "6 records".
11. **Long artist names** move out of the header row and become the page title, wrapping to two lines. The header row keeps only "‹ Artists" and ⋯, so "Remove artist" never squeezes beside the name again (UN3 already moves it into ⋯).
12. **Crate:**
    - The info card's details are sentence case: "7″ single · Rock · 1964 · 2 tracks", not caps.
    - Now-playing becomes a small tappable chip under the card ("Now playing: Vol. II: Recordings Made in Lagos…"). It ends with "…", never cut mid-word at the screen edge, and tapping it jumps to that record.
    - The artist-divider card that pokes up behind the record like a tab ("Ama Mensah") goes. The letter and artist sit as a line under the sort chip instead: "A · Ama Mensah".
13. **Crate by genre or decade** shows the sections as a row of chips that scrolls sideways with a fade at the edge, with the current one filled. Swiping the crate moves between them as today. The count reads "14 in Ambient" (UN5).
14. **Search:**
    - Type filters (All · Songs · Records · Artists · Playlists) replace the "artist: album: year: More" chips, which only work if you know the syntax. The syntax still works when typed.
    - A "Top result" leads.
    - Each group shows three items, then "See all {n} {type} ›".
    - The search field is the only header while searching. The library tabs hide until Cancel.
15. **Desktop library:**
    - Songs show as a table (# · art · Title · Artist · Record · Time · ⋯) with sortable column headers, inside a max-width of 1080px.
    - Sidebar names end with "…" on one line, with the count right-aligned and never pushed off ("Sunday morning, slow coffee… 12").

**Launch:**
16. **The full dig plays when the day turns:** the first cold start of the day, and the first after sunset (Sundown's own turning point). Every other cold start gets a **short version, about 1.5 s**:
    - six sleeves instead of eighteen
    - the same catch and landing.

    Warm starts (back from the background) never replay, as today. The Launch intro switch in Settings still turns it off entirely. *Ken can still say "full every time"; this only changes when the full one plays.*
17. **One mark, the angled cut, small, at the top only.** The giant upright "MIZIKI" that appears at the bottom during the catch goes, and with it the mark sitting on top of the crate's card and mini-player as the app fades in. That also matches the Oct 31 decision that the −12° cut is the launch's.
18. **The landing is exact.** The caught record ends at the crate card's exact position, size and tilt, measured from the live crate card (`getBoundingClientRect()` of `.crate-card.crate-current` in the already-rendered crate underneath). The stack under it becomes the crate's own stack. The launch overlay then simply stops drawing, with **no cross-fade**. Today's cross-fade shows two offset copies of the same cover for about half a second.
19. **The room fills in, in order, after the landing:**
    - the info card rises (0–200 ms)
    - the mini-player and tab bar (100–300 ms)
    - the header and tabs (200–400 ms)
    - the neighbouring-section bar last.

    Today everything fades in at once.
20. **First open (empty library):**
    - Miziki sleeves only, about 1.5 s.
    - The caught sleeve stays where it lands as the empty crate's record.
    - "The crate is empty." note and the Choose files / Choose folder buttons (UN5) appear under it.

    Today a first-time user watches about three seconds of identical sleeves and then gets a dashed box that has nothing to do with them.
21. **Desktop:** the launch stage centres on the crate's column, not the whole window, so the record lands on the card instead of jumping sideways. The sidebar and bottom bar fade in with the room.
22. **Skipping:** a tap anywhere jumps straight to the landing and room (about 0.45 s), with no visible hint, as today. Reduce Motion is a 0.3 s fade straight to the crate, as today.

---

## Order

LB0 → LB10, then LA1 → LA4, one PR each. LB = library, LA = launch. Both tracks need UN2 (parts) and UN5 (empty notes) merged first. LA3 also needs LB5 (the crate card it lands on).

---

## LB0: designs (docs only)

> Read CLAUDE.md, docs/36_UNIFORMITY.md and this addendum.
>
> 1. Export every frame of "Miziki Library and Launch" into `docs/design/uniformity/library-launch/`. Name the PNGs by row and frame (`lib-1-import-dupes.png` … `launch-r5-room.png`) and add them to the README in `docs/design/uniformity/`.
> 2. Add "**Addendum: docs/36A_LIBRARY_AND_LAUNCH.md**" under the title of `docs/36_UNIFORMITY.md`.
>
> Docs only, no code. Open the PR. Do not merge.

---

## LB1: duplicates during import (decision 1)

> Read CLAUDE.md, 36, this addendum and frame `lib-1-import-dupes`. Depends on UN2.
>
> 1. **Collect, don't ask.**
>    - In `src/library/import.js` (the loop around L156, `await askDuplicateResolution(dup, f.name)`), stop awaiting per file.
>    - Push `{file, dup}` onto a pending list and keep importing every other file.
>    - Once the import has finished (all non-duplicates in the library and saved), if the list isn't empty, open the new duplicates sheet.
> 2. **The sheet** (`src/library/duplicates-ui.js`, rebuilt with `sheetHeader`, `.p-btn`):
>    - Title "{n} possible duplicates" (or "1 possible duplicate").
>    - One line: "The rest of the import ({m} songs) is already in your library. Decide once for all {n}."
>    - The first three as rows (cover, title, "Matches a song already in your library"), then "and {n−3} more".
>    - Buttons, full width: **Keep both for all {n}** (primary), **Review one by one** (secondary), **Skip all {n}** (secondary).
> 3. **Review one by one** steps through today's per-file choice (Keep both / Replace / Skip), restyled with the parts, with "{i} of {n}" in the header. Closing it part-way skips the rest and says so in a toast ("Skipped 7 you didn't review.").
> 4. Closing the sheet with × or by swiping down means **Skip all**. Nothing is added without a choice.
> 5. **Tests:**
>    - an import with 0, 1 and 12 duplicates
>    - the non-duplicates land before the sheet opens
>    - each choice for all
>    - Review, closed part-way
>
> Lint and unit tests pass, and both builds preview with no console errors. Open the PR with the preview link at the top. Do not merge.

**Preview focus:** import a folder twice. The second time, the library is usable at once and one sheet asks once.

---

## LB2: the playlist name sheet (decision 2)

> Read CLAUDE.md, 36, this addendum and frame `lib-1-name-sheet`. Depends on UN2.
>
> 1. A new `openPlaylistNameSheet({title, initial, note, confirmLabel})` in `src/library/playlist-sheet.js` returns a promise of the name, or `null`.
>    - It uses `sheetHeader`, a labelled text field (16px, so iOS doesn't zoom), an optional note line, and one primary button that's disabled while the field is empty.
>    - Enter submits; Escape closes.
>    - It refuses a name already in use with an inline line, "You already have a playlist called …".
> 2. Use it in three places:
>    - **New playlist:** title "New playlist", button "Create playlist".
>    - **`saveQueueAsPlaylist()`** (`src/player/queue.js` L564): note "Starts with the {n} songs in your queue." This removes the `window.prompt`.
>    - **Rename…:** title "Rename playlist", button "Save".
> 3. Remove the inline "New playlist name" field and Create button under the playlist grid (`src/library/view.js` around L915).
> 4. `grep` for any other `window.prompt` or `window.confirm` in `src/`. Report each in the PR, and move them to the sheet or `#confirmOverlay` if they're in the library.
>
> Lint and unit tests pass, and both builds preview with no console errors. Open the PR with the preview link at the top. Do not merge.

---

## LB3: playlists grid (decisions 3, 5)

> Read CLAUDE.md, 36, this addendum and frame `lib-1-playlists-grid`. Depends on LB2.
>
> 1. **Mosaic cover:**
>    - a 2×2 of the first four *different records* in the playlist (by `albumKey`), using the crate's `S` art tier
>    - 3 records: three tiles plus the first one repeated in the last cell
>    - 2: split diagonally
>    - 1: the single cover
>
>    Cache the mosaic per playlist in memory, rebuilt when its items change.
> 2. **Captions:** title in Archivo 15/500, wrapping to two lines; then "{n} songs · {length}" in Archivo 13 muted.
> 3. **Header row:** "{n} playlists" on the left, "New playlist" secondary button on the right.
> 4. Desktop: the grid fills the content width (four to six across by width).
>
> Lint and unit tests pass, and both builds preview with no console errors. Open the PR with the preview link at the top. Do not merge.

---

## LB4: a playlist page (decision 4)

> Read CLAUDE.md, 36, this addendum and frame `lib-1-playlist-detail`. Depends on LB3.
>
> 1. **Header:**
>    - `backHeader('Playlists', '', ⋯)`. The title moves out of the header row (today it sits next to "‹ Back").
>    - Below it: the 96px mosaic, the title (Antonio 700 26px, wraps) and "{n} songs · {length}".
>    - Then Play (primary), Shuffle and Add songs (secondary).
> 2. **⋯ menu** (`listMenu`): [Rename…, Share], [!Delete playlist…]. Delete confirms through `#confirmOverlay`.
> 3. **Reorder:**
>    - Remove the ▲▼ buttons (`src/library/view.js` L492).
>    - Each row gets a drag handle on the left. Drag with pointer events, with the row lifting and the list making room.
>    - Keyboard users get "Move up" and "Move down" in the row's ⋯ menu instead.
>    - Order saves as today (`touchBackupKey('playlistDefs', …)`).
> 4. **Rows** use the songs row (decision 8): handle · number · art · title/artist · time · ⋯. The row ⋯ adds "Remove from this playlist" (danger), and "Add or remove tracks" goes.
> 5. **Add songs** opens the Songs list in a pick mode: checkboxes, then an "Add {n}" primary button pinned above the mini-player.
>
> Lint and unit tests pass, and both builds preview with no console errors. Open the PR with the preview link at the top. Do not merge.

**Preview focus:** reorder by drag on the phone; the long playlist name wraps; add and remove a song.

---

## LB5: the crate card and now-playing (decision 12)

> Read CLAUDE.md, 36, this addendum and frame `lib-1-crate-card`. Depends on UN2.
>
> 1. **Info card details:** `catalogLineFor()` output renders in Archivo 13, sentence case ("7″ single · Rock · 1964 · 2 tracks"). Today it's caps through CSS. Fix the CSS, not the string, so share cards are unaffected.
> 2. **Now playing** (`src/crate/view.js` L754, `'● Now playing — ' + item.album`):
>    - It becomes a chip: `--field` pill, 40px, the three-bar playing icon, "Now playing: {album}" ending with "…" (max-width 220px) and a chevron.
>    - It sits centred under the card, not above the section header.
>    - Tapping it does what the line does today (jump to the record).
>    - The "●" glyph goes.
> 3. **The artist divider** (`crate-divider` cards, L600):
>    - In A–Z, artist dividers stop drawing as cards in the stack.
>    - Show the current letter and artist as one line under the sort chip: Antonio 18 for the letter, Archivo 14 muted for "· {artist}". It updates as the crate moves.
>    - Genre and decade dividers are covered by LB6.
> 4. Check at 390×664 that the card, chip and mini-player don't overlap.
>
> Lint and unit tests pass, and both builds preview with no console errors. Open the PR with the preview link at the top. Do not merge.

---

## LB6: crate by genre or decade (decision 13)

> Read CLAUDE.md, 36, this addendum and frame `lib-2-crate-genre`. Depends on LB5.
>
> 1. When grouped by genre or decade, a row of chips under the sort chip lists the sections (Afrobeat, Ambient …, or 1960s …).
>    - The current section is filled (`--paper`).
>    - The row scrolls sideways with a fade at the right edge.
>    - Tapping a chip jumps there; swiping the crate moves the selection.
> 2. The section-name/dots header from the Oct decisions is replaced by these chips in genre/decade. A–Z keeps its letter line (LB5).
> 3. Count: "{n} in {section}" (already in UN5; check it's here).
> 4. **Tests:** chip list order matches the crate model's section order; the selected chip follows swipes.
>
> Lint and unit tests pass, and both builds preview with no console errors. Open the PR with the preview link at the top. Do not merge.

---

## LB7: songs list, rail and headers (decisions 6–8)

> Read CLAUDE.md, 36, this addendum and frame `lib-1-songs-list`. Depends on UN2.
>
> 1. **Rail** (`src/ui/letter-rail.js` `buildRailTicks()`, used from `src/library/view.js` L124 and the Artists list):
>    - Always render A–Z plus #.
>    - Letters with no entries take `letter-rail-dim` (40% opacity, not removed) and jump to the next letter that has entries.
>    - The rail is its own 18px column; list rows get `margin-right: 18px`.
> 2. **Sticky header** (`src/library/view.js` L54–110):
>    - `.letter-head` is 34px.
>    - Sticky with a solid `--bg`/`--sky1` background and a `--line` bottom border.
>    - Rows start below it, never under it.
>    - By artist, it reads "{letter} · {artist}"; by title, just the letter.
> 3. **Rows:** title (16px) and artist (13px muted), one line each, ending with "…". Remove "· MP3 · lossy" (UN5 covers it; check it's gone). Time in mono, then a 44px ⋯ button.
> 4. **Sort chip:** "By artist ▾ · 396 SONGS" (mono caps) becomes a chip "By artist" with "396 songs" (Archivo 13 muted) on the right, matching the crate.
>
> Lint and unit tests pass, and both builds preview with no console errors. Open the PR with the preview link at the top. Do not merge.

**Preview focus:** scroll fast through 400 songs: headers never cover a row, and the rail is the same every time.

---

## LB8: artists list, artist page and songs without an artist (decisions 9–11)

> Read CLAUDE.md, 36, this addendum and frames `lib-2-artists-list`, `lib-1-artist-long`. Depends on LB7, UN13.
>
> 1. **Artists list:**
>    - 46px round photos (the artist's most-played record's cover, cropped round).
>    - Name in Archivo 16/500, ending with "…".
>    - "{n} records · {m} songs" below.
>    - A chevron on the right.
>    - The same rail and headers as LB7.
> 2. **Songs without an artist:**
>    - `parseTags` (`src/library/tags/index.js` L77–79) keeps its 'Unknown Artist' fallback internally.
>    - Every *display* of it is replaced: the Artists list shows one row under "#", "Songs without an artist" / "{n} songs · tag them in Edit info", with a dashed round placeholder. It opens a plain songs list with an "Edit info" hint.
>    - The crate model (`src/crate/model.js` L74, `crateArtistPriority`) no longer builds a record from untagged files (no album tag *and* no artist tag). Those appear only in Songs.
>    - The profile shelf and pressing draws already follow the crate model. Check they skip these too, and say so.
> 3. **Artist page title** (on top of UN13): the name is the page title (Antonio 700 30px, two lines max), and the header row is only "‹ Artists" and ⋯. "6 records · 12 songs" sits under it.
> 4. **"Your most spun" on the artist page:** one line per record (cover, title ending with "…", "{n} plays"). Today the long title shows twice per row.
>
> Lint and unit tests pass, and both builds preview with no console errors. Open the PR with the preview link at the top. Do not merge.

---

## LB9: search and add to playlist (decisions 14, 2)

> Read CLAUDE.md, 36, this addendum and frames `lib-2-search`, `lib-2-add-to-playlist`. Depends on LB2, UN5.
>
> 1. **Search header:** while searching, the search field and "Cancel" are the only header; the library tabs hide. Cancel and Escape restore the view you came from, scrolled where you were.
> 2. **Type filters:**
>    - All · Songs · Records · Artists · Playlists, as chips (filled when on).
>    - Replace the "artist: album: year: More" chips, but keep the typed syntax working in `src/library/search.js`.
>    - Add a muted hint line under the filters only when the query uses the syntax: "Searching artist: Theo".
> 3. **Results:**
>    - A "Top result" section (the best single match of any type).
>    - Then each type with up to three results and "See all {n} {type} ›", which switches the filter.
>    - Artists show round, and Playlists show their mosaic.
>    - No results: "Nothing in your library matches "{q}"." with a "Clear" text link.
> 4. **Add to playlist** (from the song ⋯, UN3):
>    - One sheet: "Add to playlist", with the song's title and artist as the caption.
>    - "New playlist…" first (opens LB2's sheet, then adds the song), then each playlist with its mosaic and count.
>    - Playlists that already have the song show "Already in" and are dimmed.
>    - Tapping adds the song, closes the sheet and toasts "Added to {name}".
>
> Lint and unit tests pass, and both builds preview with no console errors. Open the PR with the preview link at the top. Do not merge.

---

## LB10: the desktop library (decision 15)

> Read CLAUDE.md, 36, this addendum and frame `lib-2-desktop-library`. Depends on LB7, UN17.
>
> 1. **Songs as a table** at ≥1024px:
>    - Columns: # · art · Title · Artist · Record · Time · ⋯, in a `max-width:1080px` column.
>    - Column headers in `.p-label`; clicking Title, Artist or Record sorts by it (the same sorts the chip offers).
>    - Rows are 52px. Title, artist and record end with "…", and hovering a cut-off cell shows it in full (`title` attribute).
> 2. **Sidebar playlists and bins** (`src/shell/sidebar.js` L66 `sidebar-bin-row`): one line each, the name ending with "…", the count right-aligned and `flex:none`.
> 3. Artists and Playlists on desktop use the phone layouts in a wider grid. The crate is already covered by UN17.
>
> Lint and unit tests pass, and both builds preview with no console errors. Open the PR with the preview link at the top. Do not merge.

---

## LA1: when the full dig plays (decision 16)

> Read CLAUDE.md, 36, this addendum and frame `launch-main`. Depends on UN2.
>
> 1. In `src/launch/intro.js`, `runLaunchSequence()` (L244) picks a variant: `full`, `short` or `fade`.
>    - **full:** no launch has played today, *or* none has played since today's sunset. Read sunset from Sundown's own day (`src/sundown/day.js`; the stand-in when there's no location, which UN11 makes seasonal).
>    - **short:** any other cold start.
>    - **fade:** Reduce Motion.
>
>    Store `S.lastLaunchAt` (device-only, not backed up).
> 2. **short:** `stackCount` 6 instead of 18, with the cruise phase cut so the dig is about 600 ms. The rest (catch, landing, room) is the same as full.
> 3. Keep `LAUNCH_ANIM` as the single source of the timings, with a `short` block beside it rather than scattered numbers.
> 4. **Tests:** the variant chosen for first-of-day, a second launch an hour later, the first after sunset, a second after sunset, and Reduce Motion.
>
> Lint and unit tests pass, and both builds preview with no console errors. Open the PR with the preview link at the top. Do not merge.

---

## LA2: one mark (decision 17)

> Read CLAUDE.md, 36, this addendum and frames `launch-r1`–`r3`. Depends on LA1.
>
> 1. `#launchWordmark` (`miziki.html` L71; `intro.js` L61, L369):
>    - It shows the −12° angled cut (the `F` cut from 22_TYPE), not the upright one.
>    - About 110px wide at the top of the stage, fading to 70% during the dig and 25% at the catch.
>    - It never moves to the bottom or grows.
> 2. Remove whatever draws the large upright "MIZIKI" at the bottom during the catch and pull (the wordmark's catch/pull animation, driven by `--launch-wordmark-duration`). Remove its CSS too.
>
> Lint and unit tests pass, and both builds preview with no console errors. Open the PR with the preview link at the top. Do not merge.

---

## LA3: the exact landing and the room (decisions 18, 19, 21)

> Read CLAUDE.md, 36, this addendum and frames `launch-r3`–`r5`, `launch-desktop`. Depends on LA2, LB5.
>
> 1. **Measure the target.**
>    - Before the catch, read the live `.crate-card.crate-current`'s `getBoundingClientRect()` in the crate already rendered under the overlay (it's there from the first paint; `restoreLibrary()` runs underneath).
>    - Convert it into the stage's coordinates (the stage is scaled by `--launch-scale`).
>    - If the crate isn't ready in time (the existing `readyWaitMs` race), fall back to today's landing.
> 2. **Land on it.**
>    - The caught record animates to that rect: position, size and the crate's tilt (`flowPose()` for the current card).
>    - The cards below it animate to the crate's own stack poses.
>    - When they arrive, hide the overlay in one frame (`finishLaunch(0)`, L304). **No cross-fade**; remove the 600 ms `crossfadeMs` path for this case.
> 3. **The room fills in.** Add a `launch-room` class to `#app` that starts with the info card, mini-player, tab bar, header and the neighbouring-section bar transparent and 8px low. Remove it in steps:
>    - info card at 0 ms
>    - mini-player and tab bar at 100 ms
>    - header at 200 ms
>    - neighbour bar at 300 ms
>
>    Each takes 200 ms ease-out; reduced motion does all at once with no movement.
> 4. **Desktop.** The stage centres on the crate's column (the content area's rect, right of the sidebar), not `window.innerWidth/2`. The sidebar and bottom bar join the room at 100 ms.
> 5. Check light theme, night, and a 390×664 phone.
>
> Lint and unit tests pass, and both builds preview with no console errors. Open the PR with the preview link at the top. Do not merge.

**Preview focus:** open the app cold: no double cover at the landing, and the room fills in top-down rather than all at once. Same on desktop.

---

## LA4: first open (decision 20)

> Read CLAUDE.md, 36, this addendum and frames `launch-f1`–`f3`. Depends on LA3, UN5.
>
> 1. With an empty library, the dig uses Miziki sleeves only, at the short length (about 1.5 s total).
> 2. The caught Miziki sleeve lands where the crate card will sit and **stays** as the empty crate's record: a still Miziki sleeve drawn by the crate for an empty library.
> 3. The UN5 empty note ("The crate is empty." with Choose files / Choose folder / Play a test tone) rises under it as part of the room. The old dashed box is already gone after UN5; check nothing of it remains.
> 4. After the first import, the Miziki sleeve leaves as the first real record arrives (the crate's normal arrival).
>
> Lint and unit tests pass, and both builds preview with no console errors. Open the PR with the preview link at the top. Do not merge.

---

## Not in this addendum

- The crate's own animation, scrolling physics and pull-up are unchanged.
- The launch's dig itself (the flick timing curve, the sky, the haptic tick, the pressing peek) is unchanged; only when it plays, the mark, the landing and the room change.
- Lyrics, credits and the Songs ⋯ menu contents are covered by 36 (UN3).

## Test-setup notes (additions to 36's)

- **Large test library:** generated with ffmpeg as 1-second silent MP3s with cover art. **Put `-t 1` before the `anullsrc` input** (`-t 1 -i anullsrc=…`). After it, it limits the image input instead, and ffmpeg encodes silence forever. That froze the test workspace once during this pass.
- **Duplicate prompts:** to get past today's per-file sheet during a big test import, click `#dupKeepBoth` whenever it shows (poll every 500 ms). After LB1, there's one sheet at the end.
- **Playlists:** `S.playlists.push({name, items: [track.id, …]})`. Items are `S.tracks[i].id`, not `trackIdentityKey()`.
- **Filming the launch:** reload with the library already imported and take a screenshot every 150 ms for about 6 seconds. First open: a fresh context before any import.
