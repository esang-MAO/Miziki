# 29 · Gatefold

The gatefold becomes the one way into a record: sized like the real thing, turned over to see its back, opened by peeling the wrap, and readable without squinting. The pass also fixes what the Nov 4 audit found broken or missing in today's gatefold (`src/gatefold/view.js`, as of PR #318).

Follows CLAUDE.md's **How Miziki behaves** rules. The reasons stay off screen: copy is plain and standard and never explains itself.

**Decisions (Ken, Nov 4):**
- **Fix first:** the Record share card gets its whole payload; the inside-left cue always shows; THE MASTER block and the format line reach the phone; tracklist and liner-note text move off the 12px caption floor.
- **Format-true sleeves:** a 10″ or 7″ record with more than one track opens a smaller fold with a true-size disc and label. A one-track single keeps the picture sleeve (docs/17). A multi-disc album gets one pocket per disc.
- **Back cover:** every record has one. Swipe the closed sleeve to turn it over. With no image of its own, a record gets the **Miziki default back**: one ink on plain stock, filled from its own data. Users can add their own back image (choose an image or photograph their copy) and go back to the default.
- **Liner notes are editable**, for your copy only. Your text replaces what the files carry; "Use the notes from the files" undoes it. Never published to the social layer; the 140-character sleeve note stays the thing friends see.
- **Peel to open:** a sealed record opens by peeling its wrap, replacing the sealed sheet as the way in. You can turn a sealed record over and read its back through the wrap first.
- **Long-press a track:** Play next, Add to queue, Favorite, and that track's own credits (read-only).
- **Booklet:** a sidecar image set (or PDF, see GF10) opens as a page-flip viewer from the inside-left panel.
- **After sunset, less:** Share, Pin, the format line and the wear line step back until morning. Notes, credits, the sleeve note and the tracklist stay.
- **One album view everywhere:** the Albums tab, an artist's albums and desktop all open the gatefold. `renderAlbumDetail()` retires.
- **Out of scope for now:** editable credits, and a "fix this name everywhere" merge on the person view. Both are listed under **Later**.

**Designs:** `docs/design/gatefold/` (canvas "Miziki Gatefold", frames 01–11 plus 02b/02c and 06b/06c, and a README). Frames are drawn against the real tokens, fonts, sleeve-interior colors, stock paper and pressing palettes; the albums in them are invented.

**Order:** GF0 → GF12, one PR each, the usual routine (preview, merge, after-merge check). Dependencies are noted per step; GF1 and GF2 come first because later steps build on their geometry and payload.

**One in, one out:** each step's PR description names what it removes, absorbs or simplifies. The big removals are the sealed sheet (GF8) and `renderAlbumDetail()` plus the desktop crate detail panel's separate layout (GF12).

