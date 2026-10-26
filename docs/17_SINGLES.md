# The 7″ picture sleeve (for singles)

A record with exactly one side and exactly one track — a single, per Ken's
own definition ("a single should be one side with ≤1 track") — opens into a
**picture sleeve** instead of the gatefold. Sealed records and loose tracks
are unaffected; everything else still opens the normal gatefold.

## Why a new view, not a smaller gatefold

The gatefold's whole shape (`src/gatefold/view.js`) is built around things a
single doesn't have: a left info panel *and* a right record panel joined by
a 3D swing/page-turn camera, plus a tracklist with side-flip. For one track
on one side, that's a lot of machinery animating around nothing — there's no
second panel's worth of tracklist, and no side to flip to.

The real template already in the codebase is the **sealed-record sheet**
(`src/gatefold/sealed-sheet.js`): one flat container, a plain fade/scale
open-close (no camera), that already reuses the gatefold's own tracklist and
social-controls builders. The picture sleeve follows that same shape, not
the gatefold's — right down to reusing `sealed-sheet.js`'s own open/close
timing (`sleep(REDUCED ? 150 : 250)`).

## What counts as a single

`isSingleRecord(item)` — `gatefoldTrackIndices(item).length === 1`. This is
a track-**count** check, nothing else. It is deliberately independent of
`record-art/format.js`'s own duration-based format table (`formatForLongestSide()`)
— a one-track record that happens to run long (an extended 12″ mix, a DJ
edit) still opens the picture sleeve, and still shows whatever format chip
`formatChipText()` actually computes for it (10″, 12″ single/EP, even a
12″ LP at the far extreme), never a forced "7″" label. The view is named for
the common case, not a guarantee about every record it shows — the same
judgment call `record-art/format.js`'s own `TEN_INCH_MAX_SEC` boundary
documents inline for a different question in the same table.

There is no existing "is this a single" helper to reuse —
`shell/ceremony-timing.js`'s `splitSides()` returns `null` for both a
single-track record and a zero-track one, so it can't by itself tell them
apart.

## Where it hooks in

`src/crate/view.js`'s `openCrateAlbum(item)` goes: loose-track early return
→ sealed check → (new) single check → `openGatefold(item)`:

```js
if(isAlbumSealed(item.albumId)){ openSealedSheet(item); return; }
if(isSingleRecord(item)){ openPictureSleeve(item); return; }
openGatefold(item);
```

Sealing takes precedence over format — an unplayed sealed single still
opens as sealed (break the seal first, same as today). Desktop gets the
same overlay as phone: there's no tap-triggered desktop branch left in
`openCrateAlbum()` to preserve (the desktop crate detail panel tracks the
*front* record automatically, independent of tap, since CR10).

## New module: `src/gatefold/picture-sleeve.js`

Same shape as `sealed-sheet.js`: one module-level state object (`SLEEVE =
{item, returnFocus}`, null when closed — no `panel`/`mode`, since there's
nothing to switch between), registered with the nav stack the same way:

```js
openLayer('picture-sleeve', closePictureSleeve,
  { instantClose: closePictureSleeveInstant, container: sleeve });
```

**Content, top to bottom, one scrollable column** (no left/right split):

1. **The sleeve face** — large square cover art, with
   `record-art/peek.js`'s existing `buildPeekDisc(t)` showing the record
   peeking out of the top edge — a static decorative touch, not animated;
   the same drawing the crate's own pull-up and the launch intro already
   use, so this costs no new visual drawing code, just new positioning CSS.
2. Title / artist, and a format chip (`formatChipText()`,
   `record-art/format.js`) right under the title — the same chip style AU10
   already established for a 45 elsewhere (crate sticker, catalog card,
   liner notes), computed from the real format table regardless of what
   triggered this view (see "What counts as a single" above).
3. One **Play** row — the single's own one track, its own duration, and a
   now-playing state when it's the one actually seated on the platter (the
   same `S.shellAlbumId === item.albumId && !S.platterEmpty` check
   `gatefold/view.js`'s own module-private `gatefoldOnPlatter()` already
   makes — duplicated here as a one-liner rather than exported for it, the
   same "small shared formula, don't wire two modules together for one
   line" call the project already makes elsewhere, e.g. `sync/images.js`).
   Tapping it starts playback the same way the sealed sheet's own row tap
   does (`sealedHandoffPlay` — reuse the existing ceremony/hand-off-to-full-
   player logic wholesale, never a new flight path, since there's no
   second record-panel for one to resolve into here either).
4. **Everything the gatefold's own left panel shows, kept as a whole** —
   per Ken ("keep it all"): `gatefold/view.js`'s own `buildGatefoldLeftPanel(item)`
   (now exported for this reuse) is called verbatim, appended right after
   the Play row — liner notes/credits if the file has any, the meta line,
   and the shared social controls row (`gatefoldSocialControlsHTML(item)` —
   star rating, sleeve note, pin). No new liner-notes/credits code.

   One accepted, minor overlap: `buildGatefoldLeftPanel()`'s own
   no-liner-notes fallback branch writes an `<h3>` album title of its own
   (it was built for a panel that otherwise shows no title at all) — in the
   picture sleeve, that can repeat the title the sleeve's own head already
   shows for a single with no liner notes in its file. Reusing the builder
   verbatim, as asked, was judged worth this small, rare duplication rather
   than forking the function for one case.

**No tracklist, no side-flip, no 3D camera.** Open/close is a plain fade
(per Ken: "Fade in open"), the same ~150–250ms timing the sealed sheet
already uses, not the gatefold's ~950ms swing — there's no second panel to
swing to.

## What's explicitly *not* changing

- Sealed singles still go through the sealed-record sheet first.
- Desktop gets the same overlay as phone.
- Everything with 2+ tracks, or 2+ sides, is completely untouched — still
  the regular gatefold.
- The format table (`record-art/format.js`) is untouched — this feature
  only changes which *view* opens, never how a record's physical format is
  computed or displayed.

## Verification

Playwright, both production build targets, plus the existing device
checklist's crate/gatefold rows: tap a genuine one-track-one-side record in
the crate and confirm the picture sleeve opens (fade, not a swing); confirm
play starts from its Play row and from the sleeve/disc itself; confirm a
2+-track or 2+-side record is unaffected (still the gatefold); confirm a
sealed single still opens the sealed sheet first, and the picture sleeve
only appears once that seal is broken.
