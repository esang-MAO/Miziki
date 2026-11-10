/* ================= LB3: the playlist mosaic cover =================
   docs/36A_LIBRARY_AND_LAUNCH.md decision 3 -- "Playlists show as a
   mosaic of four different records' covers, not one cover repeated four
   times." The two functions below are the pure selection logic (which
   albumKeys land in which cell, for a given count of *distinct* records
   in the playlist) -- kept separate from the DOM-building/art-fetching
   half in src/library/view.js, same "extract the pure core" split
   playlist-sheet.js's playlistNameCollides() and duplicates-logic.js
   already use, so the cell-count rules are unit-testable with plain
   arrays of album keys and no DOM/IndexedDB involved. */

// First four *different* records a playlist's present tracks resolve to,
// in the order they appear in the playlist (first occurrence of each
// albumKey wins) -- "present" because a forgotten track's id stays in
// pl.items but is skipped here, the same present = pl.items.map(idxOf).
// filter(i => i >= 0) rule view.js's own playlist body already applies.
// `keyFn` defaults to real tracks' own albumKey() (record-art/tiers.js)
// but takes a plain function so this stays callable with bare fixture
// objects in tests, never importing tiers.js (and so never S.tracks)
// itself.
export function distinctAlbumKeysInOrder(presentIdx, tracks, keyFn){
  const seen = new Set();
  const keys = [];
  for(const i of presentIdx){
    const t = tracks[i];
    if(!t) continue;
    const k = keyFn(t);
    if(seen.has(k)) continue;
    seen.add(k);
    keys.push(k);
    if(keys.length >= 4) break;
  }
  return keys;
}

// The addendum's own cell-count rules, given the distinct albumKeys
// already capped at 4 by distinctAlbumKeysInOrder() above:
//   4 (or more, already capped): one cover per cell, 2x2.
//   3: the three, plus the first one again in the last cell -- so the
//      mosaic always reads as a full 2x2, never a grid with one corner
//      conspicuously blank.
//   2: both -- mosaicLayout() below is what turns this into a diagonal
//      split rather than a second plain 2x2; this function only decides
//      *which* albumKeys are used, not how they're laid out.
//   1: the one.
//   0: empty -- the caller renders the UN5 empty-note treatment instead
//      of any cover cells (see src/library/view.js's playlistMosaicArt()).
export function mosaicCells(distinctKeys){
  const n = distinctKeys.length;
  if(n === 0) return [];
  if(n === 1) return [distinctKeys[0]];
  if(n === 2) return [distinctKeys[0], distinctKeys[1]];
  if(n === 3) return [distinctKeys[0], distinctKeys[1], distinctKeys[2], distinctKeys[0]];
  return distinctKeys.slice(0, 4);
}

// Which CSS layout a *distinct-record* count maps to. Not simply
// mosaicCells(...).length -- 3 distinct records pads to 4 cells (above)
// but still reads as "3 covers, one repeated," a plain 2x2 grid, the same
// shape 4+ uses; 2 is the one count the addendum calls out as its own
// shape ("split diagonally"), not a 2x2 with two cells.
export function mosaicLayout(distinctCount){
  if(distinctCount <= 0) return 'empty';
  if(distinctCount === 1) return 'single';
  if(distinctCount === 2) return 'diagonal';
  return 'grid';   // 3 (padded to 4 cells) and 4+ both tile a 2x2 grid
}