**Rules that apply throughout:**
- Tag text stays out of `innerHTML` (the ESLint rule). Back-cover and liner-note text are built with `textContent`/`createElement`.
- Every new saved key goes into `serializePrefs`/`parsePrefs`, gets a default in `S`, a round-trip test in `tests/unit/prefs.test.js`, and a row in CLAUDE.md's backup table when it gets its own carve-out.
- No type or spacing value outside the token scale without a comment saying why. Sleeve interiors keep their locked dark tokens (`11-gatefold.css`'s `.gf-right, .gf-face, .gf-flat-tracks` block) in every theme.
- Reduced motion: every new animation has a plain crossfade fallback under `REDUCED`.

---

## GF0: designs and superseded notes (docs only)

> Read CLAUDE.md first. Docs-only PR.
>
> 1. Add `docs/design/gatefold/` (the canvas files and README) and this plan doc if they aren't in the repo yet.
> 2. Add a short "**Superseded by docs/29_GATEFOLD.md**" note at the top of each affected section, without rewriting the history: `docs/13_CRATE.md` (gatefold entry is crate-only; the sealed sheet as the way into a sealed record), `docs/DESKTOP_LAYOUT.md` (the crate detail panel replacing the gatefold on desktop), `docs/17_SINGLES.md` (only the line saying every non-single opens the 12″ gatefold — the picture sleeve itself stays), `docs/16_AUDIO.md` (THE MASTER block: now delivered on the phone by GF1), and `docs/22_TYPE.md`'s TY3 gatefold row (track titles move to `--fs-row`).
> 3. CLAUDE.md's repo-layout entry for `src/gatefold/` gets a "planned: docs/29" pointer only; describe new modules when they land, not before.
>
> No code. Open the PR. Do not merge.

**Preview focus:** none (docs only).

---

## GF1: fixes to today's gatefold

> Read CLAUDE.md, this plan and `docs/design/gatefold/README.md` (frames `01`, `02`, `03`).
>
> 1. **Share record payload.** `gatefoldSocialControlsHTML()` (`src/gatefold/view.js`) passes only `{album, artist, year, albumId}`, so the Record card (`src/share/record-card.js`) draws with no cover, pressing, speed, rating or note. Gather the full `data` the composer documents: `art` (the crate's `L` tier via `getCrateArtURL(albumId,'L')`, falling back to `thumbURL`), `variant`/`look`/`metal` (the same `discLook()` resolution `applyGatefoldDiscVariant()` uses, off `albumPressingTrack()`), `speed` (from `albumFormatFor()`), `rating` and `note` (`MizikiSocial.getAlbumSocial()`), `friendsCount` (null for a record you own, per the friends-sticker rule). Put the gathering in one small exported function so the picture sleeve and any later entry point share it.
> 2. **The inside-left cue always shows.** `openGatefold()` hides `#gfLeftCue` unless the album has liner notes or credits, but the left panel always holds Your copy (rating, sleeve note, pin, share). Show the cue for every record. Render it as the 20px panel edge in frame `01`, a `<button>` with `aria-label="Inside left panel"`, and the mirror edge on the left panel ("Tracks ›") going back.
> 3. **THE MASTER block on the phone.** `buildGatefoldLeftPanel()` uses `albumLinerNotes()` alone; only the desktop side panel's `renderLinerNotes()` shows `albumDynamicsNote()`. Export `buildDynamicsNoteEl()` from `library/credits.js` and add the block under the credits (frame `02`), shown only when `albumDynamicsNote()` returns a value.
> 4. **The format line** under the title in `#gfInfo` (mono, `--fs-caption`): format name, speed, the file's format/bit depth/rate as the player's spec line already words it, track count and length. One shared formatter with `crate/model.js`'s `catalogLineFor()` if their wording lines up; otherwise say in the PR why they differ.
> 5. **Readability:** track titles `--fs-row` (16px, 500), numbers and durations `--fs-body` (14px); liner-note prose and credit rows `--fs-body`. Credit names drop their inline `color`/`textDecoration` style writes in `gatefoldCreditLink()` for a class in `11-gatefold.css` (`--paper`, 1px underline, 3px offset).
> 6. **Pin and Share** move out of the scrolling panel to a row just under it (frame `02`), so the sleeve note isn't buried under them. The rating and sleeve note stay in the panel.
> 7. **Wear line:** "Well loved · since March 2025" gains the phase this record has been played in most, from `S.albumPhaseCounts` ("· mostly spun at dusk"), only once the record has at least five counted plays and only when wear is on. No counts, per docs/24.
> 8. **Tests:** the share payload gatherer (pure — owned record gets `friendsCount: null`, unrated gets `rating: null`); cue visibility for an album with no liner notes; the phase word (most-played phase, threshold, wear off → none).
>
> Lint and unit tests pass; both builds preview with no console errors. Open the PR with the preview link at the top. Do not merge.

**Preview focus (Ken, iPhone):** open a record with no liner notes and find the "‹ Inside" edge; Share record and confirm the card shows the cover, pressing and your note; open a measured album and see THE MASTER block; the tracklist reads without squinting.

---

## GF2: gestures and panel geometry

> Read CLAUDE.md and this plan. Depends on GF1.
>
> 1. **Drag to close follows the finger.** Today `#gfInfo`'s pointermove calls `closeLayer('gatefold')` as soon as it passes 50px. Track the drag live (translate the overlay, with pointer capture), then close past a distance/velocity threshold or spring back. Same easing family as the rest of the gatefold; `REDUCED` closes on release with the plain fade.
> 2. **Geometry from one place.** Replace the hardcoded `175px` pan, the `390×740` reference size and the 350px panel literals with values derived from one `gatefoldGeometry(format, viewport)` function (pure, exported, tested), returning panel size, pan distance, pocket size and disc diameter. In this PR it returns today's 12″ numbers for every record, so nothing changes visually. GF3 feeds it real formats.
> 3. **Tests:** `gatefoldGeometry()` for the 12″ case reproduces today's numbers exactly.
>
> **One in, one out:** the literals scattered through `view.js` and `11-gatefold.css` become one function and three custom properties.

**Preview focus:** drag the info strip down slowly and let go halfway (springs back), then flick it (closes). Nothing else should look different.

---

## GF3: format-true sleeves

> Read CLAUDE.md, this plan and the README (frame `04`). Depends on GF2.
>
> 1. `openGatefold()` reads `albumFormatFor(trackIdx, S.tracks, override)` (`src/shell/ceremony-timing.js`) and passes it to `gatefoldGeometry()`: 12″ panel 350px, 10″ 292px, 7″ 204px (proportional), centered with the cue on the panel's own edge. `isSingleRecord()` (docs/17) still sends one-track singles to the picture sleeve first.
> 2. The pocket disc is drawn at true relative size, with a label sized like a real record's (the same ratios `record-art/format.js`'s format table and the Oct 31 platter sizes use — a 7″ label reads larger against its disc). The pocket's thumb cut scales with it.
> 3. **Dead wax on the pocket disc:** when the disc is out (`gf-disc-out`, or after a crate pull), draw its run-out etching from `etchingFor(releaseId, side)` along the dead-wax ring, in `var(--data)` at the 11px physical-detail size CLAUDE.md allows (the same text repeats on the platter).
> 4. The short-viewport flat mode and the wide (iPad) mode keep working for every size.
> 5. **Tests:** `gatefoldGeometry()` for 10″ and 7″; a 4-track 45 opens the 10″ fold, a one-track single still opens the picture sleeve.

**Preview focus:** open a 10″ EP and a 12″ LP back to back — the EP should look smaller in hand, its disc and label sized like a real 10″.

---

## GF4: one pocket per disc

> Read CLAUDE.md, this plan and the README (frame `05`). Depends on GF3.
>
> 1. When `splitSides()` splits by disc (multi-disc albums), the sleeve area shows one pocket per disc side by side, each holding that disc's pressing (the same pressing for every disc of one album, as now). The disc whose side is playing shows its pocket empty with "On the platter".
> 2. The tracklist gains a "Disc N" eyebrow above each disc's first side. Track numbers keep counting straight through, as now.
> 3. Three or more discs: pockets scroll horizontally inside the sleeve area; never shrink below the GF3 disc size.
> 4. **Tests:** pocket count matches the disc split; the empty pocket follows the playing disc.

**Preview focus:** a double LP shows two pockets; play side C and the second pocket empties.

---

## GF5: the back cover and the Miziki default back

> Read CLAUDE.md, this plan and the README (frames `06`, `06c`). Depends on GF3.
>
> 1. **Turning it over.** A horizontal swipe on the closed sleeve (before the swing, or with the gatefold closed back up) turns it over with a short Y-axis flip; two dots under the sleeve show Front/Back. Tapping the back, or "Open the gatefold", opens the gatefold as usual. Keyboard: a "Turn over" control reachable by Tab.
> 2. **The default back** (new module `src/gatefold/back-cover.js`): built as DOM, not an image, from the record's own data — artist, title, both sides with track times and side totals (from `splitSides()`), the catalogue line (`MZK-` plus `matrixTail(releaseId)`, so it matches the dead wax), format · speed · STEREO · total time, and "℗ year label" only when the tags carry them. One ink (`#26202C`) on `--stock-card` with a printed frame and a faint groove ring at one corner; the wordmark from `wordmarkEl()` with ink letters and `--amber-shade` rings, the back's only amber.
> 3. **Fitting the format:** a 10″ or 7″ back drops to a smaller type step and, when the tracklist still doesn't fit, shows each side's first tracks plus "and N more" in the side heading's own row. No scrolling on a back.
> 4. A worn record's back carries the same wear classes as its sleeve (ring wear, softened edges) via `30-wear.css`, and so does the gatefold's front cover face, which today stays pristine.
> 5. **Tests:** the default back's data builder (pure): sides and totals, label/year omitted when absent, catalogue line matches `matrixLineFor()`'s tail, the overflow rule for a long 7″.

**Preview focus:** turn over three records of different lengths; the backs should read like real generic jackets, with your well-played records looking played.

---

## GF6: your own back cover

> Read CLAUDE.md, this plan and the README (frame `06b`). Depends on GF5.
>
> 1. A ··· button on the back opens a small menu: **Choose an image…**, **Photograph your copy** (`<input type="file" accept="image/*" capture="environment">`), **Use Miziki default** (checked when active). The same three choices appear in the track edit sheet as a "Back cover" row.
> 2. **Storage:** the image is cropped square and re-encoded with the existing custom-cover path (`cropSquareImage()` in `library/edit.js`, then `prepareCoverUpload()` in `src/sync/images.js`), stored in the `artwork` store under an album-keyed id (`back:<albumKey>`) — no new store, no schema bump. Signed in, it uploads to the private `covers` bucket like a custom cover, with an album-keyed claim in the backup doc.
> 3. **Sync and revert:** last write wins per album; "Use Miziki default" is a `hash: null` tombstone that also wins by timestamp, the same as a custom cover's revert. Add the row to CLAUDE.md's backup table. "Forget library" leaves it in place so it reconnects when the album returns.
> 4. A user back image replaces the default everywhere the back shows (the turned-over sleeve, desktop). The default stays the fallback when the image can't load.
> 5. **Tests:** the album-keyed claim's merge (last write wins, tombstone wins, survives Forget library); the menu's checked state.

**Preview focus:** photograph a real record's back, see it on the sleeve, switch back to the default, then sign in on a second device and see the same back.

---

## GF7: editable liner notes

> Read CLAUDE.md, this plan and the README (frames `02b`, `02c`). Depends on GF1.
>
> 1. **Data:** a new album-keyed override `S.albumLinerNote` (keyed by `albumKey()`/`normKey(album)`, the same keying as `S.albumFormat`), persisted with the other album-keyed meta, and added to `backup-doc.js`'s `itemWriteFields` so it merges with `mergeKeyedLastWriteWins` exactly like `albumFormat`. A revert writes a tombstone that wins by timestamp. Excluded from the social layer entirely — never in `miziki-social.js`'s `buildItems()` payload.
> 2. `albumLinerNotes(album)` returns the override when present, otherwise today's longest-qualifying-comment pick. Every reader (gatefold, desktop side panel, picture sleeve) follows from that one function.
> 3. **UI:** a "Liner notes" heading at the top of the inside-left panel, with "yours" beside it when the override is active and an **Edit** button. The sheet (frame `02c`): Cancel / Liner notes / Save; a textarea prefilled with what the gatefold currently shows; a "From the files" disclosure with the original text and which track's comment it came from; a plain line that this changes only your copy; **Use the notes from the files** in `--danger` at the bottom. An album with no notes at all shows "Add liner notes" in place of the empty-state line.
> 4. Text is stored as typed (trimmed, capped at a generous length such as 4,000 characters), rendered with `textContent` and `white-space: pre-line`.
> 5. **Tests:** override beats file comment; revert restores the file pick; merge (last write wins per album, tombstone); never included in the social payload; prefs/backup round-trip.

**Preview focus:** edit a record's notes, close and reopen the gatefold, revert, and check the desktop side panel shows the same text.

---

## GF8: peel to open

> Read CLAUDE.md, this plan and the README (frame `07`). Depends on GF5.
>
> 1. A sealed record opens to its sealed front: cover under shrink wrap, the NEW sticker on the wrap. Dragging from the top-right corner peels the wrap following the finger; past the threshold it comes away, the seal breaks (`breakSeal()`), and the gatefold swings open.
> 2. **Peeling breaks the seal**, the same as a first play does today. Playing from the sealed front (the crate's quiet play, `sealedQuietPlay()`) still breaks it too.
> 3. "Turn it over first" shows the GF5 back through the wrap (the same sheen layer over it).
> 4. **One in, one out:** `src/gatefold/sealed-sheet.js` and its markup in `miziki.html` retire. `crate/view.js`'s sealed branch opens the sealed front instead; move `sealedQuietPlay()` somewhere that survives (e.g. `library/sealed.js` or the new module) before deleting the sheet.
> 5. `REDUCED`: tap the corner to peel, with a crossfade.
> 6. **Tests:** peel breaks the seal and persists it; a sealed record never opens the gatefold without the seal breaking first; the quiet-play path still works.

**Preview focus:** import a new album, peel it open slowly, stop halfway (it settles back), then finish the peel.

---

## GF9: long-press a track

> Read CLAUDE.md, this plan and the README (frame `08`).
>
> 1. A long press (≈450 ms, with a haptic tick via `ui/haptic.js`) on a gatefold track row opens a small sheet: the track's title, side and length; **Play next**, **Add to queue**, **Favorite** (the system playlist in `library/favorites.js`); and **This track's credits** — that one track's own role rows and ISRC, read-only, names linking to the person view as today.
> 2. A tap still plays, exactly as now. A long press never starts playback. Scrolling the tracklist never triggers it (cancel on movement past ~8px, the same lock the panel swipe uses).
> 3. Queue actions go through `player/queue.js`'s existing exports; nothing new in the queue's own logic.
> 4. **Tests:** the track-credits builder for one track (pure); long press vs scroll vs tap discrimination.

**Preview focus:** long-press a row while something else plays; Play next, then confirm the queue.

---

## GF10: the booklet

> Read CLAUDE.md, this plan and the README (frame `09`).
>
> 1. **Source:** sidecar images picked at import (a folder named `booklet`, `scans` or `artwork` beside the audio files, or images whose names start with `booklet`), or added later from the inside-left panel ("Add booklet pages…"). Pages are stored device-only in the `artwork` store, album-keyed and ordered by file name; excluded from backup (like audio and embedded art) — add the row to CLAUDE.md's table.
> 2. **Viewer:** a full-screen layer registered with `nav-stack.js`: page-turn on swipe, pinch to zoom, a thumbnail strip, "N / M", Done. Entry from the inside-left panel ("Booklet · N pages"), only when pages exist.
> 3. **PDF** needs a renderer bundled with the app (no CDN, per CLAUDE.md's security rules). Leave PDF out of this PR; the PR description says what bundling pdf.js would cost in size so Ken can decide on a follow-up.
> 4. **Tests:** page detection rules at import; ordering.

**Preview focus:** import an album with a booklet folder and page through it.

---

## GF11: after sunset, less

> Read CLAUDE.md, this plan and the README (frame `10`).
>
> 1. From the day model's sunset phase until sunrise (`src/sundown/day.js`), the gatefold hides Share record, Pin, the format line and the wear line, and dims the sleeve paper and label slightly. Notes, credits, the rating, the sleeve note and the tracklist stay. Nothing on screen says why.
> 2. Changes apply when the gatefold opens; an open gatefold doesn't change under the user mid-look. Pure mode and Sundown off follow the same sky (this is about time of day, not playback speed).
> 3. Share and Pin stay reachable at night from the record's ··· menu, for someone who looks for them.
> 4. **Tests:** which controls show by phase (pure).

**Preview focus:** open the same record before and after sunset.

---

## GF12: one album view everywhere

> Read CLAUDE.md, this plan and the README (frame `11`). Depends on GF1–GF4 at least.
>
> 1. The Albums tab's drill-down and an artist's album drill-down (`library/view.js`, the two `renderAlbumDetail()` callers) open the gatefold instead, following the same sealed → single → gatefold order `crate/view.js`'s `openCrateAlbum()` uses. Closing returns focus to the row that opened it.
> 2. **Track order moves into the gatefold:** `renderAlbumDetail()` holds the Auto/Title/Manual sort bar and the manual mover controls. They move to the gatefold's ··· menu as "Track order", which turns the tracklist into a reorder mode in place. Saved through the same `S.albumOrder`/`S.albumSort` paths and `touchBackupKey('albumOrder', …)`.
> 3. **Desktop:** the crate detail panel is replaced by the gatefold's wide spread (both panels flat, THE MASTER and booklet in the inside-left, the pocket and a single "Play the record" primary button under it). The gatefold's existing `gf-wide` mode is the starting point.
> 4. **One in, one out:** `renderAlbumDetail()` and the separate desktop detail-panel layout retire. Update CLAUDE.md and docs/DESKTOP_LAYOUT.md's description of current state.
> 5. **Tests:** both library entry points open the gatefold; manual order survives the move (same saved order before and after).

**Preview focus:** open the same album from the crate, the Albums tab and an artist page — all three should be the same gatefold. Reorder an album's tracks from the gatefold. On desktop, pick a record in the crate and see the open spread.

---

## Later (not in this plan)

- **Editable credits**: per-track and album-level, through the track overlay system, with a decision on whether friends see edited or file credits (`release_credits`) and moderation for hand-typed names.
- **Fix this name everywhere**: rename or merge one person across the library from the person view.
- **PDF booklets** (GF10 follow-up, if the size cost is acceptable).
- **Artist-designed backs and shaped pressings** for the artist pages idea.
- **MusicBrainz fill-in** for missing credits and label/year, with precedence: your edit, then the files, then MusicBrainz.
