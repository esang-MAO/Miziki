/* ================= LB4: playlist row drag reorder =================
   docs/36A_LIBRARY_AND_LAUNCH.md decision 4 -- "Rows reorder by drag
   handle, which replaces the ▲▼ buttons on every row." The two pure
   functions below are the part of that gesture worth testing without a
   DOM (same "extract the pure core" split playlist-sheet.js's
   playlistNameCollides() and playlist-mosaic.js already use): which slot
   a dragged row should land in given the pointer's Y position, and how a
   dropped order folds back into a playlist's full id list once forgotten
   (not-currently-present) entries are accounted for. The pointer-event
   wiring itself (src/library/view.js's wirePlaylistDrag()) stays
   DOM-only, same split moverCtl()/library/view.js already draws between
   "which index" and "how it's drawn." */

// dragTargetIndex(firstRowTop, rowHeight, count, pointerY): rows are a
// uniform height list starting at firstRowTop (the first row's own,
// unmoving, top -- unmoving because every row is the same height, so
// permuting their order never changes where row slot 0 begins). Returns
// which 0-based slot the pointer's current Y now sits over, clamped to
// the list's own bounds -- the simplest "which slot is this row now in"
// rule for a uniform-height list, no per-row rect bookkeeping needed as
// rows swap during the drag.
export function dragTargetIndex(firstRowTop, rowHeight, count, pointerY){
  if(!count || count < 1) return 0;
  if(!rowHeight || rowHeight <= 0) return 0;
  let idx = Math.round((pointerY - firstRowTop) / rowHeight);
  if(idx < 0) idx = 0;
  if(idx > count - 1) idx = count - 1;
  return idx;
}

// reorderPresentIds(items, finalPresentIds): `items` is a playlist's full
// id order (F3 spec -- ids, not positions), including any forgotten
// track's id the playlist detail page never shows a row for.
// `finalPresentIds` is the *visible* rows' ids, in their new (post-drag)
// order. Walks `items` in its existing order and, at each slot that held
// one of the present ids, substitutes the next id off finalPresentIds in
// turn -- so a forgotten entry elsewhere in the list keeps its own
// relative place untouched, the same guarantee moverCtl()'s own
// fullPos-based single-step move already gives, just folding a whole new
// present-order back in at once instead of swapping two neighbours.
export function reorderPresentIds(items, finalPresentIds){
  const present = new Set(finalPresentIds);
  let p = 0;
  return items.map(id => present.has(id) ? finalPresentIds[p++] : id);
}
